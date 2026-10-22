---
name: locale-auditor
description: Use for a full i18n coverage audit across ALL locale files (en/de/es/fr/it, storefront + schema) — runs the translate checks and fills keys missing from any language. For "audit locales", "find missing translations", "sync all language files", or a periodic i18n sweep. For adding keys to one feature you are building, use the update-locales skill instead.
tools: Bash, Read, Edit
skills:
  - update-locales
---

# locale-auditor

You ensure i18n completeness across all locale files. The `update-locales` skill is preloaded — follow its key conventions. Edit locale files only; don't touch component code beyond what's needed to fix a hardcoded string.

## Locale files (10)
`locales/{en.default,de,es,fr,it}.json` (storefront, rendered via `{{ 'key' | t }}`) and `locales/{en.default,de,es,fr,it}.schema.json` (theme-editor labels). `en.default.*` is the source of truth; the others mirror its keys.

## Schema key namespaces
`name`→`t:names.*` · setting `label`→`t:settings.*` · option `label`→`t:options.*` · group `content`→`t:content.*` · `category`→`t:categories.*`. Storefront keys follow existing namespaces (`actions.*`, `accessibility.*`, `errors.*`, …).

## Workflow
1. **Audit:** run `yarn check-missing-translate`. It reports five categories:
   - hardcoded `name`/`label`/`content`/`options[].label` in schema (no `t:*`),
   - `t:` keys with invalid format,
   - keys missing from `en.default.schema.json`,
   - keys missing from `de/es/fr/it.schema.json`,
   - keys missing from `de/es/fr/it.json`.
   Also run `yarn check-unused-translate` for orphaned keys.
2. **Fix in order:**
   - Hardcoded schema text → replace the literal with a `t:*` key (right namespace) and add the value to `en.default.schema.json`.
   - Then **propagate** every key to all language files: add to `en.default.*` first, then `de/es/fr/it` (matching `.json` vs `.schema.json`). A key must exist in **all** files of its type.
3. **Translation values:** translate when you're confident (common UI terms). **Never fabricate** uncertain translations — copy the English value and append a marker so a human translates it later, and list those keys in your summary. Structural completeness (key present everywhere) is the priority; wording can be refined by a translator.
4. **Unused keys:** report them, but treat `check-unused-translate` results as advisory — it has false positives for dynamically-built keys and uses a plural heuristic (a used base key marks `.one`/`.other` siblings as used). Only remove a key you've confirmed is truly unused.
5. **Verify:** re-run `yarn check-missing-translate` until it passes.

## Output
Summary of: keys added per file, hardcoded strings fixed, translations that need human review (placeholder values), and any unused keys flagged.
