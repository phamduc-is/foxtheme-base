#!/usr/bin/env node
/**
 * `shopify theme dev` on the first FREE port instead of the CLI's fixed 9292.
 *
 * The CLI has no "pick a free port" mode: `--port` takes one number, and without
 * it the dev server always asks for 9292 and dies when that is taken. So a second
 * repo running `yarn start` in parallel could never start. Probe first, then hand
 * the CLI a port we know is free.
 *
 * An explicit `--port` is an instruction, not a preference: if it is taken we say
 * so rather than quietly moving somewhere the caller is not watching (the same
 * rule scripts/wt-dev.mjs follows).
 *
 * Usage:
 *   node scripts/theme-dev.mjs -e development      # what `yarn start` runs
 *   node scripts/theme-dev.mjs --port 9400 -e test # pin it (fails if in use)
 *
 * Every other argument is forwarded verbatim to `shopify theme dev`.
 */
import { spawn } from "node:child_process";
import { stdin } from "node:process";
import { findFreePort, isPortFree } from "./lib/port.mjs";
import { shopifyBin } from "./wt-theme.mjs";

const BASE_PORT = 9292;
const SPAN = 50;

// Pull our own --port out of the argv we forward, so the CLI sees exactly one.
const argv = process.argv.slice(2);
const flagAt = argv.indexOf("--port");
const pinned = flagAt === -1 ? null : Number(argv[flagAt + 1]);
if (flagAt !== -1) argv.splice(flagAt, 2);

let port;
if (pinned) {
  if (!Number.isInteger(pinned) || pinned < 1 || pinned > 65535) {
    console.error(`\n--port must be an integer between 1 and 65535.`);
    process.exit(1);
  }
  if (!(await isPortFree(pinned))) {
    console.error(`\nPort ${pinned} is already in use. Free it, pass another, or omit --port to have one picked.`);
    process.exit(1);
  }
  port = pinned;
} else {
  port = await findFreePort(BASE_PORT, SPAN);
  if (!port) {
    console.error(`\nNo free port between ${BASE_PORT} and ${BASE_PORT + SPAN - 1}. Pass --port explicitly.`);
    process.exit(1);
  }
  if (port !== BASE_PORT) console.log(`\n▸ port ${BASE_PORT} is in use — using ${port} instead.`);
}

// Headless callers (agents run this as a background task) have no TTY: the Shopify
// CLI's interactive TUI quits on stdin EOF, silently killing the preview mid-run.
// Hold the child's stdin open (never write, never end it) so the server keeps
// serving; interactive runs keep the real TTY for keybinds.
const headless = !stdin.isTTY;
const child = spawn(shopifyBin(), ["theme", "dev", "--port", String(port), ...argv], {
  stdio: [headless ? "pipe" : "inherit", "inherit", "inherit"],
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
