---
description: "Phase 1 — analyze a WHOLE theme design (Figma) against the base and PROPOSE the task breakdown the teamlead turns into Jira issues: reuse / refactor / new-build per design section, with type, size, dependencies, and the toolkit route each task will take. Always emits Task-0 (theme skin). PROPOSAL ONLY — the teamlead decides; it never creates Jira issues and never writes briefs (per-item specs come later via design-to-brief). Not for spec'ing ONE section (use design-to-brief)."
argument-hint: "<figma FILE link(s) — the whole design file(s), not a single frame>"
allowed-tools: Bash(git log:*), Bash(ls:*), mcp__figma-api__get_figma_data, mcp__figma-api__download_figma_images
---

Analyze the full theme design and propose a task breakdown. **Read-only: propose a table, edit nothing, create nothing.** The teamlead reviews/edits the table and creates the Jira issues themselves — their experience decides the final cut, not this command.

## 0. Input contract — what to send
`$ARGUMENTS` = **Figma FILE link(s)** (`figma.com/design/<key>/...`) covering the whole theme design:
- One file with all pages → one link. Design split across files (e.g. one per template) → send every link.
- A single frame/screen link is NOT enough for this command — that's `design-to-brief`'s input. If given only a frame, say so and ask for the file link(s).
- Desktop + mobile: if mobile lives in a separate file/page, include it — mobile-only patterns (drawers, sticky bars) become their own tasks.
- Empty args → ask for the links; never proceed on a guess.

## 1. Read the design — inventory first, confirm before analyzing
Via the `figma-api` MCP (`get_figma_data`), enumerate the pages/top-level frames of each file (for large files, fetch page-by-page via node ids rather than the whole file at once). Print the **screen inventory** — "here's what I see: home, product, collection, cart, blog, about…" — and ask the teamlead: *anything missing, anything out of scope?* Only after that confirmation, walk the frames and inventory each distinct UI area: header, footer, hero, product cards, sliders, per-template layouts, popups/drawers, and repeated visual patterns (badges, ratings, countdowns).

## 2. Cross-reference the base — the column that saves the team weeks
For every inventoried area, check what the base already has (PROJECT-MAP.md, `sections/`, `blocks/`, `snippets/`) and classify:
- **reuse** — base section/block covers it; only settings/preset values differ (no task, or a config note inside another task).
- **refactor** — base has it but the design needs structural changes (new settings, layout variant) → task type `refactor` on the existing file.
- **new** — nothing close in base → task type `feature`, will need a brief + `create-liquid-*` route.
When unsure between reuse and refactor, open the actual base file and compare against the Figma frame — do not classify from the name alone.

## 3. Task-0 — always first, always present
The first task of every new theme is the **theme skin**: translate the design language into `config/settings_schema.json` defaults + color schemes + typography (font_picker defaults) + `config/settings_data.json`. Everything else renders through these tokens — building sections before the skin lands means re-checking them all after. Emit it as Task-0 with dependency arrows from every visual task.

## 4. Output — the proposal table
One markdown table, ready to paste into Jira after the teamlead edits it:

| # | Task | Type | Classification | Base files touched / created | Size | Depends on | Toolkit route |
|---|------|------|---------------|------------------------------|------|-----------|---------------|

- **Type**: `feature` / `refactor` / `fix` — matches how the team labels Jira issues.
- **Size**: S / M / L (S = settings-level, M = one section/block, L = section + JS component + new snippets).
- **Toolkit route**: what the assignee will run — `design-to-brief → /ship-batch` for features, `review-and-refactor` for refactors, `/fix-core` when the change lands in a core file.
- Order rows by dependency (Task-0 first, then foundations like header/footer, then leaves).
- After the table: list **open questions** for the designer (missing mobile frames, undefined states, ambiguous variants) — these block tasks and should be resolved before assignment.

## 5. Hand off
Remind: per-item specs are NOT written here. When a dev picks up a `feature` task, they run `design-to-brief` 1:1 on that item's Figma frame → `.briefs/<name>.md` → `/ship-batch`.
