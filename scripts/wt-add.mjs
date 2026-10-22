#!/usr/bin/env node
/**
 * wt:add — create a build worktree with the env it needs, in one step.
 *
 * The single home for the "worktree + symlinks" dance that /build-batch,
 * /ship-batch, /test-batch and /revise all need. It was copy-pasted across those
 * four command files; centralizing it here means the `node_modules` rule below
 * can't drift out of sync between them.
 *
 * Usage:
 *   yarn wt:add <branch>                 # create <branch> off main (or attach if it exists)
 *   yarn wt:add <branch> --base origin/main
 *   yarn wt:add <branch> --dry-run
 *
 * The worktree directory is always `.worktrees/<slug>`, slug = branch with
 * "/" → "-", so `feat/block-hero` → `.worktrees/feat-block-hero`. Idempotent: an
 * existing worktree at that path is reported and reused, never clobbered.
 *
 * Branch handling is automatic — existing branch → attach to it; unknown branch
 * → create it off `--base` (default `main`).
 *
 * Prints the worktree path on the last line, so a caller can read it back.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
let base = "main";
let dryRun = false;
let branch;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--base") base = argv[++i];
  else if (a === "--dry-run") dryRun = true;
  else if (!a.startsWith("--")) branch ??= a;
}

if (!branch) {
  console.error("Usage: yarn wt:add <branch> [--base <ref>] [--dry-run]");
  process.exit(1);
}

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts });
const root = git(["rev-parse", "--show-toplevel"]).trim();

const slug = branch.replace(/\//g, "-");
const rel = path.join(".worktrees", slug);
const dir = path.join(root, rel);

// Already there (normal for /revise and /test-batch on a second run) → reuse it.
const listed = git(["worktree", "list", "--porcelain"]).includes(`worktree ${dir}\n`);
if (listed || existsSync(dir)) {
  console.log(`Worktree already exists — reusing ${rel}`);
  console.log(dir);
  process.exit(0);
}

const branchExists =
  spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root }).status === 0;
// A PR branch from another dev exists only on origin — without this check we'd
// silently create an EMPTY same-named branch off base (a review would then see
// "no changes" and false-pass). Attach to the remote ref instead.
const remoteExists =
  !branchExists &&
  spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], { cwd: root }).status === 0;
const addArgs = branchExists
  ? ["worktree", "add", rel, branch]
  : remoteExists
    ? ["worktree", "add", rel, "-b", branch, `origin/${branch}`]
    : ["worktree", "add", rel, "-b", branch, base];

if (dryRun) {
  console.log(`[dry-run] git ${addArgs.join(" ")}`);
  console.log(`[dry-run] symlink node_modules${existsSync(path.join(root, "shopify.theme.toml")) ? " + shopify.theme.toml" : ""}`);
  console.log(dir);
  process.exit(0);
}

git(addArgs, { cwd: root, stdio: "inherit" });
console.log(`  ▸ ${branchExists ? "attached to existing branch" : remoteExists ? `created from origin/${branch}` : `created off ${base}`}: ${branch}`);

// Hand the worktree the gitignored, local-only deps it can't see on its own.
//
// `node_modules` is MANDATORY. Node resolves `require('sass')` upward to the
// repo root, but a bare binary on PATH is NOT resolved upward — `yarn lint:css`
// / `format` / `build:css` run stylelint/prettier/sass from `node_modules/.bin`,
// which a fresh worktree lacks, so they fail (`stylelint: command not found`) or
// fall back to a global Ruby `sass` that shadows dart-sass. The symlink hands the
// worktree the repo's `.bin`, so every yarn script behaves as in the main
// checkout. (`assets/` stays gitignored — `yarn wt:dev` builds it at preview time.)
const link = (name) => {
  const target = path.join(root, name);
  if (!existsSync(target)) return false;
  try {
    symlinkSync(target, path.join(dir, name));
    return true;
  } catch (e) {
    console.error(`  ! could not link ${name}: ${e.message}`);
    return false;
  }
};

if (!link("node_modules")) {
  console.error("  ! node_modules is missing at the repo root — run `yarn install`, then re-run wt:add.");
  process.exit(1);
}
console.log("  ▸ linked node_modules");
if (link("shopify.theme.toml")) console.log("  ▸ linked shopify.theme.toml");

// Opt-in, off by default — see scripts/wt-editor.mjs for why.
const { editorAdd } = await import("./wt-editor.mjs");
editorAdd(dir);

console.log(dir);
