---
name: propose-core
description: Promote a GENERIC lesson learned while working in a child fork UP to the core (foxtheme-base) skills/agents. Turns a lesson into an apply-ready proposal file in `.claude/core-proposals/` (committed, so it survives — memory is local-only and never reaches core). For "this should be a skill/agent update", "propose this to core", "core-worthy lesson". NOT for child-specific design decisions (those stay in a memory file). The maintainer lands accepted proposals with `harvest-proposals`.
---

# propose-core (child → core, fan-in)

Core skills/agents sync **down** to every fork (`core:sync`); nothing flows **up**. Lessons learned while building end up in **local memory** (`~/.claude/…/memory/`) — per-dev, never committed, invisible to core. This skill is the up-channel: it captures a core-worthy lesson as a **committed, apply-ready proposal** that a maintainer can land into core.

You do NOT edit core skills/agents from here — you can't (they'd be overwritten on the next sync). You produce a **proposal**; `harvest-proposals` (run by someone with core push access) applies it and opens the core PR. That human review is the gate — a fork's lesson is not automatically core truth.

## When this applies — is the lesson GENERIC?

Propose only what helps **any** fork of foxtheme-base:
- a gap in a **skill** (a missing step in `design-to-brief`, `create-liquid-block`, …) or an **agent** (a check `feature-tester` should run, a blind spot `feature-runtime-tester` keeps hitting);
- a **reusable gotcha** about the theme's shared components/contract (`Component`/`on:click` delegation, `deferred-media`, `flex-carousel`, split-marker, nested blocks) — something every fork's builder can hit.

**NOT** for this store's design decisions (a block's radius/naming/colour, which section it lives in, its data model). Those are child-specific → write a **memory file**, not a proposal. If you're unsure, ask: "would a *different* store's dev hit this?" — no → memory; yes → proposal.

## Steps

1. **Distill + gate.** State the lesson in one or two sentences and WHY it matters (what went wrong without it). Confirm it's generic (above). If it's child-specific, stop and write a memory instead.
2. **Make it apply-ready.** The value of a proposal is that a maintainer can apply it almost mechanically. For EACH change, give three things:
   - **Target** — the exact CORE file path (`.claude/agents/feature-tester.md`, `.claude/skills/design-to-brief/SKILL.md`, …).
   - **Anchor** — quote the existing line/heading to insert at/near (so harvest can locate it even if the file drifted).
   - **Content** — the exact text to add or the precise change, written in the target file's voice/format (read the target file first to match its style + not duplicate what's already there).
3. **Write the proposal file.** Path: `.claude/core-proposals/<YYYY-MM-DD>-<kebab-slug>.md` (date = today, from context — do not invent). Use the frontmatter + section layout from `.claude/core-proposals/README.md` (`status: pending`, `origin`, `targets:`, then one `## <target file>` block per change with **Anchor** + **Content**). Keep it tight; one proposal = one coherent lesson (bundle closely-related edits, split unrelated ones).
4. **Commit it** on the current branch: `chore(core-proposal): <slug>`. It now travels with the fork's normal push — durable, team-visible, out of local memory. That's the deliverable; you do NOT push to `upstream` from here.
5. **Point at the next step.** Tell the dev: it's queued in `.claude/core-proposals/`; a maintainer with core access lands it via `/harvest-proposals`. If the dev IS that maintainer, they can run harvest now.

## Guardrails
- **Never edit `.claude/skills/**` or `.claude/agents/**` in the fork** to "apply" the lesson — those are core-owned, overwritten on sync. Only ever write to `.claude/core-proposals/`.
- **Never `git push upstream` / open a core PR from this skill.** Proposing ≠ landing; landing is `harvest-proposals`, behind a human decision.
- One proposal, one lesson. Don't dump a session's whole diff — extract the generic, reusable part.
- Match the target file's existing structure; a proposal that duplicates guidance already in the skill is noise — read the target first.

## Output
The committed proposal path, a one-line summary of the lesson, and the target file(s) it touches — plus the reminder that `harvest-proposals` (maintainer) lands it.
