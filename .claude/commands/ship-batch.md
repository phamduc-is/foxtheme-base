---
description: Autonomous build→test→fix loop for new sections/blocks/snippets — orchestrated via the Agent tool so every subagent auto-approves inside its worktree (no manual confirmations, no auto mode needed). Per item, in its own worktree, feature-builder builds → feature-tester (L1, on a lighter model) checks + audits → if blockers, feature-builder fixes → re-test, until green or --max rounds; then feature-runtime-tester (L2 runtime/visual/interaction — ON by default, --no-l2 skips). Reports a triage table + per-item merge call. NEVER merges or pushes — you review the green items and merge them.
argument-hint: "block:logo-list, section:hero   [--no-l2] [--max=2]"
allowed-tools: Bash(git fetch:*), Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git switch:*), Bash(git pull:*), Bash(git stash:*), Bash(git worktree:*), Bash(git rev-parse:*), Bash(yarn wt:add:*), Bash(ls:*)
---

Ship the items in `$ARGUMENTS` autonomously: each is **built, tested, and fixed in a loop** in its own git worktree until it passes — you only review the green results and merge. Orchestrated with the **Agent tool** (each subagent auto-approves inside its worktree), so the whole run needs **no manual confirmations and no auto mode**. **Never merge, never push.**

## 0. Guard — no arguments, no work
`$ARGUMENTS` is `<$ARGUMENTS>`. If that is **empty** or contains no `type:name` item: **STOP RIGHT HERE.** Picking this command from the `/` menu runs it immediately — I may not have typed the items yet. Do **not** stash, checkout, pull, create worktrees, or spawn a single agent. Print the usage line, then wait:

```
/ship-batch <type>:<name>[, <type>:<name>…] [--no-l2] [--max=N]
   e.g.  /ship-batch block:logo-list, section:hero
```

## 1. Parse the request
- Each item is `type:name` (`section:hero`, `block:logo-list`, `snippet:price-tag`) → branch `feat/<type>-<name>`, worktree slug = branch with `/`→`-`.
- `--no-l2` — skip the runtime pass. **L2 is ON by default**: after L1-green, `feature-runtime-tester` runs (without store auth it self-reports `L2-blocked` — deferred, not a failure — so the default is safe everywhere).
- `--max=N` — max fix rounds per item (default **2**).
- **Resolve each item's brief** at `.briefs/<name>.md`. No brief → STOP and tell me to author one first (`design-to-brief`).
- If `feature-builder` / `feature-tester` (and `feature-runtime-tester`, unless `--no-l2`) aren't in `.claude/agents/`, STOP and say so.

## 2. Start from a fresh main + a worktree per item
- Remember my branch + WIP (`git status`). If dirty, `git stash push -u -m "ship-batch auto-stash"` (restore at the end). Then `git checkout main && git pull --ff-only origin main` (fail → STOP).
- Per item — one command, which creates `.worktrees/<slug>` (slug = branch with `/` → `-`), branches off `main`, and symlinks the mandatory local-only deps (see /build-batch step 3 for why):
```
yarn wt:add "feat/<type>-<name>"
```
It prints the absolute worktree path on its last line — pass that to the builder.

## 3. Build → test → fix loop (spawn subagents with the **Agent tool**)
**First, fan out the builds in parallel** — one `feature-builder` per item **in a single message** (they run concurrently, each in its own worktree, and auto-approve so they never prompt). Give each its **type / name / worktree-path / branch** + the **full brief text**. **Do NOT set `model`** on the builder — it inherits the session's strong model (building needs it). Each builds, self-reviews, and commits locally on its branch.

**Then, per item, run the verify→fix loop — up to `--max` rounds:**
1. Spawn **`feature-tester`** with the Agent tool — its agent definition pins `model: sonnet` (the tester mostly reads code + runs checks, so a lighter model keeps cost down); don't override it. Pass the worktree-path + brief. It runs every `yarn check-*` + the asset **build/compile** (returning early and cheap if those fail), the exhaustive **settings-wiring audit**, and **preset + brief conformance**. Ask it to return a concise `{ verdict, blockers:[{summary,file,fix}], deferredToL2:[], settingSinks:{} }` — a verdict + lists, NOT a transcript, so your own context stays small across the batch. (`settingSinks` is the per-setting output map you paste to L2 in step 4 — without it L2 re-derives it slowly.)
2. **No blockers** → the item is **L1-green**; stop its loop.
3. **Blockers, rounds remain** → spawn **`feature-builder`** (Agent tool, default model) told to **fix ONLY those blockers** (paste them) in its worktree and re-commit — do not redesign, do not touch unrelated files. Then go back to step 1 (re-test). **Bail** if a round does NOT reduce the blocker count (mark `stuck` — churning won't help).
4. **At `--max` with blockers left** → mark `needs-human`.

Items are independent — you may interleave their loops or run them one after another; each subagent works only in its own worktree, so they never collide.

## 4. L2 — DEFAULT ON (skip only with `--no-l2`), only for L1-green items, SEQUENTIAL
For each L1-green item (one at a time — `wt:dev` isolates the port and the development theme per worktree, but every agent shares ONE chrome-devtools browser; see `/test-batch` step 3), spawn **`feature-runtime-tester`** (Agent tool) with the item's **type/name/branch** + worktree-path + brief + **L1's `settingSinks` map** (paste it — the L2 pair matrix is built from it) + a preview URL if one is already running. `L2-blocked` (no store auth) = **deferred, not a failure**. If it FAILS with fixable blockers and rounds remain, one extra `feature-builder` fix round → re-run L1 (must still pass) → re-run L2.

## 5. Report — a triage table
One row per item:
`item · branch · rounds · L1 (green / needs-human / stuck) · L2 (PASS / FAIL / L2-blocked / skipped) · deferred-to-L2`
- Under the table, per non-clean item, list its remaining blockers (most-severe first).
- **Merge call** per item: **ready** (`L1 green` and L2 pass/not-required) · **needs runtime check** (`L1 green`, L2 not run or `L2-blocked`) · **needs human** (`needs-human`/`stuck` — name the blockers).

## 6. Hand back — do NOT merge, push, or clean up
- Return me to my original branch; `git stash pop` if you stashed. **Leave the worktrees + branches** — I review the green ones (`yarn wt:dev`, `/review-pr`) and merge them myself. Never merge, never push.

> **Why Agent-tool:** Agent-tool subagents auto-approve inside their worktree (the `.claude/agent-permissions.json` hook), so this runs unattended with **no prompts and no auto mode**, and the tester runs on a lighter model to cut tokens.
