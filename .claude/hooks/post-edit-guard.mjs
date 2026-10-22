#!/usr/bin/env node
/**
 * PostToolUse hook (matcher: Edit|Write).
 *
 * Routes the edited file to the matching repo check and BLOCKS (exit 2 + stderr)
 * on a real violation, so Claude fixes it before continuing. The codebase passes
 * all these checks today, so a failure means *this* edit introduced the problem.
 *
 * Safety (design §15.1):
 *  - Fail-open: any error inside this wrapper → exit 0 (never block on infra bugs).
 *  - Kill-switch: FOX_HOOKS=off → exit 0. Per-check: FOX_DISABLED_HOOKS=js-contract,...
 *
 * Blocking contract (verified): PostToolUse exit code 2 feeds stderr back to Claude.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative } from "node:path";

if (process.env.FOX_HOOKS === "off") process.exit(0);

const disabled = new Set(
  (process.env.FOX_DISABLED_HOOKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // fail-open: unreadable payload
}

const projectDir =
  process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const rel = relative(projectDir, filePath);
if (!rel || rel.startsWith("..")) process.exit(0); // outside project

// Decide which checks apply to this file (scripts full-scan; routing picks them).
const checks = [];
const isSettingsSchema = rel === "config/settings_schema.json";
if (/^src\/js\/modules\/.+\.js$/.test(rel))
  checks.push(["js-contract", "check-js-contract.js", ["--diff"]]);
if (isSettingsSchema)
  checks.push(["settings-schema", "check-settings-schema.js", []]);
if (
  /^(sections|blocks|snippets|locales)\//.test(rel) ||
  isSettingsSchema ||
  /^templates\/.*\.json$/.test(rel)
)
  checks.push(["missing-translate", "check-missing-translate.js", []]);

if (checks.length === 0) process.exit(0);

const failures = [];
for (const [name, script, args] of checks) {
  if (disabled.has(name)) continue;
  let res;
  try {
    res = spawnSync("node", [`scripts/${script}`, ...args], {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 30000,
    });
  } catch {
    continue; // fail-open per check
  }
  if (res.error) continue; // spawn/timeout error → fail-open
  if (typeof res.status === "number" && res.status !== 0) {
    const out = `${res.stdout || ""}${res.stderr || ""}`.trim();
    failures.push(`### ${name}\n${out}`);
  }
}

if (failures.length === 0) process.exit(0);

console.error(
  `FoxTheme guard blocked ${rel}. Fix the violation(s) below, then continue.\n` +
    `(disable: FOX_HOOKS=off · per-check: FOX_DISABLED_HOOKS=${checks
      .map((c) => c[0])
      .join(",")})\n\n` +
    failures.join("\n\n"),
);
process.exit(2);
