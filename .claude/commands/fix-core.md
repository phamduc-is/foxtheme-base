---
description: You hit a bug in a CORE file (src/js/modules, mixins, a shared snippet…) while building a feature in a child fork — a file you may not edit in the child. This lands the fix in core WITHOUT leaving the child repo: it opens a core-clean worktree off upstream/main, applies + builds + checks the fix, pushes a core PR, then optionally grafts the fix onto your current feature branch so you're unblocked immediately (no wait for merge+sync). Confirms before pushing to core.
argument-hint: "<core/file/path> \"<what's wrong / the fix>\" [--no-graft]"
allowed-tools: Bash(git remote:*), Bash(git status:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git fetch:*), Bash(git worktree:*), Bash(git checkout:*), Bash(git switch:*), Bash(git merge:*), Bash(git cherry-pick:*), Bash(git log:*), Bash(git diff:*), Bash(yarn copy:js:*), Bash(yarn build:css:*), Bash(yarn build:js-vite:*), Bash(yarn check-liquid:*), Bash(yarn check-js-contract:*), Bash(yarn lint:css:*), Bash(ls:*)
---

Land a fix to a **core** file into core (`upstream` = `foxtheme-base`) without leaving this child fork, then unblock the feature you're building. `$ARGUMENTS` = a core file path + your description of the fix (+ optional `--no-graft`). **Confirms before pushing to core** (worktree-local git ops may also prompt — intentional, see USAGE's worktree-git note).

0. **Guard — no arguments, no work.** `$ARGUMENTS` is `<$ARGUMENTS>`. Picking this command from the `/` menu runs it immediately, so an empty value may be an accident. **If `$ARGUMENTS` is empty, or has no file path:** do NOT fetch, worktree, or touch git. Print the usage line and wait:
   ```
   /fix-core <core/file/path> "<what's wrong / the fix>" [--no-graft]
      e.g.  /fix-core src/js/modules/component.js "disconnectedCallback aborts before super — reorder"
   ```

1. **Orient + classify — is this really a core fix?** Remember my current branch (`git rev-parse --abbrev-ref HEAD`) — that's the **feature branch** to unblock. Confirm `upstream` exists (`git remote | grep -qx upstream`); if not, STOP: "no core remote — can't land a core fix." Then judge the target file:
   - **Child-owned RE-SKIN** — changing what an EXISTING knob produces for THIS store (a colour, spacing, a radius/gap default, a `-markup` snippet's classes/markup, a `_component-*`/`_block-*`/`_section-*` rule) to match this fork's design → NOT a core fix. Edit it in the child (it's `merge=ours` / the fork's design layer) and STOP — no core PR needed.
   - **But a CAPABILITY added to a shared block IS a core fix, even though it touches those same files.** A NEW `{% schema %}` setting, a new merchant-facing option, a widened `range`, or a new structural/behavioural branch in a block / `-markup` snippet / `_block-*` SCSS that every fork would want → belongs IN core, not one child. The tell: a re-skin changes a *value*; a capability adds a *knob* or a *branch*. Don't bounce these — continue. They land on the `fix/<slug>` branch step 2 creates, which also keeps them clear of the `feat/**` additive-only CI gate that would otherwise fail on a modified existing core file.
   - **Additive escape** — can the feature avoid touching the core file at all by ADDING a new file (a new snippet/block/JS module in the child)? If yes, say so — additive is cheaper than a core round-trip. Only proceed when the fix genuinely belongs IN the existing core file (a real bug/limitation in `src/js/modules`, `src/js/library`, `src/scss/mixins`, or a shared snippet/section every fork uses).
   - Otherwise → it's a legitimate core fix; continue.

2. **Open a core-clean worktree (you never leave the child repo).** A worktree off `upstream/main` IS a clean core checkout.
   ```
   slug = a short kebab summary of the fix
   git fetch upstream --quiet
   yarn wt:add "fix/<slug>" --base upstream/main
   ```
   `wt:add` creates `.worktrees/fix-<slug>` off `upstream/main`, symlinks the local-only deps (`node_modules` etc. — so yarn build/check work there), and prints the worktree path on its last line — use that path everywhere below.

3. **Apply the fix in the worktree — minimal + in-voice.** Read the target file there first; make ONLY the change the description calls for (respect the repo's `Make surgical changes` rules — no drive-by refactor). For a `src/js/modules` file, keep the DOM-access contract (no new class selectors; `ref`/`data-*`).

4. **Build + verify in the worktree** (assets are gitignored — you build to VERIFY):
   - `src/js/modules/*` → `yarn copy:js` + `yarn check-js-contract` (must stay green vs baseline).
   - `src/js/library/*` → `yarn build:js-vite`.
   - `src/scss/*` → `yarn build:css` + `yarn lint:css`.
   - a `.liquid` snippet/section → `yarn check-liquid --files <path>`.
   A failure here is a blocker — fix and re-run before continuing.

5. **Commit in the worktree.** `git -C .worktrees/fix-<slug> add <file>` (source only, never `assets/`) → `git -C … commit -m "fix(core): <file> — <summary>"`.

6. **Confirm — then push to core.** Show me the diff (`git -C … diff HEAD~1`). Pushing to the shared core repo is outward — get my explicit **yes**, then `git -C .worktrees/fix-<slug> push upstream fix/<slug>`. Give me the Bitbucket "create pull request" URL from the push output (dest = `main` of `foxtheme-base`). The core **PR review + CI is the gate** — a maintainer reviews before merge.

7. **Unblock the feature NOW — graft the fix (unless `--no-graft`).** So I don't wait for the core PR to merge + sync back: on my feature branch, bring the fix commit in.
   ```
   git switch <feature-branch>
   git merge --no-ff fix/<slug>       # or: git cherry-pick <the fix commit>
   ```
   Now the feature branch has the fixed core file and I can keep building/testing. **Say this clearly:** the graft makes the feature branch temporarily *modify* a core-owned file, so `./scripts/check-additive-feature.sh` will flag it and the **feature's own PR to the child is NOT clean until the core fix has merged + been `core:sync`'d down** (at which point the file matches `main` again and the flag clears). This ordering is inherent — a feature that depends on an unmerged core fix can't ship before it. Building/testing locally in the meantime is fine.

8. **Reconcile note.** When the core PR merges and I `/sync-core`, `src/js/modules/*` (and other core-owned paths) resolve `--theirs` = core's version = the merged fix, so it reconciles with no conflict; the grafted commit becomes redundant and drops out. Then the feature PR is clean.

9. **If I can't push to `upstream`** (a dev without core access): stop at step 5 — do NOT force anything. Push the `fix/<slug>` branch to `origin` instead and tell me to hand it to a maintainer (or capture it as a code-change request for them to implement + PR). The graft (step 7) still works to unblock local building.

10. **Finish.** Leave the `fix/<slug>` branch + `.worktrees/fix-<slug>` in place until the core PR merges (I may need to push review fixes); remind me to `git worktree remove` it after. Summarize: the core PR link, whether I grafted, and the "feature PR waits on core-fix sync" ordering.
