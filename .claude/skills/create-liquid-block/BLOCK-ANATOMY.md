# Block Build Playbook — FoxTheme

The canonical reference for building a new theme block. The detailed body (§1–§8) is mirrored from the **Media-item / Icon-box** families (`_icon-box`, `_gallery-item`, `_slide`); pick your archetype in §0 first, then apply the body + the archetype-specific rules in §9.

---

## 0. Pick your block archetype first

Identify which of the archetypes you're building — each has a distinct canonical shape. §3 (snippets) and §5–§7 apply to all.

| Archetype | Tell | Canonical shape | Members |
|---|---|---|---|
| **Card** | previews a resource (product/collection/article) | thin shell → `<entity>-card-markup`, `"tag": null`; **public** = resource picker + `presets`, **internal `_`** = `closest.*` + no presets | `collection-card`, `product-card`, `_article-card` |
| **Media item / Slide** | settings-driven image/video cell, no resource | parent-dictated root class; 3-layer grid-overlap stack; positional loading; content in a companion block | `_gallery-item`, `_slide`, `image`, `video` |
| **Icon-box / Feature** | icon-or-image + heading/text | thin block (capture slots) → `<name>-markup` | `icon-box`, `icon-list`, `counter` |
| **Text primitive** | atomic heading/body/button/divider/spacer | schema-only wrapper → ONE `text-markup`/`button-markup`; leaves inherit section scheme | `text`, `button`, `divider`, `_spacer` |
| **Disclosure** | accordion/tabs/collapsible | 3 files: parent captures children → `-markup` shell host + row; split-marker reassembly | `accordion`, `_accordion-row`, `_tab` |
| **Nav / Menu** | link_list → nav | flat `<ul>` OR mega-menu handle-resolve + dual desktop/mobile `<details>` trees + split markers | `_footer-menu`, `_mega-menu-sidebar` |
| **Commerce control** | resource-bound meta/control from `closest.*` | thin / `-markup` / self-contained; `data-*` + custom-element root | `_product-price`, `_buy-buttons`, `_variant-picker` |
| **Form / Input** | form/field | thin shell, unique `form_id`, `{% form %}` body, `.form-field` unit | `contact-form`, `newsletter` |
| **Layout container** | nestable wrapper arranging children | capture `content_for 'blocks'` → `-markup`; **two-layer** outer(spacing/border/size) + inner(layout-panel + gap) | `group`, `grid` |
| **Composite / orchestrator** | a feature with fixed parts AND a repeatable list, enhanced by its own custom element | public parent: capture **static** children (`content_for 'block'`) + **dynamic** list (`content_for 'blocks'`) → `-markup` shell wrapping a `<custom-element>`; preset seeds the static blocks + `block_order` | `product-finder` (heading + button static, fields dynamic) |

The §1–§8 body details Card-adjacent Media-item / Icon-box. Defining rules for the **resource / disclosure / nav / commerce / form / layout-container / composite** archetypes are in **§9**.

---

## 1. Block root skeleton

A theme block is a file in `blocks/`. **Type = filename.** Two visibilities — pick from the brief's *addability*:

- **Public** (no leading `_` — e.g. `collection-card`, `text`, `icon-box`, `accordion`): merchant-addable. It carries `presets` (shows in the editor block picker) and, for a resource block, its **own picker setting** (`collection`/`product`…). ~25 of the theme's blocks are public.
- **Private** (leading `_` — e.g. `_gallery-item`, `_slide`): **Shopify excludes `_` files from `@theme`**, so the block is unreachable except where a parent's schema `blocks` array names its type explicitly. That whitelist is the access control — the prefix already prevents it from being dropped anywhere else. Resolves data from `closest.<resource>` or positional render args. **`presets` is orthogonal to the prefix**: it cannot expose a private block (nothing generic can reach it), it only seeds defaults + a category for the parents that DO whitelist it. Add presets when a merchant inserts the block by hand inside its host (`_product-title`, `_product-price`, `_product-badges`, `_buy-buttons` — 100 of this theme's 155 private blocks); omit them when the host section places the block itself (`_cart-products`, `_account-header`).

So: merchant drops it in standalone → **public + presets (+ resource picker)**; the section generates it per-item in a loop → **internal `_` + `closest.*` + no presets**. The parent section renders blocks via `content_for 'blocks'` (dynamic list) or `{%- render block -%}` (per-block in a custom wrapper).

**Name internal wrappers by what they ARE, not by their host section.** A thin wrapper that just re-renders an existing snippet/block with some settings dropped or locked (e.g. wrapping `label` to fix `placement: content` and hide the placement select) is **reusable** → give it a generic name (a `_content-label`), not `_<section>-label`. Reserve the `_<section>-*` prefix for wrappers carrying genuine section-specific structure/logic (a `_hero-product-finder-panel` that wires one section's heading/button/fields capture). *(Both names are illustrative, not shipped core files.)* A section-scoped name on a generic wrapper blocks reuse and implies coupling that isn't there.

**`block.shopify_attributes` goes on the OUTER root element, as the last attribute before `>`.** It is required for Theme Editor selection. Place it once, on the canonical root.

**If you open the file with `assign settings = block.settings`, read every GLOBAL theme setting you need FIRST.** That assign shadows Liquid's global `settings` object for the rest of the file, so a later `settings.animations_enabled` / `settings.enable_quick_add` resolves to **nil**, not to the theme setting. The expression stays valid (nil is falsy), so the guard reads as active and silently never fires — no `yarn check-*` catches it, and only a merchant who turns that theme setting off sees the difference. A schema `visible_if` on the setting is **not** the guard either: it only hides the control in the editor. There is no `global.settings` to fall back on, so hoist the read:

```liquid
{% liquid
  # global theme settings FIRST — the next line shadows `settings`
  assign animations_on = settings.animations_enabled
  assign settings = block.settings
%}
```

`{% render %}` is immune: it opens an isolated scope carrying the real globals and inherits none of the caller's locals. A guard that lives inside a shared snippet therefore cannot be shadowed by its callers — prefer routing setting-driven markup through the snippet that owns the guard over restating the guard in each block.

Minimal inline root (copy-paste, see `_gallery-item`):

```liquid
{% liquid
  assign color_scheme = block.settings.color_scheme
  if block.settings.inherit_color_scheme
    assign color_scheme = ''
  endif
%}
<div
  class="my-block relative color-{{ color_scheme }}"
  {{ block.shopify_attributes }}
>
  {% comment %} inner BEM elements: my-block__media / my-block__content {% endcomment %}
</div>
```

Variants:
- **Color scheme on root** (`_icon-box`, `_slide`): emit `color-{{ scheme }}` class, or `data-color-scheme="color-{{ scheme }}"` when a parent JS carousel reads it. Blank the scheme when an `inherit_color_scheme` checkbox is on.
- **No scheme on root** (`_gallery-item`): the parent section's wrapper owns the color scheme — the block sets none.
- **Accent-coloured surface inside the block** (a badge/pill/chip/button on `rgb(var(--color-sale-price))`, `--color-notification-*`, or any color role): the text and icon sitting on it must be **derived, never a literal white**. Roles flip per scheme — `--color-sale-price` is `#ffffff` in `scheme-inverse`, giving white-on-white at 1.00:1 from shipped defaults, with the `currentColor` icon vanishing too. Emit an on-accent var (`color: rgb(var(--x-on-accent, 255 255 255))`) fed from the scheme's own `var(--color-background)` when the accent comes from the scheme, or from `settings.color | color_contrast: '#000000'` vs `'#ffffff'` when it comes from a merchant color setting — **not** `color_brightness` (see the ladder note in `design-to-brief`). White is safe only on a **literal dark** background (`rgb(0 0 0 / 40%)` overlays and the like), never on a role.
- **Carousel slide** (`_slide`): root carries the literal `swiper-slide` class + `ref="slides[]"` so the parent carousel custom element collects it into `this.refs.slides`. `loading`/`fetchpriority` are computed from `block_index` (via `section.blocks | find_index: 'id', block.id`) inside **`slide-image-markup`** — the snippet `_slide` delegates its image to — not in `_slide`'s own top `{% liquid %}`.
  - **Carousel gap must live on a NON-Swiper ancestor.** If the parent section puts `gap-style`'s inline vars directly on `.swiper-wrapper`, Swiper's `destroy(_, cleanStyles=true)` (fired on the `destroyBelow` breakpoint, e.g. an editor device-switch) runs `wrapperEl.removeAttribute('style')` and **wipes them** → the mobile gap collapses to 0 with no reload. Emit the gap vars on the wrapper's non-Swiper ancestor (mirror `media-gallery`: gap on the container, `.swiper-wrapper` keeps only the `.gap-style` class + reads the vars via cascade). Desktop still uses Swiper `spaceBetween`; the destroyed/mobile state reads the surviving cascade.

**Delegator variant** (`_icon-box`): the block file emits NO own root — it computes its vars then `{% render 'icon-box-markup', …, shopify_attributes: block.shopify_attributes %}`, and the snippet spreads the param on its root (`{{ shopify_attributes }}`). If the block makes multiple render calls (`_icon-box` has two), pass the attributes on the **first/canonical** call only.

---

## 2. Schema settings — vocabulary, grouping, canonical ids

Order settings by group, each group opened by a `header` whose content is a `t:content.*` key:

| Order | Group header | Holds |
|---|---|---|
| 1 | `t:content.layout` | `text_align`, `position`, `position_mobile` |
| 2 | `t:content.media` / `t:content.icon` | `type`, `image`, `image_mobile`, `video`, `icon`, `icon_image_upload`, `icon_size` |
| 3 | `t:content.content` | `link`, `heading`, `heading_preset`, `text` |
| 4 | `t:content.appearance` | `inherit_color_scheme`, `color_scheme`, `border_radius`, overlay toggles |
| 5 | (padding/spacing) | spacing ranges |

Canonical ids → labels → defaults (reuse these exact ones; do not mint new keys):

| id | type | t:label | default | notes |
|---|---|---|---|---|
| `text_align` | select | `t:settings.text_align` | `left` | options `t:options.left/center/right` |
| `heading` | text | `t:settings.heading` | English default string ok | |
| `heading_preset` | select | `t:settings.heading_preset` | `h6` | options `t:options.h3…h6`; appended as class on `<h_>` |
| `text` | richtext | `t:settings.text` | English default string, **`<p>`-wrapped** | render via `text-markup` |
| `type_preset` | select | `t:settings.preset` | `paragraph` | options `t:options.paragraph/subheading/h1…h6` |
| `image` | image_picker | `t:settings.image` | — | `visible_if type == 'image'` when paired with `type` |
| `image_mobile` | image_picker | `t:settings.image_mobile` | — | |
| `video` | video | `t:settings.video` | — | `visible_if type == 'video'` |
| `type` | select | `t:settings.type` | `image` | options `t:settings.image`/`t:settings.video` |
| `icon` | select | `t:settings.icon` | `tag` | ~48 curated `t:options.*` icon names |
| `icon_image_upload` | image_picker | `t:settings.image_icon` | — | overrides the SVG icon |
| `icon_size` | select | `t:settings.icon_size` | `extra-large` | `extra-small…extra-large`/`custom-size` |
| `icon_width` / `icon_width_mobile` | range | `t:settings.width`/`width_mobile` | 24 (12–200/2 px) | `visible_if icon_size == 'custom-size'` |
| `link` | url | `t:settings.link` | — | whole-card overlay link |
| `position` | select | `t:settings.position` | `middle-left` | 9 options `t:options.top_left…bottom_right` |
| `position_mobile` | select | `t:settings.position_mobile` | `middle` | `t:options.top/middle/bottom` |
| `inherit_color_scheme` | checkbox | `t:settings.inherit_color_scheme` | `true` | **inherit-by-default** (13 of 15 audited blocks); only emit `color-{{ scheme }}` when the merchant turns it off |
| `color_scheme` | color_scheme | `t:settings.color_scheme` | `scheme-1`/`scheme-2` | `visible_if inherit_color_scheme == false` |
| `border_radius` | range | `t:settings.border_radius` | 10–20 (0–32/1 px) | feeds `border-style` |
| `toggle_overlay` | checkbox | `t:settings.media_overlay` | `false` | |
| `overlay_color` | color, `alpha:true` | `t:settings.overlay_color` | `#00000033` | `visible_if toggle_overlay` |

Block `name` uses `t:names.<block>`. **Presets follow ADDABILITY, not the `_` prefix (§1):** any block a merchant inserts by hand gets a `presets` entry (same `t:names.<block>` name) — seed real preset defaults (label, link, `style:'primary'`, `icon:'caret-right'` for any nested CTA). That covers every **public** block and most **private** ones, since a private block is still merchant-addable inside a parent that whitelists its type. Omit `presets` only when the host section places the block itself. Don't add presets a host-rendered block doesn't need, and don't omit them from a merchant-addable one — and never omit them out of a belief that presets would "expose" a private block, which `@theme`'s exclusion of `_` files already prevents. **Every `richtext` value must be wrapped in a top-level block tag** (`<p>`, `<ul>`, `<ol>`, `<h1>`–`<h6>`) — the setting's own `default` **and** any richtext value seeded inside `presets`, including a nested child's settings. A bare string makes Shopify reject the **whole block file** on upload (`Invalid preset …: Setting 'x' is invalid. All top level nodes must be '<p>', '<ul>', '<ol>' or '<h1>'-'<h6>' tags.`), so the block renders nowhere and the storefront serves an upload-error page. **`theme-check` and the L1 static pass do NOT catch this — only a real push does.** Watch it especially when converting an existing setting from `text` → `richtext`: the setting's `default` gets fixed, the same key seeded in the parent's `presets` is the one that gets missed.

**`inline_richtext` is the mirror-image trap: its `default` must NOT be blank.** `{ "type": "inline_richtext", "id": "x", "default": "" }` → Shopify rejects the upload with `Invalid schema: setting with id="x" default can't be blank`. The `default` key is OPTIONAL for `inline_richtext`; if present it must be non-blank. **OMIT the `default` entirely** for "empty by default" (guard the render with `{% if x != blank %}`), or give a non-blank inline string — never a `<p>`-wrapped one (that's the `richtext` rule above; a `<p>` default on `inline_richtext` also fails, via a reverse cascade to richtext-value validation). Same class of trap: `theme-check`/L1 pass, only a real push rejects it. Watch it when converting `richtext` → `inline_richtext` — the `<p>`-wrapped default that was correct becomes invalid.

---

## 3. Snippets to reuse (never reimplement)

**`button-markup`** — the ONE way to render a CTA. Driven by `style`/`size`/`icon` settings passed by id:
```liquid
{% render 'button-markup',
  label: block.settings.label,
  link: block.settings.link,
  style: block.settings.style,   {% comment %} e.g. 'primary' {% endcomment %}
  size: block.settings.size,
  icon: block.settings.icon %}   {% comment %} e.g. 'caret-right' {% endcomment %}
```
**Spacing a button → margin or a wrapper, never `.spacing-style` padding on the `.btn`.** `.btn` already owns its `padding` (a shorthand driven by `--button-padding-block`/`size`), so a `.spacing-style` class on the same `<button>` emits `padding-block` that `.btn` overrides (same 0-1-0 specificity, `.btn` loads later) — the setting silently does nothing. For *space around* a button expose **margin** settings (`margin-block-*`, group header `t:content.margin`) — `.spacing-style` applies `margin-block` and `.btn` sets no margin, so it lands; for *internal* size use the `size` setting. (button-markup's `.button-block` wrapper is the other valid home for button spacing.)

**`responsive-image`** — the ONE way to render a content/media image. Never hand-roll `<img>`:
```liquid
{% render 'responsive-image', mode: 'js', image: block.settings.image, image_ratio: block.settings.image_ratio, default_alt: shop.name %}
```
**Mode is a branch, not a constant:** `mode: 'js'` = JS-coordinated lazy image (the default for below-fold / unknown-width). Use `mode: 'liquid'` for **above-fold / known-width** media (it emits SSR `srcset`/`sizes` and is the **only** mode honoring `preload`/`fetchpriority`) — but then pass an explicit `sizes` or it falls back to `100vw` and over-fetches; the section computes and passes `image_sizes`/`media_sizes` down. Always pass `image_ratio` and `default_alt` (a11y / Theme-Store).

**`icon-or-image`** — renders EITHER the SVG icon OR an uploaded icon image:
```liquid
{% render 'icon-or-image',
  icon: block.settings.icon,
  image_upload: block.settings.icon_image_upload,
  icon_size: block.settings.icon_size,
  width: block.settings.icon_width,
  width_mobile: block.settings.icon_width_mobile,
  class_name: '' %}
```
It delegates to `icon` (SVG branch) or a direct `image_tag` (image branch); custom size emits `--icon-custom-size` CSS vars (px ÷ 10 → rem).

**Other utility snippets:** `border-style` (`{% render 'border-style', settings: block.settings %}` or `border_radius: …` → emits `--border-*` vars inline in a `style` attr), `spacing-style`, `gap-style`, `size-style`, `color-schemes`, `icon`, `loading-spinner` (`size`, `class` — the spinner inside any `.btn--loading`), `overlay` (pass `overlay_color`, not `settings`; wrap in the parent's `toggle_overlay`), `content-overlay-style` (9-way position → `--h/--v-alignment` vars), `clamp-calculate-style` (`property_name`, `min_value`=mobile, `max_value`=desktop → one fluid `clamp()` `--{prop}` var + a `--{prop}-mobile` var; use this for any paired desktop+mobile numeric setting instead of hardcoding or two media-query rules).

**Archetype-defining snippets** (compose these, don't reimplement):

| Snippet | When | Archetype |
|---|---|---|
| `<entity>-card-markup` | the card delegate; `card_settings: block.settings` default-fills omitted params | Card |
| `price` (inside `<product-price>`) | never hand-format money; param is `product_resource` | Card / Commerce |
| `product-badges` (inside `<product-badge>`) | render BOTH placements, toggle via `--badges-d/-m` — no re-render | Card |
| `text-markup` (`block: block`) | every title/body/heading; gains preset + click-to-edit | Text / Icon-box / Commerce |
| `typography-style` | INSIDE `text-markup` only — never call from a block | Text |
| `video-markup` (`player_only: true`) | every video; never hand-roll `<video>` | Media-item |
| `accordion-markup` + `{% capture styles %}` | disclosure shell host | Disclosure |
| `layout-panel-style` (`type: 'flex'\|'grid'`) | the layout-container distinguishing knob (always pass `type`) | Layout container |

**Click-to-edit is load-bearing:** `text-markup`'s `{{ attributes }}` (and `{{ block.shopify_attributes }}`) must sit on the **immediate** text parent. Any intervening tag or `{% if %}` between the attributes and the text node **severs Theme-Editor click-to-edit** — never wrap or branch in between.

**Ambient-settings leak — when NOT to route through `text-markup`:** `text-markup` (and any snippet taking `settings: block.settings`) reads the block's settings *by id*. If the SAME block also defines non-text settings that collide with the text/typography ids — e.g. a `width` for an icon (read as the text width), or its own `padding-*` (applied a second time) — the shared markup picks up the wrong values (squished text, double padding). When a block mixes a heading with other controls, render the heading **directly** with `{% render 'typography-style', preset:…, font_family:…, font_size:…, line_height:… %}` passing **explicit** params (no `settings:`), so there is zero coupling. `product-finder`'s heading hit exactly this and was switched to a direct `typography-style` render.

---

## 4. Delegate vs inline

- **Fully delegate** to a `<name>-markup` snippet when the block is a thin wrapper around reusable presentation (`_icon-box` → `icon-box-markup`). The block file then contains zero inline HTML — only `{% liquid %}` computation + the render call(s). Pass `shopify_attributes: block.shopify_attributes` on the canonical call.
- **Inline** the root + BEM skeleton when the layout is specific to this block (`_gallery-item`, `_slide` own `__media`/`__content`/`__title` inline), but still **delegate the media variants** to snippets: image → `responsive-image`, video → `video-markup`, border → `border-style`, button → `button-markup`.
- **Nest child blocks** for composable content (`_slide` → static `_slide-content` via `content_for 'block', type: '_slide-content', id: …, parent_color_scheme: …` → `content_for 'blocks'` → `text`/`button`/`_spacer`). The outer block owns media; nested blocks own heading/text/CTA. Do NOT add button settings to a media block — let nested `button` blocks own `style`/`size`/`icon`.

Rule of thumb: presentation reused across blocks → `-markup` snippet; one-off skeleton → inline; composable text/CTA → nested blocks.

### 4.1 Children must be captured in BLOCK scope

`{% content_for 'block' %}` / `{% content_for 'blocks' %}` **cannot execute inside a snippet.** Icon-box composites, Layout containers, Disclosure parents and Forms therefore capture children into a string **in the block file**, then pass that string to the `-markup` snippet:

```liquid
{%- capture children -%}{% content_for 'blocks' %}{%- endcapture -%}
{% render '<name>-markup', children: children, settings: block.settings, shopify_attributes: block.shopify_attributes %}
```

Disclosure parents do it per-child: `{% capture rows %}{% for b in block.blocks %}{% render b %}{% endfor %}{% endcapture %}`.

#### Static vs dynamic children — render each by the RIGHT mechanism (verified: `counter`, `_slide`, `accordion`)

A parent block can host two kinds of children, and they live in different places — mixing them up renders nothing:

| Child kind | Declared by | In `block.blocks`? | Render with |
|---|---|---|---|
| **Static** (fixed slot: a heading, a submit button) | preset entry `"…": { "type": "_x", "static": true }` | **NO** | `{% capture x_html %}{% content_for 'block', type: '_x', id: 'x' %}{% endcapture %}` |
| **Dynamic, one slot** (merchant adds/reorders; in schema `blocks` allowlist) | schema `"blocks": [{ "type": "_x" }]` + preset `block_order` | **YES** | `{% content_for 'blocks' %}` (all, in order) — or `{% for b in block.blocks %}{% render b %}{% endfor %}` when the parent must **wrap** each child. Required, not optional, if the parent styles its cells: `content_for 'blocks'` leaves you styling `> *`, which is the child's own root (see §9, Layout container) |
| **Dynamic, fan-out** (each child feeds TWO+ slots in different DOM places — a tab's button AND its panel) | same as dynamic-one-slot | **YES** | split-marker hack: child emits its halves bracketed by a marker comment; parent captures `content_for 'blocks'` then `split:` + distributes |

`counter.liquid` is the canonical mixed example: static `_counter-number` → `{% content_for 'block' %}`, dynamic stat blocks → `{% content_for 'blocks' %}`, and `block.blocks.size` counts the dynamic ones only. **`{% render b %}` DOES render theme blocks** (`accordion` loops `block.blocks` per-row) — the only trap is that a **static** block is invisible to `block.blocks`, so reaching it that way yields empty output.

**A parent block can COUNT and RENDER its nested children, but CANNOT READ their settings.** Spike-verified: inside `{% for b in block.blocks %}`, each `b` is an opaque `@theme` handle — `b.settings.<id>` comes back **blank** (only `block.blocks.size` and `{% render b %}` work; rendering hands control to the child's own scope where its settings resolve). And a theme block "cannot be passed variables like when using a snippet", so `{% render b, x: 5 %}` can't inject either, and a child can't read the parent's settings or `visible_if` on them. **The only parent→child channel is CSS custom properties on a wrapper `<div>` the parent paints around the child** — which carries values but cannot change the child's DOM structure. Consequence: if a feature needs **real DOM elements whose COUNT varies per row** (e.g. N segmented cells that must each round — a CSS gradient can't round individual cells), that count MUST live **per-row** (a setting on the child block AND a field on the backing metaobject), NOT as one uniform parent setting — the self-rendering child can never learn the parent's value. Default the per-row count so it's uniform-by-default. Verify any "can the parent see X" assumption with a 3-line render spike; the docs are silent on this.

**Pick the mechanism by the problem, not by habit:**
- A **fixed singleton** part (one heading, one submit button) → **static block** + `content_for 'block'`. Don't hunt for it in `block.blocks` (it isn't there) and don't reach for the split-hack — distinct static slots are simpler. (product-finder's heading/button.)
- A **variable list into one container** → `content_for 'blocks'`. (product-finder's fields.)
- A **variable list where each child must appear in several layout regions at once** → the **split-marker hack** (mirror `sections/tabs.liquid` + `blocks/_tab.liquid`): the child wraps each half in a marker comment (`<!-- @tabs/split -->` … `<!-- @tabs/split -->`), the parent does `assign parts = blocks | strip | split: '<!-- @tabs/split -->'` then buckets the chunks (tabs uses `forloop.index0 | modulo: 2` → odd chunks to the tab bar, even to the panel area). `shopify_attributes` goes on **one** half only. This is the ONLY way to fan one dynamic child out to multiple slots — neither static blocks (children are merchant-added, variable count) nor plain `content_for 'blocks'` (single insertion point) can do it. Used by tabs, mega-menu, product-tabs, collection-list.

---

## 5. SCSS

- **Per-block partial:** `src/scss/global/_block-<name>.scss`, registered in `src/scss/global/_blocks.scss` via `@use "./block-<name>";`.
- **Shared component partial** (when the block is one item in a section component, e.g. `_gallery-item`, `_slide`): styles live in `src/scss/global/_component-<name>.scss` / `_section-<name>.scss`. `_component-*` partials are `@use`d directly in `src/scss/global/theme.scss` (one legacy exception sits in `_sections.scss`); `_section-*` partials register in `_sections.scss`.
- Header every partial with `@use "../mixins" as *;` (breakpoints: `media-breakpoint-up(md)` / `media-breakpoint-down(md)`).
- **BEM**, mobile-first, max specificity 0-1-0. Root `.my-block` + `&__media`/`&__content`/`&__icon`/`&__title` elements + `&--modifier`.
- **No hardcoded colors.** Use `rgb(var(--color-foreground))`, `rgb(var(--color-primary-button-background))`, etc. Color comes from the `color-{scheme}` / `data-color-scheme` wrapper.
- Dynamic values via CSS custom props emitted in the Liquid `style` attr / snippets: `--border-width/--border-color/--border-radius`, `--icon-spacing`, `--content-gap`, `--ratio`, `--icon-custom-size`.
- Gate hover behind `@media (hover: hover) and (pointer: fine)`. Animations via `--animation-duration--medium`, `--animation-easing`.
- **Custom-width overflow safety:** any block that can take a custom/small width (a merchant can drag it tiny) must defend against content overflow — root `overflow: hidden`; `min-width: 0` on flex containers/children that hold text (title/price/etc.); `flex-wrap: wrap` on horizontal rows (top bars, title-price rows).
- **Hover-zoom a media image, not its wrapper:** with `responsive-image`'s default `with_wrapper: true`, your `class` param lands on the wrapper `div.media` (the `<img>` gets `.media__image`), and `.media.loaded` sets a `transition` that overrides one on the wrapper — so put the transition + `:hover scale` on `.media__image`, and **scope** it (`.card__media .media__image`, not `.card:hover .media__image`) so a logo / other `responsive-image` in the same card doesn't also zoom. See `create-scss-module` for the full recipe.

---

## 6. JS — when (and when not) a block needs a custom element

**Default: NONE.** All three audited blocks are static SSR — pure Liquid + SCSS, no `src/js/modules` component. Interactivity is achieved by:
- a whole-card overlay link (`<a class="absolute inset-0">`) + CSS hover,
- emitting `class="swiper-slide" ref="slides[]"` so the **parent** section's carousel custom element controls the block,
- delegating to a snippet that ships its own deferred JS (`video-markup` toggle play/volume buttons),
- `<motion-component data-motion="…">` wrappers from the animation/motion system (gated behind `settings.animations_enabled`).

Only create a custom element (via `create-js-component`, extending `Component` from `@theme/component`) when the block itself needs stateful behavior not covered above. Then follow the DOM-access contract: `ref="name"` → `this.refs.name`, `data-*`, no class selectors; one `AbortController`; `ThemeEvents` constants from `@theme/events`.

---

## 7. i18n — reuse keys, mint none

Every `name`/`label`/`content`/`options[].label` uses a `t:*` key. **Reuse the shared catalog** — none of the audited blocks introduced a new key:
- name: `t:names.<block>` (e.g. `t:names.icon_box`, `t:names.gallery_item`, `t:names.image_slide`)
- preset category: `t:categories.basic`
- group headers: `t:content.layout/media/icon/content/appearance`
- labels: `t:settings.*` (table in §2)
- options: `t:options.*` (left/center/right, h3…h6, paragraph/subheading, the ~48 icon names, top_left…bottom_right, extra_small…custom)

**Reuse these exact keys before minting (builders keep re-inventing them):** `settings.image`, `settings.width`, `settings.width_mobile`, `settings.custom_width`, `settings.border_radius`, `settings.color`, `settings.color_scheme`, `settings.gradient_color`, `options.fit`, `options.fill`, `options.custom`, `options.gradient`, `placeholders.product_title`, `actions.add_to_cart`, `categories.product`. When you need "leave blank to inherit" copy for an optional color, reuse `t:info.leave_blank_to_use_default`.

Hardcoded **default values** for `heading`/`text` (English strings) are acceptable — those are values, not labels. After adding any new key, run `yarn check-missing-translate`. If you must add one, put editor labels in `locales/en.default.schema.json` and storefront text in `locales/en.default.json` (apply `update-locales`).

---

## 8. RESOLVED DECISIONS — the one canonical way

**CTA button → `button-markup` driven by `style`/`size`/`icon` settings.**
There is no bespoke CTA HTML and no per-block button-style picker beyond these three settings. A block that needs a styled CTA either nests a standard `button` theme block (the `_slide` way — `_slide` → `_slide-content` → `button` → `{% render 'button-markup', style, size, icon %}`, preset seeds `style:'primary'`, `icon:'caret-right'`) or calls `button-markup` directly. **Media-only blocks ship no button** — `_icon-box` uses a whole-card overlay link (`link` url setting → `<a class="absolute inset-0" aria-label="{{ heading | escape }}">` + `reversed-link` class) instead of a button; `_gallery-item` ships nothing. Decide: styled CTA → `button-markup` (`style`/`size`/`icon`); whole-card click → `link` overlay; none → omit.

**Content image → `image_picker` setting + `responsive-image`.**
Canonical: `image` (image_picker) → `{% render 'responsive-image', image: …, image_ratio: '1/1', default_alt: shop.name %}` (`_gallery-item`). Always pass `image` + `image_ratio` + `default_alt`; **`mode` is a branch** (`js` for below-fold/unknown-width — the default; `liquid` for above-fold/known-width with an explicit `sizes` — see §3), not a constant. Pair with a `type` select (`visible_if type == 'image'`) when the block also offers video. **Exceptions, not the rule:** an *icon-scale* image goes through `icon-or-image`'s direct `image_tag` (not responsive-image) because it's small (`_icon-box`); a slideshow hero that needs a hand-rolled `<picture>` + mobile `<source>` is the documented `_slide` exception — for any ordinary content image, use `responsive-image`.

**Icon → curated `icon` select enum (+ optional `icon_image_upload`) via `icon-or-image`.**
`icon` select (~48 named options, default `tag`) OR `icon_image_upload` image_picker → `{% render 'icon-or-image', icon, image_upload, icon_size, width, width_mobile %}`. The snippet branches: `icon != 'none' and image_upload == blank` → `{% render 'icon', icon, size: icon_size %}`; image present → `image_tag` branch. Size from the `icon_size` select; `custom-size` reveals `icon_width`/`icon_width_mobile` ranges (`visible_if`) and emits `--icon-custom-size`/`--icon-custom-size-mobile` (px ÷ 10 → rem). Mirror this exact `icon-or-image` + `icon_size` enum + custom-width-CSS-var trio (`_icon-box`). **Icon color** is an optional override: pass `icon_color` (a `color` setting, blank = inherit the ambient `currentColor`) through `icon-or-image` → `icon`; the SVG uses `currentColor` so the snippet just emits `color:` on the icon span. Reuse `t:settings.color` + `t:info.leave_blank_to_use_default`, no new key.

**Self-background → inherit scheme OR override (scheme | gradient).**
A block that paints its OWN background (not the section scheme — `_marquee` is the self-background example, though it uses a plain `color_scheme`) MAY expose a `background_type` select — `scheme` (default → uses `color_scheme`) / `gradient`; a `color_background` id `…_gradient` `visible_if background_type == 'gradient'`; markup emits `--x-bg: {{ settings.…_gradient | default: '<fallback>' }}` + a `--gradient` modifier class, SCSS applies `background: var(--x-bg)`. Gradient stops/angle are design constants — only the colors are merchant-editable. **Pattern spec only — no core block implements the gradient branch yet** (it came from a fork build); the shape mirrors the `text_color: custom` override / `text.liquid` convention, which IS in core.

---

## 9. Archetype-specific rules (beyond the Media-item / Icon-box body above)

### Card — resource-preview block
The block does ONLY: (1) resolve the resource — `block.settings.<resource>` (public) or `closest.<resource>` (internal); (2) optionally compute `image_sizes` from the section's columns; (3) `{% render '<entity>-card-markup', card_settings: block.settings, <resource>: …, shopify_attributes: block.shopify_attributes %}`. It emits **no** card HTML and is **`"tag": null`**. `card_settings` lets the markup default-fill omitted params. Schema order: Layout → Media → Content → Size → Appearance → Advanced. Always ship the **blank-resource onboarding fallback** (placeholder title, fixed count, `role="link" aria-disabled="true"`) so it renders an empty state in the editor.

**Reusing `quick-add` (multi-variant → the "Choose options" quick-view drawer) has two hard requirements.** (1) The card ROOT must be `<product-card class="…" data-product-id="{{ product.id }}">` and the title/overlay `<a href="{{ product.url }}">` must carry `ref="productCardLink"` — `quick-view.js` derives the fetch URL via `this.closest("product-card")?.getProductCardLink()` and **ignores** any `data-product-url`; a plain `<div>` root → `closest("product-card")` is null → the drawer fetches `?section_id=undefined` and shows the PLACEHOLDER product (empty quick-view). `ProductCard.connectedCallback` only adds two guarded variant listeners, so a minimal card (no swatches/gallery) is safe; `product-card.js`+`quick-view.js` load unconditionally. (2) The blank/onboarding state must render a STATIC disabled button, NOT `add-to-cart-button` — the latter is a JS-hydrated form component and prints the raw untranslated key ("ACTIONS.ADD_TO_CART") in the form-less placeholder; use `<button type="button" class="btn btn--primary w-full" disabled><span class="btn__text">{{ 'actions.add_to_cart' | t }}</span></button>`. Generalize: for ANY interactive control in the blank state, prefer a static, non-hydrated element.

### Text / Rich-text primitive
Liquid body ~1–10 lines: a tiny resolve + ONE `{% render '<x>-markup' %}`. Two call styles: **text family** → `{% render 'text-markup', block: block %}` (the snippet reads settings); **button/divider/label** → **explode** settings into named params (`label:`, `link:`, `style:`) — NEVER `settings: block.settings`. `"tag": null`. Leaves **inherit the section scheme** (no `color_scheme` picker) except self-background ones (`_marquee`). Presets re-skin the SAME block (Heading = `text` + `type_preset: h2`, not a new file). `typography-style` is called inside `text-markup`, never by the block. Don't "fix" known-misspelled ids (`marquee_postion`). **A `type_preset` with a `custom` option needs a SCSS consumer rule:** named presets (`h3`…) style themselves via the global `.h3` class, but `custom` only *emits* `--font-size`/`--font-family`/`--font-weight`/`--line-height` vars — they do nothing until a `&--custom` modifier consumes them (`font-size: var(--font-size)` …). Emit a `…--custom` class on the element when `type_preset == 'custom'` and add the matching rule, or the custom option silently no-ops (product-finder heading bug). **A `text_color` select with a `custom` option** is the color analogue: the value becomes the `color-{{ text_color }}` class, so `custom` needs the shared `.color-custom { color: var(--color-text-custom) }` helper (already in `_helpers.scss`) + a `color`-type `text_color_custom` setting (label reuses `t:options.custom`, no new locale key) whose value is emitted as `--color-text-custom`. Wiring by call style: blocks rendering via `text-markup` with `block: block` get it **free** (the snippet handles `custom`); blocks passing `text_color:` explicitly must ALSO pass `text_color_custom:` (`icon-box-markup`); own-markup blocks emit the var themselves (`_counter-number`, `_product-finder-heading`). Since `color_palette` landed (hybrid — `color_scheme_group` kept, a global `color_palette` added), a plain `color`/`color_background` setting auto-surfaces the palette swatches, so `custom` = pick-from-palette-or-hex with live cascade.

### Layout container — nestable wrapper
Block ~8 lines: `{% capture children %}{% content_for 'blocks' %}{% endcapture %}` → `{% render '<name>-markup', children: …, settings: block.settings, shopify_attributes: block.shopify_attributes %}`. **But if the container styles its children at all, wrap each one instead** (§4.2's per-child form): `{%- for child in block.blocks -%}<div class="<name>__cell">{% render child %}</div>{%- endfor -%}`. With `content_for 'blocks'` the only hook is `.inner > *`, and that selector **is the child block's own root** — an element you do not own. Anything you put there fights the child: `display` overrides its own layout mode (and with it whatever alignment control it ships), `justify-items` shrink-wraps *its* children, `padding`/`width` beat its `.spacing-style`/`.size-style` only by `@use` source order, and even `display: grid` alone resurrects a `<script>` the child emitted into a visible cell. A container that merely passes children through (no per-cell padding, border, sizing or alignment) can keep `content_for 'blocks'`; one that draws cells cannot. Verified in the theme editor with `@theme` children: Add block, reorder and click-to-select all still work, and a preset carrying children still populates `block.blocks`. **Two-layer structure is mandatory:** an OUTER box (`spacing-style border-style size-style` + color-scheme) and an INNER content div (`layout-panel-flex`|`layout-panel-grid` + `gap-style`); children go in the inner div only. flex-vs-grid is ONE knob (`layout-panel-style type: 'flex'|'grid'`). `"tag": null`, `blocks: [{ "@app" }, { "@theme" }]`. Inert wrapper — no hover/JS. **Padding visibility:** if the wrapper's padding only reads as a visible "panel" when it paints its own background (e.g. a transparent-by-default content overlay), gate the padding group on `inherit_color_scheme == false` (or the bg toggle) — padding with no background is invisible and just clutters the editor.

### Composite / orchestrator — public parent with static + dynamic children (mirror `product-finder`, `counter`)
A self-contained feature (a finder, a stat row, a stepped form) whose layout has **fixed parts** (a heading, a submit button) AND a **repeatable list** (the fields/stats), all enhanced by **one custom element of its own**. Build:
1. **Capture children in block scope by kind** (see §4.1): static parts → `{% capture heading_html %}{% content_for 'block', type: '_x-heading', id: 'x-heading' %}{% endcapture %}` (one per slot); the repeatable list → `{% capture fields_html %}{% content_for 'blocks' %}{% endcapture %}`. Static children are `_`-internal, NO presets of their own — the **parent** preset places them.
2. **Delegate to a `-markup` shell** that drops each captured string into its slot and wraps everything in the `<custom-element>` root (carry `block.shopify_attributes` on that root). The shell is presentation-only — it cannot run `content_for`, so all capturing stays in the block file.
3. **Preset seeds everything:** `"blocks": { "x-heading": { "type": "_x-heading", "static": true, "settings": {…} }, "x-button": { "type": "_x-button", "static": true, … }, "field_1": { "type": "_x-field", … }, … }` + `"block_order": ["field_1", "field_2", …]`. Static entries get `"static": true`; the dynamic list is ordered by `block_order`.
4. **The custom element owns behavior**, refs reach into the captured slots (`ref="submit"` on the button, `ref="fields[]"` on each select). If it fetches/re-renders, see `section-rendering-api` (the **data-endpoint section** pattern) — a finder cascades options from `collection.filters` via `getSectionHTML(id, false, collectionUrl)`. Pass settings the JS needs as `data-*` on the root (`data-collection-url`, `data-mobile-collapsible`), never class selectors.
5. **Reuse, don't re-mint:** the submit button composes the `.btn` classes like `button-markup` and carries `loading-spinner` so the JS can toggle `btn--loading`; responsive paired padding (desktop+mobile) uses `clamp-calculate-style`. Generic setting `default`s ("Find your product" / "Select option"); brand demo values live in the preset.

### Resource data resolution (Card / Commerce-control)
Resolve from `closest.<product|collection|article|page|cart>` (commerce) or `block.settings.<resource>` / `closest.<resource>` (card public/internal) — **never as a render param**. Add the editor fallback: `if request.visual_preview_mode and product == blank → collections.all.products.first`.

**A metaobject `rich_text` field renders as raw AST/JSON unless piped through `metafield_tag`.** Reading a metaobject's rich-text field via `{{ scale.body.value }}` **or** the bare drop `{{ scale.body }}` both print the parsed structure (`{"type":"root","children":[…]}`) to the storefront — dropping `.value` is NOT the fix. Render it with **`{{ scale.body | metafield_tag }}`** (wraps the HTML in `<div class="metafield-rich_text_field">`; docs/community-confirmed for metaobject fields). Apply the filter at the render pass-site (`{% assign body_html = scale.body | metafield_tag %}` then pass `body_html`) — a bare rich-text drop passed through `{% render %}` stringifies to AST. Scalar metaobject fields (`single_line_text`, `number_integer`) keep `.value`; only rich text needs `metafield_tag`. Invisible until you render REAL metaobject rich-text data — a richtext SETTING is already HTML, so the authored/nested path looks fine while the metafield path shows JSON.

### Disclosure / Nav / Form / Commerce-control (condensed — copy the named mirror)
Lower-frequency, multi-file archetypes. Build by copying the mirror, observing these invariants:
- **Disclosure** (`accordion` + `_accordion-row`): three roles (parent captures children → `-markup` shell hosting `<accordion-component>` + row). Native `<details>`: `open_row_by_default` sets BOTH the `open` attr AND the `is-open` class. Padding on `.accordion__inner` (JS animates height), not `.accordion__content`. Indexed refs `item[]/summary[]/content[]` + `on:click` (no class selectors). Tabs / mega-menu use **split-marker comments** (`<!-- @tabs/split -->`, `<!-- @megaMenu/split -->`) bracketing both halves — `shopify_attributes` on one half only.
- **Nav** (`_footer-menu`, `_mega-menu-sidebar`): flat → `<ul class="list-unstyled">` + `reversed-link__text`; mega-menu → resolve one link by `menu_title | handle` against `section.settings.menu.links`, emit a desktop `<details>` tree AND a separate mobile tree.
- **Form** (`contact-form`, `newsletter`): unique `form_id` from `block.id`; `{% form '<type>' %}` body; field unit is `label[for=ID] + input[id=ID]` (ID suffixed with `section.id`); required → `aria-invalid` + `aria-describedby`. Input chrome lives once in `_component-form.scss`; the block does layout only; submit is `btn btn--primary` + `btn__text`.
- **Commerce-control** (`_product-price`, `_buy-buttons`): read `closest.product` (+ `request.visual_preview_mode` sample fallback); wrap JS-enhanced controls in their custom element (`<product-price>`, `<product-form-component>`); padding settings LAST.

---

**Build checklist:** root + `block.shopify_attributes` placed (§1) → settings grouped with `t:` keys (§2) → reuse `button-markup`/`responsive-image`/`icon-or-image` (§3) → delegate or inline correctly (§4) → SCSS partial registered, BEM, no hardcoded colors (§5) → no JS unless stateful (§6) → no new i18n keys, `yarn check-missing-translate` passes (§7) → `yarn check-liquid --files blocks/<name>.liquid` (or `_<name>` if internal) passes → `yarn map`.