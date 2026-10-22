// Shared reader for the Theme Store release state — the git tags that record what
// Shopify has actually seen and published. Consumed by store-state.mjs,
// tag-submit.mjs, tag-store.mjs and the guard in bump-store-version.mjs.
//
// Two tag namespaces live on the release branch (`production` in a fork, `main` if
// the team ships from main):
//   submit/<ver>-r<N>  one per zip uploaded to the Partner Dashboard — reviewer round N
//                      of store version <ver>. The version does not change between rounds.
//   store/<ver>        the commit whose zip Shopify approved and published. Its presence
//                      is what makes the theme "live": from then on every submission is a
//                      NEW version and must be bumped first.
//
// Mode is therefore derived from git, not remembered by a person:
//   no store/* tag        → first-submission: version must stay, no bump
//   any store/* tag       → live: next submission must carry a version > latest store/*
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const SCHEMA_PATH = "config/settings_schema.json";

export function git(cmd, opts = {}) {
  return execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

export function parseSemver(v) {
  const m = String(v)
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Not a semver: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The store version the theme currently declares (theme_info[0].theme_version). */
export function readStoreVersion() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const info = Array.isArray(schema) ? schema.find((s) => s.name === "theme_info") : null;
  const version = info?.theme_version;
  if (!version || !parseSemver(version)) {
    throw new Error(`${SCHEMA_PATH}: theme_info.theme_version missing or not semver (got ${JSON.stringify(version)})`);
  }
  return version;
}

function listTags(pattern) {
  const out = git(`tag -l '${pattern}'`);
  return out ? out.split("\n").filter(Boolean) : [];
}

/** Every store/<ver> tag, newest version first. */
export function storeTags() {
  return listTags("store/*")
    .map((tag) => ({ tag, version: tag.slice("store/".length) }))
    .filter((t) => parseSemver(t.version))
    .sort((a, b) => compareSemver(b.version, a.version));
}

/** Every submit/<ver>-r<N> tag for one version, highest round first. */
export function submitTags(version) {
  const re = /^submit\/(\d+\.\d+\.\d+)-r(\d+)$/;
  return listTags(`submit/${version}-r*`)
    .map((tag) => {
      const m = tag.match(re);
      return m ? { tag, version: m[1], round: Number(m[2]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.round - a.round);
}

export function tagCommit(tag) {
  return git(`rev-list -n 1 ${tag}`);
}

/**
 * The whole picture in one object. `version` defaults to the declared store version.
 *   mode: "first-submission" | "live"
 *   latestStore: { tag, version } | null
 *   rounds: submit tags for `version`, highest first
 *   nextRound: the -rN the next tag-submit would create
 */
export function storeState(version = readStoreVersion()) {
  const stores = storeTags();
  const latestStore = stores[0] ?? null;
  const rounds = submitTags(version);
  return {
    version,
    mode: latestStore ? "live" : "first-submission",
    latestStore,
    published: stores.some((s) => s.version === version),
    rounds,
    nextRound: (rounds[0]?.round ?? 0) + 1,
  };
}

export function currentBranch() {
  return git("rev-parse --abbrev-ref HEAD");
}

export function isTreeClean() {
  return git("status --porcelain") === "";
}

export function opt(args, name) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
}
