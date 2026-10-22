#!/usr/bin/env node
/**
 * check-toolkit-refs — anti-drift check for the .claude/ toolkit docs.
 *
 * The toolkit's knowledge lives in many places (CLAUDE.md, USAGE.md, commands,
 * agents, skills, workflow scripts). When source is refactored, the docs drift:
 * a `yarn build:js` that no longer exists, a `sections/footer-top.liquid` that
 * was never real. This script catches the mechanical layer of that drift:
 *
 *   1. every `yarn <script>` mentioned in the docs exists in package.json
 *   2. every literal repo file path mentioned in the docs exists on disk
 *
 * Placeholders (`yarn <script>`, `sections/{name}.liquid`, globs) are skipped.
 * Intentional examples of files that must NOT exist live in IGNORE below —
 * add a new entry with a comment when a doc deliberately names a non-file.
 *
 * Usage: node scripts/check-toolkit-refs.mjs   (also: yarn check-toolkit-refs)
 * Exits 1 with a file:line report on any dangling reference.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── What to scan ───────────────────────────────────────────────────────────
// Doc layer only. briefs/ are per-dev scratch; TOOLKIT-DESIGN.md is a dated
// design-history document — both exempt by design.
const SCAN_DIRS = [".claude"];
const SCAN_FILES = ["CLAUDE.md"];
const SKIP = [
  ".claude/TOOLKIT-DESIGN.md",
  ".claude/worktrees",
  ".claude/settings.local.json",
];
const SCAN_EXT = new Set([".md", ".js", ".mjs", ".json"]);

// ── Intentional non-files named in docs (each entry needs a reason) ────────
const IGNORE = new Set([
  "templates/page.l2-test.json", // feature-runtime-tester's throwaway fixture — never committed
  ".claude/.toolkit-port.json", // port-toolkit marker — exists only in INDEPENDENT target repos, never in core
  "config/settings_data.json", // child-fork file (merge=ours); absent in core by design
  "config/markets.json", // store-audit.md names it as a file that must NOT exist (Theme Store req)
  "src/js/global/custom.js", // child-fork customization slot; core ships without it
  ".briefs/a.md", // USAGE.md illustrative brief name
  ".briefs/hero.md", // USAGE.md illustrative brief name
  "blocks/highlight-badge.liquid", // revise.md worked example feature
  "src/scss/global/_block-highlight-badge.scss", // revise.md worked example feature
  "src/scss/global/_block-block-name.scss", // create-liquid-block template placeholder ("block-name")
  "src/scss/global/_section-name.scss", // create-liquid-section template placeholder
  "src/scss/global/section-name.scss", // create-liquid-section template placeholder
  "blocks/_my-item.liquid", // PROJECT-ANATOMY illustrative child-block name
  "layout/robots.txt.liquid", // store-audit.md: Theme Store REQUIRES this file to NOT exist
]);

// Generic category mentions in prose ("no yarn deploy", "every yarn check") —
// not invocations of a specific script. Exact script names are still enforced.
const PROSE_OK = new Set(["build", "check", "deploy", "watch", "lint", "clean"]);

// Yarn built-ins that are not package.json scripts.
const YARN_BUILTIN = new Set([
  "install", "add", "remove", "upgrade", "run", "init", "why", "link",
  "unlink", "pack", "publish", "info", "config", "cache", "global",
]);

const isPlaceholder = (s) => /[<>{}*…$]|\.\.\./.test(s);

// A path that doesn't exist but MATCHES a .gitignore pattern is a legitimate
// per-dev/local file (settings.local.json, briefs, PROJECT-MAP…) — docs may
// name it, and CI's fresh clone won't have it. check-ignore works off the
// patterns alone, so it answers the same locally and in CI.
const isGitignored = (p) =>
  spawnSync("git", ["check-ignore", "-q", p], { cwd: root }).status === 0;

const files = [];
const walk = (rel) => {
  if (SKIP.some((s) => rel === s || rel.startsWith(s + "/"))) return;
  const abs = path.join(root, rel);
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const e of readdirSync(abs)) walk(path.join(rel, e));
  } else if (SCAN_EXT.has(path.extname(rel))) {
    files.push(rel);
  }
};
for (const d of SCAN_DIRS) walk(d);
for (const f of SCAN_FILES) if (existsSync(path.join(root, f))) files.push(f);

const scripts = new Set(
  Object.keys(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts ?? {})
);

const YARN_RE = /\byarn ([A-Za-z0-9:_.<>{}*$…-]+)/g;
const PATH_RE =
  /(?:^|[\s`'"(\[])((?:sections|blocks|snippets|templates|layout|config|locales|scripts|src|assets|\.claude|\.briefs)\/[A-Za-z0-9@._{}<>*$/-]+\.(?:liquid|json|mjs|scss|css|sh|md|js))/g;

// A core-proposal is a DATED SNAPSHOT, not live documentation, so its path refs are never
// enforced — at any status. A PENDING one describes a state core has not reached yet:
// naming a script or path that does not exist is its whole job, and it must not be forced
// to mangle those names to stay green (this has already cost two proposals a rewrite). A
// LANDED one records what the change looked like on the day it landed; README.md keeps it
// as the audit trail and forbids deleting it, so when core later removes or renames one of
// those files the only ways to go green are rewriting history or adding an IGNORE entry per
// deletion, in every fork, forever. Worse, the failure is invisible to core CI — core
// carries no proposal files, so a deletion is green in core and red in every fork on the
// next core:sync (seen with PR #249 removing snippets/nss-stroke-hotfix.liquid). Drift in a
// document nobody may edit is not actionable; don't lint it.
const isProposalDoc = (rel) => rel.startsWith(".claude/core-proposals/");

const errors = [];
for (const rel of files) {
  const text = readFileSync(path.join(root, rel), "utf8");
  if (isProposalDoc(rel)) continue;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(YARN_RE)) {
      const name = m[1];
      if (isPlaceholder(name) || name.startsWith("-") || YARN_BUILTIN.has(name) || PROSE_OK.has(name)) continue;
      if (!scripts.has(name)) errors.push(`${rel}:${i + 1}  yarn script not in package.json: yarn ${name}`);
    }
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[1];
      if (isPlaceholder(p) || IGNORE.has(p)) continue;
      if (p.startsWith("assets/")) continue; // gitignored build output — existence varies
      if (!existsSync(path.join(root, p)) && !isGitignored(p))
        errors.push(`${rel}:${i + 1}  file does not exist: ${p}`);
    }
  });
}

if (errors.length) {
  console.error(`check-toolkit-refs: ${errors.length} dangling reference(s)\n`);
  for (const e of errors) console.error("  " + e);
  console.error(
    "\nFix the doc, or — if the doc names a non-file on purpose — add it to IGNORE in scripts/check-toolkit-refs.mjs with a reason."
  );
  process.exit(1);
}
console.log(`check-toolkit-refs: OK — ${files.length} toolkit files, no dangling yarn-script or file references.`);
