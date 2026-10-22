---
name: section-rendering-api
description: Use when working with the Shopify Section Rendering API in JS — fetching section HTML, morphing a section into the DOM, handling variant/cart updates that re-render a section, or implementing updatedCallback after a morph. Mentions sectionRenderer, morphSection, ThemeEvents.variantUpdate, updatedCallback.
---

# Section Rendering API

## When to use

- Re-rendering a section after a user action (variant change, filter update, quantity change)
- Building a component that listens to `ThemeEvents.variantUpdate` and morphs its content
- Implementing `updatedCallback` correctly after a morph reuses an element
- Understanding the hybrid cache → JSON → full HTML approach used in `VariantPicker`

---

## Architecture overview

Two fetch pathways:

**`sectionRenderer`** — singleton for fetching and morphing full sections. Handles caching, deduplication of concurrent requests, and abort of in-flight morphs.

**`VariantPicker` hybrid approach** — optimized for product variant switches:

1. **Cache hit** — preloaded variants from initial HTML → instant update, background HTML sync
2. **JSON fetch** — `?sections=variant-data&variant=xxx` → lighter payload for price/availability
3. **Full HTML fallback** — fetches and morphs entire section HTML

After any morph, custom elements inside the morphed region receive `updatedCallback` (not `connectedCallback` — the element is reused, not recreated).

---

## Imports

```javascript
import { sectionRenderer, morphSection, buildSectionSelector, normalizeSectionId } from "@theme/section-renderer";
import { morph } from "@theme/morph";
import { ThemeEvents, VariantUpdateEvent } from "@theme/events";
```

---

## Fetching and morphing a section

### Re-render a section by ID (most common)

```javascript
// Fetches HTML via ?section_id=xxx and morphs the section in place
await sectionRenderer.renderSection("product-main");

// With options — disable cache (always re-fetch)
await sectionRenderer.renderSection("product-main", { cache: false });
```

Cache is automatically disabled when `Shopify.designMode` is true (theme editor).

If `renderSection` is called again for the same section ID before the previous one completes, the in-flight morph is aborted and replaced by the new request.

### Fetch HTML only (no morph)

```javascript
const html = await sectionRenderer.getSectionHTML("product-main");
// html is a raw HTML string — parse it before use
const doc = new DOMParser().parseFromString(html, "text/html");
```

### Manual morph using fetched HTML

```javascript
// morphSection: parses the HTML you already fetched and morphs the section in place (it does NOT fetch)
import { morphSection } from "@theme/section-renderer";
await morphSection("product-main", htmlString);

// morph: low-level, morph any two elements
import { morph } from "@theme/morph";
morph(existingElement, newElement);
```

### Section URL pattern

Section Rendering API appends `?section_id=<id>` to the current page URL:

```
/products/my-product?section_id=product-main
```

The section ID in the URL is the raw ID without the `shopify-section-` prefix.

### Utility helpers

```javascript
buildSectionSelector("product-main");
// → "shopify-section-product-main"

normalizeSectionId("shopify-section-product-main");
// → "product-main"
```

---

## Data-endpoint section (headless fetch, no morph)

The patterns above re-render a section **in place on the current page**. A different, equally valid use of the API: a **standalone section that exists only to be fetched** — never placed in any template — used to read server-computed data (e.g. a collection's storefront filters) and hand raw values to JS. The finder cascade (`product-finder`) is built this way.

### The 3-arg `getSectionHTML(id, useCache, url)`

`getSectionHTML` takes an optional **third `url` argument** that overrides the request URL. This is the crux: the fetched section renders in the **context of that URL**, not the current page.

```javascript
// Fetch the headless endpoint AS IF we were on the collection page, with cumulative filter params.
const target = new URL(collection.url, location.origin);
target.searchParams.set("filter.p.m.custom.make", "honda");
const html = await sectionRenderer.getSectionHTML("section-rendering-product-finder", false, target);
const doc = new DOMParser().parseFromString(html, "text/html");
// read doc.querySelectorAll("select[data-filter-name]") — never morphed into the page
```

Why the `url` matters: `collection.filters` (and `collection.products`) only honor `?filter.*` params when the request URL **is** the collection's own URL. Fetching the endpoint against the current page (e.g. the homepage) returns unfiltered data. Pass the collection URL as the 3rd arg and Shopify recomputes each filter value's `count` against the active selection — that count-based narrowing is what drives a cascade (invalid downstream options come back `count: 0`). Pass `useCache: false` for live-narrowing fetches.

### The endpoint section itself

```liquid
{% comment %} sections/section-rendering-<feature>.liquid — fetched, never placed {% endcomment %}
<div hidden>
  {%- for filter in collection.filters -%}
    <select data-filter-name="{{ filter.param_name }}" data-filter-label="{{ filter.label | escape }}">
      {%- for value in filter.values -%}
        {%- if value.count > 0 -%}
          <option value="{{ value.value | escape }}" data-count="{{ value.count }}">{{ value.label }}</option>
        {%- endif -%}
      {%- endfor -%}
    </select>
  {%- endfor -%}
</div>
{% schema %}
{ "name": "t:names.<feature>_rendering", "disabled_on": { "groups": ["header", "footer"] }, "settings": [] }
{% endschema %}
```

- Output is **data, not UI** — `hidden`, bare `<select>`/`data-*`, consumed by `querySelector` in JS. It renders nothing useful when viewed directly; that's expected (API-only).
- `disabled_on: { groups: ["header", "footer"] }` keeps it out of those group editors; no settings.
- The consuming JS manages its own AbortController around `getSectionHTML` (this path is not the auto-aborting `renderSection`).

---

## `updatedCallback` — required after morph

After `morph()` completes, custom elements that were reused (not recreated) receive `updatedCallback`. This is NOT `connectedCallback` — element identity is preserved, refs may be stale.

### What must happen in `updatedCallback`

```javascript
updatedCallback() {
  super.updatedCallback();

  // 1. Re-fetch stale refs (morph may have replaced inner DOM)
  const button = this.refs.addToCartButton;

  // 2. Reset any accumulated state that should start fresh
  this.#currentVariantId = this.dataset.variantId;

  // 3. Re-bind observers or listeners not covered by AbortController
  // (AbortController listeners survive since the element is reused)

  // 4. For animated components: reset animation state
  // See animation-motion/SKILL.md for the full reset pattern
}
```

### When `updatedCallback` is NOT needed

- Component has no internal state that depends on DOM structure
- Component only listens to events via `{ signal }` — those survive morph automatically
- Component is never inside a section that uses Section Rendering API

### Key difference from `connectedCallback`

|                 | `connectedCallback`       | `updatedCallback`           |
| --------------- | ------------------------- | --------------------------- |
| When            | Element inserted into DOM | Element reused after morph  |
| Refs            | Fresh, just set up        | May be stale — re-fetch     |
| AbortController | Create new one            | Same instance, still active |
| Animation state | Prestage + bind           | Reset + prestage + re-bind  |

### A morph strips runtime state, and only a Component gets told

Morph reconciles against the server's HTML, which never contains attributes the
runtime wrote — so **every one of them is removed** from a reused node. For a
`Component` that is harmless: `updatedCallback` fires and it rebuilds its state.

An element that is **not** a Component gets no such callback. `motion-group` is
a customized built-in (`<div is="motion-group">`), and the group-level prestage
is keyed on the ABSENCE of `data-motion-ready` — so a morph silently re-armed
the hide on a list that was already on screen, with nothing left to run, and the
whole grid went invisible. It now watches that attribute itself via
`attributeChangedCallback`.

If you write a custom element that is not a `Component` and keeps state in an
attribute, assume a morph will take it away, and decide how it finds out.

---

## Listening to `ThemeEvents.variantUpdate`

`VariantUpdateEvent` fires from `variant-picker` after each variant change. Other components (price, badge, inventory, media gallery) listen to update themselves.

### Event structure

```javascript
addEventListener(ThemeEvents.variantUpdate, (event) => {
  const { resource, sourceId, data } = event.detail;

  // resource — variant object or null
  // resource.id — variant ID
  // resource.available — availability flag
  // resource.featured_media — { id, preview_image: { src } } or undefined

  // sourceId — option value ID that triggered the change

  // data.html — parsed Document (null for cache-only updates)
  // data.productId — string, used to scope updates to correct product
  // data.fromCache — true = optimistic update, html may be null
  // data.isBackgroundSync — true = background HTML sync after cache hit
  // data.newProduct — { id, url } if combined listing switched product, else undefined
});
```

### Pattern: morph a sub-element from `data.html`

```javascript
addEventListener(
  ThemeEvents.variantUpdate,
  (event) => {
    const { data } = event.detail;

    // html is null on first cache-hit dispatch — wait for background sync
    if (!data.html) return;

    const newContent = data.html.querySelector(".my-component");
    if (newContent) {
      morph(this, newContent);
    }
  },
  { signal: this.#controller.signal }
);
```

### Pattern: optimistic update from `resource`

```javascript
addEventListener(
  ThemeEvents.variantUpdate,
  (event) => {
    const { resource, data } = event.detail;

    // Skip background syncs (HTML update after earlier cache dispatch)
    if (data.isBackgroundSync) return;

    if (resource?.available !== undefined) {
      this.refs.addToCartButton.disabled = !resource.available;
    }
  },
  { signal: this.#controller.signal }
);
```

### Scoping to the correct product

Multiple variant pickers can be on the same page (product cards, quick-add drawer). Always scope by `data.productId`:

```javascript
addEventListener(
  ThemeEvents.variantUpdate,
  (event) => {
    if (event.detail.data.productId !== this.dataset.productId) return;
    // ... handle update
  },
  { signal: this.#controller.signal }
);
```

---

## Important: `shopify:section:load` does not fire after Section Rendering API morph

Shopify's `shopify:section:load` event fires for theme editor reloads, but NOT for Section Rendering API morphs. Any setup that relied on that event must instead be triggered from `updatedCallback` or from the component that called `renderSection`.

---

## Common mistakes

- **Accessing `event.detail.data.html` and crashing on null** — cache-hit dispatches have `html: null`. Always null-check before querying.
- **Not scoping `variantUpdate` listener by `productId`** — all pickers on the page dispatch the event; without scoping, a product card update triggers the PDP component.
- **Forgetting `updatedCallback`** — component inside a re-renderable section will have stale refs and stale state after a morph. `connectedCallback` does not re-run.
- **Calling `renderSection` without aborting in-flight requests** — `sectionRenderer` handles this automatically, but if you call `getSectionHTML` directly, you must manage your own AbortController.
- **Not re-applying post-load setup after morph** — animations, scroll bindings, and any `shopify:section:load` handler must be re-applied in `updatedCallback`.

---

## Checklist

- [ ] `updatedCallback` present if component is inside a re-renderable section
- [ ] `data.html` null-checked before calling `.querySelector()` on it
- [ ] `variantUpdate` listener scoped by `data.productId`
- [ ] `isBackgroundSync` check added to prevent double-processing when using cache+HTML pattern
- [ ] `sectionRenderer.renderSection` used for full-section re-renders (not raw `fetch`)
- [ ] `morph(existingEl, newEl)` used for partial DOM updates (not `innerHTML`)
- [ ] No reliance on `shopify:section:load` inside Section Rendering API flow
- [ ] Animation state reset in `updatedCallback` (see `animation-motion/SKILL.md`)
- [ ] Data-endpoint fetch: 3rd `url` arg of `getSectionHTML(id, false, url)` set to the resource's own URL (so `?filter.*` is honored); endpoint section is `hidden`, `disabled_on` header/footer, no settings, never placed in a template; own AbortController managed
