#!/usr/bin/env node
// Bump the Shopify Theme Store release version in lockstep across three files:
//   - snippets/theme-version.liquid (the echo'd value rendered by scripts.liquid)
//   - config/settings_schema.json    (theme_info[0].theme_version, visible in admin)
//   - package.json                   (version field, consumed by scripts/zip.js for
//                                     release filename — follows Shopify Dawn convention)
//
// Usage:
//   yarn theme:bump-store-version 2.5.0
//   yarn theme:bump-store-version 2.5.0 --force   # skip the published-version guard
//
// Guard: a store version counts releases that reached the store, so a bump is only
// due once the theme is live — i.e. a store/* tag exists (yarn theme:tag-store) — and
// the new version must be above the highest one published. Reviewer rounds of a first
// submission keep their version (submit/<ver>-rN tags count the rounds instead).
// --force bypasses it for a repo that tracks store versions without the tags.
//
// This version is independent of the internal git-tag version (CHANGELOG.md
// + `v*` tags) that auto-increments per commit on CI. Bump manually only
// when shipping a new release to the Shopify Theme Store.
//
// Implementation note: every file is patched via targeted regex (not JSON
// round-trip) so unrelated formatting — compact `{ "value": ..., "label": ... }`
// inline objects in settings_schema.json — is preserved and the diff stays
// one-line per file.

import { readFileSync, writeFileSync } from "node:fs";
import { storeTags, compareSemver, readStoreVersion } from "./lib/store-state.mjs";

const SNIPPET_PATH = "snippets/theme-version.liquid";
const SCHEMA_PATH = "config/settings_schema.json";
const PKG_PATH = "package.json";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const raw = argv.find((a) => !a.startsWith("--"));
if (!raw) {
  console.error("Missing version. Usage: yarn theme:bump-store-version 2.5.0");
  process.exit(1);
}
const version = raw.replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${raw}". Expected semver like 2.5.0 (or v2.5.0).`);
  process.exit(1);
}

// --- guard: only bump a theme that is live, and only upwards -----------------
if (!force) {
  const published = storeTags();
  const current = readStoreVersion();
  if (!published.length) {
    console.error(
      `No store/* tag: the theme has never been published, so ${current} stays through every reviewer round.\n` +
        `Record the publication first (yarn theme:tag-store) — or pass --force if this repo does not track store tags.`
    );
    process.exit(1);
  }
  const top = published[0];
  if (compareSemver(version, top.version) <= 0) {
    console.error(`${version} is not above the published ${top.tag}. A new submission needs a higher version.`);
    process.exit(1);
  }
  if (compareSemver(version, current) <= 0) {
    console.error(`${version} is not above the declared ${current}.`);
    process.exit(1);
  }
}

// --- snippet ---------------------------------------------------------------
const snippet = readFileSync(SNIPPET_PATH, "utf8");
const echoRe = /(echo\s+['"])([^'"]+)(['"])/;
const echoMatch = snippet.match(echoRe);
if (!echoMatch) {
  throw new Error(`Could not find \`echo '<version>'\` line in ${SNIPPET_PATH}`);
}
const previousSnippetVersion = echoMatch[2];
writeFileSync(SNIPPET_PATH, snippet.replace(echoRe, `$1${version}$3`));

// --- settings_schema -------------------------------------------------------
// theme_version appears only inside theme_info[0]; replace the first
// occurrence so we don't risk renaming user-added theme_version keys
// elsewhere.
const schema = readFileSync(SCHEMA_PATH, "utf8");
const themeInfoIdx = schema.indexOf('"theme_info"');
if (themeInfoIdx === -1) {
  throw new Error(`${SCHEMA_PATH}: theme_info block not found.`);
}
const schemaRe = /("theme_version":\s*")([^"]+)(")/;
const schemaMatch = schema.match(schemaRe);
if (!schemaMatch) {
  throw new Error(`${SCHEMA_PATH}: theme_version key not found.`);
}
const versionIdx = schema.search(schemaRe);
if (versionIdx < themeInfoIdx) {
  throw new Error(`${SCHEMA_PATH}: first theme_version occurrence is before theme_info — refusing to patch.`);
}
const previousSchemaVersion = schemaMatch[2];
writeFileSync(SCHEMA_PATH, schema.replace(schemaRe, `$1${version}$3`));

// --- package.json ----------------------------------------------------------
// `version` appears only once at the top level (devDependency entries use
// `"<name>": "<spec>"`, never `"version"` as a key), so first-match replace
// is safe and preserves the rest of the file's formatting.
const pkg = readFileSync(PKG_PATH, "utf8");
const pkgRe = /("version":\s*")([^"]+)(")/;
const pkgMatch = pkg.match(pkgRe);
if (!pkgMatch) {
  throw new Error(`${PKG_PATH}: version key not found.`);
}
const previousPkgVersion = pkgMatch[2];
writeFileSync(PKG_PATH, pkg.replace(pkgRe, `$1${version}$3`));

// --- summary ---------------------------------------------------------------
console.log(`Bumped store version → ${version}`);
console.log(`  ${SNIPPET_PATH}  (${previousSnippetVersion} → ${version})`);
console.log(`  ${SCHEMA_PATH}   (${previousSchemaVersion} → ${version})`);
console.log(`  ${PKG_PATH}                 (${previousPkgVersion} → ${version})`);
console.log("\nReview & commit:");
console.log(`  git diff ${SNIPPET_PATH} ${SCHEMA_PATH} ${PKG_PATH}`);
console.log(`  git commit -am "chore(store): bump theme version to ${version}"`);
