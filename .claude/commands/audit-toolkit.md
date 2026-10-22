---
description: Semantic audit of the .claude/ toolkit — fan out 4 parallel read-only auditors that verify skills/agents/commands/settings against the ACTUAL codebase, then synthesize one ranked findings report. Catches what `yarn check-toolkit-refs` (mechanical, in CI) cannot — contradictions between files, advice reality has refuted, claims about code that drifted, bloat. Run every 1-2 months or after a big toolkit refactor. Read-only — reports and proposes fixes, never edits.
argument-hint: "[optional focus, e.g. \"agents and commands only\"]"
allowed-tools: Bash(git log:*), Bash(git status:*), Bash(yarn check-toolkit-refs:*)
---

Audit the `.claude/` toolkit for semantic drift. `$ARGUMENTS` (optional) narrows the focus; empty = full audit. **Read-only: no auditor edits anything; you edit nothing either — report + propose, apply only after the dev approves.**

## 1. Mechanical layer first (cheap)
Run `yarn check-toolkit-refs`. Anything it flags goes straight into the report — the auditors then focus on what it CANNOT see: wrong claims about existing files, contradictions, bad advice.

Also collect `git log --oneline -20 -- .claude/ scripts/ package.json` — recent refactors are where docs lag behind code; paste the relevant lines into each auditor's prompt.

## 2. Fan out 4 read-only auditors — one message, parallel
Spawn 4 general-purpose subagents (all READ-ONLY — Read/Grep/Bash-readonly; instruct them to make NO edits). Scopes:

1. **create-\* skills + anatomy docs** — `skills/create-liquid-{section,block,snippet}/` (SKILL + `*-ANATOMY.md`), `create-js-component`, `create-scss-module`.
2. **Workflow/domain skills** — `design-to-brief`, `review-and-refactor`, `delete-section-block`, `update-locales`, `propose-core`, `harvest-proposals`, `animation-motion`, `cart-operations`, `section-rendering-api`.
3. **Agents + commands** — everything in `agents/` and `commands/`, plus `USAGE.md` and `COMMANDS.md` as the docs tying them together (`COMMANDS.md` restates every command's steps — the toolkit's highest-drift file; diff its claims against each command file).
4. **Config + top-level docs** — `settings.json`, `settings.local.json`, `agent-permissions.json`, `hooks/*.mjs`, `.mcp.json`, `CLAUDE.md`, `USAGE.md`, `CHILD.md`, `core-proposals/README.md`, relevant `.gitignore` entries. **Pin drift (MCP + CLI):** for every pinned external tool — MCP packages (`.mcp.json` + the setup commands in USAGE.md) AND the `@shopify/cli` devDependency — `npm view <pkg> version` vs the pin; if behind, read the changelog and report upgrade-worthy vs hold (never bump blindly; flags the toolkit depends on — `--experimentalPageIdRouting`, `--development-context` — must be re-verified via `--help`).

Every auditor verifies claims **against the codebase, not from memory** — grep/read the named files, check every named `yarn`-script against `package.json`, check named exports/events against `src/js/`, check named snippets/sections/blocks exist. Per-scope checklist to include in each prompt:

- **Staleness** — references to files/APIs/scripts/flags that were renamed or removed; claims about code that no longer hold (spot-check line-level claims).
- **Contradictions** — vs CLAUDE.md, vs each other, vs the code, vs itself (a checklist item that violates the file's own rule).
- **Consistency across the pipeline** — do command ↔ agent ↔ hook descriptions of the same flow still match (branch names, worktree flow, model overrides, permission grants in frontmatter vs `allowed-tools` vs `agent-permissions.json` deny lists)?
- **Description quality** — frontmatter `description`: clear triggers, explicit NOT-for, disambiguation vs sibling skills/agents.
- **Gaps** — missing validation steps (`check-liquid`, `check-js-contract`, locales, `yarn map`) the workflow promises elsewhere.
- **Bloat** — duplication across files that a pointer could replace; content CLAUDE.md already injects.

Require from each: concrete `file:line` findings, ranked (broken/stale > misleading > bloat > nit), plus what is verified-GOOD (so the verdict is balanced). Their final text is a raw structured report.

## 3. Synthesize — one report
Merge the 4 reports: dedup cross-scope findings, then rank:
- 🔴 **Hỏng thật** — an agent/command following this today does the wrong thing.
- 🟠 **Gây hiểu nhầm / lệch tài liệu** — wrong claims, contradictions, gaps.
- 🟡 **Bloat / dọn dẹp** — duplication, trimming, nits.

Lead with the overall verdict, then findings grouped by severity with per-item file + suggested fix, then a "verified good" section.

## 4. Hand back — propose, don't apply
End with a grouped fix plan (which files, which branch strategy) and ask the dev what to apply. Do NOT start editing in this command's turn. If a finding is a *generic* lesson (skill/agent gap), remind about `propose-core`.
