#!/usr/bin/env node
/**
 * SessionStart hook (matcher: startup|clear|compact).
 *
 * Surfaces recent git activity so a fresh/blind session (or post-compaction
 * session) is never blind to recent important changes. This is the memory-capture
 * workhorse (design §9b): git commits ARE the durable record; we just re-inject
 * them. stdout from a SessionStart hook is added to Claude's context (verified).
 *
 * Replaces the claude-mem SessionStart banner. Never blocks; fail-open.
 * Opt-out: FOX_MEMORY_CONTEXT=off.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.env.FOX_MEMORY_CONTEXT === "off") process.exit(0);

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // ignore — payload is optional here
}

const projectDir =
  process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

function git(args) {
  try {
    const r = spawnSync("git", args, {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 10000,
    });
    return r.status === 0 ? (r.stdout || "").trimEnd() : "";
  } catch {
    return "";
  }
}

const log = git(["log", "--oneline", "-15"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = git(["status", "--short"]);

if (!log && !dirty) process.exit(0);

let out = "## Recent work (git) — session continuity\n";
if (branch) out += `\nBranch: ${branch}`;
if (log) out += `\n\nLast commits:\n${log}`;
if (dirty) out += `\n\nUncommitted changes:\n${dirty}`;
out +=
  "\n\nNote: anything important must live on disk (a memory file + a commit) to survive a fresh session.";

process.stdout.write(out);
process.exit(0);
