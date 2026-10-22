---
name: cart-operations
description: Use when working with the cart in JS — calling cart API routes (add/update/change), reacting to CartAddEvent vs CartUpdateEvent, or re-rendering sections after a cart mutation. For "add to cart", "update quantity", "remove line item", "cart drawer", or components reacting to cart state.
---

# Cart Operations

## When to use
- Submitting an add-to-cart form via AJAX
- Updating or removing a line item
- Building a component that reacts to cart count changes
- Re-rendering sections after a cart mutation (grouped sections pattern)

---

## Cart API routes

Always use `FoxTheme.routes` — never hardcode paths.

| Key | Resolves to | Use for |
|-----|------------|---------|
| `FoxTheme.routes.cart_add_url` | `/cart/add.js` | Add to cart |
| `FoxTheme.routes.cart_change_url` | `/cart/change` | Update / remove line item |
| `FoxTheme.routes.cart_update_url` | `/cart/update` | Bulk update |
| `FoxTheme.routes.cart` | `/cart.js` | Read current cart JSON |
| `FoxTheme.routes.cart_url` | `/cart` | Cart page URL |

---

## `fetchConfig` — required for cart API calls

```javascript
import { fetchConfig } from "@theme/utilities";
```

| Type | Use for | Effect |
|------|---------|--------|
| `"javascript"` | Form submission (add to cart with `FormData`) | Sets `X-Requested-With`, removes `Content-Type` — required for multipart |
| `"json"` | JSON body requests (change, update) | Sets `Content-Type: application/json` |

```javascript
// Add to cart via form
const formData = new FormData(form);
const config = fetchConfig("javascript", { body: formData });
const response = await fetch(FoxTheme.routes.cart_add_url, {
  ...config,
  headers: { ...config.headers, Accept: "text/html" },
});

// Update line item via JSON
const config = fetchConfig("json", {
  body: JSON.stringify({ id: lineItemKey, quantity: newQty }),
});
const response = await fetch(FoxTheme.routes.cart_change_url, config);
```

**Never use `"javascript"` with a JSON body or `"json"` with FormData — headers won't match.**

---

## Cart events

```javascript
import { ThemeEvents, CartAddEvent, CartUpdateEvent, CartErrorEvent, CartGroupedSections } from "@theme/events";
```

### `CartAddEvent` vs `CartUpdateEvent` — critical distinction

Both fire on `ThemeEvents.cartUpdate`. The difference is `event.detail.data.isIncremental`:

| Event | `isIncremental` | `itemCount` meaning |
|-------|-----------------|---------------------|
| `CartAddEvent` | `true` | **Delta** — how many items were just added |
| `CartUpdateEvent` | `false` | **Absolute** — total cart item count |

**Always check `isIncremental` before updating your count** (`{ signal }` from your AbortController, as on every listener):
```javascript
document.addEventListener(ThemeEvents.cartUpdate, (event) => {
  const { itemCount, isIncremental } = event.detail.data;
  if (isIncremental) {
    this.#count = (this.#count ?? 0) + itemCount; // add the delta
  } else {
    this.#count = itemCount; // replace with absolute
  }
}, { signal: this.#controller.signal });
```

### `CartErrorEvent` — fires on add failure (e.g. out of stock)

```javascript
document.addEventListener(ThemeEvents.cartError, (event) => {
  const { sourceId, data } = event.detail;
  // data.message — short error message
}, { signal: this.#controller.signal });
```

Note: on 422 errors, Shopify may still add the max allowed quantity. `product-form` handles this by batch-fetching the affected sections in ONE `?sections=<id,id>` request and reading the real count from the returned HTML (`[ref="cartItemCount"]` / `[data-cart-bubble-count]`) — there is NO separate `cart.js` round-trip (commit `3801e1db` deliberately removed it; don't reintroduce one).

### `source` field — scope to prevent side effects

Set `source` in event data to let other components know where the update originated:

```javascript
this.dispatchEvent(
  new CartUpdateEvent({}, this.id, {
    itemCount: newCount,
    source: "cart-items-component", // e.g. cart-drawer doesn't reopen
    sections: response.sections,
  })
);
```

Cart drawer skips auto-opening if `source === "cart-items-component"` and drawer is already open.

---

## Requesting section re-renders alongside cart mutations

When adding/updating cart, Shopify can return HTML for sections in the same request. This avoids a second round-trip.

### Step 1: Append section IDs to FormData before the add-to-cart fetch
```javascript
const ids = [...document.querySelectorAll("cart-items-component")]
  .filter((item) => item instanceof HTMLElement && item.dataset.sectionId)
  .map((item) => item.dataset.sectionId);
if (ids.length) formData.append("sections", ids.join(","));
```
Append **one comma-joined value** (matching `product-form.js`) — appending `sections` once per component is last-one-wins on Shopify's parser, so only the LAST section would re-render (no error, just silently stale UI).

### Step 2: Shopify returns `response.sections` — a map of sectionId → HTML string
```javascript
// response.sections = { "cart-drawer": "<div id='shopify-section-cart-drawer'>...</div>" }
if (response.sections) {
  this.dispatchEvent(
    new CartAddEvent({}, itemId, {
      source: "product-form-component",
      itemCount: quantity,
      sections: response.sections,
    })
  );
}
```

### Step 3: `cart-items-component` listens and morphs with the returned HTML
```javascript
document.addEventListener(ThemeEvents.cartUpdate, (event) => {
  const sections = event.detail.data?.sections;
  if (sections?.[this.dataset.sectionId]) {
    morphSection(this.dataset.sectionId, sections[this.dataset.sectionId]);
  }
});
```

---

## `CartGroupedSections` — let components register for re-render

Used to collect all section IDs that should be fetched together. Components dispatch `CartGroupedSections`, others push their own section ID into the event:

```javascript
// Dispatcher (e.g. before a cart-clearing operation)
const event = new CartGroupedSections([]);
document.dispatchEvent(event);
const sectionIds = event.detail.sections; // populated by listeners

// Listener (any component that wants to be re-rendered)
document.addEventListener(CartGroupedSections.eventName, (event) => {
  event.detail.sections.push(getSectionId(this));
}, { signal: this.#controller.signal });
```

`getSectionId` from `@theme/utilities` extracts the section ID from an element's `data-section-id` or `.shopify-section` ID.

---

## Dispatching CART events — on `this`, not `document`

**Scope: `CartAddEvent` / `CartUpdateEvent` / `CartErrorEvent` dispatched from a component.** They bubble (`bubbles: true`), so dispatch from `this` and the origin stays traceable:

```javascript
this.dispatchEvent(new CartAddEvent(...));  // correct
document.dispatchEvent(new CartAddEvent(...));  // avoid
```

Exception — **`CartGroupedSections` is a document-level COLLECTOR by design** (see above): the dispatcher `document.dispatchEvent`s it so every listener across the page can push its section id. That pattern is correct, not a violation of this rule.

---

## Common mistakes

- **Using `"json"` type with `FormData`** — Content-Type header mismatch; add-to-cart returns 400
- **Treating `CartAddEvent.itemCount` as absolute** — it's a delta; using it as total causes count to drift
- **Not appending `sections` to FormData** — forces a second round-trip fetch for cart HTML; sections not re-rendered
- **Dispatching `CartUpdateEvent` without `source`** — cart drawer may open unexpectedly when quantity is updated from inside it
- **Reading `response.sections` on a 422 error** — Shopify does NOT return sections on 422 errors; always null-check and re-render via one batched `?sections=<id,id>` fetch, reading counts from the returned HTML (no `cart.js` round-trip)

---

## Checklist

- [ ] Cart API routes from `FoxTheme.routes` — not hardcoded
- [ ] `fetchConfig("javascript", ...)` for FormData; `fetchConfig("json", ...)` for JSON body
- [ ] `isIncremental` checked before updating cart count
- [ ] `response.sections` null-checked; on 422/missing sections, re-render via one batched `?sections=` fetch (no `cart.js` round-trip)
- [ ] `source` set in event data when dispatching from inside the drawer
- [ ] `CartGroupedSections` listener present if component should be re-rendered alongside cart operations
- [ ] Events dispatched on `this`, not `document`
- [ ] `{ signal }` from the component's AbortController passed to `document.addEventListener` calls too — same rule as element listeners (the abort in `disconnectedCallback` removes them; no manual `removeEventListener` needed)
