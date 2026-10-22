---
description: "Phase 5 — package a theme for Theme Store submission (or a live-theme update): verify gates (/store-audit green, checks pass, listings valid) → clean store data from JSON → bump the store version in lockstep → draft merchant-facing release notes from git history → build the zip → print the submission checklist. Orchestrates existing scripts (clean-data-json:release, theme:bump-store-version, zip); distinct from `yarn release` (repo/git version release, git-cliff tag). Confirms before every mutating step; never pushes, never submits — the teamlead uploads to the Partner dashboard."
argument-hint: "<store-version, e.g. 2.1.0> [--update — this is an update to a live theme]"
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git tag:*), Bash(git diff:*), Bash(yarn check-listings:*), Bash(yarn check-liquid:*), Bash(yarn check-missing-translate:*), Bash(yarn check-template-refs:*), Bash(yarn theme:store-state:*), Bash(ls:*)
---

Package the theme for Theme Store submission. `$ARGUMENTS` = the store version this upload carries (semver, no `v` prefix — this is the THEME version shown to merchants, independent of the repo's `v*` release tags) + optional `--update` flag. **Empty args → run `yarn theme:store-state`, show the current store version and mode, and ask for the version before anything else.**

**Two kinds of upload, told apart by git, not by memory.** Run `yarn theme:store-state --json` first and keep its `mode`:
- `first-submission` (no `store/*` tag): the theme has never been published. Every upload during Shopify's review — including each fix-and-resubmit round — keeps the SAME version; the rounds are counted by `submit/<ver>-rN` tags instead. `$VERSION` must equal the declared version; a bump here is a mistake.
- `live` (a `store/*` tag exists): every upload is a NEW release, a hotfix included — a Theme Store update is a manual zip submission that reviewers approve and publish, there is no silent patch. `$VERSION` must be above the latest `store/*` tag AND already declared (bumped on `main`, carried over by the release PR). `--update` is implied; if it is missing, say so and continue.
Mismatch → stop and say which of the two the tags describe.

## 1. Gates — refuse to package a theme that isn't ready
- On the **release branch**, clean tree, pulled. The release branch is `main` by default, or the branch the team ships from — a fork typically cuts `production` for its first submission and keeps releasing from it once the theme is live, so `main` can keep taking next-version features. `git status`, then compare with that branch's own `origin/<branch>` counterpart (not `origin/main`). Not there → stop.
- On a release branch other than `main`: it is fed by ONE PR from `main` per release — that merge is the boundary between two store versions — so `git log <branch>..origin/main --oneline` must be empty, or list only commits deliberately left out of this release (next-version features). Anything else means the branch is behind — merge `main` in first, re-run the checks below, then continue.
- `yarn check-liquid` + `yarn check-missing-translate` + `yarn check-template-refs` + `yarn check-listings` all green.
- Ask: has `/store-audit` been run on this state (and were ❌ items resolved)? If not, recommend running it first — packaging proceeds only on an explicit "skip audit".

## 2. Clean store data (mutating — confirm first)
`yarn clean-data-json:release` — strips demo-store resources (`shopify://`, product/collection/menu handles) and credentials (`api_key`-shaped settings, any Google `AIza…` value) from `templates/`, `sections/`, `listings/` so installs don't reference a store the merchant doesn't have, and normalises every `list-collections.json` to the reviewer's shape (main section enabled, everything else disabled). Show the diff summary after.

## 3. Version (mutating — confirm first)
`yarn theme:bump-store-version $VERSION` — updates THREE files in lockstep: the version snippet, `settings_schema.json` `theme_version`, and `package.json` `version` (which feeds the zip filename). Never edit any of them by hand; expect all three in the commit. The script itself refuses to bump a theme with no `store/*` tag, or to a version not above the highest published one (`--force` overrides, for a repo that does not track store tags).

Which means: in `first-submission` mode this step is SKIPPED — the version stays. In `live` mode the bump has normally already happened on `main` (that is how `$VERSION` got declared); run it here only when the release branch is `main` itself and the declared version is still the published one.

## 4. Release notes draft (requirement: versions + release notes)
What this step produces depends on the mode:
- `first-submission`: the theme is not on the store, the version stays, and there is nothing for a merchant to "update to" — so **no `release-notes.md` in the zip** (`scripts/zip.js` ships that file when it exists; make sure it does not). What the reviewer needs instead: for round 2+, `git log <latest submit/* tag>..HEAD` summarised as "what changed since the last upload" for the resubmission message; for the listing form, a description of the theme, not a diff.
- `live`: `git log <latest store/* tag>..HEAD` = everything merchants get with this version. Summarise into MERCHANT-facing notes: features added, sections/blocks added, fixes visible to merchants — drop internal refactors, toolkit changes, CI noise. Output as a short markdown block the teamlead pastes into the submission form, and offer to save it to `release-notes.md` at the repo root so the archive carries it.

## 5. Build the package
`yarn zip` (full clean build → assets → zip). Report the artifact path + size. Note: the zip must contain built CSS/JS only — no `.scss`, no `src/` (the zip script owns this; flag it if the archive listing shows otherwise).

Then record the upload: `yarn theme:tag-submit` tags HEAD as `submit/<version>-rN` (next round for this version, sha256 of the zip in the tag message) and prints what changed since the previous round or the last published version. It refuses off the release branch, on a dirty tree, without the matching zip, or on a HEAD already tagged — each refusal names the fix. Propose the `git push origin <tag>` it prints; don't run it.

## 6. Submission checklist (manual — print, don't claim done)
- [ ] Demo store per preset live, matches its listing, Bogus Gateway / test-mode payments on.
- [ ] Listing form content per preset (name, industry tags, screenshots) prepared.
- [ ] Release notes pasted (step 4) — live updates only; a first submission ships no release-notes.md.
- [ ] Merchant docs + contact form up to date (see /gen-docs).
- [ ] Upload the zip in the Partner dashboard → Theme Store submission form; push the `submit/*` tag.
- [ ] Reviewer sends changes back → fix on `main`, one release PR, re-run this command with the SAME version (first submission) — the next `submit/*-rN` counts the round.
- [ ] Shopify publishes it → `yarn theme:tag-store` (tags `store/<version>` on the commit of the last round — from here the theme is live and every later upload needs a bump) and push that tag.

Afterwards, remind: commit the cleaned JSON (+ the bump, when this command did it) — propose the commit, don't run it. Where the team ships from a release branch fed only by `main`, that commit belongs on `main` (a PR) and the release PR `main` → release branch carries it over. Never push `main` directly. If the team also tags repo releases, `yarn release` is the separate repo-version lane; `submit/*` and `store/*` are the store lane.
