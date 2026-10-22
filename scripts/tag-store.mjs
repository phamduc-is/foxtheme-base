#!/usr/bin/env node
// Shopify published the theme: record it as store/<version>, on the commit of the
// LAST reviewer round for that version (submit/<version>-r<N>) — the zip they approved —
// not on HEAD, which may already carry later work.
//
//   yarn theme:tag-store             # version = the one settings_schema declares
//   yarn theme:tag-store 1.0.1       # or name it
//   yarn theme:tag-store --dry-run
//
// From this tag on, the theme counts as live: every further submission is a new
// version (see store-state). Never pushes — prints the push command.
//
// Refuses when: store/<version> already exists · no submit/<version>-r* tag exists
// (nothing was ever uploaded for that version, so nothing can have been published).
import {
  storeState,
  submitTags,
  storeTags,
  parseSemver,
  readStoreVersion,
  tagCommit,
  git,
  opt,
} from "./lib/store-state.mjs";

const args = process.argv.slice(2);
const dryRun = Boolean(opt(args, "dry-run"));
const named = args.find((a) => !a.startsWith("--"));
const fail = (msg) => {
  console.error(`tag-store: ${msg}`);
  process.exit(1);
};

const version = (named || readStoreVersion()).replace(/^v/i, "");
if (!parseSemver(version)) fail(`"${version}" is not a semver like 1.0.1.`);

if (storeTags().some((s) => s.version === version))
  fail(`store/${version} already exists — that version is already recorded as published.`);
const rounds = submitTags(version);
if (!rounds.length)
  fail(
    `no submit/${version}-r* tag — nothing was uploaded for ${version}, so it cannot have been published. Run yarn theme:tag-submit for each upload.`
  );

const last = rounds[0];
const commit = tagCommit(last.tag);
const tag = `store/${version}`;
const message = [`${tag}`, ``, `published from: ${last.tag}`, `rounds: ${rounds.length}`].join("\n");

console.log(
  `${dryRun ? "[dry-run] would tag" : "tagging"} ${tag} → ${commit.slice(0, 10)} (the commit of ${last.tag}, ${rounds.length} reviewer round${rounds.length > 1 ? "s" : ""})`
);
if (!dryRun) git(`tag -a ${tag} ${commit} -m "${message}"`);

const state = storeState(version);
console.log(`\nThe theme is now live at ${version}. Every later upload is a new version: bump on main first.`);
if (state.latestStore && state.latestStore.version !== version) {
  console.log(`(note: ${state.latestStore.tag} is a higher published version — this tag records an older release)`);
}
console.log(`\nNext:\n  git push origin ${tag}`);
