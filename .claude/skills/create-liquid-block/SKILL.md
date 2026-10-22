---
name: create-liquid-block
description: Use when creating a NEW theme block — a new file in blocks/ (reusable, nestable, rendered via content_for 'blocks'). For "create/add a new block". Not for section blocks defined inline in a section's {% schema %}, and not for editing an existing block (use review-and-refactor).
---

# Create Liquid Block

## When to use
- Creating a new file in `blocks/`
- Building a reusable, nestable block component

## Two types of blocks

The leading `_` is not a naming convention — **Shopify treats it as a visibility flag.**

**Public block** (no `_` prefix, e.g. `blocks/text.liquid`):
- Covered by `{ "type": "@theme" }`, so every section/block accepting `@theme` can host it
- `presets` puts it in the theme editor's general block picker

**Private block** (`_` prefix, e.g. `blocks/_product-card.liquid`):
- **Excluded from `@theme`.** It can only be added where a parent's schema `blocks` array names its type explicitly — that whitelist IS the access control
- Type in schema = filename without `.liquid` (e.g. `"type": "_product-card"` is determined by the filename)
- **`presets` on a private block is safe, common, and usually REQUIRED** — safe because it cannot leak the block into the general picker (`@theme` never reaches an `_` file), and required because **without a preset the block has no "Add block" entry at all**, even inside a parent that whitelists its type. The whitelist grants permission; the preset is what creates the picker entry. A whitelisted block with no preset is placeable only programmatically, from a section's or parent's own preset — so a merchant who deletes a pre-placed one cannot get it back, and can never add another. In this theme **100 of 155 private blocks carry presets** (`_product-title`, `_product-price`, `_product-badges`, `_buy-buttons`…); the other 55 are blocks a section places itself, where nothing would ever add them by hand
- The decision is therefore **"can a merchant add this inside its host?"**, not "is the filename prefixed?"

*Verify the rule in any theme: grep for schemas listing `@theme`. Here 7 of them also list private types by hand, and NOT ONE lists a public type by hand — exactly the shape you get when `@theme` already covers public blocks and private ones must be named.*
## Canonical reference — match real blocks, don't drift

Deep reference: **[`BLOCK-ANATOMY.md`](./BLOCK-ANATOMY.md)** (distilled from `_icon-box`, `_gallery-item`, `_slide`). **The block is where a section's CTA / image / icon actually live** — mirror these patterns:

- **`{{ block.shopify_attributes }}` on the OUTER root**, as the last attribute (required for editor selection). If the block delegates to a `-markup` snippet, pass `shopify_attributes: block.shopify_attributes` and spread it there — on the first/canonical render call only (mirror `_icon-box` → `icon-box-markup`).
- **If a host section defers this block into a `<template>`** (lazy tab panels, deferred media, cloned slides), the root attribute is not enough: template content is inert, so the editor cannot see or select anything inside it. The section must ALSO emit `{{ block.shopify_attributes }}` on the wrapper it renders *outside* the template — grouped with the other template-only attributes (`hidden`, `data-lazy-loading`), since all of them apply to exactly that case. An eagerly-rendered first panel needs it only on the block root; the deferred ones need it only on the slot. Both look wrong in a diff and both are right.
- **CTA button** → render via the standard `button` block / `button-markup` — don't hardcode a button, expose the settings. Two id vocabularies exist: the standalone **`button` block** uses unprefixed ids (`style`, `size`, `icon`, `icon_only`, `icon_end`, `width`, `width_mobile` — BLOCK-ANATOMY §3's example); a block embedding its OWN CTA settings prefixes them (`button_style`, `button_size`, `button_icon`, `button_width`/`button_width_mobile` — mirror `_icon-box-quick-view`). Pick per your case, don't mix. (Width is wired in `button-markup` via `btn--full-desktop` / `btn--full-mobile`; the legacy `mobile_full_width` param was removed.)
- **Image** → `image_picker` (+ `image_mobile`) rendered via **`responsive-image`** (never hand-roll `<img>`). For image-OR-video, a `type` select gates `image`/`video` (see `_gallery-item`).
- **Icon** → an `icon` select (curated `t:options.*` enum) + optional `icon_image_upload` override via `icon-or-image`; size via `icon_size` select (+ `icon_width` when `custom-size`).
- **Color scheme** → `color-{{ scheme }}` class on root with an `inherit_color_scheme` checkbox (blank the scheme when inheriting), OR no scheme if the parent section owns it.
- **Carousel slide** → root carries literal `swiper-slide` + `ref="slides[]"` so the parent carousel custom element collects it.

## Workflow

### Step 1: Create the file
`blocks/{block-name}.liquid` — kebab-case. Type = filename without `.liquid`.

### Step 2: Block structure — copy the skeleton from BLOCK-ANATOMY §1

The canonical skeleton (`{% doc %}` header, captured `-style` snippets piped `| strip | strip_newlines`, root with `{{ block.shopify_attributes }}` as the last attribute, schema shell with `"tag": null` + `t:` keys, presets only when public per the §1 visibility rule) lives in **BLOCK-ANATOMY §1** — copy from there, or better, from the real block your archetype names in §0. `{{ block.shopify_attributes }}` on the root is required for theme editor drag-and-drop.

### Step 3: Schema settings

Same order as sections: **Layout → Content → Appearance → Padding** — group with `t:content.*` headers; the padding pair is the standard `padding-block-start`/`-end` range (`min 0, max 100, step 1, default 0` — blocks default 0 on BOTH devices, unlike sections' mobile 48). Copy the settings tree from the closest real block (BLOCK-ANATOMY §0 names one per archetype) rather than retyping it.

**`range` has hard limits Shopify enforces only at upload time** — `theme-check` stays silent, so a bad range passes every static check and then makes the store reject the whole file (the block renders nothing and its page 500s):

- `(max - min) / step` must be **≤ 101** steps. `"min": 0, "max": 999, "step": 1` is 999 steps → rejected. Want a pill radius? Use `"max": 100, "step": 1` (100 steps) — CSS clamps `border-radius` to half the box height anyway.
- `(max - min)` must be **evenly divisible** by `step`.
- `default` must sit inside `[min, max]`.

Run `yarn check-range-steps` — it enforces all three across `blocks/`, `sections/`, and `config/settings_schema.json`.

Conditional settings:
```json
{ "visible_if": "{{ block.settings.some_setting == true }}" }
```

`visible_if` only hides the control; the stored value survives. Never gate Liquid on a setting that is itself `visible_if`-gated by the condition you actually mean — see `create-liquid-section` → "**`visible_if` hides a setting, it does NOT reset it**".

### Step 4: Delegate to -markup snippet (for complex blocks)

When markup is complex or reused elsewhere, delegate to a `-markup` snippet:

```liquid
{%- render 'block-name-markup',
  block: block,
  param_a: block.settings.param_a,
  param_b: some_derived_value
-%}
```

Simple blocks (< ~30 lines of HTML) can inline markup directly.

### Step 5: CSS

Always create a dedicated SCSS file — do NOT put block CSS inside the section that uses it (block may be used in multiple sections).

`src/scss/global/_block-block-name.scss` → add `@use "./block-block-name";` to `src/scss/global/_blocks.scss`. File shape + BEM rules: apply the **create-scss-module** skill (it owns the partial template).

### Step 6: Update locales
Apply **update-locales** skill — add all `t:*` keys to `locales/en.default.schema.json`. Run `yarn check-missing-translate`.

## Common snippets for blocks

```liquid
{% render 'responsive-image', image: block.settings.image, mode: 'js', image_ratio: block.settings.image_ratio %}   {# mode is a BRANCH: 'liquid' above-fold, 'js' below-fold — never a flat constant #}
{% render 'spacing-style', settings: block.settings %}
{% render 'border-style', settings: block.settings %}
{% render 'icon-or-image', icon: block.settings.icon, image_upload: block.settings.icon_image %}
{% render 'text-markup', block: block %}
```

## Checklist
- [ ] File created: `blocks/{name}.liquid`
- [ ] `{% doc %}` at top with `@param` and `@example`
- [ ] `{{ block.shopify_attributes }}` on root element
- [ ] Schema: `"tag": null`
- [ ] Schema: settings order Layout → Content → Appearance → Padding
- [ ] Schema: all text uses `t:*` keys
- [ ] Schema: `presets` present whenever a merchant adds the block **by hand** — public blocks always, and private `_` blocks that a merchant inserts inside a whitelisting parent (the majority here). Omit `presets` only for a private block the host section places itself. A private block's presets can never leak it into the general picker: `@theme` excludes `_` files
- [ ] CSS: `_block-name.scss` created → imported in `_blocks.scss`
- [ ] **Every setting reaches a consumer** — read in the Liquid, lands in a class/attr/CSS var, and any emitted `--var` has an SCSS rule reading it (dead setting / dead var = the #1 L1 blocker)
- [ ] Preset values are **runtime-valid** — every preset key exists in the schema, and a scheme NAME is never used as a color VALUE (theme-check passes it; the storefront breaks)
- [ ] `yarn check-liquid --files blocks/{name}.liquid` passes (MANDATORY — CLAUDE.md Liquid workflow)
- [ ] `yarn check-range-steps` passes if the schema has any `range` setting (upload-time limits theme-check can't see — Step 3)
- [ ] Locales updated → `yarn check-missing-translate` passes
- [ ] `yarn map` run after file creation
- [ ] **Archetype identified** (BLOCK-ANATOMY §0) and its defining shape followed (§9)
- [ ] **Visibility matches addability** — merchant-addable → public name + `presets` (+ resource picker); host-rendered → internal `_` + `closest.*` + no presets
- [ ] **[Card/Commerce]** resource from `closest.*`/picker (not a render param); `request.visual_preview_mode` fallback; blank-resource onboarding (`aria-disabled` link). Card is `"tag": null`, emits no card HTML → single `<entity>-card-markup` render
- [ ] **[Icon-box/Layout/Form/Disclosure]** children captured in BLOCK scope (`{% capture … %}{% content_for … %}{% endcapture %}`) then passed to `-markup`
- [ ] **[Text]** schema-only; ONE `text-markup`/`button-markup`; button settings EXPLODED (not `settings:`); leaf inherits section scheme; `shopify_attributes`/`text-markup` attributes on the **immediate** text parent (click-to-edit)
- [ ] **[Layout container]** two-layer outer(`spacing/border/size-style`) + inner(`layout-panel-flex|grid` + `gap-style`); every `*-style` emitter paired with its consuming class
- [ ] `inherit_color_scheme` defaults **true**; `responsive-image` mode is liquid-vs-js (not flat `js`) + `default_alt`; no hardcoded colors
- [ ] Any **behaviour** the block ships (scroll row, tabs, accordion, dialog, countdown…) checked against PROJECT-MAP §0 (Capability index) first — reuse the listed component's markup contract, never hand-roll one that exists
