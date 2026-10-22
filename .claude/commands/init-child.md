---
description: "Phase 0 — bootstrap a NEW child theme fork from foxtheme-base: remotes (origin=child, upstream=core), merge drivers, CHILD.md, shopify.theme.toml environments, theme identity, first map build. Run INSIDE the fresh clone of the new child repo. Guided + idempotent — safe to re-run; confirms before anything destructive. Not for syncing an existing fork (use /sync-core)."
argument-hint: "[theme-name — omit to be asked]"
allowed-tools: Bash(git remote:*), Bash(git fetch:*), Bash(git status:*), Bash(git log:*), Bash(git config:*), Bash(ls:*), Bash(yarn map:*), Bash(yarn check-toolkit-refs:*), Bash(./scripts/setup-merge-drivers.sh), Bash(yarn core:diff:*), Bash(yarn install)
---

Bootstrap this repo as a new child theme fork. Theme name: `$ARGUMENTS` (ask if empty). A new theme = a new child fork of foxtheme-base — this command runs the setup that, when skipped or half-done, silently breaks `core:sync` months later.

## How a child fork is born (so you know where this command sits)
1. Teamlead creates an **empty child repo** on Bitbucket by hand (no API access — manual).
2. Dev clones the CORE repo into a fresh folder: `git clone <core-url> <theme-name>` — at this point `origin` still points at core; that's expected.
3. Dev opens `claude` in that folder and runs `/init-child <theme-name>` → this command **converts** the clone into the child (steps below).

This command NEVER runs in the team's long-lived core working copy. It cannot tell a fresh clone from your core checkout by looking — so it asks (step 0).

## 0. Preconditions — verify, don't assume
- We are inside a git repo with the base shape (`sections/`, `.claude/`, `scripts/core-sync.mjs` exist).
- **The core-vs-clone question, asked out loud:** if `origin` points at foxtheme-base, say so and ask: *"Is this working copy a fresh clone being converted into child `<name>` — or your core checkout?"* Convert only on an explicit yes. Red flags that this is NOT a fresh clone — dirty tree, local feature branches, `.worktrees/` entries, an `upstream` remote already present — surface them and stop unless the dev overrides.
- Collect from the dev (ask only for what's missing): **theme name**, **child repo git URL** (Bitbucket, created in step 1 above), **core repo git URL**, store domains for the `development` / `test` / `intro` environments (+ theme IDs if already created).

## 1. Remotes — the #1 silent killer of future syncs
- `origin` must point at the CHILD repo. If it still points at core (cloned from base), re-point it: `git remote set-url origin <child-url>`.
- `upstream` must point at CORE: `git remote add upstream <core-url>` (or fix it). Then `git fetch upstream --tags`.
- Verify: `git remote -v` shows origin=child, upstream=core. `yarn core:diff <latest-tag>` must run without error.

## 2. Merge drivers + attributes
Run `./scripts/setup-merge-drivers.sh` — registers the `foxlocale` / `ours` merge drivers that `.gitattributes` references. Without this, the first `core:sync` mangles locale files and overwrites `CHILD.md`.

## 3. Child identity
- **`.claude/CHILD.md`** — fill the header: theme name, store conventions section (can start near-empty; it is `merge=ours`, core never overwrites it).
- **`config/settings_schema.json`** `theme_info[0]`: set `theme_name` to the new theme's name (keep `theme_version` lockstep rules — see `yarn theme:bump-store-version`).
- **`shopify.theme.toml`**: create/update `[environments.development|test|intro]` with the collected store domains + theme IDs. Note: the inherited `.gitignore` ignores this file — it stays per-dev/local by default; if the team wants it committed, that takes a deliberate `.gitignore` edit (ask, don't assume).

## 4. Install + verify
- `yarn install` (runs postinstall → PROJECT-MAP), then `yarn map`.
- Run the check suite: `yarn check-liquid`, `yarn check-missing-translate`, `yarn check-toolkit-refs` — all must be green on a fresh fork.
- Remind: restart `claude` in the new repo (agents/hooks load at startup) and approve the PreToolUse hook on first prompt.

## 5. Report + manual tail
Print a checklist of what was done vs what remains **manual** (do NOT attempt these):
- Bitbucket: repo created, `main` branch protection, CI pipeline enabled. Mirror core's **lint** steps, but **OMIT the `Auto release` (git-cliff) step** — a fork must NOT run git-cliff on its own history (mostly synced core commits → a core-flavoured CHANGELOG and orphan `chore(release):` commits whose versions collide with core's tags). The fork's `bitbucket-pipelines.yml` is `merge=ours`, so this stays fork-owned. The store's version is `yarn theme:bump-store-version`; merchant release notes come from `/submit-theme`.
- Shopify: dev/test/intro stores exist, themes pushed once (`yarn deploy:dev`).
- Team: devs clone, run `/plugin` + MCP setup per `.claude/USAGE.md` → "Setup cho dev mới".

Confirm before any file write; never push anything.
