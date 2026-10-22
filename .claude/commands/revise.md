---
description: Hand YOUR review feedback on an already-built feature back to the agents — they revise it and re-test, you never touch the worktree. Translates your free-form notes into a concrete change list, folds it into the brief, then feature-builder applies it and feature-tester (L1) re-verifies in a loop until green; feature-runtime-tester (L2) runs by default (--no-l2 skips). Use after /build-batch or /ship-batch, when you have looked at the result and want changes. Never merges or pushes.
argument-hint: "block:highlight-badge \"badge too tall on mobile; icon should default to the right\" [--no-l2] [--max=2]"
allowed-tools: Read, Grep, Write, Edit, Bash(git status:*), Bash(git branch:*), Bash(git worktree:*), Bash(git checkout:*), Bash(git switch:*), Bash(git fetch:*), Bash(git log:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(git merge-base:*), Bash(yarn wt:add:*), Bash(ls:*)
---

Apply my feedback to an already-built feature and re-verify it — **entirely through subagents**, in a git worktree (recreated from the branch or from `main` if `wt:clean` already removed it). I have looked at the result and want changes. **Never merge, never push.**

Parse `$ARGUMENTS` as: one `type:name` item, then my **feedback in quotes**, then optional flags.

## 0. Guard — no arguments, no work
`$ARGUMENTS` is `<$ARGUMENTS>`. If that is **empty**, or has no `type:name` item, or has no feedback text: **STOP RIGHT HERE.** Selecting this command from the `/` menu runs it immediately — I may not have had a chance to type anything. Do **not** read files, spawn agents, create worktrees, or touch git. Just print the usage line and ask me for the item + feedback:

```
/revise <type>:<name> "<what you want changed>" [--no-l2] [--max=N]
   e.g.  /revise block:highlight-badge "badge too tall on mobile; icon should default to the right"
```

Then wait. (Tip for me: press **Tab** to accept a `/` completion without running it, then type the arguments.)

## Why this command exists
You (the main session) do **not** route through the per-agent auto-approve hook, so an `Edit`/`Write`/`Bash` you make inside a worktree isn't audited the way a subagent's is. So: **you read and think, they write.** You may `Read`/`Grep` the worktree freely; you **must not edit a single feature file in it** — that is the builder's job, and only its commits are self-reviewed and re-tested. (Note: `.claude/settings.json` pre-allows `Edit/Write(.worktrees/**)` as a human escape hatch, so this rule is now a convention, not a prompt that stops you — honour it. The only things you write here are the worktree scaffold in step 1 and the brief in the main repo in step 3.)

## 1. Resolve + get a worktree — even for an already-merged feature
`type:name` → branch `feat/<type>-<name>`, worktree `.worktrees/<slug>` (slug = branch with `/`→`-`), brief `.briefs/<name>.md`. The feature files are `blocks/<name>.liquid` (or `sections/`), its `-markup` snippet, and `src/scss/global/_*<name>.scss`.

**Find a worktree to work in — try in this order, don't just STOP:**
1. **Worktree exists** (`.worktrees/<slug>` in `git worktree list`) → use it.
2. **Worktree gone, branch `feat/<type>-<name>` still exists** → recreate with `yarn wt:add "feat/<type>-<name>"` (attaches to the branch and symlinks deps per `/build-batch` step 3). `wt:clean` removes merged worktrees, so this is the normal post-review state.
3. **Both gone but the feature EXISTS on `main`** (the branch merged, then got pruned — check `git rev-parse --verify main:blocks/<name>.liquid` or `sections/`) → the feature is live code now. Make a fresh revise branch off latest main: `git fetch origin --quiet`, then `yarn wt:add "revise/<type>-<name>" --base origin/main`. Tell me you're revising the **merged** feature on a new `revise/*` branch (I'll PR it like any other change).
4. **The feature doesn't exist anywhere** → STOP: "no `<name>` found on a branch or on main — run `/build-batch <item>` or `/ship-batch <item>` first."

**Get a brief — archive first, reconstruct only as a last resort:**
- Brief present at `.briefs/<name>.md` → use it.
- **Brief missing** → check **`.briefs/archive/<name>.md`** — `wt:clean` archives a merged feature's brief there (committed). Found → copy it back to `.briefs/<name>.md` and use it (that's the real agreed spec).
- **Archive missing too** (pre-archive feature, or another dev never committed it) → do NOT stop. **Reconstruct a minimal brief from the current code**: read the feature's `.liquid` + `-markup` + `.scss` (+ its JS module), and write `.briefs/<name>.md` capturing what's actually there now — the settings table (id/type/default from the schema), the structure, the acceptance bullets you can infer, **an Interactions table from the wired handlers/components you find** (carousel/dialog/on:* handlers → one row each; none → "N/A"), and **an Edge cases table** (rows you can infer; anything you can't determine → "unknown — verify at L2"). This becomes the baseline your feedback edits in step 3. Tell me it was reconstructed, so I know it's inferred, not the original spec.

Then **read the brief and the feature's actual files with the Read/Grep tools**, and `git -C "<worktree>" log --oneline` to see what's already been done.

## 2. Turn my feedback into a concrete change list
My notes are loose ("badge too tall on mobile", "colour looks washed out"). Your job is to make them **actionable and specific** before any agent sees them — this is the one thing you are better at than the builder, because you can read the code and the brief together.

For each note, produce: **what changes · which file · which setting/rule · what the new value or behaviour is.** Example:
> "badge too tall on mobile" → `blocks/highlight-badge.liquid`: `padding-block-start`/`-end` default 6 → 4; `src/scss/global/_block-highlight-badge.scss`: no change (padding is setting-driven).

**If a note is ambiguous, or would contradict the brief, or you see two reasonable readings — ASK ME before proceeding.** A guess here costs a whole build+test round. A question costs one message.

**Cover every note — no silent drops.** Split my feedback into discrete notes and account for **each** one: either it becomes a change-list entry, or you explicitly decline it (with a reason) and say so back to me. A five-point note half-applied is the failure to avoid; the step-7 report must list every note with its outcome.

Also classify each note two ways:
- **design change** (the brief must change, step 3) vs **defect** (the brief is already right, the code isn't — brief stays as-is).
- **static-verifiable** (a class/attr/var/default L1 can confirm) vs **visual-only** ("too tall", "washed out", "off-center", spacing/colour/proportion — only a rendered page confirms it).

**If any accepted note is visual-only and `--no-l2` WAS passed → tell me before building**: "this feedback is visual — only the runtime pass can confirm it; drop `--no-l2`, or I'll apply it but the result stays `needs runtime check`." (L2 runs by default, so this only comes up when you explicitly disabled it.) Don't quietly report L1-green as if the visual change were verified.

## 3. Fold the accepted changes into the brief — MANDATORY
Edit `.briefs/<name>.md` so it describes the feature **as it should now be** (settings table, defaults, style notes, acceptance bullets). `.claude/settings.json` pre-allows `Read/Edit/Write(.briefs/**)`, so this never prompts, in any permission mode.

**Skip this and the next L1 pass will flag your own change as a brief deviation, and the builder will helpfully undo it.** For a pure defect fix, the brief needs no edit — say so explicitly in your report.

### 3a. Settings delta — the step a revision most often botches
A revision that touches the settings is not done when the prose reads right. Before you save the brief, spell out the delta explicitly:
- **ADD** — settings this change introduces (id + type + what output they must reach).
- **REMOVE** — settings this change retires. For EACH one, trace what consumed it — the `{{ …settings.<id> }}` read, the class/attr/CSS-var it fed, the SCSS rule reading that var — because the builder must delete **all** of it, not just the schema entry. A removed setting whose consumer lingers is a dead var; a consumer whose setting is gone is a broken read.
- **KEEP** — settings that stay (say so, so the builder doesn't drop them).

Then **update the brief's settings TABLE** to match this delta — not just the surrounding prose. A brief whose prose says "no subtext option" while its table still lists `subtext` is internally inconsistent, and the builder will faithfully implement the contradiction.

Carry the **REMOVE list** forward: it goes to the builder in step 4 ("delete these settings AND everything that consumed them") and to the tester in step 5 (as the list it must confirm are gone).

## 4. Revise — spawn `feature-builder` (Agent tool)
One builder, default model (no `model` override). Give it: type · name · **the actual worktree path and branch resolved in step 1** (which may be a `revise/*` branch for a merged feature, not `feat/*`) · the **updated brief in full** · the **change list** from step 2.

Tell it plainly:
- Apply **only** the listed changes. Do not redesign, do not add features, do not touch unrelated files or settings.
- If the change list has a **REMOVE** set (step 3a): delete each of those settings **and everything that consumed it** — the schema entry, the `-markup` read, the class/attr/CSS-var it emitted, and the SCSS rule reading that var. Leaving any of it behind is the revision's most common defect.
- `yarn --cwd "<path>" …`, `git -C "<path>" …`, Read/Grep/Write/Edit tools with absolute paths. **Never `cd` in a Bash command, in any form.**
- Self-review, then commit locally on the same branch: `fix(<type>): <name> — <short summary of the revision>`.

## 5. Verify → fix loop — up to `--max` rounds (default **2**)
1. Spawn **`feature-tester`** (Agent tool — its agent definition pins `model: sonnet`; don't override) with the worktree path and **the full text of the updated brief pasted into the prompt** — the brief lives in the main repo's `.briefs/` (gitignored, NOT inside the worktree), so the tester can't find it on its own; paste it, don't reference the path. It runs every `yarn check-*` (including `check-range-steps`), the asset build, the settings-wiring audit, the static interaction-wiring audit, and brief conformance against the NEW brief. Ask for `{ verdict, blockers:[{summary,file,fix}], deferredToL2:[], settingSinks:{} }` — a verdict and lists, not a transcript (`settingSinks` feeds L2's pair matrix in step 6).
   - **Re-audit the WHOLE schema, not just the changed settings** — run the full Mức A wiring pass on every setting, because a revision can orphan a setting that the change didn't name.
   - On a **`revise/*` branch** (step-1 case 3 — revising a merged feature), the tester **skips `./scripts/check-additive-feature.sh`** and reports it `skipped (revise branch)` — a revision of live code intentionally modifies existing files; do not count that as a blocker.
   - **Revision-specific severity:** paste the step-3a **REMOVE list** and tell the tester that any of those settings **still present in the schema — even if fully wired — is a BLOCKER, not a nit.** (For a fresh build a present-beyond-brief setting is only a nit; in a revision it means the requested change wasn't finished.) Dead / no-op / dead-var settings remain blockers as always.
2. No blockers → **L1-green**, stop the loop.
3. Blockers with rounds left → spawn `feature-builder` again to fix **only those** (paste them), then re-test. **Bail** if a round does not reduce the blocker count (`stuck`).
4. Out of rounds with blockers left → `needs-human`.

## 6. L2 — default ON (skip only with `--no-l2`)
Spawn **`feature-runtime-tester`** so I can see the revision actually render — pass the item's type/name/branch, the worktree, the updated brief, **L1's `settingSinks` map**, and a preview URL if one is already running. `L2-blocked` (no store auth) is deferred, not a failure. If it FAILS with fixable blockers and rounds remain: one builder fix round → re-run L1 → re-run L2.

## 7. Report
- **Worktree:** which of the step-1 cases applied (reused / recreated from branch / fresh `revise/*` off main). If the brief was reconstructed, say so — it's inferred, not the original spec.
- **What I asked → what changed** — one row per note, **every note accounted for**: `my note · design-change|defect · static|visual · what was changed · file`. Any note declined: say so and why.
- **Brief:** updated (list the sections) or unchanged (say why). If settings changed, show the **delta**: added / removed / kept.
- **Verify:** `rounds · L1 (green / needs-human / stuck) · L2 (PASS / FAIL / L2-blocked / skipped)`; remaining blockers most-severe first. **If any accepted note was visual-only and L2 did not run, mark the whole result `needs runtime check` — do not imply L1-green verified the visual change.**
- **Merge call:** ready · needs runtime check · needs human.
- Leave the worktree + branch alone — I review and merge them myself.

> Same orchestration model as `/ship-batch`: Agent-tool subagents auto-approve inside their worktree, so the whole revision runs unattended. The difference is where the change list comes from — `/ship-batch` gets it from the tester, `/revise` gets it from me.
