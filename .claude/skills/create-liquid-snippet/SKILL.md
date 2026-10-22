---
name: create-liquid-snippet
description: Use when creating a NEW snippet — a new file in snippets/ (a -markup presentation snippet or a small utility snippet used via {% render %}). For "create/add a new snippet". Not for editing an existing snippet (use review-and-refactor).
---

# Create Liquid Snippet

## When to use
- Creating a new file in `snippets/`
- Extracting reusable markup from a section or block
- Building a utility helper (URL builder, CSS variable emitter)

## Two types of snippets

**`-markup` snippet** (e.g. `product-card-markup.liquid`):
- Renders meaningful HTML output
- Used by blocks and sections to keep markup separate
- Has `{% doc %}` + `{%- liquid -%}` assigns + HTML

**Utility snippet** (e.g. `price.liquid`, `spacing-style.liquid`):
- Outputs CSS variables, URLs, or small computed values
- No HTML wrapper/shell
- Short, clear name — no `-markup` suffix

## Canonical reference — reuse before you create

Deep reference: **[`SNIPPET-ANATOMY.md`](./SNIPPET-ANATOMY.md)** (from `button-markup`, `spacing-style`, `responsive-image`). **First check `snippets/` for an existing one** — never reimplement `responsive-image`, `button-markup`, `spacing-style`, `border-style`, `gap-style`, `icon`, `icon-or-image`, `color-schemes`, `price`. Only create a new snippet for genuinely new presentation/util. Non-negotiable: the two kinds (presentation `-markup` vs utility CSS-var/helper), a `{% doc %}` param contract, `allow_false: true` for boolean params, quoted render name, stripped output.

## Workflow

### Step 1: Create the file
- Markup: `snippets/{name}-markup.liquid`
- Utility: `snippets/{name}.liquid`

### Step 2: -markup snippet structure

```liquid
{% doc %}
  Short description of what this snippet renders.

  @param {object} block - Block object for shopify_attributes (if applicable)
  @param {string} param_a - Description
  @param {string} [param_b] - Optional description

  @example
  {% render 'name-markup', block: block, param_a: value %}
{% enddoc %}

{%- liquid
  assign param_b = param_b | default: 'fallback'
  assign boolean_param = boolean_param | default: true, allow_false: true
  assign classes = 'root-class'
  if some_condition
    assign classes = classes | append: ' root-class--modifier'
  endif
-%}

<div class="{{ classes }}" {{ block.shopify_attributes }}>
  <!-- markup -->
</div>
```

### Step 3: Utility snippet structure

```liquid
{% doc %}
  Emits CSS custom properties from block/section settings.

  @param {object} settings - block.settings or section.settings
  @param {string} [suffix] - Optional suffix for setting IDs

  @example
  {% render 'spacing-style', settings: block.settings %}
{% enddoc %}

{%- liquid
  assign suffix = suffix | default: ''
-%}
{%- capture output -%}
  {%- if settings.gap != blank -%}--gap: {{ settings.gap }}px;{%- endif -%}
{%- endcapture -%}
{{- output | strip | strip_newlines -}}
```

### Step 4: Parameter defaults

```liquid
{%- liquid
  assign text       = text | default: ''
  assign loading    = loading | default: 'lazy'
  assign use_zoom   = use_zoom | default: true, allow_false: true
  assign with_wrapper = with_wrapper | default: true, allow_false: true
-%}
```

`allow_false: true` is required for booleans that can be explicitly `false`.

### Step 5: Output formatting

Always strip whitespace from final output to avoid inline layout bugs:
```liquid
{%- capture markup -%}
  <!-- content -->
{%- endcapture -%}
{{ markup | strip | strip_newlines }}
```

### Step 6: Rendering from blocks/sections

```liquid
{%- render 'name-markup',
  block: block,
  param_a: block.settings.param_a,
  param_b: derived_value
-%}
```

Template name **must be a quoted string** — never a variable.

### Step 7: No CSS/JS in snippets
Snippets do not own CSS or JS files. Styles for markup snippets belong to the block or component SCSS file that uses them.

## Checklist
- [ ] File created: `snippets/{name}.liquid` or `snippets/{name}-markup.liquid`
- [ ] `{% doc %}` with all `@param` and `@example`
- [ ] Boolean params use `allow_false: true`
- [ ] Output uses `strip | strip_newlines`
- [ ] `-markup` snippets include `{{ block.shopify_attributes }}` if block is passed
- [ ] No hardcoded colors or magic numbers — use CSS variables
- [ ] `yarn check-liquid --files snippets/{name}.liquid` passes (MANDATORY — CLAUDE.md Liquid workflow)
- [ ] `yarn check-missing-translate` passes if the snippet (or the caller you edited) introduced `t:` keys (ANATOMY §6)
- [ ] `yarn map` run after file creation
- [ ] **Reused before reimplementing** — image→`responsive-image`, button→`button-markup`, text/heading→`text-markup`, icon→`icon`/`icon-or-image`, price→`price`, spacing/border/gap/size/typography/layout/overlay/clamp→the matching `*-style` snippet. Did NOT hand-roll `<img>`/`<svg>`/`.btn`/`<h*>`/price HTML. For any **behaviour** the snippet's markup implies (scroll row, tabs, accordion, dialog…), checked PROJECT-MAP §0 (Capability index) and used the listed component's markup contract.
- [ ] **`{% doc %}` matches the code** — param names equal what the snippet body reads, documented defaults are the *actual* defaults, every `@example` arg is comma-separated.
- [ ] **CSS-var emitter contract** — output goes inside a `style="…"` AND the consuming class is named on the same element (paired `*-style`/preset class). Pass the settings *object* (`section.settings`/`block.settings`, never the global `settings` or a scalar); use a named param to override a single value.
- [ ] **Self-guard vs caller-gate is intentional** — snippet renders nothing for its empty state (`icon:'none'`, blank `label`+`icon`, blank text), OR documents that the caller must gate it (e.g. `overlay` never self-gates — wrap in `toggle_overlay`).
- [ ] **Delegated math, not reimplemented** — fluid dimensions go through `clamp-calculate-style` (raw px, no `--` prefix, comma-separated, gated `!= blank`), not a hand-written `clamp()`.
