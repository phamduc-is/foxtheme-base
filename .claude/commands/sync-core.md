---
description: Sync an upstream core version into this child fork — go to a fresh main, merge core on a sync branch, confirm, then on your OK land it onto main, push origin/main, and delete the sync branch. Destructive; confirms before the merge AND before pushing main.
argument-hint: "[version e.g. v1.3.0 — omit for latest]"
allowed-tools: Bash(git fetch:*), Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git switch:*), Bash(git pull:*), Bash(git stash:*), Bash(git merge:*), Bash(git log:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git tag:*), Bash(yarn core:diff:*), Bash(yarn core:dry-merge:*)
---

Sync upstream core version `$ARGUMENTS` into this child fork, land it on main, and clean up. On a child fork `origin` = this store's repo, `upstream` = core. **Two confirmation gates — never skip them.**

0. **Guard — confirm before touching git.** `$ARGUMENTS` is `<$ARGUMENTS>`. Omitting the version is a *valid* mode (sync the latest), but picking this command from the `/` menu runs it immediately, so an empty value may be an accident rather than a choice. **If `$ARGUMENTS` is empty: do not stash, do not checkout, do not fetch.** Say that you're about to sync the *latest* core into this fork and ask me to confirm — or to name a version (`/sync-core v1.3.0`). Only proceed on my explicit yes. With a version given, continue straight to step 1.

1. **Go to a fresh main.** Remember my current branch (and whether I had work-in-progress). If `git status` is dirty, `git stash push -u -m "sync-core auto-stash"` to save my WIP (restore in step 10). Then `git checkout main` and `git pull --ff-only origin main`. If `--ff-only` fails (local main diverged), STOP and tell me. Confirm the `upstream` remote exists (`git remote`); if not, STOP (see FORK-WORKFLOW.md §4).

2. **Determine what to sync.** `git fetch upstream --tags` (branches + tags).
   - If `$ARGUMENTS` is given, use it as-is — a release tag (`v1.2.0`) or any upstream ref (`upstream/main` for the latest *untagged* core).
   - If empty: newest tag = `git tag -l 'v*.*.*' --sort=-v:refname | head -1`. Then check for untagged core commits beyond it: `git rev-list --count <tag>..upstream/main`. If `0`, use the tag. If `> 0`, tell me "core main is N commit(s) ahead of `<tag>`" and ask which to sync: the **tag** (stable, pinned, reproducible — recommended) or **`upstream/main`** (latest, includes untagged docs/chore). Default to the tag.

3. **Create the sync branch.** Name it `sync/core-<version>` with any `/` replaced by `-` (e.g. `upstream/main` → `sync/core-upstream-main`, `v1.2.0` → `sync/core-v1.2.0`). `git checkout -b <that name>` off the fresh main (`yarn core:sync` refuses to run on main/master).

4. **Preview.** `yarn core:dry-merge <version>` → show the exact files that would conflict (optionally `yarn core:diff <version>` for Tier 1/Tier 2).

5. **Confirm #1 — before the merge.** Summarize what will merge; do NOT run the real merge without my explicit yes.

6. **Merge core.** `yarn core:sync <version>`. If it conflicts, use the **fork-sync-resolver** subagent to resolve each file by its merge strategy. Don't move on until conflicts are resolved.

7. **Validate.** Rebuild if needed (`yarn install` if `package.json`/`yarn.lock` changed; `yarn build:css` / `yarn copy:js` if `src/` changed) and run the relevant `yarn check-*`. Show me what merged, which conflicts were resolved, and whether checks pass.

8. **Confirm #2 — before landing on main.** Tell me explicitly you're about to **merge `sync/core-<version>` into `main`, push `origin/main`, and delete the sync branch.** Wait for my explicit OK. If any check failed, surface it and let me decide.

9. **Land on main + clean up** (on my OK):
   - `git checkout main && git pull --ff-only origin main` (in case `origin/main` moved during the sync).
   - `git merge sync/core-<version>`.
   - `git push origin main`.
     - **If the push is rejected** (branch protection on main): do NOT force. Instead `git push origin sync/core-<version>`, tell me to open a PR from it, keep the sync branch, and stop here.
   - On successful push: `git branch -d sync/core-<version>` (safe delete — refuses if somehow unmerged; never use `-D`).

10. **Finish.** Return to my original branch (`git checkout <original>`) and, if you stashed in step 1, `git stash pop` to restore my WIP. (If I started on `main`, stay on `main`.) Remind me that `main` now has core `<version>` — integrate it into active feature branches as needed.
