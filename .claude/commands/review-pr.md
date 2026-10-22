---
description: Review PR branches before merging — real PR list via the Bitbucket API (fallback: unmerged branches), each branch reviewed in its OWN worktree (your working tree is never touched), diff-reviewer audit by default, --l1 adds feature-tester (no-brief mode), --l2 adds the runtime pass. Reports per-branch findings + a merge verdict + a wt:dev preview hint. Read-only outward: never comments on PRs and never merges (you do those).
argument-hint: "[branch… | PR numbers | all — omit to list open PRs] [--l1] [--l2]"
allowed-tools: Bash(git fetch:*), Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(git worktree:*), Bash(git remote:*), Bash(yarn wt:add:*), Bash(node scripts/bitbucket-prs.mjs:*)
---

Review PR branch(es) so I can decide what to merge. `$ARGUMENTS` = branches / PR numbers / `all` (+ optional `--l1`, `--l2` — `--l2` implies `--l1`). **My working tree is never touched — no stash, no checkout in the main tree. Every branch gets its own worktree.**

1. **Fetch.** `git fetch --all --prune` (new PR branches + fresh `origin/main`). Do NOT switch my branch.

2. **Resolve the target list — real PRs when possible.**
   - Run `node scripts/bitbucket-prs.mjs` (allow-listed — no prompt). Success → menu of REAL open PRs: `#id · source-branch · title · author · updated`. Args given as PR numbers resolve through this list to their source branches.
   - **Exit 2 = no creds / API failure (say which):** fall back to unmerged branches as the proxy: `git branch -r --no-merged origin/main` (strip `origin/`, drop HEAD/main), each line annotated with `git log -1 --format='%cr · %an' origin/<branch>` so live PRs are distinguishable from abandoned branches.
   - No `$ARGUMENTS` → show the menu and ask which to review. `all` → everything listed. **Cost guard:** > 5 targets → show the count, confirm before proceeding.

3. **Per branch — its own worktree, sequentially.**
   - `yarn wt:add <branch>` — idempotent: reuses the worktree `/build-batch` left behind; a branch that exists only on origin is attached from `origin/<branch>` (fresh thanks to step 1's fetch). It prints the absolute worktree path on its last line — use that path for everything below (`git -C "<path>"`, Read/Grep with absolute paths; never `cd`).
   - **Freshness (reused worktrees only):** compare `git -C "<path>" rev-parse HEAD` vs `git rev-parse origin/<branch>`. Behind? The default audit (step 4) is still correct — it diffs the REFS. But `--l1`/`--l2` test the CHECKOUT, so update it first: `git -C "<path>" merge --ff-only origin/<branch>` — this one command may prompt (worktree git is deliberately not auto-approved); tell me why before running it.

4. **Audit (always): diff-reviewer** pointed at the worktree, scope `origin/main...HEAD`. Full checklist: ratcheted `check-js-contract` (NOT `:strict`), `check-liquid` on changed `.liquid`, `check-missing-translate`, `check-template-refs` (+ `check-settings-schema`/`check-range-steps` when schema changed, + `check-capability-headers` when the diff adds a `src/js/modules/*.js` or `_component-*.scss`), diff-scoped settings-wiring, interaction wiring, JS/Liquid/SCSS hard rules + performance. Capture verdict (✅ mergeable · ⚠️ needs changes · ❌ blockers) + one-line summary + findings (`path:line · rule · issue · fix`).

5. **`--l1` (opt-in): feature-tester in the worktree — no-brief mode.** PR branches from other devs have no `.briefs/<name>.md` on this machine (briefs are per-dev scratch); the tester runs everything except brief-conformance and says so. Adds: asset compilation, deep preset/schema validation, the full settings-wiring audit, `settingSinks`.

6. **`--l2` (opt-in, after L1 PASS): feature-runtime-tester** on the worktree — it starts its own preview (`yarn wt:dev <slug>`, per-worktree `wt/*` theme, headless browser). Without a brief the visual measurement tier is skipped (it says so); render-health, settings matrices from `settingSinks`, interactions, and overflow checks all run. Skip with a note if L1 failed.

7. **Report.**
   - Single target: full report (verdict + findings formatted so I can paste them as a PR comment) + scope summary (`git log origin/main..HEAD --oneline` from the worktree).
   - Multiple: **triage table** `| PR/branch | verdict | 1-line summary | #findings |` sorted worst-first, details below.
   - Every entry ends with the eyeball hint: `xem bằng mắt: yarn wt:dev <slug>` (its own dev theme — safe alongside anything else running).

8. **Harvest the lesson — before the doc is thrown away.** The review write-up is disposable: it lives in `.briefs/` (gitignored scratch), gets overwritten each round and deleted when the PR merges. So any finding diff-reviewer marked `· class` (a repeatable defect, not this author's slip) has to be routed somewhere permanent NOW, or it is re-discovered by hand on the next PR. For each one, propose the destination — do not act unilaterally, I decide:
   - **Statically detectable → a new `yarn check-*` script.** The strongest outcome: it runs in CI and nobody has to remember. This is exactly how `scripts/check-preset-values.js` came to exist. Say plainly whether the rule is mechanically checkable — most markup/schema-shape defects are, and the script is usually well under 100 lines.
   - **Needs judgment → `propose-core`.** A guidance gap in a skill/agent, or a reusable gotcha about a shared component. Lands in `.claude/core-proposals/` — committed, status-tracked, never deleted.
   - **True only for this fork → a memory file + `.claude/CHILD.md`.** Not everything is core-worthy; say so rather than inflating it.
   **Second occurrence = escalate.** A class already recorded in a proposal that shows up in another PR is no longer a hypothesis — append the new occurrence to the existing proposal and raise it from "guidance" to "write the check". Because `.claude/core-proposals/` is committed and never pruned, it is the ledger that makes the second occurrence visible at all.

9. **Finish.** My tree was never touched — nothing to restore. Leave the worktrees for my inspection; remind me `yarn wt:clean` reclaims them after merge. **Do NOT** comment on any PR and **do NOT** merge — I read the report, then comment / merge myself on Bitbucket.
