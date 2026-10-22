---
description: Verify built feature branches before merge — fan out feature-tester (L1 static+build) per branch in parallel, then feature-runtime-tester (L2 runtime/visual/interaction, ON by default — --no-l2 for static-only) where L1 passed. Read-only: runs the tests and reports a triage table + per-item verdict + merge call. Never merges, pushes, or fixes.
argument-hint: "block:logo-list, section:hero   (or --all)   [--no-l2]"
allowed-tools: Bash(git fetch:*), Bash(git status:*), Bash(git branch:*), Bash(git worktree:*), Bash(git rev-parse:*), Bash(yarn wt:add:*), Bash(ls:*)
---

Test the built items in `$ARGUMENTS` — each on its own branch/worktree — **before** you review and merge them. This is the gate after `/build-batch`: **L1** (`feature-tester`) checks every item compiles, is wired, and matches its brief; **L2** (`feature-runtime-tester`) optionally renders it and checks each setting takes effect + it matches Figma. **Test only — never merge, push, or fix.**

## 0. Guard — no arguments, no work
`$ARGUMENTS` is `<$ARGUMENTS>`. If it is **empty** and `--all` was NOT passed: **STOP RIGHT HERE.** Picking this command from the `/` menu runs it immediately — I may not have typed the items yet. Do not spawn a single agent. Print the usage line, then wait:

```
/test-batch <type>:<name>[, …]   |   --all        [--no-l2]
   e.g.  /test-batch block:logo-list
```

## 1. Parse the request
- Each item is `type:name` (as `/build-batch`) or a bare branch (`feat/block-logo-list`). Resolve each to its **branch** `feat/<type>-<name>`, its **worktree** `.worktrees/<slug>` (slug = branch with `/`→`-`), and its **brief** `.briefs/<name>.md`.
- `--all` — test every unmerged `feat/*` worktree currently under `.worktrees/`. (`revise/*` branches: pass the bare branch name — `--all` covers `feat/*` only.)
- `--no-l2` — static-only run. **L2 is ON by default**: where L1 passes, `feature-runtime-tester` runs too; without store auth it self-reports `L2-blocked` (deferred, not a failure), so the default costs nothing when a preview isn't available.
- If an item has **no worktree**, create one with `yarn wt:add "<branch>"` — it attaches to the existing branch and symlinks `node_modules` (+ `shopify.theme.toml`) per `/build-batch` step 3, so its yarn build/lint runs natively. Safe to run even if the worktree already exists (it reuses it). If it has **no brief**, warn (brief-conformance is skipped) but still run the code checks + build.

## 2. Fan out L1 — one tester per item, in parallel
Spawn the **`feature-tester`** subagent for every item **in a single batch** (they auto-approve in-worktree → run silently). Tell each:
- its **type / name / branch / worktree path**, and the **brief** (paste the content of `.briefs/<name>.md`);
- to run — inside that worktree — all `yarn check-*`, the asset **build** (the compile step the builder skips), the exhaustive **settings-wiring audit** (+ static interaction wiring), and **preset + brief conformance**, then return its verdict + findings + its `deferred-to-L2` list + its **`settingSinks` map** (step 3 pastes it to L2 for the pair matrix).
They run concurrently — each reads a distinct worktree, so they can't collide. Collect every verdict.

## 3. Chain L2 — where L1 PASSED (default; skip only with `--no-l2`)
- Skip this step only when `--no-l2` was passed; always skip any item whose L1 verdict is `FAIL` (fix the static blockers first — no point rendering a feature that doesn't compile).
- For each eligible item, spawn **`feature-runtime-tester`** pointed at its worktree + brief + **L1's `settingSinks` map** (paste it — its pair matrix is built from it) (+ a preview URL if you have one running).
- **Run L2 with LIMITED concurrency — one at a time, or a small number.** This is the deliberate difference from L1's full fan-out. The binding reason is the **browser**, not the store: `yarn wt:dev` gives each worktree its own port and its own development theme, but the chrome-devtools MCP server is ONE Chrome shared by every agent in the session. `--experimentalPageIdRouting` (set in `.mcp.json`) lets each tester address its own tab by `pageId`, which is what makes more than one safe at all — they still share one browser process, its memory, and its cookie jar. Stay sequential unless you have a reason not to.
- If a tester reports `L2-blocked` (no store auth / no preview), record it and move on — do NOT fail the run over a missing preview.

## 4. Collect + report — a triage table
One row per item:
`item · branch · L1 (PASS/FAIL) · L2 (PASS/FAIL/blocked/skipped) · # blockers · deferred-to-L2`
- List each item's blockers below the table, grouped by item, most-severe first (blocker → warning → nit).
- Make the **merge call explicit** per item:
  - **ready** — L1 pass, and L2 pass or not required;
  - **needs fixes** — has blockers (name them);
  - **needs runtime check** — L1 pass but L2 not run (ran with `--no-l2`, or `L2-blocked`).

## 5. Hand back — do NOT merge, fix, or clean up
- Testing is **read-only**: leave every branch + worktree exactly as it was. Don't apply fixes here — for a failing item the dev re-runs its builder or uses `review-and-refactor`, then re-runs `/test-batch <that item>`.
- **Never merge, never push.** Merging happens after the dev reviews the green items and does it themselves.
- **An agent's environment claim is not a result — test it before you repeat it.** Feature findings come back measured; claims about the toolchain (the dev server, the CLI proxy, the browser, the store) usually come back inferred from adjacency. Before relaying one — and certainly before it becomes a memory file or a core proposal — run the smallest experiment that separates the claimed cause from the observed symptom. If it contradicts existing core guidance, assume the guidance until your own measurement says otherwise: it was written from a previous run's evidence, which the agent cannot see.

> **Pairing:** `/build-batch` (build) → `/test-batch` (this: L1 always, L2 by default — `--no-l2` for static-only) → dev reviews the `ready` items → merges + pushes each. L1 is the autonomous gate; L2 is the runtime/visual/interaction gate whenever a store preview is available.
