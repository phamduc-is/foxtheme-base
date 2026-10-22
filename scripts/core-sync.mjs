#!/usr/bin/env node
// DX wrapper for child forks syncing from foxtheme-base (upstream).
//
// Usage:
//   node scripts/core-sync.mjs diff       <version> [--from <prev>]
//   node scripts/core-sync.mjs dry-merge  <version>
//   node scripts/core-sync.mjs sync       <version> [--from <prev>] [--yes]
//
// `<version>` is a release tag (e.g. v1.2.0) OR any upstream ref (e.g.
// upstream/main, to pull the latest *untagged* core). When `--from` is omitted,
// the most recent v*.*.* tag reachable from HEAD is used as the previous baseline.

import { execSync, spawnSync } from "node:child_process";

const SUBCOMMANDS = new Set(["diff", "dry-merge", "sync"]);

const argv = process.argv.slice(2);

if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(argv.length === 0 ? 1 : 0);
}

const subcommand = argv[0];
if (!SUBCOMMANDS.has(subcommand)) {
  console.error(`Unknown subcommand: "${subcommand}"`);
  printHelp();
  process.exit(1);
}

const version = argv[1];
if (!version) {
  console.error(
    `Missing <version>. Expected a release tag (e.g. v1.2.0) or any upstream ref (e.g. upstream/main for the latest untagged core).`,
  );
  printHelp();
  process.exit(1);
}

const opts = parseOpts(argv.slice(2));

try {
  ensureUpstreamRemote();
  fetchUpstream();
  ensureRefExists(version);

  if (subcommand === "diff") {
    runDiff(version, opts);
  } else if (subcommand === "dry-merge") {
    runDryMerge(version);
  } else if (subcommand === "sync") {
    runSync(version, opts);
  }
} catch (err) {
  console.error(`\n[core-sync] ${err.message}`);
  process.exit(1);
}

// ── Subcommands ──────────────────────────────────────────────────────────────

function runDiff(version, { from }) {
  const prev = from || detectPreviousTag(version);
  if (prev === version) {
    console.log(`[core-sync] HEAD is already at ${version}; nothing to diff.`);
    return;
  }
  console.log(`[core-sync] Comparing ${prev}..${version}`);

  const coreChanged = listChangedFiles(`${prev}..${version}`);
  if (coreChanged.length === 0) {
    console.log(`[core-sync] No files changed between ${prev} and ${version}.`);
    return;
  }

  const mergeBase = gitOut(`git merge-base ${prev} HEAD`).trim();
  const childChanged = new Set(listChangedFiles(`${mergeBase}..HEAD`));

  const tier1 = [];
  const tier2 = [];
  for (const file of coreChanged) {
    (childChanged.has(file) ? tier2 : tier1).push(file);
  }

  console.log(`\nCore changed ${coreChanged.length} file(s) total.\n`);

  console.log(`Tier 1 — auto-merge (child unchanged): ${tier1.length}`);
  for (const f of tier1) console.log(`  ${f}`);

  console.log(`\nTier 2 — likely conflict (child also modified): ${tier2.length}`);
  for (const f of tier2) console.log(`  ${f}`);

  console.log(
    `\nNext:\n  yarn core:dry-merge ${version}   # preview conflicts\n  yarn core:sync ${version}        # perform the merge\n`,
  );
}

function runDryMerge(version) {
  requireCleanWorkingTree();
  console.log(`[core-sync] Dry-running merge of ${version} (will abort)…`);

  const res = spawnSync("git", ["merge", "--no-commit", "--no-ff", version], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  let conflicts = [];
  try {
    conflicts = gitOut("git diff --name-only --diff-filter=U")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } finally {
    // Always abort the dry merge, even if nothing happened.
    spawnSync("git", ["merge", "--abort"], { stdio: "ignore" });
  }

  if (res.status === 0 && conflicts.length === 0) {
    console.log(`[core-sync] Merge of ${version} would be CLEAN — no conflicts.`);
    return;
  }

  console.log(`\n[core-sync] Merge would conflict in ${conflicts.length} file(s):\n`);
  for (const f of conflicts) console.log(`  ${f}`);
  console.log(`\nMerge aborted. Use \`yarn core:sync ${version}\` to merge for real.`);
}

function runSync(version, { from, yes }) {
  requireCleanWorkingTree();

  const branch = gitOut("git rev-parse --abbrev-ref HEAD").trim();
  if (branch === "main" || branch === "master") {
    throw new Error(
      `Refusing to merge into ${branch}. Create a sync branch first:\n  git checkout -b sync-core-${version}`,
    );
  }

  const prev = from || detectPreviousTag(version);
  if (prev === version) {
    console.log(`[core-sync] HEAD is already at ${version}; nothing to merge.`);
    return;
  }

  console.log(`[core-sync] Merging ${version} into ${branch} (previous: ${prev})`);
  if (!yes) {
    console.log(`[core-sync] Tip: run \`yarn core:diff ${version}\` first to preview impact.`);
  }

  const res = spawnSync("git", ["merge", "--no-ff", version], { stdio: "inherit" });

  if (res.status === 0) {
    console.log(`\n[core-sync] Merge succeeded with no conflicts.`);
    printPostMergeSteps(version);
    return;
  }

  const conflicts = gitOut("git diff --name-only --diff-filter=U")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`\n[core-sync] Merge has ${conflicts.length} conflict(s):\n`);
  for (const f of conflicts) console.log(`  ${f}`);
  console.log(
    `\nResolve each file, then:\n  git add <files> && git commit\n  ${buildHints(conflicts)}\nAbort with: git merge --abort`,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseOpts(rest) {
  const opts = { from: null, yes: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--from") {
      opts.from = rest[++i];
      if (!opts.from || !/^v\d+\.\d+\.\d+$/.test(opts.from)) {
        throw new Error(`Invalid --from value: "${opts.from}". Expected v1.0.0`);
      }
    } else if (a.startsWith("--from=")) {
      opts.from = a.slice("--from=".length);
      if (!/^v\d+\.\d+\.\d+$/.test(opts.from)) {
        throw new Error(`Invalid --from value: "${opts.from}". Expected v1.0.0`);
      }
    } else if (a === "--yes" || a === "-y") {
      opts.yes = true;
    } else {
      throw new Error(`Unknown option: "${a}"`);
    }
  }
  return opts;
}

function ensureUpstreamRemote() {
  const remotes = gitOut("git remote").split("\n").map((s) => s.trim());
  if (!remotes.includes("upstream")) {
    throw new Error(
      `No "upstream" remote configured. core:* commands are for child forks.\n` +
        `Add it with:  git remote add upstream <foxtheme-base-url>`,
    );
  }
}

function fetchUpstream() {
  console.log(`[core-sync] Fetching upstream branches + tags…`);
  execSync("git fetch upstream --tags", { stdio: "inherit" });
}

function ensureRefExists(ref) {
  try {
    execSync(`git rev-parse --verify ${ref}^{commit}`, { stdio: "ignore" });
  } catch {
    throw new Error(
      `Ref "${ref}" not found after fetching upstream. Expected a tag (e.g. v1.2.0) or an upstream ref (e.g. upstream/main).`,
    );
  }
}

function detectPreviousTag(version) {
  // Most recent v*.*.* tag reachable from HEAD that is NOT the target version.
  // Walk back until we find one that differs.
  let candidate;
  try {
    candidate = gitOut(`git describe --tags --abbrev=0 --match 'v*.*.*' HEAD`).trim();
  } catch {
    throw new Error(
      `Could not detect a previous v*.*.* tag from HEAD. Pass --from <prev>.`,
    );
  }
  if (candidate === version) {
    // Step one more back.
    try {
      candidate = gitOut(
        `git describe --tags --abbrev=0 --match 'v*.*.*' ${version}^`,
      ).trim();
    } catch {
      throw new Error(`Only one v*.*.* tag found. Pass --from <prev>.`);
    }
  }
  return candidate;
}

function listChangedFiles(range) {
  const out = gitOut(`git diff --name-only ${range}`);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function requireCleanWorkingTree() {
  const status = gitOut("git status --porcelain");
  if (status.trim().length > 0) {
    throw new Error(
      `Working tree has uncommitted changes. Commit or stash them before syncing.`,
    );
  }
}

function buildHints(conflicts) {
  const hints = [];
  if (conflicts.some((f) => f.endsWith(".scss") || f.startsWith("src/"))) {
    hints.push("yarn build:css");
  }
  if (conflicts.some((f) => f.startsWith("src/js/"))) {
    hints.push("yarn copy:js");
  }
  if (conflicts.includes("package.json") || conflicts.includes("yarn.lock")) {
    hints.unshift("yarn install");
  }
  return hints.length ? `After resolving: ${hints.join(" && ")}` : "";
}

function printPostMergeSteps(version) {
  console.log(
    `\nNext steps:\n` +
      `  yarn install              # if package.json changed\n` +
      `  yarn build:css && yarn copy:js\n` +
      `  yarn shopify theme dev    # smoke test locally\n` +
      `\nWhen happy, merge back into main:\n` +
      `  git checkout main && git merge --no-ff $(git rev-parse --abbrev-ref @{-1})\n`,
  );
}

function gitOut(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function printHelp() {
  console.log(`Usage:
  node scripts/core-sync.mjs diff       <version> [--from <prev>]
  node scripts/core-sync.mjs dry-merge  <version>
  node scripts/core-sync.mjs sync       <version> [--from <prev>] [--yes]

Subcommands:
  diff       Classify files changed in <prev>..<version> into Tier 1
             (child unchanged → auto-merge) vs Tier 2 (child also modified
             → likely conflict).
  dry-merge  Run \`git merge --no-commit --no-ff <version>\` then abort,
             reporting any conflicting files.
  sync       Actually merge <version> into the current branch (must not be
             main/master). On conflict, prints resolution guidance.

Examples:
  yarn core:diff v1.2.0
  yarn core:dry-merge v1.2.0
  yarn core:sync v1.2.0
`);
}
