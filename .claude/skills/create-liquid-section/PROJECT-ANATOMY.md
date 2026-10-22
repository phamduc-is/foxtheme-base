# Section Build Playbook (FoxTheme)

Canonical reference for building a new `sections/*.liquid` so output matches gold-standard sections (`icon-boxes`, `testimonials`, `featured-collection`, `media-gallery`) with minimal review. Validate every build with `yarn check-liquid --files sections/<name>.liquid`.

---

## 0. Pick your section archetype first

| Archetype | Tell | Shape | Members |
|---|---|---|---|
| **Carousel / list** | fetches/accepts items, renders a grid OR carousel via a `type` knob; merchant-addable | §1–§8 below (the body of this doc) | `featured-collection`, `testimonials`, `blog-posts`, `media-gallery` |
| **Template-host** | renders one route's body or a fixed UI region; ONE instance, theme-placed, **no `presets`** | §9 | `main-collection`, `product-information`, `main-article`, `header`, `footer`, `breadcrumbs` |

§1–§8 document the **Carousel/list** archetype (the common case for new merchant sections). §9 documents the **Template-host** family (route bodies + chrome + SRA helpers) — the largest section group.

---

## 1. Root skeleton

Capture style strings ABOVE the root, then emit them inline. Two-level wrapper: a `section` root (spacing/border/color) and an inner `section__container section-grid` (columns/gaps).

```liquid
{%- liquid
  assign use_padding_inline = true
  if section.settings.container == 'fixed'
    assign use_padding_inline = false
  endif
-%}

{%- capture section_style -%}
  {% render 'border-style', settings: section.settings %}
  {% render 'spacing-style', settings: section.settings, use_padding_inline: use_padding_inline %}
{%- endcapture -%}

{%- capture container_style -%}
  {% render 'layout-panel-style', settings: section.settings, type: 'grid',
     columns_mobile: columns_mobile, columns_md: columns_md, columns_lg: columns_lg,
     columns_xl: columns_xl, columns_xxl: columns_xxl %}
  {% render 'gap-style', settings: section.settings %}
  {%- if swipe_custom_width_column -%} --swipe-column-width: {{ section.settings.swipe_column_width | divided_by: 100.0 }};{%- endif -%}
{%- endcapture -%}

<div
  id="section-{{ section.id }}"
  class="section my-section border-style spacing-style color-{{ section.settings.color_scheme }}"
  style="{{ section_style | strip_newlines | strip }}"
>
  <div
    class="section__container section-grid section-grid--{{ section.settings.container }}"
    style="{{ container_style | strip_newlines | strip }}"
  >
    {%- comment -%} grid / carousel branch here {%- endcomment -%}
  </div>
</div>
```

**Hard rules (all 4 sections agree):**
- Root id is always `id="section-{{ section.id }}"` (media-gallery omits it, but DO stamp it — it's the standard).
- Root classes: `section` + BEM root (`my-section`) + the `-style` utility classes that pair with each `-style` snippet you render (`spacing-style`, `border-style`) + `color-{{ section.settings.color_scheme }}` (direct interpolation, NOT the `color-schemes` snippet).
- Inner container: always `section__container section-grid section-grid--{{ container }}`.
- `disabled_on.groups: ["header", "footer", "custom.overlay"]` in schema.
- `use_padding_inline = false` when `container == 'fixed'` so inline padding only applies in full-width.
- Only wrap in a custom element (`<carousel-slider>` / `<flex-carousel>`) inside the carousel branch — the section shell is static SSR.

---

## 2. Schema settings — vocabulary + ORDER

Order: **Layout → Mobile layout → Appearance → Padding → Advanced**. Use canonical ids/labels/defaults below (drawn from `featured-collection` / `media-gallery`, the most complete).

```json
{ "type": "select", "id": "container", "label": "t:settings.container",
  "options": [{ "value": "full", "label": "t:options.full" }, { "value": "fixed", "label": "t:options.fixed" }],
  "default": "fixed" },
{ "type": "select", "id": "type", "label": "t:settings.type",
  "options": [{ "value": "grid", "label": "t:options.grid" }, { "value": "carousel", "label": "t:options.carousel" }],
  "default": "grid" },
{ "type": "range", "id": "columns_xxl", "label": "t:settings.desktop_columns", "min": 2, "max": 6, "step": 1, "default": 4 },
{ "type": "range", "id": "column_gap", "label": "t:settings.horizontal_gap", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 10 },
{ "type": "range", "id": "row_gap", "label": "t:settings.vertical_gap", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 10,
  "visible_if": "{{ section.settings.type == 'grid' }}" },

{ "type": "header", "content": "t:content.mobile_layout" },
{ "type": "checkbox", "id": "enable_swipe_on_mobile", "label": "t:settings.enable_swipe_on_mobile", "default": false },
{ "type": "checkbox", "id": "swipe_custom_width_column", "label": "t:settings.swipe_custom_width_column", "default": false,
  "visible_if": "{{ section.settings.enable_swipe_on_mobile }}" },
{ "type": "range", "id": "swipe_column_width", "label": "t:settings.custom_width", "min": 20, "max": 90, "step": 1, "unit": "%", "default": 76,
  "visible_if": "{{ section.settings.swipe_custom_width_column and section.settings.enable_swipe_on_mobile }}" },
{ "type": "select", "id": "columns_mobile", "label": "t:settings.mobile_columns",
  "options": [{ "value": "1", "label": "t:options.grid_1_column" }, { "value": "2", "label": "t:options.grid_2_column" }], "default": "2",
  "visible_if": "{{ section.settings.swipe_custom_width_column == false or section.settings.enable_swipe_on_mobile == false }}" },
{ "type": "range", "id": "column_gap_mobile", "label": "t:settings.horizontal_gap", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 8 },
{ "type": "range", "id": "row_gap_mobile", "label": "t:settings.vertical_gap", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 8,
  "visible_if": "{{ section.settings.enable_swipe_on_mobile == false }}" },

{ "type": "header", "content": "t:content.appearance" },
{ "type": "color_scheme", "id": "color_scheme", "label": "t:settings.color_scheme", "default": "scheme-1" },
{ "type": "select", "id": "border", "label": "t:settings.borders",
  "options": [{ "value": "none", "label": "t:options.none" }, { "value": "solid", "label": "t:options.solid" }], "default": "none" },
{ "type": "range", "id": "border_width", "label": "t:settings.border_width", "min": 0, "max": 10, "step": 0.5, "unit": "px", "default": 1,
  "visible_if": "{{ section.settings.border != 'none' }}" },
{ "type": "range", "id": "border_opacity", "label": "t:settings.border_opacity", "min": 0, "max": 100, "step": 1, "unit": "%", "default": 100,
  "visible_if": "{{ section.settings.border != 'none' }}" },
{ "type": "range", "id": "border_radius", "label": "t:settings.border_radius", "min": 0, "max": 32, "step": 1, "unit": "px", "default": 0 }
```

### Canonical device-padding block (verbatim — paste under `t:content.padding`)

Desktop block defaults `0/0` (layout sections; `media-gallery` uses `50/50`), mobile defaults `48/48`, all inline defaults `0` and gated on `container == 'full'`.

```json
{ "type": "header", "content": "t:content.padding" },
{ "type": "select", "id": "device", "label": "t:settings.devices",
  "options": [{ "value": "desktop", "label": "t:options.desktop" }, { "value": "mobile", "label": "t:options.mobile" }], "default": "desktop" },
{ "type": "range", "id": "padding-block-start", "label": "t:settings.top", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 0,
  "visible_if": "{{ section.settings.device == 'desktop' }}" },
{ "type": "range", "id": "padding-block-end", "label": "t:settings.bottom", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 0,
  "visible_if": "{{ section.settings.device == 'desktop' }}" },
{ "type": "range", "id": "padding-inline-start", "label": "t:settings.left", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 0,
  "visible_if": "{{ section.settings.device == 'desktop' and section.settings.container == 'full' }}" },
{ "type": "range", "id": "padding-inline-end", "label": "t:settings.right", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 0,
  "visible_if": "{{ section.settings.device == 'desktop' and section.settings.container == 'full' }}" },
{ "type": "range", "id": "padding-block-start-mobile", "label": "t:settings.top", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 48,
  "visible_if": "{{ section.settings.device == 'mobile' }}" },
{ "type": "range", "id": "padding-block-end-mobile", "label": "t:settings.bottom", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 48,
  "visible_if": "{{ section.settings.device == 'mobile' }}" },
{ "type": "range", "id": "padding-inline-start-mobile", "label": "t:settings.left", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 0,
  "visible_if": "{{ section.settings.device == 'mobile' and section.settings.container == 'full' }}" },
{ "type": "range", "id": "padding-inline-end-mobile", "label": "t:settings.right", "min": 0, "max": 100, "step": 1, "unit": "px", "default": 0,
  "visible_if": "{{ section.settings.device == 'mobile' and section.settings.container == 'full' }}" },

{ "type": "header", "content": "t:content.advanced" },
{ "type": "text", "id": "custom_columns", "label": "t:settings.custom_columns", "info": "t:info.custom_columns" }
```

`custom_columns` is a free-text per-breakpoint override (`"mb:1,md:2,lg:3,xl:4,xxl:5"`) parsed in Liquid and fed into `layout-panel-style`. Derive `columns_xl/lg/md` from `columns_xxl` via `at_most: 4 / 3 / 3` (`featured-collection`, `media-gallery`).

> Naming note: older sections (`icon-boxes`, `testimonials`) use `columns` + `t:settings.columns` and `t:settings.column_gap`. **Prefer the newer `columns_xxl` + `t:settings.desktop_columns` + `t:settings.horizontal_gap/vertical_gap`** vocabulary (`featured-collection`, `media-gallery`) for new sections.

---

## 3. Snippets to reuse (must-use, never reimplement)

| Snippet | Call | Purpose |
|---|---|---|
| `spacing-style` | `{% render 'spacing-style', settings: section.settings, use_padding_inline: use_padding_inline %}` + `spacing-style` class on root | padding CSS vars |
| `border-style` | `{% render 'border-style', settings: section.settings %}` + `border-style` class on root | border CSS vars |
| `layout-panel-style` | `{% render 'layout-panel-style', settings: ..., type: 'grid', columns_mobile/md/lg/xl/xxl: ... %}` on inner container | responsive grid column vars |
| `gap-style` | `{% render 'gap-style', settings: section.settings %}` + `gap-style` class on grid/`.swiper-wrapper` | column/row gap vars |
| `carousel-controls` | `{% render 'carousel-controls', ref: 'controls', navigation: 'group', class: 'hidden md:flex' %}` | carousel prev/next (carousel branch only) |
| `responsive-image` | per-item, inside the block | responsive images — NEVER hand-roll `<img>` |
| `icon-or-image` / `icon` | inside the block | icon/image picking |
| `button-markup` | inside the block | CTA buttons |

**Section level renders NO buttons, images, or icons.** Those live in the per-item block. The section only renders the four `-style` snippets + `carousel-controls`. Color scheme is the `color-{{ scheme }}` class, NOT the `color-schemes` snippet.

> **Scope:** this rule is for the **Carousel/list** archetype. **Template-host chrome** sections (§9) legitimately `{% render %}` presentation snippets (`header-logo`, `breadcrumbs`, `filters`, `pagination`) — but still NEVER inline raw HTML; they delegate to `-markup`/chrome snippets.

**Card vs Media-item (what the per-item block is):** a **Card** binds a resource object (product/collection/article) and shows price/metadata; a **Media-item** is purely settings-driven decorative media (`block.settings.image/.video`) + optional text. Both delegate media to `responsive-image`; only the Card uses `price`/`product-badges`. **The section computes the responsive `sizes` (`media_sizes`/`image_sizes`) from its columns and passes it down** — the card/media block consumes it; never hardcode `sizes` in the block.

---

## 4. Block model — pick ONE, never mix

A section uses **either** theme blocks **or** section blocks, never both.

**Theme blocks (preferred for new sections** — all 4 gold sections):
- Schema: `"blocks": [{ "type": "_my-item" }]` (a private `blocks/_my-item.liquid`), or `[{ "type": "@theme" }, { "type": "@app" }]` for open editor blocks.
- Render: loop explicitly and delegate —
  ```liquid
  {%- for block in section.blocks -%}
    <div class="f-column{% if type == 'carousel' %} swiper-slide{% endif %}">{%- render block -%}</div>
  {%- endfor -%}
  ```
  The block file emits its own `{{ block.shopify_attributes }}` — the section does NOT.
- A single uniform block type → `render block` directly (no `case`). Static header/sub-blocks are pulled in via `{% content_for 'block', type: '_section-header-vertical', id: 'section-header-vertical' %}` captured into a var.
- Use `{% content_for 'blocks' %}` when you want Shopify to place editor-added blocks itself (`featured-collection`).

**Section blocks (inline `{% schema %}` "blocks"):** render with `{% for block in section.blocks %}` + `case block.type`, and YOU emit `{{ block.shopify_attributes }}` on each wrapper.

---

## 5. SCSS skeleton

- Partial path: `src/scss/global/_section-<name>.scss` (true section scope) or `_component-<name>.scss` (reusable component, e.g. `_component-testimonial.scss`, `_component-media-gallery.scss`).
- Register: `@use "./section-<name>";` in `src/scss/global/_sections.scss` (section partials) — components go in `theme.scss`/`_blocks.scss`.
- Open with `@use "../mixins" as *;` (add `@use "sass:math";` only if needed).
- BEM root = your section root class (`.my-section`), elements `&__wrapper` / `&__inner` / `&__item`, modifiers `&--carousel`.
- Mobile-first: base = mobile, then `@include media-breakpoint-up(md)` / `up(xl)`; `media-breakpoint-down(md)` for the inverse.
- Colors via CSS vars only: `rgb(var(--color-border) / var(--color-border-alpha))`, `rgb(var(--color-foreground))`. No hardcoded colors.
- Layout (`section-grid`, `layout-panel-grid`, `gap-style`, `swipe-mobile`, swiper classes) is owned by shared global utilities — do NOT restyle them. Often a layout section needs NO own partial (`featured-collection` composes utilities entirely). Per-item visuals belong in the block's own partial.

---

## 6. JS — only when carousel

The section shell is static SSR. JS appears **only in the carousel branch**, via a declarative custom element + inline JSON config — no bespoke module:

```liquid
<carousel-slider data-section-id="{{ section.id }}">  {# or <flex-carousel> / <carousel-centered-slider> #}
  <script type="application/json" ref="config">{ "slidesPerView": ..., "spaceBetween": {{ section.settings.column_gap }}, "destroyBelow": 768, "breakpoints": { ... } }</script>
  <div class="swiper" ref="container"> ... <div class="swiper-wrapper"> ...slides... </div> </div>
  {% render 'carousel-controls', ref: 'controls', navigation: 'group', class: 'hidden md:flex' %}
</carousel-slider>
```

Pick the existing element: `<carousel-slider>` (`src/js/modules/carousel.js`, default), `<flex-carousel>` (`flex-carousel.js`), `<carousel-centered-slider>` (`carousel-centered-slider.js`, centered). Refs: `config`, `container`, `controls`. All extend the `Component` base. Write a NEW module ONLY for genuinely new interactive behavior — then use the `create-js-component` skill (refs/ThemeEvents/AbortController contract). Grid mode = zero JS. `data-section-id` goes on the carousel element itself, not on an ancestor: `CarouselComponent` reads it off its own element to register the theme editor's `shopify:block:select` handler and bails silently without it, leaving block selection dead with no error. This only becomes a trap once your own custom element wraps the carousel — a section whose root IS a `CarouselComponent` subclass (`slideshow-component`) has them on one element and cannot tell the difference.

**Template-host exception (§9):** a behavioural host section may itself BE a custom element (`results-list`, `cart-items-component`) or `is="sticky-header"`, loading a per-template module via `<script type="module" fetchpriority="low">`. Section Rendering API (morph) re-render targets need **stable ids** (`id="{{ section.id }}-{{ product.id }}"`) + refs — never class-name-only hooks. See the `section-rendering-api` skill.

---

## 7. i18n discipline

- **Reuse existing shared keys first** — all 4 sections introduce zero bespoke setting keys. Reuse `t:settings.*`, `t:options.*`, `t:content.*`, `t:names.*`, `t:categories.*`. Only genuinely new info text (e.g. `t:info.custom_columns`) is a new key.
- Two files only: `locales/en.default.schema.json` (editor: names, labels, options, headers, info) and `locales/en.default.json` (storefront `{{ 'x' | t }}` text). Preset block content strings (demo copy) are literal — that's the convention.
- After adding keys, run `yarn check-missing-translate`. Use the `update-locales` skill while building.

---

## 8. RESOLVED DECISIONS (the recurring ambiguities — one canonical answer each)

**Button style/size → the section renders NO button.** None of `icon-boxes`, `testimonials`, `featured-collection`, `media-gallery` render a CTA at section level. Buttons live in the block via `button-markup`; the canonical block contract (from `_icon-box-quick-view` presets) is `button_style: 'primary'`, `button_size: 'medium'`, `button_icon: 'none'`, `button_icon_only: false`, `button_width: 'fit-content'`, `button_width_mobile: 'fit-content'`. The only section-level interactive control is `carousel-controls` in the carousel branch. → Do NOT add a button setting to the section.

**Full-width vs contained → a `container` select (`full` | `fixed`, default `fixed`), never a width enum.** It (1) sets class `section-grid--{{ container }}` on the inner container, and (2) computes `use_padding_inline = true`, forced `false` when `container == 'fixed'`, passed to `spacing-style` so inline padding applies only in full-width. Inline-padding settings are `visible_if container == 'full'`. (`testimonials`, `featured-collection`, `media-gallery`.) `icon-boxes` hardcodes `section-grid--fixed` only because it is always contained — still use the `container` select for new sections.

**Default padding values → device-split block: desktop `0/0`, mobile `48/48`, all inline `0`.** The canonical layout-section default is desktop top/bottom = `0` (`testimonials`, `featured-collection`), mobile = `48`; inline left/right = `0` and only shown for `container == 'full'`. `media-gallery` uses `50/50` desktop and `icon-boxes` uses `100/100` desktop — those are content-density choices; **presets** then override desktop to `50/50`. Default the raw settings to `0/0` desktop, `48/48` mobile, and set richer values in the preset.

**Icon vs image → neither at the section level.** No `image_picker`, no `icon` select on the section. All media is delegated to the per-item block (`_gallery-item` picks `image|video` and uses `responsive-image`/`video-markup`; `_icon-box` picks `icon` + custom px size). The section is a pure layout/loop container and at most passes a computed `media_sizes` string down (`featured-collection` → `_product-card`). → Keep image/icon pickers in the block, always via `responsive-image`/`icon-or-image`, never a hand-rolled `<img>`.

---

## 9. Template-host sections (route bodies + chrome + SRA helpers)

Distinct from Carousel/list: **one instance per route/region, theme-placed, NO `presets`.** Route bodies pin with `enabled_on.templates`; chrome self-excludes with `disabled_on.groups: ["header", "footer", "custom.overlay"]`. Naming: `main-<route>` for route bodies, the bare region name for chrome (`header`, `footer`, `top-bar`).

**Pick ONE hosting mode** (mirrors the never-mix-block-types rule):
1. **Theme-block host** — root → width container → `{% content_for 'blocks' %}`. Schema `blocks: [{ "@theme" }, { "@app" }, …route blocks]`. (`main-page`, `custom-section` — the latter is what the footer group instantiates for its top region.)
2. **Per-route ordered host** — explicit ordered `{% content_for 'block', type: '_x', id: 'x' %}` passing `closest.<resource>`; the section owns the visual order/layout. (`product-information`, `main-article`, `main-cart`.)
3. **Snippet-composition chrome** — no blocks; every region is `{% render '<region>(-markup)' %}`; inline NO presentation HTML. (`header`, `footer`, `breadcrumbs`, `top-bar`.)

**Root contract:** `section <name> spacing-style[ border-style] color-{{ section.settings.color_scheme }}`; `style` = captured `spacing-style` + `border-style` (+`gap-style`) piped `| strip_newlines | strip`; width = `page-width` (fixed) or `section-grid section-grid--{{ container }}`; `use_padding_inline = container == 'full'`. Settings order Layout → route-specific → Appearance → Padding (§2 device block).

**Behavioural hosts** add a custom-element root (`results-list`, `cart-items-component`) or `is="sticky-header"`, with `data-section-id`/`ref=`, plus a top-of-file per-template `template-<route>.css` via `stylesheet_tag` and `<script type="module" fetchpriority="low">`.

**SRA / utility sub-shape** (`variant-data`, `section-rendering-product-card`): emit JSON or a bare custom-element fragment, resolve the resource from `closest.*` or a URL param, `disabled_on` header/footer, and **skip the root contract** (no padding/color settings).

**Anti-patterns:** giving a route host `presets`; mixing `content_for 'blocks'` with `for block in section.blocks`; inlining presentation HTML in chrome instead of `-markup`/chrome snippets; class-selector hooks from host JS into block internals (use stable ids/refs for SRA morph targets).