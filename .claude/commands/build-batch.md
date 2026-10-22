---
description: Fan out builder agents to create several new sections/blocks/snippets in parallel — each on its own branch in its own git worktree. All `type:` items route to the generalized `feature-builder` (or an explicit --agent for custom/child builders). Builds only; never merges or pushes — you review each branch one at a time, then PR.
argument-hint: "section:hero-slider, block:logo-list   (or  --agent=motrix-promo a, b, c)"
allowed-tools: Bash(git fetch:*), Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git switch:*), Bash(git pull:*), Bash(git stash:*), Bash(git worktree:*), Bash(git rev-parse:*), Bash(yarn wt:add:*)
---

Build the items in `$ARGUMENTS` in parallel, each via a builder subagent isolated in its own git worktree. This is how a dev fans out many sections/blocks at once; the lead then reviews and merges them one at a time. **Build only — never merge, never push.**

## 0. Guard — no arguments, no work
`$ARGUMENTS` is `<$ARGUMENTS>`. If that is **empty** or contains no item: **STOP RIGHT HERE.** Picking this command from the `/` menu runs it immediately — I may not have typed the items yet. Do **not** stash, checkout, pull, create worktrees, or spawn a single agent. Print the usage line, then wait:

```
/build-batch <type>:<name>[, <type>:<name>…]      [--agent=<custom-builder>]
   e.g.  /build-batch section:hero-slider, block:logo-list
```

## 1. Parse the request
- Each item is `type:name` (e.g. `section:hero-slider`, `block:logo-list`, `snippet:price-tag`). All types route to the **`feature-builder`** agent — pass the `type` to it (it picks the matching `create-liquid-*` skill).
- If `--agent=<name>` is given, use that agent for every item (for custom/child builders such as `motrix-promo-builder`); items are then bare names.
- Branch per item: `feat/<type>-<name>` (e.g. `feat/section-hero-slider`). With `--agent`, use `feat/<name>`.
- The agent is **`feature-builder`** (or the `--agent` override). If it isn't present in `.claude/agents/`, STOP and say so — and that they can copy `feature-builder` to create a custom one.
- **Resolve each item's brief** at `.briefs/<name>.md` — the spec authored in Phase 1 (the design discussion). If an item has **no brief**, STOP and tell me to write one first (describe the section with Claude, share the design; Claude saves the agreed brief — see `.briefs/_TEMPLATE.md`). Do NOT build blind from just a name.

## 2. Start from a fresh main
- Remember my current branch and whether I had work-in-progress (`git status`). If dirty, `git stash push -u -m "build-batch auto-stash"` (restore at the end).
- `git checkout main && git pull --ff-only origin main`. If `--ff-only` fails (local main diverged), STOP and tell me.

## 3. Create a NAMED worktree per item (don't rely on auto-random worktrees)
For each item, one command — it creates `.worktrees/<slug>` (slug = branch with `/` → `-`, e.g. `feat-section-hero`, so a dev can tell at a glance which worktree is which), creates the branch off `main`, and symlinks the local-only deps:
```
yarn wt:add "feat/<type>-<name>"
```
It prints the absolute worktree path on its last line — pass that to the builder. Re-running it on an existing worktree reuses it instead of failing, and an existing branch is attached rather than recreated.

**Why the symlinks matter** (`scripts/wt-add.mjs` does them for you): `node_modules` MUST be linked. Node resolves `require('sass')` upward to the repo root, but a **bare binary on PATH is NOT resolved upward** — `yarn lint:css`/`format`/`build:css` run `stylelint`/`prettier`/`sass` from `node_modules/.bin`, which a bare worktree lacks, so they fail (`stylelint: command not found`) or fall back to a global Ruby `sass` that shadows dart-sass. (`assets/` is still gitignored — a fresh worktree has none; `yarn wt:dev` builds them at preview time.)

## 4. Fan out — one builder per worktree, in parallel
For every item, **in a single batch**, spawn the `feature-builder` subagent **without `isolation`** (the worktree already exists). Tell each builder:
- its **type** (`section`/`block`/`snippet`) — it routes to the matching `create-liquid-*` skill;
- the full **brief** for its item — paste the entire content of `.briefs/<name>.md` into the prompt. The builder implements the brief; if the brief references a design (Figma/URL), it reads it via the available MCP first.
- its **worktree path** `.worktrees/<slug>`, and that branch `feat/<type>-<name>` is already checked out there;
- to do **all** file writes and git commands **inside that path** via `git -C "<path>" …`, `yarn --cwd "<path>" …` and the Read/Grep/Write/Edit tools (absolute paths) — **never `cd` in a Bash command, in any form** (`cd <path> && …` trips a harness safety gate that forces a manual confirm even when auto-approved) — and never touch the main working tree;
- to obey the Builder Contract — source only, own locale keys in `en.default[.schema].json` ONLY, no `assets/`, **self-review before commit**, commit `feat(<type>): <name>`, return a manifest.

They run concurrently — each writes to a distinct worktree directory, so they can't collide.

## 5. Collect + report
Wait for all builders, then present a table — one row per item:
`worktree path · branch · files · locale keys · checks (liquid / i18n) · TODO`
Tell me to preview with **`yarn wt:dev`** (interactive picker: lists the worktrees → pick one → it **builds the assets** then runs `shopify theme dev` on a distinct port). `assets/` is gitignored, so a fresh worktree has none — without the build the theme renders broken; `wt:dev` handles it. **Preview one at a time** — every preview uploads to the single pinned dev theme, so parallel previews clobber each other's `theme.css`/`theme.js`/locales (see the ⚠️ in `.claude/USAGE.md`). Flag any builder that failed checks or returned a TODO. The branches and worktrees persist for review.

> **Worktree asset-build note (SCSS/JS edits don't show in preview).** `yarn wt:dev` builds assets **once at startup** — `shopify theme dev` then live-reloads only `.liquid`/`.json`, NOT `src/`. So after editing SCSS/JS in a worktree, rebuild: `yarn build:css` / `yarn copy:js` (modules) / `yarn build:js-vite` (library) — or run `yarn watch:css` alongside `wt:dev`. These now run **natively** in the worktree — step 3 symlinks `node_modules` (so `.bin` is on PATH) and `build:css` compiles via the dart-sass JS API — so the old "global Ruby sass shadows dart-sass / `stylelint: command not found`" trap is gone. If a change still doesn't show, `stat assets/theme.css` to confirm it rebuilt.

## 6. Hand back — do NOT merge, do NOT clean up
- Return me to my original branch; if you stashed in step 2, `git stash pop`. **Leave the worktrees in place** — I review from them.
- Remind me how to work each one, **one at a time**:
  - **Verify first:** `/test-batch <items>` — L1 static+build per branch (compiles the assets, audits every setting is wired, checks brief-conformance), then the L2 runtime/visual/interaction pass by default (`--no-l2` for static-only). This is the intended next step after a build.
  - **Review:** `yarn wt:dev` (picks a worktree, builds its assets, runs `shopify theme dev` on its own port — one preview at a time) and/or `/review-pr feat/<type>-<name>` for the static audit. (`yarn deploy:dev` from a worktree also needs `yarn build:assets` first and pushes to the shared dev theme — only for a single review or a shareable URL, not parallel.)
  - **Ask for changes:** `/revise <type>:<name> "<your feedback>"` — it folds the notes into the brief, the builder applies them in that worktree, and L1 (→ L2) re-verifies. Never edit the worktree yourself (the main session bypasses the per-agent audit path — that's exactly what `/revise` exists to prevent).
  - **Ship:** `git push origin feat/<type>-<name>` → open the PR.
  - **Clean up when done:** `git worktree remove .worktrees/<slug>` (removes the dir + its symlinks — `node_modules` + theme config; the target dirs are untouched; the branch persists).
