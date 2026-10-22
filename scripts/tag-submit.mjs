#!/usr/bin/env node
// Record one upload to the Partner Dashboard: tag HEAD of the release branch as
// submit/<version>-r<N>, N = next reviewer round for that version. Run right after
// `yarn zip`, before (or just after) uploading that zip.
//
//   yarn theme:tag-submit                          # on main or production
//   yarn theme:tag-submit --release-branch=ship    # the team ships from another branch
//   yarn theme:tag-submit --dry-run
//
// The tag message carries the zip's sha256 so a reviewer round can be matched to the
// exact archive later. Never pushes — prints the push command. Also prints what changed
// since the previous round (the reply to the reviewer) or since the last published
// version (the merchant release notes).
//
// Refuses when: not on a release branch · tree dirty · no release/<name>-<version>.zip
// · HEAD already carries a submit/* tag · the declared version is not allowed in the
// current mode (see store-state).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { storeState, compareSemver, currentBranch, isTreeClean, tagCommit, git, opt } from "./lib/store-state.mjs";

const args = process.argv.slice(2);
const dryRun = Boolean(opt(args, "dry-run"));
const releaseBranch = opt(args, "release-branch");
const fail = (msg) => {
  console.error(`tag-submit: ${msg}`);
  process.exit(1);
};

const branch = currentBranch();
const allowed = releaseBranch ? [releaseBranch] : ["main", "production"];
if (!allowed.includes(branch)) {
  fail(
    `on "${branch}" — submissions are tagged on the release branch (${allowed.join(" or ")}); pass --release-branch=<name> if the team ships from elsewhere.`
  );
}
if (!isTreeClean())
  fail("working tree is dirty — commit or drop the changes first; the tag must point at what was zipped.");

const state = storeState();
const { version } = state;
if (state.published)
  fail(`${version} is already published (${state.latestStore.tag}). Bump the version on main before submitting again.`);
if (state.mode === "live" && compareSemver(version, state.latestStore.version) <= 0) {
  fail(`declared ${version} is not above the published ${state.latestStore.tag}. Bump on main first.`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.version !== version)
  fail(
    `package.json is ${pkg.version} but settings_schema declares ${version} — run yarn theme:bump-store-version so the trio matches.`
  );
const zipPath = `release/${pkg.name}-${version}.zip`;
if (!existsSync(zipPath))
  fail(`${zipPath} not found — run yarn zip first; the tag records the archive you are about to upload.`);

const head = git("rev-parse HEAD");
const existing = git(`tag -l 'submit/*' --points-at ${head}`);
if (existing) fail(`HEAD is already tagged ${existing} — nothing new to submit. Merge the next fixes from main first.`);

const sha256 = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
const tag = `submit/${version}-r${state.nextRound}`;
const previous = state.rounds[0]?.tag ?? state.latestStore?.tag ?? null;
const message = [
  `${tag}`,
  ``,
  `zip: ${zipPath}`,
  `sha256: ${sha256}`,
  `branch: ${branch}`,
  previous ? `previous: ${previous}` : `previous: — (first upload)`,
].join("\n");

console.log(
  `${dryRun ? "[dry-run] would tag" : "tagging"} ${tag} → ${head.slice(0, 10)} (${zipPath}, sha256 ${sha256.slice(0, 12)}…)`
);
if (!dryRun) git(`tag -a ${tag} -m "${message.replace(/"/g, '\\"')}"`);

if (previous) {
  const range = `${tagCommit(previous)}..${head}`;
  const log = git(`log --oneline --no-merges ${range}`);
  console.log(
    `\nChanged since ${previous} (${previous.startsWith("submit/") ? "your reply to the reviewer" : "the merchant release notes"}):`
  );
  console.log(
    log
      ? log
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
      : "  (no commits — same content as the previous upload)"
  );
}

console.log(`\nNext:`);
console.log(`  git push origin ${tag}`);
console.log(`  upload ${zipPath} in the Partner Dashboard`);
console.log(`  when Shopify publishes it: yarn theme:tag-store`);
