---
name: create-scss-module
description: Use when adding NEW styles for a section, block, or component — a new SCSS partial in src/scss/ (BEM, mobile-first, color-scheme CSS variables). For "add styles / new SCSS / style this section". Not for editing existing styles (use review-and-refactor).
---

# Create SCSS Module

## When to use
- Adding styles for a new section, block, or component
- Creating a lazy-loaded stylesheet for a specific template

## Decision tree — where does new CSS go?

| CSS needed on | File type | Location | Load via |
|---------------|-----------|----------|---------|
| Every page (global) | `_name.scss` partial | `src/scss/global/` | Imported in `theme.scss` (through `_blocks.scss`, `_sections.scss`, or directly) |
| Specific template / lazy | `name.scss` non-partial | `src/scss/global/` | `<link>` at top of section file OR `snippets/styles.liquid` |
| Module-specific (e.g. drawer) | `name.scss` | `src/scss/modules/` | `<link>` in section file that owns it |

**Blocks:** always `_block-name.scss` → import in `_blocks.scss` (blocks are reusable across sections).
**Sections (global):** `_section-name.scss` → import in `_sections.scss`.
**Components:** `_component-name.scss` → import directly in `theme.scss`.
**Section (lazy):** `section-name.scss` (no `_`) → `<link media="print" onload="this.media='all'">` at top of section file.

## Workflow

### Step 1: Create the file

```scss
@use "../mixins" as *;

// For _component-*.scss ONLY — a @capability header at the very top (extracted
// into PROJECT-MAP §0 by `yarn map`; section/block partials don't need one):
// @capability One sentence: what this component ships visually/behaviourally.
// @when When to reuse it; name the pairing JS module if any.
// @contract The class names / markup structure the styles expect.
// @keywords comma, separated, vocabulary a builder would grep for

// ─── Component / Block / Section Name ─────────────────────────────────────────

.component-name {
  &__element {
  }

  &--modifier {
  }
}
```

### Step 2: Breakpoint mixins

```scss
@use "../mixins" as *;

.component-name {
  // Mobile styles (default)
  padding: 1rem;

  @include media-breakpoint-up(md) {
    // 768px+
    padding: 2rem;
  }

  @include media-breakpoint-down(md) {
    // 767px and below (max-width based)
  }

  @include media-breakpoint-between(md, lg) {
    // 768px–1023px
  }
}
```

Breakpoints: `sm: 640px` · `md: 768px` · `lg: 1024px` · `xl: 1200px` · `xxl: 1440px`

### Step 3: BEM naming

```scss
.product-card { }               // Block
.product-card__title { }        // Element
.product-card--featured { }     // Block modifier
.product-card__title--large { } // Element modifier
```

Max specificity: **0-1-0** (single class). Avoid nesting beyond 1 level except for media queries and pseudo-classes.

### Step 4: CSS variables

**Read from snippets** (set by Liquid):
```scss
.component {
  padding-block-start: var(--padding-block-start, 0);
  gap: var(--gap, 1rem);
  border-radius: var(--border-radius, 0);
}
```

**Component-level variables:**
```scss
.component {
  --component-size: 4rem;
  width: var(--component-size);
}
```

**Color variables** — always use theme color vars, never hardcode:
```scss
color: rgb(var(--color-foreground));
background: rgb(var(--color-background));
border-color: rgb(var(--color-foreground) / 20%);
```

**A `var()` fallback protects against *undefined*, not against *empty*.** `var(--x, <fallback>)` uses the fallback only when `--x` has no value at all. A declaration like `--x: ;` substitutes as empty, so `rgb(var(--x, var(--y)))` becomes `rgb()` — invalid at computed-value time. This is not hypothetical: the **theme editor injects colour-scheme variables live**, and a colour role the merchant has not set arrives empty. Code that is correct on the storefront can lose its borders and icons in the editor only.

IACVT is per-declaration and its fallbacks differ, which disguises the cause: `border` reverts to `none` and `background-color` to `transparent` — both vanish — while `color` merely **inherits** and stays visible. A control whose text still renders while its rule and its caret disappear is this bug, not a missing stylesheet.

**So never put a scheme-role var in a SHORTHAND.** IACVT discards the declaration it appears in, and a shorthand *is* one declaration — `border: 1px solid var(--x)` loses its `border-style` too, so the border does not merely lose its colour, it stops existing. Write `border-width` / `border-style` / `border-color` separately and only the colour is dropped, falling back to `currentcolor`. `snippets/border-style.liquid` already emits the three longhands for exactly this reason. `yarn check-shorthand-scheme-var` enforces it. This one shipped *after* the rule above was already written — measured live: with the role emptied, the longhand form held at `1px solid rgb(0,0,0)` while a shorthand control on the same page read `0px none`.

Write the longhands plainly — no suppression comment is needed. `declaration-block-no-redundant-longhand-properties` used to collapse them back on the next `--fix` run, silently, so the source could look right while the shipped CSS did not. That rule is now off in `.stylelintrc.json`: a stylistic preference does not get to overrule a correctness check, and settling it once in config beats a disable comment at every site.

Prefer one failure point with a visible failure mode: put the token on `color`, then draw rules, borders and masked icons with `currentcolor`. Everything then degrades together to the inherited foreground instead of disappearing. Reproduce in one line: `.color-scheme-1 { --color-button-link: ; }`.

**Scheme-aware SUBTLE surface (zebra stripe, hover tint, alt row) — use `--color-background-secondary`, not a fixed foreground alpha.** A hardcoded `rgb(var(--color-foreground) / 8%)` overlay reads fine on a light scheme but is nearly invisible on a **dark** scheme (8% white on black), and CSS here **cannot detect** whether a scheme is light or dark (the theme has no dark flag and doesn't use relative-color syntax). The theme's own subtle-surface token is `--color-background-secondary` (merchant-set per scheme; used across `_component-accordion`, `_component-product-card`, `_component-article-card`, `cart-modules`, `_helpers`) — ~`#F2F2F2` on light schemes, an appropriately-contrasting tint on dark, so it reads on both:
```scss
.table__row--stripe { background-color: rgb(var(--color-background-secondary)); }
```

**Emitted CSS vars need a consumer rule** — if Liquid (a snippet or a `style=""` attr) emits a custom prop, some class must actually *read* it, or it silently no-ops. The classic miss: a `type_preset` `custom` option emits `--font-size`/`--font-family`/`--font-weight`/`--line-height` via `typography-style`, but the named presets style via the global `.h3`… class — so `custom` does nothing until a `&--custom` modifier consumes the vars:
```scss
.block-name__heading--custom {
  font-family: var(--font-family);
  font-weight: var(--font-weight);
  font-size: var(--font-size);
  line-height: var(--line-height);
}
```
Rule of thumb: every `--var` an emitter produces is paired with a class that consumes it (a "dead" emitted var = a setting that does nothing).

### Step 5: Section dividers

Every SCSS file must have a section divider comment at the top of each logical group:
```scss
// ─── Block Name ───────────────────────────────────────────────────────────────

.block-name { }

// ─── Hover States ─────────────────────────────────────────────────────────────

@media (hover: hover) and (pointer: fine) {
  .block-name { }
}
```

### Step 6: Register the file

**Partial (global):**
```scss
// In _blocks.scss:
@use "./block-block-name";

// In _sections.scss:
@use "./section-section-name";

// In theme.scss (components):
@use "./component-component-name";
```

**Standalone (lazy):** No import needed — build system auto-discovers non-partial files. Add `<link>` reference in Liquid.

## Rules
- No hardcoded colors — always `rgb(var(--color-xxx))`
- No `!important` unless overriding third-party or Shopify inline styles (document with comment)
- Mobile-first: base styles for mobile, `media-breakpoint-up` for larger screens
- Max specificity 0-1-0; acceptable up to 0-2-0 for `:hover`, `:focus`, `:not()`
- No `no-js` CSS rules — the theme has no no-JS support
- **Per-device dimensions scale via clamp, not a hard breakpoint switch.** A merchant value with a desktop & mobile setting should reach CSS as `--x` (a `clamp()` across the desktop range) + `--x-mobile` (fixed), emitted by `clamp-calculate-style` / `spacing-style` in Liquid — consume as `var(--x-mobile, var(--x))` mobile-first. Don't author two raw `px` values toggled at `@media`.
- **CSS has NO `ceil()`/`floor()` — stepped math is `round(up|down|nearest|to-zero, value, step)`** (plus `mod()`/`rem()`). "ceil(x)" in CSS is `round(up, x, 1)`. A bare `ceil()`/`floor()` is invalid CSS: the browser drops the whole declaration (verified: `CSS.supports('width','ceil(1px)')` → false; `round(up,3px,2px)` → true). `round()` is baseline (Chrome/Edge 125+, Safari 15.4+, Firefox 118+). Two traps that pass `theme-check` + the build and only surface in a real browser: **(1)** an invalid function inside `@supports` inverts a `not` guard — `@supports not (width: ceil(1px))` is **true in every browser forever** (the inner query is unsupported), so a "run when the feature is missing" fallback runs *always* and the real path becomes dead code; always feature-query a *valid* construct (`@supports (width: round(up, 1px, 1px))`). **(2)** Dart Sass **evaluates** `ceil()`/`floor()`/`round()` *inside* `@supports` conditions (parses them as SassScript), silently rewriting `@supports not (width: ceil(1px))` → `@supports not (width: 1px)` in the compiled CSS. `--custom-prop: ceil(...)` is emitted verbatim (Sass leaves custom-property values alone), so the two contexts behave oppositely — to emit a literal in a real property/condition, interpolate a string: `#{"round(up, 1px, 1px)"}`. This class of bug only a live `CSS.supports` check (L2) reveals.
- **Icon strokes are screen-px BY ARCHITECTURE — `svg * { vector-effect: non-scaling-stroke }` (`_resets.scss`) + `stroke-width="var(--icon-stroke-width, 2)"` is one system; never remove one half.** The icon set mixes viewBoxes (20 and 256): only NSS makes "2" mean 2 *screen* px for both, so dropping the reset upscales some strokes and collapses the 256-based icons to ~0.1px hairlines, while hardcoding a number in one icon detaches it from the global weight. Four verified facts to reuse: **(1)** a bare `var()` resolves inside an SVG **presentation attribute** in EVERY engine — measured 2/2/2 across Chrome, Firefox and Safari, so the `stroke-width="var(--icon-stroke-width, 2)"` icons are safe as written and must not be swept. A var with **no fallback** is a different case: invalid at computed-value time, silently painting the initial `1`. But a `calc()` — in an attribute *or* in CSS — **must carry a unit, and that unit must be `px`**: `calc(1.5 * var(--x, 1))` computes to `1.5` in Chrome/Safari and **`1` in Firefox**, and `stroke-dasharray: calc(0.1rem * …)` dashes in Chrome/Firefox and draws **solid in Safari**. Both are the same mechanism — the declaration is dropped and the property takes its INITIAL value (`stroke-width: 1`, `stroke-dasharray: none` = a solid line) — and both are silent: no console error, no `yarn check-*`, and **Chrome paints every broken form correctly**, which is how the pattern passed review in the first place. Under the 62.5% root `0.1rem` and `1px` are the same number, so `px` costs nothing. **(2)** Engines periodically break NSS (Firefox 127, Chrome 151 — painted at 1/devicePixelRatio on HiDPI). The compensation lever is a version-gated inline script in `layout/theme.liquid` that puts a scale factor on `document.documentElement` and removes it on a DPR change (core shipped one for Chrome 151 and deleted it once Chromium fixed the bug — re-add only against a measured regression, and scope it to shapes that actually use NSS: applying it to a `vector-effect: none` shape doubles the stroke). A runtime feature-detect is impossible because canvas rasterization does NOT reproduce compositor bugs — measure on screen or gate on version. **(3)** If a design ever needs uniform strokes *without* NSS: per-icon `--vb` on the svg root + `stroke-width: calc(var(--icon-stroke-px, 2) / tan(atan2(100cqw, 1px * var(--vb, 20))))` under `container-type: inline-size` on `.icon` reimplements it in plain geometry (verified painting 2px at every size/viewBox mix on the buggy Chrome — `tan(atan2(A, B))` is the CSS idiom for dividing two lengths into a number). **(4)** Never sweep this pattern in bulk: four look-alike stroke call sites in one fork needed four *different* fixes — one wanted a `px` unit, one wanted the compensation factor removed because its shape sets `vector-effect: none` (see (2)), one was already correct because its literal was `1` so the dropped `calc()` fell back to the intended value, and one belonged in CSS rather than an attribute. Read `vector-effect` on the element and the literal in the value before changing either; they decide which of the four cases you are in.
- **Full-bleed auto-grow media → use the shared mixins** `full-bleed-media-cover` / `full-bleed-media-adapt($ratio)` (`src/scss/mixins/_media.scss`, available via `@use "../mixins" as *`). Pair with `min-height: var(--height-mobile, 0)` / `var(--height, 0)` on the wrapper; never set a `height` on the grid item itself, and never cover via a bare `svg` selector (it hits control icons). See `create-liquid-section` → "Full-bleed / overlay hero patterns".
- **`display: contents` for mobile reflow** (lifting body children into a parent grid to row-stack on mobile) is clean, but `display` is not animatable → a one-time layout jump exactly at the breakpoint while a user live-resizes. Real users don't drag across the breakpoint, so it's acceptable — note it as a known trade-off so it isn't "fixed" by accident.
- **Hover-zoom a media image → scale `.media__image`, scoped.** `responsive-image` (default `with_wrapper: true`) puts your `class` param on the wrapper `div.media`; the `<img>` gets `.media__image`. Two traps: (1) `.media.loaded` sets `transition: background-color …` which **overrides** a transition placed on the wrapper — so animate the IMAGE, not the wrapper (override its opacity-only transition to also include `transform`). (2) Any other `responsive-image` in the same card (a brand logo) ALSO has `.media__image`, so `.card:hover .media__image` zooms it too — **scope** to `.card__media .media__image`. The specificity tie with `_component-media`'s `.media__image:not(.media-hover__element)` (0-2-0) resolves in your favour because block partials are `@use`d after `component-media` in `theme.scss` (no `!important` needed):
```scss
.card__media .media__image {
  transition: transform var(--animation-duration--medium) var(--animation-easing),
              opacity   var(--animation-duration--medium) var(--animation-easing);
}
@media (hover: hover) and (pointer: fine) {
  .card:hover .card__media .media__image { transform: scale(1.06); }
}
```
- **Zebra/alt-row parity across DOM groups that stack on mobile → emit a GLOBAL-parity class, override per-group on desktop.** If a repeated list is split into two side-by-side DOM groups on desktop (newspaper columns) but stacks into one column on mobile, a per-group `:nth-child(even)` restarts parity in each group → two same-colour rows at the group boundary once stacked (whenever the first group has an odd count). Fix: emit a parity class from the **whole-list** index in Liquid (`forloop.index0 | modulo: 2`) for the base/mobile stripe (continuous when stacked), then **override** at the desktop breakpoint under the 2-col modifier with per-group `:nth-child(even)` (each column restarts white). Single-column keeps the global stripe.
- **Horizontal-scroll-not-clip in an `overflow-x: auto` wrapper:** a `min-width: <n>` on the inner element only scrolls when the slot is narrower than `n`; a long unbreakable value at full width overflows and gets **clipped** by `overflow: hidden` instead. Fix: give the inner element `width: max-content; min-width: 100%` (fills a wide block, grows past a narrow slot) AND do **not** put `min-width: 0` on its grid/flex cells — that collapse is exactly what lets the box stay ≤ slot and clip. Then long `white-space: nowrap` content grows the box → the wrapper scrolls; short content still fills.
- **A divider drawn as a `border` on a PARENT is covered by child backgrounds** — a striped row's `background` paints over the parent group's `border-inline-start`, so the divider vanishes on striped rows. Put the divider on the **child rows** instead (`.group:nth-child(2) .row { border-inline-start: … }`); a border paints on top of the element's OWN background, so it stays visible on every row.
- **Logical properties flip the BOX; they never flip a fill that is anchored physically — and RTL rules belong in `src/scss/global/_rtl-base.scss`, nowhere else.** `inset-inline-start` / `padding-inline` / `margin-inline` handle geometry under `dir="rtl"` for free, which makes a component *look* direction-safe. Anything that anchors PAINT does not follow: `background-position`, a `linear-gradient(to right, …)` direction, `clip-path`, `transform-origin`. A partially-filled element — a progress bar, a rating star, a connector between steps — therefore keeps growing from the same physical edge while everything around it mirrors, so it fills *away* from the thing it belongs to. **The tell is a value that is partial**: at 0% or 100% both directions render identically, so this is invisible unless you look mid-fill (and it is permanent under an autoplay countdown, which parks a segment part-filled). Fix it with the smallest re-anchor — usually one declaration, `background-position: 100% 0`, or swapping `to right` for `to left` — placed in `_rtl-base.scss` next to the existing `.rating-value__dot--partial` and `.image-comparison` entries. Two reasons that file and not a `[dir="rtl"]` block in your own partial: `layout/theme.liquid` gates the `dir` attribute and the `rtl.css` link behind the same `settings.enable_rtl` flag (so a rule there loads exactly when it is needed, and never ships to LTR stores), and it is the one place the next person will look — `_rtl-base.scss` is the only file under `src/scss` containing `dir="rtl"`. When you add one, say so in the partial's `@capability`/`@contract` header: the pair is a cross-file dependency, and the header is what reaches PROJECT-MAP §0.
- **Internal dividers on a grid whose LAST ROW can be incomplete → per-cell `box-shadow` PLUS filler cells, counted per breakpoint.** When the item count isn't a multiple of the column count, the two obvious techniques fail differently. *Gap-reveal* (grid `gap: 1px` + a tint `background-color` on the grid + opaque cells) lets the tint show through the **empty tracks** as a large grey block. *Per-cell shadows alone* — `box-shadow: -1px 0 0 rgb(var(--color-foreground) / 10%), 0 -1px 0 rgb(var(--color-foreground) / 10%)` (left + top lines) with `overflow: hidden` on the grid clipping the outer top/left ones — kills the grey and is column-count agnostic (no `nth-child`), but the last row's divider then **stops short**: an empty track has no cell, so nothing draws it. The complete fix is the shadows **plus filler cells** that finish the last row, counted separately for **each** breakpoint's column setting (a desktop-only count leaves a half-width divider on mobile, and fillers left visible on the other viewport add phantom rows):
```liquid
{%- comment -%} item_count from block.blocks.size — see create-liquid-block {%- endcomment -%}
{%- if item_count > 0 -%}
  {%- assign r = item_count | modulo: cols -%}
  {%- if r > 0 -%}{%- assign fillers = cols | minus: r -%}{%- endif -%}
{%- endif -%}
```
Render `max(fillers_desktop, fillers_mobile)` cells, tag each `--filler-desktop` / `--filler-mobile` by `forloop.index`, and in SCSS hide `--filler` by default, revealing each only inside its own media query. Fillers inherit the cell's opaque background + shadows and stretch to the row height, so the divider spans the full row. **Two Liquid traps ride along:** with **0** children a naive count goes `-1`, and `-1 | modulo: 2` is **1** (Ruby semantics) → a stray empty cell paints, so guard `if item_count > 0`; and reading the column `select` without `| default` yields `modulo: 0` = a Liquid **"divided by 0"** that blanks the entire block — reuse the already-defaulted variable rather than re-reading the setting.
- **A decoration that must sit IN the gap → paint it from the CONTAINER, never as a child `::before`.** The two bullets above put the line on a cell *edge*; when the design centres a rule *between* columns the same instinct fails silently. To land in the gap the pseudo has to be positioned outside the child's own box, and `overflow` clips a descendant regardless of which ancestor is its containing block — so any card that clips eats it. That is most of them: `article-card` (`article-card-markup.liquid` root class includes `overflow-hidden`), `product-card`, `collection-card`. You cannot force `overflow: visible` on the child either; that is what makes its media clipping and hover-scale work. Paint the whole row from the container instead, as one tiled background on the container's own `::before` (shipped: `_component-grid-separator.scss`):
  ```scss
  .row--separator {
    --sep-gap: var(--f-column-gap-mobile, var(--f-column-gap, 0));

    position: relative;

    &::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image: linear-gradient(90deg, var(--sep-color) 0 var(--sep-w), transparent var(--sep-w));
      background-repeat: repeat-x;
      background-position: calc(var(--sep-gap) / -2 - var(--sep-w) / 2) center;
      background-size: calc((100% + var(--sep-gap)) / var(--f-grid-columns)) var(--sep-h);
      pointer-events: none;
    }

    @include media-breakpoint-up(md) { --sep-gap: var(--f-column-gap, 0); }
  }
  ```
  The tile is **one column track plus one gap**, so tile boundaries fall on gap boundaries; shifting the tiling origin half a gap left centres a line in every gap, while the lines for `k = 0` and `k = columns` fall outside the box and are clipped — **exactly `columns − 1` lines, never one on an outer edge, with no `nth-child` and no Liquid arithmetic**. Read the count from `--f-grid-columns` (the same var `.layout-panel-grid` feeds to `grid-template-columns`) and it tracks every breakpoint *and* any `custom_columns` override for free. Two riders: **dashes** need `mask-image: repeating-linear-gradient(to bottom, …)` on that `::before` — a CSS `border-style: dashed` derives its dash length from the thickness, so a 1px rule gives ~3px dashes, and masking the *container* instead would mask every child block; and because the background tiles horizontally only, a **wrapping** grid gets continuous column rules through the row gaps rather than a rule per row (a row's pitch is not knowable in CSS) — say so in the setting's `info` rather than pretending otherwise.
- **Media queries add NO specificity — a per-breakpoint override must MATCH the selector shape it overrides.** Any scheme that suppresses something at a narrow breakpoint and re-enables it at a wider one is a specificity problem, not a source-order problem. `.x--md-2 > :nth-child(2n + 1)::before { display: none }` is 0-2-1; the re-enable `.x--xl-4 > *::before { display: block }` is 0-1-1 and **loses at every wider breakpoint no matter where it appears in the file**. Write the re-enable at the same specificity (`> :nth-child(n)::before`). Symptom: the feature is correct at the narrowest breakpoint and silently dead at all the wider ones — the reverse of the bug you go looking for, and `stylelint` says nothing (`no-descending-specificity` is disabled in this repo).

## Checklist
- [ ] File created in correct location (check decision tree above)
- [ ] If `_component-*.scss`: `@capability` header at top (`@capability` + `@keywords` required) — feeds PROJECT-MAP §0
- [ ] **No hand-written utility rules** — before writing any display/alignment/position/visibility/text-tweak rule, check `_helpers.scss` (~38 utility categories: `.hidden`, `.flex`, `.items-center`, `.line-clamp`, `.visually-hidden`, responsive hide/show…) and `_layout.scss`/`_spacing.scss` for an existing class; apply the class in the Liquid markup instead
- [ ] `@use "../mixins" as *;` at top
- [ ] Section divider comment `// ─── Name ─────...`
- [ ] BEM naming convention
- [ ] No hardcoded colors — uses `rgb(var(--color-xxx))`
- [ ] Mobile-first approach
- [ ] File imported/registered (partial) or `<link>` added (standalone)
- [ ] Hover/zoom transforms target `.media__image` (not the wrapper) and are scoped to the specific media (`.card__media .media__image`, not a broad `:hover .media__image`)
- [ ] `yarn build:css` run to verify compilation
- [ ] `yarn lint:css` passes (stylelint)
