#!/usr/bin/env node
/**
 * wt:clean — remove finished parallel-build worktrees (archiving their briefs).
 *
 * Lists the worktrees under `.worktrees/` and removes the ones whose
 * branch is already MERGED into origin/main (the PR landed) — safe: it won't
 * touch a worktree still under review. For each removed worktree it also deletes
 * the local branch and ARCHIVES the matching brief (`.briefs/<name>.md`,
 * gitignored per-dev scratch) into `.briefs/archive/<name>.md` — which IS
 * committed — so the agreed spec of a merged feature survives for `/revise`.
 *
 * Usage:
 *   yarn wt:clean             # remove merged worktrees + branches; archive briefs
 *   yarn wt:clean --dry-run   # show what would be removed, change nothing
 *   yarn wt:clean --all       # remove ALL build worktrees, even unmerged (careful)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { editorRemove } from "./wt-editor.mjs";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const all = argv.includes("--all");

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts });

// Refresh both mains so the merged check is accurate. A child fork also has an
// `upstream` (core) remote, and a branch built here for core lands THERE.
try { git(["fetch", "origin", "--quiet"]); } catch {}
let hasUpstream = false;
try {
  hasUpstream = git(["remote"]).split("\n").includes("upstream");
  if (hasUpstream) git(["fetch", "upstream", "--quiet"]);
} catch { hasUpstream = false; }

const raw = git(["worktree", "list", "--porcelain"]);
const parsed = [];
let cur = {};
for (const line of raw.split("\n")) {
  if (line.startsWith("worktree ")) cur = { path: line.slice("worktree ".length) };
  else if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length).replace("refs/heads/", "");
  else if (line === "" && cur.path) { parsed.push(cur); cur = {}; }
}
if (cur.path) parsed.push(cur);

// `.claude/worktrees/` is the legacy location — still matched so worktrees created
// before the move are still cleaned up once their branch lands.
const isBuildWorktree = (p) => p.includes("/.worktrees/") || p.includes("/.claude/worktrees/");

const list = parsed.filter((w) => isBuildWorktree(w.path));
if (list.length === 0) {
  console.log("No worktrees under .worktrees/.");
  process.exit(0);
}

// A branch can land in EITHER main: a child feature merges into origin/main,
// while a core-destined branch built in a fork (a new component contributed
// upstream, anything from `/fix-core`) merges into upstream/main and never
// appears in origin/main at all. Testing only origin/main leaves those
// worktrees behind forever, reported as "in review" long after they shipped.
const MAINS = ["origin/main"];
if (hasUpstream) MAINS.push("upstream/main");

// `--is-ancestor` alone reports a branch that never DIVERGED as merged, because a
// branch with no commits of its own is trivially an ancestor of the main it was cut
// from. `wt:add` creates exactly that, so a worktree opened minutes ago — with the
// dev's uncommitted work in it — read as "merged → origin/main" and was removed,
// branch force-deleted, work gone. Observed on a fork: a worktree created in one
// session was queued for removal by another session's `wt:clean` before its first
// commit.
//
// A landed branch and a never-started one are both ancestors, so ancestry cannot tell
// them apart. First-parent reachability can: merging a branch puts its commits on the
// SECOND parent of the merge commit, so a landed tip is NOT on main's first-parent
// chain, while a branch still sitting where it was cut points straight at a commit on
// that chain.
//
// Squash and rebase merges are unaffected — they rewrite the commits, so the tip is
// not an ancestor at all and the branch was already kept as "in review". A repo that
// fast-forwards its merges is the one case this reads as not-landed: there the
// feature's commits BECOME the first-parent chain. That is a deliberate trade — a
// false keep costs one manual `git worktree remove`, a false remove costs work that
// was never pushed.
// Every commit on the first-parent chain of every main we compare against, resolved
// once. A branch sitting on one of these has not landed anything — it is where it was
// cut, which is precisely what `wt:add` produces.
const firstParentShas = (() => {
  const set = new Set();
  for (const main of MAINS) {
    const r = spawnSync("git", ["rev-list", "--first-parent", main], { encoding: "utf8" });
    if (r.status === 0) for (const sha of r.stdout.split("\n")) if (sha) set.add(sha);
  }
  return set;
})();

const mergedInto = (branch) => {
  const tip = spawnSync("git", ["rev-parse", "--verify", branch], { encoding: "utf8" });
  if (tip.status !== 0) return null;

  // A branch that never DIVERGED is trivially an ancestor of the main it was cut from,
  // so `--is-ancestor` alone called it merged: a worktree opened minutes ago, holding
  // the dev's uncommitted work, read as "merged → origin/main" and was removed with its
  // branch force-deleted. Ancestry cannot separate "landed" from "never started" —
  // both are ancestors. First-parent reachability can: merging a branch hangs its
  // commits off the merge commit's SECOND parent, so a landed tip is never on a main's
  // first-parent chain, while an untouched branch points straight at a commit that is.
  //
  // Checked against ALL mains, not just the one that matches below: a fork's
  // `/fix-core` branch is cut from `upstream/main`, and that base commit typically
  // entered `origin/main` through the merge of a sync branch — so it is an ancestor of
  // origin/main while still sitting on upstream/main's own chain.
  //
  // Squash and rebase merges are unaffected: they rewrite the commits, so the tip is
  // not an ancestor at all and the branch was already kept as "in review". A repo that
  // fast-forwards its merges is the one case this reads as not-landed, since there the
  // feature's commits BECOME the first-parent chain. Deliberate trade — a false keep
  // costs one manual `git worktree remove`, a false remove costs unpushed work.
  if (firstParentShas.has(tip.stdout.trim())) return null;

  return (
    MAINS.find(
      (main) =>
        spawnSync("git", ["rev-parse", "--verify", main]).status === 0 &&
        spawnSync("git", ["merge-base", "--is-ancestor", branch, main]).status === 0
    ) ?? null
  );
};

/** Uncommitted or untracked files in a worktree — work that removal would destroy. */
const isDirty = (wtPath) => {
  const r = spawnSync("git", ["-C", wtPath, "status", "--porcelain"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() !== "";
};

// `feat/section-demo-p1` → brief `.briefs/demo-p1.md` (revise/* branches reuse the same brief)
const briefFor = (branch) =>
  path.join(
    ".briefs",
    `${branch.replace(/^(?:feat|revise)\/(?:section|block|snippet)-/, "").replace(/^(?:feat|revise)\//, "")}.md`
  );
const ARCHIVE_DIR = path.join(".briefs", "archive");

let removed = 0;
let kept = 0;
for (const w of list) {
  const landedIn = w.branch ? mergedInto(w.branch) : null;
  const name = path.basename(w.path).padEnd(34);
  if (!all && !landedIn) {
    console.log(`  keep    ${name} ${w.branch}  (not merged — in review)`);
    kept++;
    continue;
  }
  // Second, independent guard. `worktree remove --force` below discards uncommitted
  // and untracked files without asking, so even a correct "landed" verdict must not
  // reach a worktree someone is still typing in — a merged branch can legitimately
  // have follow-up edits sitting in it. `--all` is the explicit override.
  if (!all && isDirty(w.path)) {
    const why = landedIn ? `merged → ${landedIn}` : "forced";
    console.log(`  keep    ${name} ${w.branch}  (${why}, but has uncommitted changes)`);
    kept++;
    continue;
  }
  // Name the main it landed in, so "why did this get removed?" is answerable.
  const reason = landedIn ? `merged → ${landedIn}` : "forced";
  const brief = w.branch ? briefFor(w.branch) : null;
  const hasBrief = brief && existsSync(brief);

  if (dryRun) {
    console.log(`  REMOVE  ${name} ${w.branch}  (${reason})${hasBrief ? `  brief → ${ARCHIVE_DIR}/` : ""}`);
    removed++;
    continue;
  }
  try {
    git(["worktree", "remove", "--force", w.path]);
  } catch (e) {
    console.error(`  ! could not remove ${w.path}: ${e.message}`);
    continue;
  }
  // Drop the now-dead folder from the editor window too (opt-in, mirrors wt:add).
  editorRemove(w.path);
  if (w.branch) { try { git(["branch", "-D", w.branch]); } catch {} }
  let briefNote = "";
  if (hasBrief) {
    // Archive, don't delete: the brief is the agreed spec — /revise reads it back
    // from the archive when revising a merged feature. Newest spec wins on name clash.
    try {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
      renameSync(brief, path.join(ARCHIVE_DIR, path.basename(brief)));
      briefNote = `  brief → ${ARCHIVE_DIR}/ (commit it to share the spec)`;
    } catch (e) {
      briefNote = `  ! brief not archived: ${e.message}`;
    }
  }
  console.log(`  removed ${name} ${w.branch}  (${reason})${briefNote}`);
  removed++;
}
try { git(["worktree", "prune"]); } catch {}

console.log(`\n${dryRun ? "[dry-run] " : ""}${removed} removed, ${kept} kept.`);

// A removed worktree leaves its `wt/<slug>` development theme behind on the store, and this is
// the moment that gets forgotten: the run reports "N removed" and reads as finished. We
// deliberately do NOT delete themes here (removal is always something you ask for — see
// wt-theme.mjs), and deliberately do NOT call the Admin API to list them either: wt:clean needs
// no store credentials today, and making it hit the network on every run would break it wherever
// those creds are absent. A line of text is enough to close the gap.
if (removed > 0) {
  console.log(`\nTheir wt/* development themes are still on the store — reclaim with:`);
  console.log(`  yarn wt:theme --delete-orphans     (or \`yarn wt:theme --delete\` to pick)`);
  console.log(`  (untouched themes expire on their own after ~7 days idle)`);
}
