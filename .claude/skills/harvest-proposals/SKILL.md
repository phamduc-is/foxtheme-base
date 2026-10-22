---
name: harvest-proposals
description: Maintainer-side (needs core push access) — review PENDING core-proposals raised by forks and LAND the accepted ones into the core skills/agents via a PR to foxtheme-base. The review gate + fan-in point: a fork's lesson only reaches core through your decision here. Reads `.claude/core-proposals/*.md`, applies accepted changes to the real `.claude/skills`/`.claude/agents`, opens the core PR, marks each proposal landed/rejected. For "harvest proposals", "land the core proposals", "review pending proposals". Pair with `propose-core` (the up-channel that writes the proposals).
---

# harvest-proposals (core maintainer — land the fan-in)

`propose-core` fills `.claude/core-proposals/` with apply-ready lessons from forks. This skill is the **other half**: you (with push access to `foxtheme-base`) review those, apply the accepted ones to the REAL core skills/agents, and open the core PR. Your accept/reject IS the review gate — nothing lands automatically.

**Prereq:** you can push to the core repo (the fork's `upstream` remote = `foxtheme-base`, or a direct `foxtheme-base` checkout). If you can't push to core, you can still review + mark proposals, but you can't land them — hand off to someone who can.

## Steps

0. **Guard.** Confirm `upstream` exists (`git remote | grep -qx upstream`) or you're in a `foxtheme-base` checkout. If neither, STOP: "no core remote — can't land; only review."

1. **List PENDING proposals.** In the current repo, read every `.claude/core-proposals/*.md` with `status: pending`. (To gather proposals from OTHER forks, pull/checkout each fork and re-run here — cross-fork discovery is manual for now; each fork's proposals live in its own repo.) Show a short triage table: `file · lesson (one line) · target file(s)`.

2. **Review each — accept / reject / defer.** For each proposal, read the lesson + its apply-ready blocks (Target · Anchor · Content). Judge: is it genuinely generic + correct + not already in core?
   - **Reject** → set `status: rejected` + a one-line reason in the proposal frontmatter, commit (audit trail). Don't touch core.
   - **Defer** → leave `pending`, note why. 
   - **Accept** → go to step 3.

3. **Apply the accepted proposals to core (one branch).** 
   - Prepare a core working tree: `git fetch upstream --tags` then `git worktree add .worktrees/harvest-<date> -b chore/harvest-<YYYY-MM-DD> upstream/main` (a clean core-main checkout).
   - For each accepted proposal, in that worktree: **read the target file**, locate the **Anchor** (skills drift — the anchor may have moved or the surrounding text changed; adapt the insertion, don't blindly paste), apply the **Content** as a minimal, in-voice edit. Match the file's existing style; don't reformat unrelated lines.
   - Batch related proposals into the one `chore/harvest-<date>` branch (or one branch per proposal if they're unrelated and you want independent review).
   - Commit per proposal with a clear message: `docs(skill|agent): <what> (proposal <slug>)`.

4. **Open the core PR.** `git push upstream chore/harvest-<date>` → the Bitbucket "create pull request" URL is in the push output (source = the branch, dest = `main` of `foxtheme-base`). The **PR review** is the final gate — you (or another core maintainer) review the actual skill/agent diff before merge.

5. **Close the loop in the fork.** For each landed proposal, set `status: landed` + the core PR link in its frontmatter, commit (`chore(core-proposal): mark <slug> landed`). Keep the file (audit trail) — don't delete. After the core PR merges + the fork runs `core:sync`, every fork has the improvement.

## Guardrails
- **Apply MINIMALLY** — only the proposal's stated Content; no drive-by edits to the skill/agent while you're in there.
- **Verify the anchor** against the CURRENT core file — a proposal written weeks ago may reference a line that moved or guidance that's since been added. If the target genuinely changed, adapt or flag it in the PR, don't force a stale edit.
- **Never force-push**; never auto-merge the core PR — a human reviews the diff.
- **Confirm before `git push upstream`** — it's an outward action on the shared core repo.
- Reject freely: a fork's "lesson" that's really a store-specific preference does NOT belong in core. Say so in the rejection reason.

## Output
A triage table (accepted / rejected / deferred with reasons), the core branch + PR link for the accepted batch, and the proposals marked landed/rejected in the fork.
