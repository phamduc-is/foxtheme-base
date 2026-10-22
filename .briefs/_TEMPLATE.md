<!--
BRIEF = the spec a builder implements (per-dev, gitignored — only this template and
`archive/` are committed; `wt:clean` archives a merged feature's brief there for /revise).

Authored in Phase 1 (THINK), WITH Claude:
  1. You share the Figma (desktop + mobile + variants) via the figma MCP.
  2. Claude analyses it against the project — PROJECT-ANATOMY.md / BLOCK-ANATOMY.md /
     SNIPPET-ANATOMY.md + the CLOSEST real section/block — and proposes the
     implementation map (create vs reuse) + grouped settings.
  3. You discuss & agree; Claude fills this brief in.
Phase 2 (/build-batch) hands the brief to the feature-builder.

Copy to .briefs/<name>.md. Be concrete — vagueness becomes a guess.
Delete any section that doesn't apply (a snippet-only brief needs far less) — EXCEPT the
Interactions and Edge cases tables: those stay, with an explicit "N/A — <why>" when empty
(the testers treat a missing table as an unfinished brief, not as "nothing to test").
-->

# <section | block | snippet>: <name>

**Purpose:** <what it's for, where it appears>
**Design:** desktop `<Figma URL#node>` · mobile `<URL#node>` · variants `<URL#node…>` — builder reads via figma MCP
**Mirror:** <closest existing thing to follow — e.g. "structure like `media-gallery` + `_gallery-item`">
**Addability + data** (block/card only): <merchant-addable → public name + `presets` + own picker | host-rendered → internal `_`-block, no presets, reads `closest.<collection|product>`>

## Implementation map  (from the Think analysis)

**Create:**
- `sections/<name>.liquid`
- `blocks/_<name>-<item>.liquid` — <what the item block holds>
- `src/scss/global/_section-<name>.scss` (+ `_component-<name>.scss` if shared)
- locale keys: <new `t:` keys needed, or "reuse only">

**Reuse (don't reimplement):**
- snippets: <responsive-image · button-markup · spacing-style · border-style · gap-style · icon-or-image …>
- blocks: <existing block types to accept, e.g. `@theme`, `button`, or a shared block>

## Settings schema  (a TREE — section + each child block get their OWN tree, never merged)

<!-- Agent drafts the canonical/structural settings + content slots; the dev defines the
     intent settings (toggles/ranges/optional regions). Resolved together in Think — the
     final list below is authorless (no agent/dev markers). -->

**Section** — Layout → Mobile layout → Appearance → Padding:
- `container` (full|fixed, default fixed) · `type` (grid|carousel) · `columns_xxl` · `column_gap`/`row_gap`
- mobile: `enable_swipe_on_mobile` · `columns_mobile`
- appearance: `color_scheme` · `border`
- padding: canonical device block (desktop 0/0, mobile 48/48)

**Block `_<name>-<item>`** — Layout → Media → Content → Appearance:
- <id (type) — t:label — default — note>
- CTA via `button_style`/`button_size`/`button_icon` settings (+ `button-markup`) · image via `image_picker` (+ `responsive-image`) · icon via `icon` select (per BLOCK-ANATOMY)

### Settings inspector preview  (how it reads in the Theme Editor)
<!-- ASCII mock of the editor inspector, drawn from the agreed settings tree above.
     One box per level (section box + each child-block box). Group rows under a CAPS
     header = one schema `header`. Flag conditional rows with "← only if <condition>". -->

```
┌─ <Block / Section name> ─────────────────────────┐
│  <GROUP HEADER>                                  │
│    <Label>                     [ <control>      ]│
│    ...                                           │
└──────────────────────────────────────────────────┘
```

Legend: `▾` = dropdown/select · `[A│B]` = segmented select · `⬒` = image picker · `▦` = color/gradient
picker · `●─○ n px` = range slider · `[ ◯ ]` = checkbox/toggle · CAPS row = a `header` group ·
"← only if …" = `visible_if`.

## Style & layout  (agent — climb the inheritance ladder: setting → theme global → mirror → hardcode-LAST)

- **Layout / structure:** <root skeleton + BEM elements from the mirror; desktop vs mobile arrangement, columns, gaps>
- **Color:** <which scheme roles — e.g. card bg = scheme background, title = `--color-foreground`; never hex. Note any setting that controls it, or any scheme override>
- **Spacing:** <bound to which settings (padding group / gap); any value taken straight from design + why no setting>
- **Font:** <which preset classes — `.h1`–`.h6` / `.paragraph` / `.text-subheading` (responsive clamp); or `type_preset` setting. Never raw px>
- **Hover / state:** <from the mirror — e.g. accent borrows `--color-primary-button-background`; card lift via box-shadow/transform; gated `@media (hover: hover)`>
- **Caveats / hardcodes (rung 4 — must be listed):** <anything that legitimately fell to a hardcode, with the reason; a color outside every scheme; a section with no padding group>

## Spacing table  (MANDATORY — exact numbers from Figma, no prose)
<!-- One row per gap/padding/margin. Bind to a setting/token where one exists; literal px only for design-specific values. -->

| Between | Desktop | Mobile | Bound to (setting/token) · Figma ref |
|---|---|---|---|
| <e.g. label → heading> | <16px> | <12px> | <`gap` setting · node 1:23> |

## Typography table  (MANDATORY — exact from Figma textStyles, no prose)

| Element | Font family | Weight | Size (D / M) | Line-height | Case | Bound to (preset/setting) · Figma ref |
|---|---|---|---|---|---|---|
| <heading> | <heading> | <900> | <62 / 43> | <1.1> | <none> | <`type_preset: custom` · textStyle Display> |

## Behavior / JS
<grid vs carousel (which element: carousel-slider / flex-carousel); motion; or "static SSR, none">

## Interactions  (MANDATORY — one row per behavior; write "N/A — static, no interactive element" explicitly if none)
<!-- This table IS L2's interaction test plan (Mức C) — a behavior not listed here is a behavior
     nobody tests. L2 also auto-detects carousels/dialogs/tabs/forms, but the EXPECTED outcome
     only you can specify. -->

| Element | Action | Expected |
|---|---|---|
| <e.g. carousel next button> | <click> | <advances one slide; at last slide loops to first> |
| <card image> | <click> | <opens quick-view dialog; Esc closes it> |

## Edge cases  (MANDATORY — walk this checklist in the Think phase; keep the rows that apply, mark the rest "N/A — <why>")
<!-- An unpinned edge case is an untested edge case. L2 renders a STRESS instance from these. -->

| Case | Expected |
|---|---|
| Long content (~120-char heading / longest realistic label) | <wraps / truncates … — never overflows the container> |
| Max items (<N> child blocks / list items) | <wraps to next row / scrolls / caps at N> |
| Empty / no data selected | <onboarding placeholder, no broken link, no Liquid error> |
| Optional image blank | <placeholder svg / block hides> |
| Sold-out product (commerce only) | <add-to-cart disabled + label; badge shown> |
| On-sale product (commerce only) | <compare-at strike + sale badge> |

## Variants  (what changes across the designs)
<e.g. desktop 4-col grid → mobile 1-col swipe · with/without CTA · light/dark scheme>

## Acceptance
- Renders in Theme Editor (Add section → "<name>") matching Figma **desktop AND mobile**
- Mirrors `<closest section/block>` structure (root skeleton, container, padding, blocks)
- `yarn check-liquid` + i18n (en) pass; no section-level button/image/icon (those live in the block)
- Every **Interactions** row behaves as specified; every **Edge cases** row renders as specified (L2 verifies both)
- No horizontal overflow at 1440 / 768 / 375, including with stress content
