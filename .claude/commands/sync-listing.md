---
description: "Phase 4 — pull a finished demo store's configuration INTO the repo as a Theme Store preset listing: shopify theme pull (JSON only) → diff report → split into listings/<preset>/ + a presets entry in settings_data.json → clean + validate (check-listings). The inbound half of the demo pipeline — test-presets.mjs is the outbound half (preview a listing in its own worktree). Confirms before writing; never commits or pushes. Not for building the demo itself (done by hand in the theme editor)."
argument-hint: "<preset-name> [store-domain — omit to pick from shopify.theme.toml]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(ls:*), Bash(shopify theme list:*), Bash(shopify theme pull:*), Bash(yarn check-listings:*), Bash(yarn clean-data-json:*), Bash(yarn listings:pad-schemes:*)
---

Sync a hand-built demo store into `listings/<preset>/`. Args: `$ARGUMENTS` → preset name (Theme Store rules: 1-2 words, <30 chars, one preset per theme must equal the theme name) + store domain (omit → offer the environments from `shopify.theme.toml`). **Empty args → ask for the preset name first; never guess, never start pulling without it.**

## 1. Preconditions
- `git status` clean on the touched paths (`listings/`, `config/settings_data.json`) — if dirty, stop and say what's in the way.
- Shopify CLI authenticated for the store (a failed `shopify theme list -s <store>` means the dev must `shopify auth login` first — tell them, don't attempt auth yourself).
- Identify WHICH theme on the store holds the demo: `shopify theme list -s <store>` → ask the dev to pick (usually the live theme or the named dev theme). Never guess.

## 2. Pull JSON only — into a scratch dir, never onto the working tree
```bash
shopify theme pull -s <store> -t <theme-id> --path <scratch-dir> \
  --only "templates/*.json" --only "sections/*.json" --only "config/settings_data.json" \
  --ignore "templates/customers/*"
```
`templates/customers/*` (login, account, orders…) are the theme's own system templates, not demo content — they never enter a listing and the root copies are never overwritten. Also drop any `sections/*.context.*.json` the pull returns (a market-context override — store data). The working tree stays untouched until the confirmed write in step 5.

## 3. Diff report — what the demo changed
Compare the pulled JSON against the repo (existing `listings/<preset>/` if re-syncing, else against root `templates/` + `config/settings_data.json`). Report per file: new / changed / identical. Flag:
- section or block types used by the demo that don't exist in this theme (editor leftovers from another theme — must not enter listings);
- files identical to another preset's listing (Shopify allows omitting duplicates — propose skipping them);
- demo-store-specific resources (`shopify://` URLs, product/collection/menu/product_list keys, `http` links, metafield liquid) — step 5 STRIPS them before anything is validated; list them here so the dev knows what the listing will not carry (a merchant re-picks menus/collections after install).

## 4. Split into the listing shape
- Pulled `templates/*.json` + `sections/*.json` (section groups) → `listings/<preset>/templates/` + `listings/<preset>/sections/`.
- Pulled `config/settings_data.json` `current` object → a `presets["<Preset>"]` entry in the repo's `config/settings_data.json` (Title Case key; the folder↔key comparison in `check-listings` and `test-presets` is slug-insensitive, so `Preset Name` ↔ `preset-name` is fine). Parse the repo file with a `/* … */`-tolerant reader — the theme editor writes that banner and strict `JSON.parse` rejects it.
- **The DEFAULT preset writes to two places.** The preset whose name equals `theme_name` in `config/settings_schema.json` (Theme Store: one preset must take the theme's name) IS the install state — what a merchant gets on "Add theme". So for it, ALSO write the same pulled JSON to the root `templates/` + `sections/` (overwriting — except `templates/customers/`, which is theme-owned and stays; delete root JSON files the demo no longer has only if the dev confirms) and set `settings_data.json` `current` to the same object as `presets["<Preset>"]`. `yarn check-listings` fails when the default listing and the root drift (deep-equal per file, and `presets[default]` vs `current`), so a re-sync is the only sanction. Non-default presets never touch the root. Say which case applies in the write plan.
- **Equalise `color_schemes` after adding the preset.** Each demo ends with its own number of schemes (demo A 8, demo B 12) but one settings_data ships for all, and templates reference schemes by id — so every preset (+ `current`) must define the same ids. `yarn listings:pad-schemes` (run in step 5) copies each missing id from the preset with the most schemes (additive only — the new demo's own schemes are never altered) and prints what it added; put that list in the report. `check-listings` errors on any remaining gap.

## 5. Confirm → write → clean → validate
Show the write plan (files created/updated, the settings_data presets diff, the strip list from step 3), get a yes, then write and immediately:
- **Clean what was just written** — the repo is always shippable; nothing waits for zip time. `yarn clean-data-json listings/<preset> config/settings_data.json`, plus `templates sections` when the preset is the default (those root files were just overwritten too). It also empties the children of the **header** section's static blocks (mega-menu columns, custom links/icons, drawer items): they are authored against the demo's menus, and core ships a header with no blocks at all. It strips **credentials** the demo typed into a setting (`api_key`, `*_token`… and any Google `AIza…` value — the demo's Maps key must not bill every install). And it normalises **`list-collections.json`** — main section enabled, every other section disabled: the reviewer opens that page for the paginated collections list, while the demo store keeps its dressed-up design (only the repo copy is rewritten). Say both in the report so the dev is not surprised by a plain collections list in `test-presets`. Store data (products, menus, collections, `shopify://` images) is the store's, not the theme's: `test-presets` exists to check the section/block/settings JSON, not that a demo's products show up. `clean-data-json:release` stays in `/submit-theme` as an idempotent safety net for hand edits.
- `yarn listings:pad-schemes` — color_schemes parity (step 4).
- `yarn check-listings` — structure, type refs, naming rules, parity, default mirror; `shopify://` left behind is an ERROR here.
Report results. Suggest `yarn test-presets <preset>` to eyeball it before committing — it previews the listing in its own worktree + development theme, so the working tree keeps the files you just wrote. Propose the commit (`feat(listing): sync <preset> from <store>`) — do not run it.
