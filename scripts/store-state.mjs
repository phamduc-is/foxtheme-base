#!/usr/bin/env node
// Where is this theme in its Theme Store life? Derived from git tags, so nobody has
// to remember whether the last upload was a reviewer round or a release.
//
//   yarn theme:store-state           # human summary
//   yarn theme:store-state --json    # for other scripts / the /submit-theme gate
//
// Prints the declared store version, the mode (first-submission | live), the latest
// store/* tag, the submit/* rounds already uploaded for this version, and what the
// next submission is allowed to be. See scripts/lib/store-state.mjs for the tag model.
import { storeState, compareSemver, opt, currentBranch } from "./lib/store-state.mjs";

const args = process.argv.slice(2);
const state = storeState();
const branch = currentBranch();

let verdict;
if (state.mode === "first-submission") {
  verdict = `first submission — keep ${state.version}; the next upload is submit/${state.version}-r${state.nextRound}`;
} else if (state.published) {
  verdict = `${state.version} is already published (${state.latestStore.tag}) — bump on main before the next submission`;
} else if (compareSemver(state.version, state.latestStore.version) > 0) {
  verdict = `live — ${state.version} is a new release over ${state.latestStore.tag}; the next upload is submit/${state.version}-r${state.nextRound}`;
} else {
  verdict = `INVALID — declared ${state.version} is not above the published ${state.latestStore.tag}; bump on main first`;
}

if (opt(args, "json")) {
  console.log(JSON.stringify({ branch, ...state, verdict }, null, 2));
  process.exit(0);
}

console.log(`branch:        ${branch}`);
console.log(`store version: ${state.version}`);
console.log(`mode:          ${state.mode}`);
console.log(`latest store:  ${state.latestStore ? state.latestStore.tag : "— (never published)"}`);
console.log(
  `rounds:        ${
    state.rounds.length
      ? state.rounds
          .map((r) => r.tag)
          .reverse()
          .join(", ")
      : "— (nothing uploaded for this version yet)"
  }`
);
console.log(`\n${verdict}`);
process.exit(verdict.startsWith("INVALID") ? 1 : 0);
