---
name: create-liquid-section
description: Use when creating a NEW page section — a new file in sections/ with its own {% schema %} (settings, presets). For "create/add/build a new section". Not for editing an existing section (use review-and-refactor), theme blocks in blocks/ (use create-liquid-block), or removing one (use delete-section-block).
---

# Create Liquid Section

## When to use
- Creating a new file in `sections/`
- Building a new page component with schema settings

## Canonical reference — mirror real sections, don't drift

The authoritative project anatomy + resolved decisions live in **[`PROJECT-ANATOMY.md`](./PROJECT-ANATOMY.md)** (distilled from gold-standard sections `icon-boxes`, `testimonials`, `featured-collection`, `media-gallery`). **Read it and mirror those sections** before building. Non-negotiables (these are where naïve builds drift):

- **A section is a LAYOUT CONTAINER.** It renders the `-style` snippets and **delegates all item content to theme blocks** (`blocks/_<item>.liquid` + `content_for 'blocks'` / `render block`). The section itself renders **NO button, NO image, NO icon, NO heading text** — those live in the block. Even a "simple" section (hero/banner) is built this way: a `_<name>-content` block holds the content.
- **Width = `container` select** (`full`|`fixed`, default `fixed`) → class `section-grid--{{ container }}` + `use_padding_inline = false` when `fixed`. **Never** invent a `max-width`/`__inner`/width-enum.
- **Padding defaults**: desktop `0/0`, mobile `48/48`, inline `0` (inline only shown when `container == 'full'`). Put richer spacing in the **preset**, not the setting default.
- **Multi-item sections** use the grid/carousel `type` system: `container` · `type` (`grid`|`carousel`) · `columns_xxl` (+ derive xl/lg/md via `at_most`) · `column_gap`/`row_gap` · mobile-layout + swipe. The **carousel branch** = a declarative custom element (`<carousel-slider>` / `<flex-carousel>`) + inline JSON config + `carousel-controls`; the **grid branch** = zero JS. See PROJECT-ANATOMY §2 + §6 for the exact settings + markup.
- **Colors** = `color-{{ section.settings.color_scheme }}` class (NOT the `color-schemes` snippet). **Reuse existing `t:` keys first** (all 4 gold sections add zero bespoke setting keys). Never hand-roll `<img>` — always `responsive-image`. Never hand-roll a **horizontally scrolling row** either — a tab bar or filter row gets `.edge__shadows` + `<div is="swipe-component">` (`.swipe__element` > `.swipe__inner`), which supply the edge fade and scroll-the-active-item-into-view that a bare `overflow-x: auto` does not. A row whose buttons already carry `aria-selected` gets the auto-scroll with no extra wiring. That rule generalizes: **before writing ANY new behaviour CSS/JS** (tabs, accordion, dialog, countdown, sticky, marquee…), check **PROJECT-MAP.md §0 (Capability index)** — grep it by behaviour keywords; if a component serves the behaviour, use its listed markup contract.

## Workflow

### Step 1: Create the file
`sections/{section-name}.liquid` — kebab-case filename.

### Step 2: Section structure — copy the skeleton from PROJECT-ANATOMY §1

The canonical skeleton (root with `id="section-{{ section.id }}"`, captured `-style` snippets piped `| strip | strip_newlines`, the two-level `section__container section-grid section-grid--{{ container }}` shell, `content_for 'blocks'`, and the schema shell with `disabled_on` + `@theme`/`@app` + `t:` keys) lives in **PROJECT-ANATOMY §1**. Copy it from there and rename — don't re-derive it; every part of that shell is a resolved decision.

### Step 3: Choose block type — section blocks OR theme blocks (never mix)

**Theme blocks** (files in `blocks/`, reusable, nestable):
- Section schema: `"blocks": [{ "type": "@theme" }, { "type": "@app" }]`
- Render in section: `{% content_for 'blocks' %}`
- Static block: `{% content_for 'block', type: '_block-name', id: 'unique-id', extra_param: value %}`

**Section blocks** (defined in section schema, single-level, not reusable):
- Add each block to schema `blocks` array with `type`, `name`, `settings`
- Render with `{% for block in section.blocks %}` + `{% case block.type %}`
- Inline markup or `{% render 'snippet-name', block: block %}` (name must be quoted string)
- No file in `blocks/` needed

### Step 4: Schema settings

**Settings order: Layout → Content → Appearance → Padding**

The container select + the full device-switched padding block (desktop `0/0`, mobile `48/48`, per-device `visible_if`, `inline_start`/`inline_end` gated on `container == 'full'`) is canonical in **PROJECT-ANATOMY §2** — copy it verbatim, don't retype it (a retyped range block is exactly how min/max/step drift in).

**Conditional settings** — always use `visible_if`:
```json
{ "visible_if": "{{ section.settings.some_setting == true }}" }
```

**Mixing `and`/`or` in one `visible_if` — Liquid groups RIGHT-TO-LEFT, and parentheses are invalid.** `A and B or C` means `A and (B or C)`, never `(A and B) or C` ([operators](https://shopify.dev/docs/api/liquid/basics)). Never add parentheses "for clarity" — they are invalid characters and `theme-check` rejects the expression outright.

Ordering is how you choose the grouping, and **both** groupings are reachable:

- `A and B or C` → `A and (B or C)` — shared condition first, alternatives last.
- `C or A and B` → `C or (A and B)`, i.e. `(A and B) or C` — put the standalone `or` operand first.

So you never need to split one setting into two just to express a grouping.

**`visible_if` hides a setting, it does NOT reset it.** A setting the merchant can no longer see keeps whatever value it last had, and Liquid still reads that value. So a branch must gate on the *real* condition, never on a setting that is itself `visible_if`-gated by that condition — the hidden setting is a stale proxy that stays true forever. The shape to avoid:

```json
{ "id": "controls_position", "visible_if": "{{ section.settings.type == 'carousel' }}", "default": "header" }
```
```liquid
{%- if controls_position == 'header' -%}  {%- comment -%} still true on `type == 'grid'` {%- endcomment -%}
```

Gate on both — `{%- if controls_position == 'header' and type == 'carousel' -%}` — or derive the flag from the real condition. Fold the extra term into the `{% if %}` rather than into the `assign` that computes the flag, when that flag is read by more than one branch: redefining it reaches branches the bug never touched.

**Before reaching for either, check the disjunction isn't dead weight.** If `Y or Z` covers every option of the same select, it is always true and the whole expression is just `X`. A gate like `enable_swipe_on_mobile == false and type == 'carousel' or type == 'grid'`, where `type` has exactly those two options, means nothing more than `enable_swipe_on_mobile == false` — write that. A single operand is shorter, unambiguous, and needs no rule to read.

Nothing lints any of this — `check-visible-if` skips every expression containing `or` on purpose — so when a mixed expression really is necessary, a comment above the setting is the only safety net.

**Common reusable keys** — check before adding new ones:
`t:settings.container`, `t:settings.color_scheme`, `t:settings.column_gap`, `t:settings.row_gap`,
`t:settings.desktop_columns`, `t:settings.mobile_columns`, `t:content.layout`, `t:content.appearance`,
`t:content.padding`, `t:options.full`, `t:options.fixed`, `t:options.desktop`, `t:options.mobile`

### Step 5: Presets

```json
"presets": [
  {
    "name": "t:names.section_name",
    "category": "t:categories.xxx",
    "settings": {
      "padding-block-start": 50,
      "padding-block-end": 50
    },
    "blocks": {
      "block-id": {
        "type": "block-type",
        "settings": {}
      }
    },
    "block_order": ["block-id"]
  }
]
```

Static blocks (always present, cannot be removed by merchant): add `"static": true`.

### Step 6: CSS

**Global (needed on every page):** Create `src/scss/global/_section-name.scss` → add `@use "./section-name";` to `src/scss/global/_sections.scss`.

**Lazy/page-specific:** Create `src/scss/global/section-name.scss` (no `_` prefix) → add `<link media="print" onload="this.media='all'" href="{{ 'section-name.css' | asset_url }}">` at top of the section file, OR add `stylesheet_tag` in `snippets/styles.liquid` if template-conditional.

File shape + BEM rules: apply the **create-scss-module** skill (it owns the partial template AND the emitted-var/consumer pairing rule — every `--var` a `*-style` snippet emits needs an SCSS rule reading it; see also SNIPPET-ANATOMY's "emitters are inert without their paired class").

### Step 7: Update locales
After writing schema, apply **update-locales** skill — add all new `t:*` keys to `locales/en.default.schema.json`. Run `yarn check-missing-translate`.

## Common snippets for sections

```liquid
{% render 'spacing-style', settings: section.settings %}
{% render 'border-style', settings: section.settings %}
{% render 'gap-style', settings: section.settings %}
{% render 'layout-panel-style', settings: section.settings, type: 'grid',
   columns_mobile: columns_mobile, columns_md: columns_md,
   columns_lg: columns_lg, columns_xl: columns_xl, columns_xxl: columns_xxl %}
{% render 'responsive-image', image: image, mode: 'js', image_ratio: 'adapt' %}   {# mode is a BRANCH: 'liquid' above-fold, 'js' below-fold — never a flat constant #}
```

## Full-bleed / overlay hero patterns

For a section with a full-bleed background image/video + overlaid content (hero-banner, main-collection-banner, slideshow), follow these — each was a real, costly bug:

- **Height = a min-height FLOOR, not a fixed `height`.** Offer `height` = `auto` (adapt to image) | `custom` (px range), independent desktop & mobile. Emit `--height` / `--height-mobile` and consume as `min-height: var(--height-mobile, 0)` (mobile) / `var(--height, 0)` (desktop) on the wrapper so the box auto-grows when content is taller than the floor.
- **Media must COVER the grown box** — use the shared mixins `full-bleed-media-cover` / `full-bleed-media-adapt($ratio)` (`src/scss/mixins/_media.scss`). Without them the global `.media { aspect-ratio: var(--ratio) }` inflates a full-width image once the box is indefinite. **Do NOT put a `height` on the grid ITEM** (the `&__media` wrapper) — let it stretch; setting a height breaks the stretch-to-floor (custom height then only renders as tall as the content).
- **Cover the BACKGROUND media only** — `img, video, .placeholder` (the mixin does this). Never a bare `svg` selector: it also catches the video poster-icon / control SVGs and distorts them.
- **`content_position: inside` must NOT zero the content padding.** `inside` only sets the width baseline (`grid-column: 2` = page-width column); the merchant's inline/block padding always applies on top, in both inside & outside. Zeroing it silently drops their value and flushes content to the edge on mobile (no gutter).

## Spacing / height / typography conventions

- **Any merchant dimension with a desktop & mobile value → emit via `clamp-calculate-style`** (or `spacing-style`), giving `--x` (clamp across the desktop range) + `--x-mobile` (fixed mobile) — never two raw `px` values switched at a media query. When one side can be "auto" (e.g. height), only clamp when BOTH sides are explicit; otherwise emit the single fixed var:
  ```liquid
  {%- if d == 'custom' and m == 'custom' -%}
    {%- render 'clamp-calculate-style', property_name: 'edge-padding-inline', min_value: m_val, max_value: d_val, max_breakpoint: 1455 -%}
  {%- elsif d == 'custom' -%}--x: {{ d_val }}px;{%- elsif m == 'custom' -%}--x-mobile: {{ m_val }}px;{%- endif -%}
  ```
- **Design-exact display heading → the `text` block's `type_preset: custom`** (there is no `mega-title` preset). Set `font` / `font_weight` / `font_size` / `font_size_mobile` / `line_height`; `typography-style` derives `font_type` from the size (>48px → display) and emits a responsive `clamp(mobile→desktop)` automatically, and `.custom-font-size > *` applies it to the inner `<h_>` (semantics preserved). Caveat: custom has no text-transform — uppercase must come from the text itself or a scoped `text-transform`.

## Checklist
- [ ] Read `PROJECT-ANATOMY.md` + mirrored the closest gold section
- [ ] **[Full-bleed hero]** height = min-height floor (auto/custom, per-device); media via `full-bleed-media-cover/adapt` mixins; no height on the `__media` grid item; `content_position: inside` keeps the padding
- [ ] **[Per-device dimension]** emitted via `clamp-calculate-style`/`spacing-style`, not raw px + media-query switch
- [ ] File created: `sections/{name}.liquid`
- [ ] `id="section-{{ section.id }}"` on root element
- [ ] Two-level shell: `section …` root + inner `section__container section-grid section-grid--{{ container }}`
- [ ] `spacing-style` and `border-style` snippets applied via `section_style`
- [ ] `color-{{ section.settings.color_scheme }}` class on root
- [ ] **[Carousel/list] Item content lives in theme blocks** — section renders no button/image/icon/heading itself (Template-host chrome may render `-markup`/chrome snippets — never inline HTML)
- [ ] Width via `container` select (`full`/`fixed`) — no custom max-width/`__inner`
- [ ] Padding defaults: desktop `0/0`, mobile `48/48` (richer values → preset, not setting default)
- [ ] Block type chosen: theme blocks (`content_for 'blocks'`) OR section blocks (for/case) — not both
- [ ] Schema: settings order Layout → Content → Appearance → Padding
- [ ] Schema: `disabled_on` configured
- [ ] Schema: `presets` defined (Carousel/list) — **Template-host has NO presets**
- [ ] All schema text uses `t:*` keys (no hardcoded strings)
- [ ] **Every setting reaches a consumer** — read in the Liquid, lands in a class/attr/CSS var, and any emitted `--var` has an SCSS rule reading it (dead setting / dead var = the #1 L1 blocker)
- [ ] Preset values are **runtime-valid** — every preset key exists in the schema; never a scheme NAME as a color VALUE (theme-check passes it; the storefront breaks)
- [ ] **Stress/empty-safe** — long heading wraps inside the container (no overflow at 375), empty resource renders the onboarding placeholder, max items lay out (L2 renders exactly these states)
- [ ] `yarn check-liquid --files sections/{name}.liquid` passes (MANDATORY — CLAUDE.md Liquid workflow)
- [ ] `yarn check-range-steps` passes if any `range` setting (Shopify's upload-time limits — theme-check is silent on them; see create-liquid-block "Range hard limits")
- [ ] CSS created and imported (or lazy-loaded)
- [ ] Locales updated → `yarn check-missing-translate` passes
- [ ] `yarn map` run after file creation
- [ ] **Archetype identified** (PROJECT-ANATOMY §0: Carousel/list vs Template-host)
- [ ] **[Carousel/list]** card loop captured ONCE → reused in grid + carousel branches; `else` placeholder loop present; Swiper `slidesPerView` breakpoints mirror `columns_md/lg/xl/xxl`; computes + passes `media_sizes`/`image_sizes` down
- [ ] **[Template-host]** ONE hosting mode (theme-block / per-route ordered / snippet-composition) — not mixed; route body pins `enabled_on.templates`, chrome self-excludes `disabled_on.groups`
- [ ] **[SRA helper]** resolve from `closest.*`/URL param; morph targets carry stable ids (`{{ section.id }}-{{ product.id }}`) + refs, never class-only hooks
