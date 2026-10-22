---
description: Calibrate a freshly PORTED toolkit to an INDEPENDENT Shopify theme (not a child fork — those use /init-child + core:sync). Run INSIDE the target theme repo. NOTE: this local copy is for forks of this core; independent themes use the plugin version, /foxtheme-toolkit:init-project, which ports first. Detects the theme's real architecture, generates PROJECT-MAP + a PROJECT-ANATOMY draft from the theme's own gold sections, rewrites the template-layer skills (create-*, review-and-refactor, CLAUDE.md) to match THAT codebase, and disables checks that don't apply. Proposal-first — every convention choice ends in a report the teamlead approves before anything is treated as law.
argument-hint: "(no arguments — run from the target theme's repo root)"
allowed-tools: Bash(git log:*), Bash(git status:*), Bash(node scripts/generate-project-map.js:*), Bash(yarn map:*), Bash(ls:*)
---

Calibrate the ported toolkit to THIS repo. Preconditions: `.claude/.toolkit-port.json` exists, `yarn install` done. If either is missing, stop and say which — for an independent theme, the porting step now lives in the foxtheme-toolkit plugin (`/foxtheme-toolkit:init-project`), not in this repo.

**Prime directive: this theme's code is the truth.** The template files you are calibrating describe foxtheme-base — a DIFFERENT architecture. Every claim you leave in a skill must be re-derived from THIS codebase, never carried over unverified. Where this theme is internally inconsistent, you PROPOSE a convention and ask — you never pick silently.

## 1. Detect — the applicability matrix

Read the repo (Glob/Read/Grep, no assumptions) and build a table of what exists:

- **Build pipeline**: `src/` present? SCSS or plain CSS? What do the existing `package.json` scripts build? (NEVER touch the theme's own build scripts.)
- **JS architecture**: custom elements? A base class? jQuery/inline scripts? Import aliases/importmap? Where do modules live?
- **Section/block model**: theme blocks (`blocks/` + `content_for`)? section-schema blocks only? Both?
- **i18n**: which locale files exist; schema locales present?
- **Theme Store artifacts**: `listings/`? `release-notes`? version snippet?

From the matrix, decide per ported check/script: **applies / needs adaptation / does not apply**. Examples of the judgment expected: `check-capability-headers` + `check-js-contract` need a `src/js/modules`-style layout — without one, remove their `package.json` entries and note why; `wt:dev` builds assets with core's script names — if this theme builds differently, adapt the build-step list in `scripts/wt-dev.mjs` or document `--no-build`; `check-listings` only matters if `listings/` exists (but for a live Theme Store theme, RECOMMEND adopting it rather than dropping the check).

## 2. Map + gold exemplars

Run `yarn map`. From PROJECT-MAP pick **3-4 gold sections and 2-3 gold snippets/blocks** — the most conventional, most reused, recently-touched files (check `git log` — prefer what the team writes TODAY over legacy style). These exemplars are the calibration source.

## 3. Calibrate the template layer — fan out, then verify

Spawn parallel read-only analysts over the gold exemplars to extract the REAL conventions (naming, schema ordering, spacing/color mechanics, snippet-vs-inline habits, JS wiring pattern, i18n key style). Then rewrite, in place:

- **`CLAUDE.md`** — replace every foxtheme-base-specific claim (build commands, conventions, common snippets/components, key patterns) with this theme's reality. Keep the generic sections (code-quality principles, working agreements, memory rules) verbatim.
- **`create-liquid-section/block/snippet`, `create-js-component`, `create-scss-module`, `review-and-refactor`, `design-to-brief`** — keep each skill's PROCESS (steps, validation, checklists), replace its ARCHITECTURE content (the anatomy references, canonical settings, base-class snippets, house rules) with what the gold exemplars actually do. Where the codebase offers no precedent for something a skill mandates (e.g. no `@capability` headers yet, no `-markup` suffix habit), mark it in the skill as **[ADOPTED — new convention, teamlead approved <date>]** or drop it — per the teamlead's call in step 5.
- **ANATOMY docs** — write a fresh `PROJECT-ANATOMY.md` for this theme from the gold exemplars (structure mirroring core's, content 100% local). Delete anatomy claims you cannot verify with a file+line.

## 4. Wire what applies

- Update `package.json`: remove entries flagged *does not apply*; keep the rest.
- If the JS layout supports it, seed `@capability` headers on this theme's obviously-reusable components (or record it as a backlog item) and run `yarn check-capability-headers:baseline`.
- Run every remaining `yarn check-*` once; each must pass or its failure must appear in the report with a reason (pre-existing debt vs toolkit misfit).
- Run `yarn check-toolkit-refs` LAST — after calibration it must pass: no skill may reference a script or file this repo doesn't have.

## 5. Hand back — proposal, not law

End with one report: the applicability matrix (applied / adapted / removed + why) · the gold exemplars chosen · **every convention question found** (inconsistencies needing a teamlead ruling, new conventions worth adopting from core) · check results · suggested first commit split. **Do NOT commit** — the teamlead reviews, answers the convention questions, then commits. Recommend re-running `/audit-toolkit` after the first month of real use.
