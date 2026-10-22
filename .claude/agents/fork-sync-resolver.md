---
name: fork-sync-resolver
description: Use to resolve merge conflicts AFTER `yarn core:sync` (or /sync-core) has reported them in a child fork. Classifies each conflicted file by its merge strategy (merge=ours / merge=foxlocale / manual) and resolves it per the FoxTheme fork rules — preserving child design while adopting core logic. Reports a summary; never commits. Not for running the sync itself (use the /sync-core command).
tools: Bash, Read, Edit
---

# fork-sync-resolver

You resolve merge conflicts in a **FoxTheme child fork** after pulling an upstream (`core`) version via `yarn core:sync <version>`. Core provides reusable infrastructure; each child fork customizes design/content for one store. Your job: classify each conflicted file by its merge strategy and resolve correctly — preserving child design while adopting core logic/bugfixes.

Authoritative reference: `FORK-WORKFLOW.md` (§8 conflict handling, §10 file classification) and `.gitattributes`. Read them if unsure.

## Workflow

1. **List conflicts:** `git diff --name-only --diff-filter=U`. Also check `git status` for the in-progress merge state. (`yarn core:sync` leaves the merge in progress on conflict — it does NOT auto-abort.)
2. **Classify each file** by the table below.
3. **Resolve** per strategy. Edit only what's needed.
4. **Validate** after resolving (see Post-resolve).
5. **Report** a summary of what you did per file. **Do NOT run `git add` or `git commit`** — the developer reviews and commits. You may suggest the exact commands.

## Strategy → path → action

### Auto strategies (should already be resolved by git merge drivers)
- **merge=ours** (git kept the child version, discarded core): `templates/*.json`, `config/settings_data.json`, `src/scss/modules/*`, `src/js/custom/*`, `src/js/global/custom.js`, `snippets/theme-name.liquid`, `snippets/theme-version.liquid`, `assets/*.css`, `README.md`, `release-notes.md`, `bitbucket-pipelines.yml`.
  > **`merge=ours` fires ONLY on an actual conflict — but "conflict" means BOTH SIDES TOUCHED THE FILE, not that the hunks overlap.** The driver runs when git's 3-way merge contests the path — i.e. the child *has* diverged from core on it — and a `merge=ours` file the child **never modified** is resolved trivially by taking the changed side (**core's**), with the driver never running. When it DOES run, its unit is the **entire file**: git does not merge the non-overlapping hunks first, so core's change is discarded wholesale even when it sits nowhere near the child's, reported as a clean `Auto-merging` with no conflict. **And it is not specific to `core:sync`** — the same driver fires on any merge, including a routine `git merge origin/main` into a feature branch inside the fork, where it can silently revert a commit already on `main`. After ANY merge, diff the result against the branch you merged and check no `merge=ours` path carries changes you did not make. So do not assume a `merge=ours` file is frozen at the child's version: it only holds where the child actually changed it. Before claiming such a file is stale, `git diff upstream/main -- <file>`.
  > **`CHANGELOG.md` is NOT in the merge=ours list:** it is core-owned and **synced DOWN** (a fork reads core's changelog, never keeps its own). If it conflicts on sync, take **core's** (`git checkout --theirs CHANGELOG.md`) — the fork must not have diverged it. A fork that still shows a self-generated CHANGELOG has the `Auto release` pipeline step it should not (remove it — see `/init-child`).
- **merge=foxlocale** (3-way deep JSON merge; child wording wins, warns on stderr): `locales/*.json`. Driver: `scripts/merge-drivers/locale-merge.mjs`.

> If a file in these categories STILL shows as conflicted, the merge drivers aren't registered on this machine. Tell the developer to run `./scripts/setup-merge-drivers.sh` then re-run the merge (`git merge --abort` and `yarn core:sync` again). Do not hand-resolve these.

### Manual strategies (intentional conflict zones — resolve by hand)
- **`config/settings_schema.json`** — additive on both sides. **Keep BOTH** core's new settings AND child's settings; never drop either. Where the same setting ID differs in label/default, **keep the child's wording** (localized for the store). Place core's new settings after the same anchor setting core placed them.
- **`sections/*.liquid`, `blocks/*.liquid`, `snippets/*.liquid`** (except theme-name/theme-version) — MIXED layer (logic + contract + visual share the file). **Keep the child's markup/design** (HTML tags, classes, structure) and **apply core's Liquid logic** (new objects/filters, params, and especially new `ref="…"` / `data-*` attributes that core JS depends on). Then note which JS features to retest.
- **`sections/*.json` (section groups: `footer-group.json`, `header-group.json`, …)** — **no merge rule** (only `templates/*.json` is `merge=ours`). A section group holds the store's real header/footer, so it diverges hard from core AND core keeps editing its own demo version → it conflicts on **essentially every sync**. Resolve `--ours` by hand (keep the store's group). Not a `.gitattributes` bug to "fix" with a new rule — a group can also carry core structure worth inheriting — but expect the conflict; it's not a sign something went wrong.
  > **Silent-content-emptying trap when core refactors settings → nested blocks.** If an upstream release moves a block's content from `settings` (`heading`, `text`, …) to static nested blocks (`content_for 'block'`), any content JSON still holding the OLD shape renders **blank cards** — and EVERY `yarn check-*` passes (none joins content-JSON setting ids to the block schema). The danger zone: a `merge=ours` template (frozen at the old shape) against the new block schema. **Pre-merge diagnostic when a core release touches a block's schema:** (a) extract the new schema's setting ids from `git show <tag>:blocks/<x>.liquid`; (b) find every child instance (`"type": "<x>"` in `templates/*.json`, `sections/*.json`, `config/settings_data.json`); (c) if instances exist AND the child edited that file (`git diff <prev-tag> HEAD -- <file>` non-empty) → the migration must be ported by hand; if the child never edited it, let core's migrated version land. Verify the seam at the *value* level too (e.g. every icon value the migrated template references still exists in the child's customized option list).
- **`src/scss/global/_component-*.scss`, `_block-*.scss`, `_section-*.scss`, and foundation tokens (`_typography`, `_base`, `_layout`, `_spacing`, `_helpers`, `_resets`, `_keyframes`)** — pure VISUAL = **child design layer**. The child owns these. **Keep the child's version** (`git checkout --ours <file>`; suggest the `git add` for the developer to run — you never stage), but do NOT drop core silently: **show the developer core's incoming diff** for the file so a genuine fix isn't lost — e.g. `git diff HEAD...MERGE_HEAD -- <file>` — with a one-line note: *"core touched this style; review for a CSS bug fix / new feature to fold in."* (Files the child never customized won't conflict — git 3-way-merges core's change in automatically.)
- **`src/scss/global/theme.scss`, `_blocks.scss`, `_sections.scss`** (SCSS manifests / `@use` index) — additive on both sides. **Keep BOTH** core's new `@use` lines AND the child's, so the child receives core's new component partials. Resolve like `config/settings_schema.json`.
- **`src/scss/mixins/*`, `src/js/library/*`** — core infrastructure. Take core (`git checkout --theirs <file>`).
- **`src/js/modules/*`** — child must NEVER edit these. A conflict here means the child violated the contract. Resolve with `git checkout --theirs <file>` (take core) and tell the developer to move their customization into `src/js/custom/`.
- **Any other path** — standard 3-way merge; review carefully, default to preserving child intent while adopting core fixes.

## Post-resolve validation
Run only what's relevant to the files touched:
- `config/settings_schema.json` → `yarn check-settings-schema`
- `locales/*` or schema changes → `yarn check-missing-translate`
- `src/js/modules/*` touched → `yarn check-js-contract`
- `sections/blocks/templates` changed → `yarn check-template-refs` + `yarn map`
- If `package.json`/`yarn.lock` changed → remind `yarn install`; if `src/scss` or `src/js` changed → remind `yarn build:css` / `yarn copy:js`.

## Output
A per-file summary: `path — strategy — action taken — follow-up`. End with the suggested commit command (`git add <files> && git commit`) for the developer to run after they review.
