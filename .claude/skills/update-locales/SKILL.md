---
name: update-locales
description: Use while adding or renaming i18n keys for the section/block/snippet you are building — replacing hardcoded schema text (name/label/content/options) with t:* keys and adding values to en.default[.schema].json. For "add translation key", "this label needs i18n". For a full cross-language audit that fills keys missing across de/es/fr/it, use the locale-auditor agent.
---

# Update Locales (i18n)

## When to Use

- Adding new `name`, `label`, `content`, or `options` in a section/block schema
- Adding Liquid text rendered via `{{ 'key' | t }}`
- Renaming existing schema labels
- Verifying no missing or unused translation keys

## Two Locale Files

| File | Purpose | When to edit |
|------|---------|-------------|
| `locales/en.default.schema.json` | Editor text: section/block names, setting labels, option labels, group headers, categories | Every time schema has new keys (`t:names.*`, `t:settings.*`, etc.) |
| `locales/en.default.json` | Storefront text rendered in Liquid: `{{ 'key' | t }}`, accessibility, error messages | When Liquid renders a translated string |

**Schema-only text** (editor labels never shown on storefront) → `en.default.schema.json` only.  
**Liquid-rendered text** → `en.default.json` (and optionally `en.default.schema.json` if also used as label).

## Key Namespace Map

| Schema usage | JSON path in `en.default.schema.json` |
|-------------|--------------------------------------|
| `"name": "t:names.hero_banner"` | `{ "names": { "hero_banner": "Hero banner" } }` |
| `"label": "t:settings.heading"` | `{ "settings": { "heading": "Heading" } }` |
| `"label": "t:options.left"` | `{ "options": { "left": "Left" } }` |
| `"content": "t:content.layout"` | `{ "content": { "layout": "Layout" } }` |
| `"category": "t:categories.basic"` | `{ "categories": { "basic": "Basic" } }` |
| `"info": "t:info.leave_blank_to_use_default"` | `{ "info": { "leave_blank_to_use_default": "…" } }` |

Also real (rare): `html_defaults.*` / `text_defaults.*` — preset default content for text/HTML settings. Don't invent a namespace outside this table; `info` text goes under `info.*`, never `settings.*`.

## Workflow

### Step 1: Identify new keys

After creating or editing a section/block schema, list all new `t:*` keys used that don't exist yet in the locale files.

### Step 2: Check for existing keys

Before adding, search `en.default.schema.json` for the same or similar key. Many common keys already exist:
- `t:settings.heading`, `t:settings.text`, `t:settings.image`, `t:settings.color_scheme`
- `t:settings.container`, `t:settings.direction`, `t:settings.gap`
- `t:content.layout`, `t:content.appearance`, `t:content.padding`, `t:content.content`
- `t:options.left`, `t:options.right`, `t:options.center`, `t:options.full`, `t:options.fixed`

Reuse existing keys when the meaning matches. Do not create `t:settings.heading_text` if `t:settings.heading` already exists.

### Step 3: Add new keys

Add missing keys to the correct namespace in `locales/en.default.schema.json`:

```json
{
  "names": {
    "new_section_name": "New Section Name"
  },
  "settings": {
    "new_setting_id": "Setting label"
  },
  "options": {
    "new_option_value": "Option label"
  },
  "content": {
    "new_group_name": "Group Header"
  }
}
```

If the text is Liquid-rendered, also add to `locales/en.default.json` under the appropriate namespace.

### Step 4: Verify

Run `yarn check-missing-translate` to detect any `t:*` keys used in schema that are missing from locale files.

Run `yarn check-unused-translate` to detect keys defined in locale files but not used anywhere.

## Common Mistakes

- **Committing locale work as type `i18n`** — the commit-msg hook only allows `feat` / `fix` / `refactor` / `chore` / `docs`. Commit translation additions/backfills as `chore(<feature>): …` (or fold them into the feature's `feat` commit).
- **Adding a key twice with slightly different names** — always grep first.
- **Editing only `en.default.json` for schema labels** — schema labels go in `en.default.schema.json`.
- **Hardcoding English text in schema** — always use `t:*` keys; Shopify uses locale files for all languages.
- **Forgetting `en.default.schema.json` when the AI proposes a schema** — check the full schema output for any new `t:*` keys.

## Checklist

- [ ] All new `"name"`, `"label"`, `"content"`, `"options[].label"` use `t:*` keys
- [ ] New keys added to `locales/en.default.schema.json`
- [ ] Liquid-rendered new text also added to `locales/en.default.json`
- [ ] No duplicate keys (grep before adding)
- [ ] `yarn check-missing-translate` passes with no errors
