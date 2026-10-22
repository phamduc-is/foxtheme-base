#!/usr/bin/env node
/**
 * Moved — porting the toolkit to an independent theme now lives in the
 * `foxtheme-toolkit` plugin, not here.
 *
 * This stub stays so the old command reports where the work went instead of
 * "file not found", and so the docs that name this path keep resolving.
 */
console.error(`
port-toolkit has moved into the foxtheme-toolkit plugin.

  Why: the payload it copied now ships inside the plugin (templates/), so
  onboarding a theme no longer requires having this repo cloned. And the copy
  that lived here had gone stale in two ways that mattered — it still copied
  the seven command files that are now shared by the plugin (a repo copy
  shadows them under a bare name and drifts), and it copied
  scripts/check-js-contract.js, which is what left both Sleek and Hyper with a
  post-edit-guard pointing at a script neither repo has.

  It also classified generate-project-map.js, post-edit-guard.mjs,
  diff-reviewer.md and eight others as overwrite-on-re-port. Those diverge by
  8-624 lines between two independently calibrated themes: re-porting would
  have reverted a full calibration session.

  To onboard an independent theme, from that theme's repo:

    /plugin marketplace add git@bitbucket.org:is-workspace/foxtheme-claude-toolkit.git
    /plugin install foxtheme-toolkit@foxecom
    /foxtheme-toolkit:init-project

  init-project ports first when the repo has no .claude/.toolkit-port.json,
  then calibrates.

  This does NOT affect child forks of foxtheme-base — they still get toolkit
  updates through core:sync, and propose-core / harvest-proposals are unchanged.
`);
process.exit(1);
