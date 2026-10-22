---
name: delete-section-block
description: Use when deleting, removing, or retiring a section (sections/*.liquid) or theme block (blocks/*.liquid). Runs the full cleanup — orphaned refs in templates/*.json, locale keys, PROJECT-MAP, built assets — not just the Liquid file. For "delete/remove/stop using section or block X".
---

# Delete / Stop Using a Section or Theme Block

## When to use
- User asks to **delete**, **remove**, or **stop using** a **section** (`sections/{name}.liquid`) or a **theme block** (`blocks/{name}.liquid`).
- Deleting the Liquid file alone is NOT enough — Shopify does not auto-clean `templates/*.json` presets, locale keys, or built assets. Complete the **entire sequence** below.

## Workflow (in order)

### Step 1: Impact
Before deleting, know what references it. Check **PROJECT-MAP.md** (or grep) for: which `templates/*.json`, which snippets/sections, which JS/SCSS use it. State clearly which files must be fixed.

### Step 2: Delete / clean source
- **Section:** delete `sections/{name}.liquid`. Remove related SCSS/JS in `src/` if any, and any `@use` registration in `src/scss/global/_sections.scss` / `theme.js` / `modules.js` / `snippets/scripts.liquid`.
- **Theme block:** delete `blocks/{name}.liquid`. Remove related style/JS the same way (`@use` in `src/scss/global/_blocks.scss`). **Also clean schema whitelists:** a block type can be whitelisted inside OTHER sections'/blocks' `{% schema %}` `blocks` arrays (e.g. `_marquee` in `sections/custom-section.liquid`), which `clean-template-refs` does NOT touch — `grep -rn '"{name}"' sections/ blocks/` and remove the type from every host `blocks` array.
- **Section block** (declared in a section's `{% schema %}` `blocks`, no file in `blocks/`): remove the block from the section's Liquid + delete its preset JSON manually or via the editor. `clean-template-refs` still helps drop refs to deleted section/block files.

### Step 3: JSON templates (mandatory)
Theme does **not** auto-delete presets in `templates/*.json`.
- Run **`yarn clean-template-refs`** — removes orphaned section/block refs and syncs `block_order` / `order`.
- Verify with **`yarn check-template-refs`** (use `yarn check-template-refs:fail` in CI).

### Step 4: Locale
If keys were only used by the deleted schema: remove orphaned keys in `locales/*.json` / `*.schema.json` (apply the **update-locales** skill). Run **`yarn check-missing-translate`** after schema changes.

### Step 5: Index
Run **`yarn map`** to refresh `PROJECT-MAP.md`.

### Step 6: Build
If `src/scss` or `src/js` changed, rebuild: **`yarn build:css`** / **`yarn copy:js`** (or the watcher). See the Build Commands section in CLAUDE.md.

## Quick command sequence (after deleting the Liquid file)
```bash
yarn clean-template-refs && yarn check-template-refs && yarn map
```
If schema/locale was touched, also run `yarn check-missing-translate`.

## Checklist
- [ ] Impact checked (PROJECT-MAP / grep) — all referencing files identified
- [ ] Liquid file deleted + related `src/` SCSS/JS and `@use` registrations removed
- [ ] Block type removed from every host schema `blocks` whitelist (`grep -rn '"{name}"' sections/ blocks/` finds them)
- [ ] `yarn clean-template-refs` run, `yarn check-template-refs` passes
- [ ] Orphaned locale keys removed; `yarn check-missing-translate` passes (if schema touched)
- [ ] `yarn map` run
- [ ] Rebuilt if `src/` changed
