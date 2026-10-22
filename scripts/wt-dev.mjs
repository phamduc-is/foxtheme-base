#!/usr/bin/env node
/**
 * wt:dev — interactive worktree preview launcher.
 *
 * Lists the git worktrees under `.worktrees/` (created by /build-batch),
 * lets you pick one, builds its assets (assets/ is gitignored → absent in a
 * fresh worktree, so `theme dev` would otherwise serve a broken theme), then
 * runs `shopify theme dev` on a distinct port against that worktree's OWN
 * development theme (`wt/<worktree>`, created on first preview — see
 * scripts/wt-theme.mjs). Previews are therefore safe to run in parallel; manage
 * or remove the themes with `yarn wt:theme`.
 *
 * Usage:
 *   yarn wt:dev                 # interactive menu
 *   yarn wt:dev <name|index>    # pick directly (menu number, branch slug, or section name)
 *   yarn wt:dev --port 9300     # pin the port (fails if it is in use)
 *                               # without it: 9292 + menu index, then the first free port upwards
 *   yarn wt:dev --no-build      # skip the asset build (already built this session)
 *   yarn wt:dev --list          # just list the worktrees and exit
 *   yarn wt:dev <name> -- -- --live-reload off
 *                               # everything after the separator is forwarded verbatim to
 *                               # `shopify theme dev`. TWO dashes through yarn, which
 *                               # swallows the first; `node scripts/wt-dev.mjs` needs one.
 */
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import path from "node:path";
import { isPortFree } from "./lib/port.mjs";
import { readCreds, ensureTheme, shopifyBin } from "./wt-theme.mjs";

// Everything after a bare `--` belongs to `shopify theme dev`, not to us. Without this
// there is no way to reach any CLI flag we do not already model (`--live-reload off` is
// the one that keeps coming up: hot reload can navigate a held-open page away mid-run).
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const ownArgv = sep === -1 ? argv : argv.slice(0, sep);
const shopifyArgv = sep === -1 ? [] : argv.slice(sep + 1);

let port;
let noBuild = false;
let listOnly = false;
let pick;
for (let i = 0; i < ownArgv.length; i++) {
  const a = ownArgv[i];
  if (a === "--port") port = Number(ownArgv[++i]);
  else if (a === "--no-build") noBuild = true;
  else if (a === "--list") listOnly = true;
  else if (!a.startsWith("--")) {
    // A second positional used to silently overwrite the first, so a forgotten separator
    // (`yarn wt:dev foo --live-reload off` → yarn eats the `--`, `off` becomes the pick)
    // failed with a baffling "No worktree matches off". Say what actually happened.
    if (pick !== undefined) {
      console.error(
        `Unexpected extra argument "${a}" (already picking "${pick}").\n` +
          `To pass flags through to \`shopify theme dev\`, separate them with \`--\`:\n` +
          `  yarn wt:dev ${pick} -- -- --live-reload off\n` +
          `(two, because yarn itself consumes the first one; a direct \`node scripts/wt-dev.mjs\` needs only one.)`,
      );
      process.exit(1);
    }
    pick = a;
  }
}

// Parse `git worktree list --porcelain` into { path, branch } records.
const raw = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
const all = [];
let cur = {};
for (const line of raw.split("\n")) {
  if (line.startsWith("worktree ")) cur = { path: line.slice("worktree ".length) };
  else if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length).replace("refs/heads/", "");
  else if (line === "" && cur.path) { all.push(cur); cur = {}; }
}
if (cur.path) all.push(cur);

// `.claude/worktrees/` is the legacy location — still matched so worktrees created
// before the move keep working until they are merged and cleaned up.
const isBuildWorktree = (p) => p.includes("/.worktrees/") || p.includes("/.claude/worktrees/");

const list = all.filter((w) => isBuildWorktree(w.path));
if (list.length === 0) {
  console.error("No worktrees under .worktrees/. Run /build-batch first.");
  process.exit(1);
}

if (listOnly) {
  list.forEach((w, i) => console.log(`[${i + 1}] ${path.basename(w.path).padEnd(34)} ${w.branch || "(detached)"}`));
  process.exit(0);
}

const resolve = (sel) =>
  /^\d+$/.test(sel)
    ? list[Number(sel) - 1]
    : list.find((w) => path.basename(w.path) === sel || w.branch === sel || path.basename(w.path).endsWith(sel));

let chosen;
if (pick) {
  chosen = resolve(pick);
  if (!chosen) { console.error(`No worktree matches "${pick}".`); process.exit(1); }
} else {
  console.log("\nWorktrees to preview:\n");
  list.forEach((w, i) => console.log(`  [${i + 1}] ${path.basename(w.path).padEnd(34)} ${w.branch || "(detached)"}`));
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question("\nPick a worktree number: ")).trim();
  rl.close();
  chosen = resolve(ans);
  if (!chosen) { console.error("Invalid selection."); process.exit(1); }
}

// `9292 + index` is a STARTING POINT, not an assignment — it used to be handed
// straight to the CLI, which is why previews collided.
//
// Two ways it goes wrong, neither of them unlucky. The index is the worktree's
// position in the list, so adding or removing a worktree renumbers every other
// one: a preview that started at index 2 keeps port 9294 while the worktree
// below it is deleted, and the next run computes 9294 for a different worktree.
// And 9292 is the Shopify CLI's own default, so a plain `yarn start` in the same
// repo takes the port index 0 will ask for, every time.
//
// So probe. An explicit --port is an instruction, not a preference: if it is
// taken, say so rather than quietly moving somewhere the caller is not watching.
let usePort;
if (port) {
  if (!(await isPortFree(port))) {
    console.error(`\nPort ${port} is already in use. Free it, pass another, or omit --port to have one picked.`);
    process.exit(1);
  }
  usePort = port;
} else {
  const base = 9292 + list.indexOf(chosen);
  usePort = base;
  while (usePort < base + 50 && !(await isPortFree(usePort))) usePort += 1;
  if (usePort >= base + 50) {
    console.error(`\nNo free port between ${base} and ${base + 49}. Pass --port explicitly.`);
    process.exit(1);
  }
  if (usePort !== base) console.log(`\n▸ port ${base} is in use — using ${usePort} instead.`);
}

if (!noBuild) {
  console.log(`\n▸ Building assets in ${path.basename(chosen.path)} (assets/ is gitignored) …`);
  for (const script of ["build:css", "build:js-vite", "copy:images", "copy:js"]) {
    execFileSync("yarn", [script], { cwd: chosen.path, stdio: "inherit" });
  }
}

// Each worktree previews on its OWN development theme, created on first use.
// Without this every worktree uploads to the single theme pinned by
// `-e development`, and concurrent previews overwrite each other's shared files
// (assets/theme.css, layout/theme.liquid, locales/*) — see scripts/wt-theme.mjs.
const creds = readCreds();
const theme = ensureTheme(path.basename(chosen.path), chosen.path, creds);

// Run `theme dev` from the repo root (which has the Shopify CLI state in
// .shopify/) but point it at the worktree with --path, so newly-added sections
// sync to the theme + show in the editor. Running it from inside the worktree
// (a non-standard cwd) can fail to surface new files in the online Theme Editor.
// Credentials go in explicitly rather than via `-e development`, whose pinned
// `theme = <id>` would override the per-worktree theme we just resolved.
console.log(`\n▸ theme "${theme.name}" (#${theme.id})  port ${usePort}  ${chosen.branch}`);
console.log(`  preview: https://${creds.store}?preview_theme_id=${theme.id}\n`);
// Headless callers (the L2 agent runs this as a background task) have no TTY:
// the Shopify CLI's interactive TUI quits on stdin EOF, silently killing the
// preview mid-run. Hold the child's stdin open (never write, never end it) so
// the server keeps serving; interactive runs keep the real TTY for keybinds.
const headless = !stdin.isTTY;
const child = spawn(
  shopifyBin(),
  [
    "theme", "dev",
    "-s", creds.store,
    "--password", creds.password,
    "-t", String(theme.id),
    "--port", String(usePort),
    "--path", chosen.path,
    ...shopifyArgv,
  ],
  { cwd: process.cwd(), stdio: [headless ? "pipe" : "inherit", "inherit", "inherit"] }
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
