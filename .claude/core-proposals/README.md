# core-proposals — lessons flowing from forks back UP to core

Core syncs **down** to every fork; this folder is the missing **up-channel**. Lessons learned while building in a fork otherwise die in local, per-dev memory. Here they become **committed, apply-ready proposals** a core maintainer can land — so an improvement discovered in one fork reaches every fork.

```
  fork build → lesson         /propose-core        writes a pending proposal here (committed)
       │                          │                          │
       └──────────────────────────┘                          ▼
                                                 /harvest-proposals  (maintainer, core push access)
                                                          │  reviews · accepts · applies to core skills/agents
                                                          ▼
                                            PR to foxtheme-base  →  merge  →  core:sync  →  ALL forks
```

- **`/propose-core "<lesson>"`** — any dev, any fork, no core access needed. Distills a GENERIC lesson (a skill/agent gap, a reusable gotcha — never a store-specific design choice) into a proposal file here, and commits it.
- **`/harvest-proposals`** — a maintainer with push access to `foxtheme-base`. Reviews the pending proposals, applies the accepted ones to the real `.claude/skills`/`.claude/agents`, opens the core PR, and marks each `landed`/`rejected`. This review is the gate — a fork's lesson is not automatically core truth.

## Proposal file format

`<YYYY-MM-DD>-<kebab-slug>.md`:

```markdown
---
status: pending          # pending | landed | rejected
origin: <fork-name>      # which fork raised it (e.g. foxtheme-motrix)
raised: <YYYY-MM-DD>
targets:                 # the core files this touches
  - .claude/agents/feature-tester.md
  - .claude/skills/design-to-brief/SKILL.md
# on land:  landed_pr: <core PR url>
# on reject: reason: <why not core-worthy>
---

# <Title — the lesson in a phrase>

**Lesson:** <1–2 sentences: what it is + why it matters / what went wrong without it.>

## <target file path>
**Anchor:** <quote the existing line/heading to insert at or near>
**Content:**
    <the exact text to add, or the precise change, in the target file's voice>

## <next target file …>
…
```

## Rules
- **Generic only.** Would a *different* store's dev hit this? Yes → proposal. No → a memory file, not here.
- **Apply-ready.** Each change gives Target · Anchor · Content, so harvest applies it almost mechanically. Read the target file first; match its voice; don't duplicate what's already there.
- **Never edit `.claude/skills`/`.claude/agents` in a fork to "apply" a lesson** — those are core-owned, overwritten on sync. Only write proposals here.
- **Keep landed/rejected files** (audit trail) — don't delete. `status` + the PR link / reason record the outcome.
- **A proposal's paths are a snapshot, not live references.** `yarn check-toolkit-refs` skips every file in this folder at every status, so a proposal may name a path that does not exist yet (pending) or no longer exists (landed, after core deleted or renamed it). Write the paths that were true when you raised it and leave them alone afterwards — do not rewrite a landed proposal to keep a checker green.
