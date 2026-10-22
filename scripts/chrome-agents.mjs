#!/usr/bin/env node
/**
 * List (and optionally kill) Chrome instances that an AGENT launched — never your own browser.
 *
 * Why this exists: the L2 runtime pass (feature-runtime-tester) drives a headless Chrome via
 * the chrome-devtools MCP server. When a run ends badly — the agent is interrupted, the MCP
 * server is replaced, the session is cleared — the browser is left running with a ~100MB
 * temp profile that nothing will ever reclaim. Those processes are invisible (headless) and
 * indistinguishable from your own Chrome in Activity Monitor.
 *
 * The marker is absolute, not a heuristic: puppeteer always launches with
 *   --user-data-dir=<TMPDIR>/puppeteer_dev_chrome_profile-XXXXXX
 * Your own Chrome uses the default profile and never carries that flag, so it can never
 * appear in this list.
 *
 * KNOWN BLIND SPOT: the `chrome-attached` MCP server does NOT launch a browser — it attaches
 * to your real Chrome over --browserUrl http://127.0.0.1:9222. Tabs an agent opened there
 * live in your own browser and this script cannot see them. Check those by eye.
 *
 *   yarn chrome:agents                 list what is running, and who is using each instance
 *   yarn chrome:agents --kill          in a terminal: list, then pick which ones to kill
 *   yarn chrome:agents --kill <pid>    kill exactly that instance (comma-separated for several)
 *   yarn chrome:agents --kill --orphans  kill only the ones no live process holds
 *   yarn chrome:agents --kill --all    kill every instance listed
 *
 * A bare `--kill` used to mean "kill them all". With several instances running it now asks which
 * ones — and where no one can answer (an agent, CI, a pipe) it refuses instead of prompting into
 * the void. The case it protects: two sessions share this machine (a headless L2 run and an
 * attached admin browser), and killing the other session's browser mid-run is indistinguishable
 * from a crash on its side. Say --all when you mean all.
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const PROFILE_PREFIX = "puppeteer_dev_chrome_profile-";

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

// ── Arguments ────────────────────────────────────────────────────────────────
// `--kill` takes optional PID targets: `--kill 123`, `--kill 123,456`, `--kill=123`.
// Anything non-numeric after --kill is a flag, not a target, so the two forms never collide.
const argv = process.argv.slice(2);
const KILL = argv.includes("--kill") || argv.some((a) => a.startsWith("--kill="));
const ALL = argv.includes("--all");
const ORPHANS = argv.includes("--orphans");

// Pick-from-the-list only where a human can answer. `--pick` forces it (and makes the prompt
// testable through a pipe); otherwise it needs a real TTY, because an agent running this with
// a redirected stdin would otherwise wait forever on a prompt nobody can see.
const PICK = argv.includes("--pick");
const INTERACTIVE = PICK || Boolean(stdin.isTTY);

const targets = new Set(
  argv
    .flatMap((a) =>
      a.startsWith("--kill=") ? a.slice("--kill=".length).split(",") : a.startsWith("--") ? [] : a.split(",")
    )
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
);

const usage = () => {
  console.log(`
  yarn chrome:agents                    list + who is using each instance
  yarn chrome:agents --kill             in a terminal: pick which ones to kill from the list
  yarn chrome:agents --kill <pid>       kill exactly that instance (comma-separated for several)
  yarn chrome:agents --kill --orphans   kill only instances no live process holds
  yarn chrome:agents --kill --all       kill every instance listed
`);
};

/** Every running process, as { pid, ppid, etime, command }. */
const processes = () =>
  sh("ps", ["-eo", "pid=,ppid=,etime=,command="])
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, etime, command]) => ({ pid: Number(pid), ppid: Number(ppid), etime, command }));

const dirSize = (dir) => {
  const out = sh("du", ["-sh", dir]).trim();
  return out ? out.split(/\s+/)[0] : "?";
};

/**
 * Remove a profile dir, tolerating the race with the browser we just signalled.
 *
 * `kill` sends SIGTERM and returns immediately; Chrome is still flushing and recreating files
 * under the profile for a moment after that, so an unguarded rmSync throws ENOTEMPTY —
 * `force: true` only swallows ENOENT. Unhandled, that exception aborts the whole run: the
 * instances after this one are never killed and no summary is printed. Retry briefly, and if
 * the dir survives leave it — the stale-dir sweep at the end of the NEXT run reclaims it,
 * since by then nothing owns it.
 */
const removeProfile = (dir) => {
  if (!dir || !dir.includes(PROFILE_PREFIX)) return false;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    return !existsSync(dir);
  } catch {
    return false;
  }
};

/** Working directory of a process — this is what says WHICH repo or worktree the session drives. */
const cwdOf = (pid) => {
  const out =
    sh("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
      .trim()
      .split("\n")
      .pop() ?? "";
  return out.startsWith("n") ? out.slice(1) : null;
};

/** One env var of a process. macOS exposes this for your own processes; absent is fine. */
const envOf = (pid, key) => {
  const hit = sh("ps", ["-wwEp", String(pid)])
    .split(/\s+/)
    .find((tok) => tok.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : null;
};

const all = processes();
const byPid = new Map(all.map((p) => [p.pid, p]));

// A browser's own renderer/GPU children carry --type=…; only the top-level process does not.
const browsers = all.filter(
  (p) =>
    p.command.includes(PROFILE_PREFIX) && p.command.includes("MacOS/Google Chrome") && !p.command.includes("--type=")
);

const profileOf = (command) => {
  const flag = command.split(/\s+/).find((a) => a.startsWith("--user-data-dir="));
  return flag ? flag.slice("--user-data-dir=".length) : null;
};

/** Walk up the parent chain from a pid, so we can name the MCP server AND the session behind it. */
const ancestry = (pid, max = 8) => {
  const chain = [];
  let cur = byPid.get(pid);
  while (cur && chain.length < max) {
    chain.push(cur);
    if (cur.ppid <= 1) break;
    cur = byPid.get(cur.ppid);
  }
  return chain;
};

/**
 * Who is using this browser.
 *
 * ppid 1 means the launcher died and macOS reparented it to launchd: nothing will ever close
 * this browser — that is the case --orphans targets. Otherwise the chain is
 *   chrome → chrome-devtools-mcp → npm exec <flags> → claude session → host app
 * and each link answers a different question: the npm-exec flags say WHICH MCP server
 * (`--browserUrl` = chrome-attached, `--headless` = the isolated one L2 uses), and the session's
 * cwd says which repo or worktree it is driving — the part that tells two parallel runs apart.
 */
const describeOwner = (browser) => {
  if (browser.ppid <= 1 || !byPid.has(browser.ppid)) {
    return { orphan: true, server: null, agent: "ORPHAN — launcher is gone, nothing will ever close it" };
  }

  const chain = ancestry(browser.ppid);
  const mcp = chain.find((p) => p.command.includes("chrome-devtools-mcp") || p.command.includes("mcp"));
  const launcher = chain.find((p) => p.command.includes("--browserUrl") || p.command.includes("--headless"));

  // No launcher flags and no mcp ancestor means nobody's MCP server owns this — a browser
  // started by hand or by a stray script. Say so rather than implying an MCP server exists.
  let flavor = mcp ? "unrecognised MCP server" : null;
  if (launcher?.command.includes("--browserUrl")) flavor = "chrome-attached (drives your real Chrome)";
  else if (launcher?.command.includes("--headless")) flavor = "chrome-devtools (headless, isolated)";

  const session = chain.find(
    (p) => /claude-agent-sdk|claude-acp|\bclaude\b/.test(p.command) && !p.command.includes("chrome")
  );
  const host = chain.find((p) => /Zed\.app|iTerm|Terminal\.app|Ghostty|WezTerm|Alacritty|Code Helper/.test(p.command));

  let agent = "no Claude session in the parent chain — started by hand?";
  if (session) {
    const cwd = cwdOf(session.pid);
    const entrypoint = envOf(session.pid, "CLAUDE_CODE_ENTRYPOINT");
    const hostName = host ? ` via ${host.command.match(/([\w.-]+)\.app/)?.[1] ?? "terminal"}` : "";
    agent =
      `claude session pid ${session.pid}` +
      (entrypoint ? ` (${entrypoint})` : "") +
      hostName +
      (cwd ? `\n           cwd ${cwd}` : "");
  }

  return { orphan: false, server: flavor ? `${flavor}  pid ${mcp?.pid ?? browser.ppid}` : null, agent };
};

const line = "─".repeat(64);
const rows = browsers.map((b, i) => ({ ...b, ...describeOwner(b), profile: profileOf(b.command), index: i + 1 }));

// ── Report ───────────────────────────────────────────────────────────────────
for (const r of rows) {
  const helpers = all.filter((p) => p.ppid === r.pid).length;

  console.log(line);
  console.log(`  [${r.index}] PID  ${r.pid}  (+${helpers} helper processes)`);
  console.log(`  age      ${r.etime}`);
  console.log(`  mode     ${r.command.includes("--headless") ? "headless" : "headful"}`);
  if (r.server) console.log(`  server   ${r.server}`);
  console.log(`  agent    ${r.agent}`);
  console.log(`  profile  ${r.profile ?? "?"}  [${r.profile ? dirSize(r.profile) : "?"}]`);
  if (!KILL) console.log(`  kill     yarn chrome:agents --kill ${r.pid}`);
}
console.log(line);

// ── Decide what --kill applies to, BEFORE killing anything ───────────────────
let victims = [];
let killError = null;

if (KILL && rows.length) {
  if (targets.size > 0) {
    const unknown = [...targets].filter((pid) => !rows.some((r) => r.pid === pid));
    if (unknown.length) {
      killError =
        `pid ${unknown.join(", ")} is not an agent-launched Chrome.\n` +
        `  This script only ever kills pids it listed itself — check the PID column above.`;
    } else {
      victims = rows.filter((r) => targets.has(r.pid));
    }
  } else if (ORPHANS) {
    victims = rows.filter((r) => r.orphan);
    if (!victims.length) killError = "no orphaned instances — every one is still held by a live process.";
  } else if (ALL) {
    victims = rows;
  } else if (INTERACTIVE) {
    // Pick from the list that was just printed. Indexes, not pids: the numbers are one line
    // above and two digits shorter, and a mistyped index can only ever hit another listed
    // instance — whereas a mistyped pid, if we resolved pids here, could name anything.
    const rl = createInterface({ input: stdin, output: stdout });
    let answer = "";
    try {
      answer = (await rl.question("\n  Kill which? [number, 1,3 for several, a=all, o=orphans, Enter=none]: ")).trim();
    } catch {
      // ctrl-D closes stdin mid-question and readline rejects with ABORT_ERR. Unhandled that
      // prints a stack trace, which reads like the script crashed while killing something.
      answer = "";
    } finally {
      rl.close();
    }

    const pick = answer.toLowerCase();
    if (pick === "" || pick === "q") {
      killError = "nothing selected.";
    } else if (pick === "a" || pick === "all") {
      victims = rows;
    } else if (pick === "o" || pick === "orphans") {
      victims = rows.filter((r) => r.orphan);
      if (!victims.length) killError = "no orphaned instances — every one is still held by a live process.";
    } else {
      const chosen = pick.split(",").map((n) => Number(n.trim()));
      const bad = chosen.filter((n) => !rows.some((r) => r.index === n));
      if (bad.length || !chosen.length) killError = `"${answer}" is not one of the numbers listed.`;
      else victims = rows.filter((r) => chosen.includes(r.index));
    }
  } else if (rows.length === 1) {
    // Nobody to ask and nothing to choose between: the shorthand an unattended cleanup uses.
    victims = rows;
  } else {
    // No TTY: an agent or a CI step is running this. Prompting here would hang the run
    // forever with no visible prompt, so refuse and name the flags that need no input.
    killError =
      `${rows.length} instances are running, so a bare --kill is refused.\n` +
      `  Pass a pid (--kill ${rows[0].pid}), or --kill --orphans, or --kill --all.\n` +
      `  Run it in a terminal to pick from the list instead.`;
  }
}

// ── Kill ─────────────────────────────────────────────────────────────────────
for (const v of victims) {
  // SIGTERM lets Chrome flush and reap its own helpers; the profile goes with it.
  sh("kill", [String(v.pid)]);
  const gone = removeProfile(v.profile);
  console.log(
    `  [${v.index}] pid ${v.pid} → killed${gone ? ", profile removed" : ", profile still on disk — rerun to prune it"}`
  );
}
if (victims.length) console.log(line);

if (rows.length === 0) {
  console.log("  Clean — no agent-launched Chrome running.");
} else if (killError) {
  console.log(`  Nothing killed: ${killError}`);
} else if (victims.length) {
  console.log(
    `  Killed ${victims.length} of ${rows.length} instance(s). ${rows.length - victims.length} left running.`
  );
} else {
  console.log(`  ${rows.length} agent-launched Chrome instance(s). Your own Chrome is NOT listed.`);
}
if (killError) usage();

// Profile directories whose process is already dead — pure disk leak, ~100MB each.
// Pruning these is safe under any kill mode: by definition nothing owns them.
const tmp = process.env.TMPDIR || tmpdir();
const live = all.map((p) => p.command).join("\n");
let stale = 0;

console.log("\nOrphaned profile dirs on disk (process already dead):");
for (const name of existsSync(tmp) ? readdirSync(tmp) : []) {
  if (!name.startsWith(PROFILE_PREFIX)) continue;
  const dir = join(tmp, name);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
  if (live.includes(dir)) continue;
  stale += 1;
  console.log(`  ${dirSize(dir)}\t${dir}`);
  if (KILL && !killError) {
    console.log(removeProfile(dir) ? `  → removed` : `  → could not remove (in use?) — left on disk`);
  }
}
if (stale === 0) console.log("  none");
