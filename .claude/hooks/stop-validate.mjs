#!/usr/bin/env node
/**
 * Stop hook — slow/whole-turn validation that doesn't belong on every edit.
 *
 * Validates the .liquid files changed this turn (theme-check) and, if structural
 * files changed, template refs. On problems it asks Claude to keep working via
 * {"decision":"block","reason":...} (verified Stop-hook contract).
 *
 * Safety (design §15.1):
 *  - stop_hook_active=true → exit 0 (avoid the 8-block loop cap).
 *  - Fail-open: any wrapper error → exit 0.
 *  - Kill-switch: FOX_HOOKS=off → exit 0.
 *
 * Only CHANGED files are checked, so pre-existing offenses in untouched files
 * never block unrelated work.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.env.FOX_HOOKS === "off") process.exit(0);

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

if (payload.stop_hook_active === true) process.exit(0);

const projectDir =
  process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

function run(cmd, args, extraEnv) {
  try {
    return spawnSync(cmd, args, {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 60000,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
  } catch {
    return null;
  }
}

// Changed files this turn: staged + unstaged + untracked.
const status = run("git", ["status", "--porcelain", "--no-renames"]);
if (!status || status.status !== 0) process.exit(0); // not a repo / git error → fail-open

const changedRaw = status.stdout
  .split("\n")
  .filter(Boolean)
  .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).trim() }))
  .filter((e) => e.path);

const changed = changedRaw.map((e) => e.path);
const liquid = changed.filter((f) => f.endsWith(".liquid"));
const structural = changed.some((f) => /^(sections|blocks|templates)\//.test(f));

// Keep the (gitignored) project map fresh: regenerate when files the map indexes
// were added/deleted/untracked this turn. Best-effort, non-blocking — the map is
// local-only, so re-running yarn map freely is harmless.
const mapStale = changedRaw.some(
  (e) =>
    /[AD?]/.test(e.code) &&
    /^(sections|blocks|snippets|layout|templates|src\/js|src\/scss|locales)\//.test(e.path),
);
if (mapStale) run("node", ["scripts/generate-project-map.js"]);

const problems = [];

if (liquid.length > 0) {
  const res = run(
    "node",
    ["scripts/check-liquid.mjs", "--theme-path", ".", "--files", liquid.join(",")],
    { OPT_OUT_INSTRUMENTATION: "true" },
  );
  if (res && !res.error && typeof res.status === "number" && res.status !== 0) {
    problems.push(`Liquid (theme-check):\n${(res.stdout || res.stderr || "").trim()}`);
  }
}

if (structural) {
  const res = run("node", ["scripts/check-template-refs.js", "--fail"]);
  if (res && !res.error && typeof res.status === "number" && res.status !== 0) {
    problems.push(`Template refs:\n${(res.stdout || res.stderr || "").trim()}`);
  }
}

// A bad `range` (>101 steps, non-divisible span, out-of-bounds default) passes
// theme-check and is only rejected by Shopify at upload — catch it at edit time.
if (liquid.some((p) => /^(blocks|sections)\//.test(p))) {
  const res = run("node", ["scripts/check-range-steps.js"]);
  if (res && !res.error && typeof res.status === "number" && res.status !== 0) {
    problems.push(`Range settings:\n${(res.stdout || res.stderr || "").trim()}`);
  }
}

if (problems.length === 0) process.exit(0);

const reason =
  "FoxTheme validation found issues in files you changed this turn — fix them before finishing:\n\n" +
  problems.join("\n\n") +
  "\n\n(If an offense is pre-existing and unrelated to your change, you may stop. Disable with FOX_HOOKS=off.)";

process.stdout.write(JSON.stringify({ decision: "block", reason }));
process.exit(0);
