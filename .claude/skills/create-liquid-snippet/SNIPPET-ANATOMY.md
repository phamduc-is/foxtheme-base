# Snippet Build Playbook (FoxTheme)

The canonical reference for creating a new `snippets/<name>.liquid`. Follow it top-to-bottom.

---

## 1. Two kinds of snippet — pick one first

| Kind | Emits | Filename | Examples |
|------|-------|----------|----------|
| **Presentation** | an HTML element (`<a>`, `<button>`, `<img>`, `<picture>`, `<div>`…) | **`-markup` suffix** → `button-markup.liquid` | `button-markup`, `product-card-markup` |
| **Utility / helper** | CSS-var text, a URL, a computed value — **no HTML element** | short clear name, **no suffix** | `spacing-style`, `border-style`, `gap-style`, `clamp-calculate-style` |

Rules:
- If your snippet outputs a tag a user sees → presentation → `-markup`.
- If it only emits `--foo: …;` declarations meant to drop inside a `style="…"` attribute, or returns a small computed string → utility → no suffix.
- **Exception (foundational reusables):** `responsive-image` emits an `<img>`/`<picture>` but predates the split and keeps its bare name. Don't invent new bare-named presentation snippets — use `-markup` for anything new.
- Theme blocks should **delegate** their HTML to a `-markup` snippet rather than inline it.

---

## 2. Param contract

**Every snippet opens with a `{% doc %}` block** documenting each param: name, type, `[optional]`, default, and what it does. Add at least one `@example` render call. Match the audited shape:

```liquid
{% doc %}
  Renders a single button as <a> or <button>.

  @param {string} style - REQUIRED. 'primary' | 'secondary' | 'outline' | 'link' | 'white' | 'plain'.
  @param {string} [label] - Button label text.
  @param {string} [icon] - Icon name; 'none' omits the icon. Default: 'none'.
  @param {boolean} [icon_only] - Icon without label. Default: false.

  @example
  {% render 'button-markup', style: 'primary', label: 'Add to cart' %}
{% enddoc %}
```

Then normalize defaults in a single `{% liquid %}` block right after the doc:

- **Scalars/strings:** `assign size = size | default: 'medium'`.
- **Boolean params MUST use `allow_false`:** `assign icon_only = icon_only | default: false, allow_false: true`. Without it, a caller passing `false` is silently overridden to the default — the most common snippet bug.
- **`with_wrapper`-style "default true" flags:** either `| default: true, allow_false: true` (spacing-style) or an explicit null-check `{% if with_wrapper == null %}assign with_wrapper = true{% endif %}` (responsive-image) when you need to distinguish "unset" from "explicit false".
- Keep the doc block and the code in sync — `{% doc %}` drift is real and was expensive here (params documented under the wrong name, undocumented params, wrong examples — all found and fixed in shipped snippets during audits). So when REUSING a snippet, **skim the liquid body, not just the doc**; and when WRITING one, document the *actual* behaviour, comma-separate every arg, and make every param name match what the body reads. If you catch a drifted doc, fix the snippet's `{% doc %}` right then — don't catalog the drift somewhere else.

---

## 3. Structural patterns

### A. Presentation `-markup` snippet — *guard → capture → emit*

Shape lifted from `button-markup`:

1. **Guard / early-out** — render nothing when there's nothing to show:
   ```liquid
   {%- unless label == blank and icon == 'none' -%}
   ```
2. **Normalize** — one `{% liquid %}` block: apply `default`/`allow_false`, pick the wrapper `element` (e.g. `'motion-component'` when animated + `settings.animations_enabled`, else `'div'`).
3. **Capture buffers** — build each piece into its own `{%- capture -%}`, finalize class strings with `| strip | strip_newlines`:
   - a `class` buffer: `btn btn--{{ style }} btn--{{ size }}` + conditional BEM modifiers;
   - a `wrap_attributes` buffer: wrapper class + `data-motion*` + `{{ block.shopify_attributes }}`;
   - a `button` buffer: the `<{{ tag }}>…</{{ tag }}>` itself (link/`role`/`aria-disabled` logic, raw `attributes`, `btn__text` span, the `icon` snippet, then `content_after`).
4. **Emit** — wrap or not:
   ```liquid
   {%- if with_wrapper or block != blank -%}
     <{{ element }} {{ wrap_attributes }}>{{ button }}</{{ element }}>
   {%- else -%}
     {{ button }}
   {%- endif -%}
   ```
   Passing a `block` forces the wrapper (to carry `shopify_attributes`) regardless of `with_wrapper`.
5. Close the guard (`{%- endunless -%}`).

CSS contract = BEM only: `btn` / `btn--*` / `btn__text` on the element, `button-block block` on the wrapper. No inline styles for static design.

### B. Utility / CSS-var emitter — *capture → strip → one inline line*

Shape lifted from `spacing-style`:

1. No HTML element, ever. Build declarations into one buffer and close with:
   ```liquid
   {{ variables | strip | strip_newlines }}
   ```
   so the output is a single inline-safe line for a `style="…"` attribute.
2. Index settings **dynamically** by computed key — don't hardcode every field:
   ```liquid
   {%- assign desktop_value_in_px = settings[setting_id] -%}
   {%- assign mobile_value = settings[setting_id | append: '-mobile'] -%}
   ```
   Drive combinations with split lists + nested loops (`properties = 'padding,margin'`, `directions = 'block,inline'`, `edges = ',start,end'`).
3. **Only emit a var when its source value is non-blank** — never spray empty declarations.
4. **Delegate the hard math** to an existing helper rather than reimplementing — `spacing-style` hands the `clamp()` work to `clamp-calculate-style`:
   ```liquid
   {%- render 'clamp-calculate-style', property_name: name,
       min_value: mobile_value_in_px, max_value: desktop_value_in_px,
       max_breakpoint: 1455, scale_min: scale_min -%}
   ```
   `clamp-calculate-style` takes **raw px numbers** (no units — it does the `/10`→rem math itself), `property_name` **without a leading `--`** (the snippet prepends `--` itself — passing `--x` would emit `----x`), and **every arg comma-separated** (a dropped comma silently malforms the whole declaration). Gate settings-driven calls with `!= blank` (a blank min/max yields a degenerate clamp). Override `max_breakpoint: 1455` to align with the 1440 design width.
5. Honor `use_*` toggles by `continue`-ing the loop / blanking the mobile value (e.g. `use_padding_inline: false` skips the inline padding entirely).

---

## 4. Reuse discipline — don't reimplement

Before writing HTML or math, reach for the existing primitive:

| Need | Use (canonical call) | Never / gotcha |
|------|----------------------|----------------|
| Responsive image (`<img>`/`<picture>`, srcset, ratio vars, placeholder) | `{% render 'responsive-image', mode: 'js', image: …, image_ratio: …, default_alt: shop.name %}` | hand-roll `<img srcset>` / `image_tag`. `mode:'liquid'` only for above-fold/known-width (needs explicit `sizes`; only mode honoring `preload`/`fetchpriority`). |
| A button | `{% render 'button-markup', style: …, label: …, … %}` | a bare `<a class="btn">`. `style` is REQUIRED (no default → broken `btn--`). Use `icon:'none'` to omit an icon. |
| Text / heading / richtext | `{% render 'text-markup', block: block %}` | a raw `<h2>{{ block.settings.text }}</h2>` — you'd lose preset/color/spacing/animation + click-to-edit. Pass `fallback_text:` for resource titles. |
| Icon | `{% render 'icon', icon: 'caret-right', size: 'large' %}` | inline `<svg>`. `icon:'none'` = empty-state guard. `width`/`width_mobile` are silently dropped. |
| Icon OR uploaded image (picker) | `{% render 'icon-or-image', icon: …, image_upload: …, icon_size: …, width: …, width_mobile: … %}` | branching icon-vs-image yourself. Self-guards; image wins; sizing only on `icon_size=='custom-size'`. |
| Product price / compare-at / sale badge | `{% render 'price', product_resource: product, use_variant: true %}` | hand-built price HTML or `\| money`. Param is `product_resource` (NOT `product`). Wrap in `<product-price>`. |
| Spacing CSS vars | `{% render 'spacing-style', settings: section.settings %}` | hand-written `--padding-*`. Element needs the `spacing-style` class. |
| Border CSS vars | `{% render 'border-style', settings: section.settings %}` | hand-written vars. Pass the settings OBJECT (never a scalar radius); element needs the `border-style` class. |
| Gap CSS vars | `{% render 'gap-style', settings: section.settings %}` | hand-written `gap:`. Element needs the `gap-style` class. Carousels: row-gap only (Swiper owns column). |
| Width/height CSS vars | `{% render 'size-style', settings: block.settings %}` | hand-written width/height. Element needs the `size-style` class. `height` reacts only to `'fill'`. |
| Grid columns / flex alignment vars | `{% render 'layout-panel-style', type: 'grid', settings: … %}` | hardcoding `--f-columns-*`/`--*-alignment`. ALWAYS pass `type:` ('grid'/'flex') — omitting silently uses grid. |
| Content-overlay flex alignment | `{% render 'content-overlay-style', position: …, position_mobile: … %}` | hardcoding align-items/justify-content. Element needs the `content-overlay-style` class; mobile vertical-only → `\| append: '-center'`. |
| Media tint overlay | `{% render 'overlay', overlay_color: … %}` | a hand-rolled `.overlay` div. Pass `overlay_color` (not `settings`); never self-gates — wrap in the parent's `toggle_overlay`. |
| Typography CSS vars | `{% render 'typography-style', settings: block.settings %}` | hand-written `--font-*`. Emits ONLY for `preset=='custom'`; named presets need the preset CLASS on the element. |
| `clamp()` responsive value | `{%- render 'clamp-calculate-style', property_name: …, min_value: …, max_value: … -%}` | manual `clamp()`/media queries. Raw px numbers, no units; comma-separate every arg. |
| Color scheme CSS vars (GLOBAL) | `{% render 'color-schemes' %}` — rendered **once in the layout `<head>`** only | hardcoded colors. Inside a section/block, do NOT render this — apply the `color-{{ section.settings.color_scheme }}` class instead |

**The CSS-var emitters are inert without their paired class.** Every `*-style` utility (`spacing-style`, `border-style`, `gap-style`, `size-style`, `content-overlay-style`) only *declares* `--vars`; the matching class in `_layout.scss` is what *consumes* them. The host element must carry **both** the `style="…{% render '…-style' … %}…"` output **and** the same-named class — emit the vars but forget the class (or vice-versa) and the effect silently drops with no error. `typography-style` is stricter: for named presets it emits nothing, so the element must also carry the preset class (`{{ preset }}` + `custom-typography`/`rte` helpers).

CLAUDE.md is explicit: **always use `responsive-image`, never reimplement.** A new presentation snippet should *delegate* (icon → `icon`, image → `responsive-image`, button → `button-markup`), not duplicate.

---

## 5. Calling conventions

- **`{% render %}` only** — never `{% include %}`. The snippet name is a **quoted string**: `{% render 'button-markup', style: 'primary' %}`.
- **Pass the settings object, not individual fields**, to utility emitters: `{% render 'spacing-style', settings: section.settings %}` (or `settings: block.settings`). The snippet indexes into it by key. **Pass `section.settings`/`block.settings`, never the global `settings`** — and never pass a *scalar* where an object is expected: `border-style`'s `settings:` must be a settings object, not a lone radius (`collection-card-markup.liquid:119` passes a scalar radius as `settings:`, so it reads border keys off a number and emits no border). To override one value, use the **named param** (`border_radius:`, `columns_md:`, `overlay_color:`), not `settings:`.
- **CSS-var emitters live inside a `style="…"` attribute**, standalone or concatenated with siblings — order matters, append after any inline vars:
  ```liquid
  style="{% render 'border-style', settings: section.settings %}{% render 'spacing-style', settings: section.settings %}"
  ```
- **Forward toggles by name** so sections opt out: `{% render 'spacing-style', settings: section.settings, use_padding_inline: use_padding_inline %}`.
- **Pass `block:` to a presentation snippet** when its output must carry `block.shopify_attributes` (Theme Editor selection). It forces the wrapper.
- **Pass raw attribute strings** via `attributes:` / `content_after:` rather than forking the snippet for one-off markup.

---

## 6. Before returning — validate

```bash
yarn check-liquid --files snippets/<name>.liquid
```

Fix and re-validate (max 3 retries). If the snippet introduced schema/`t:` text in a caller, also run `yarn check-missing-translate`. No build step is needed for `.liquid` files themselves, but rebuild any SCSS/JS the snippet's CSS contract relies on.