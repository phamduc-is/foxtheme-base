# JavaScript events & actions

This theme implements Shopify's
[Standard Storefront Events & Actions](https://shopify.dev/docs/api/storefront-events-and-actions)
— the platform-standard JavaScript API for storefronts. Code written against it
works on this theme and on any other theme that adopts the standard.

The API has two halves, and they answer two different questions:

|                | **Actions** — _you call the storefront_                          | **Events** — _the storefront tells you_                              |
| -------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Direction      | Your code → theme                                                | Theme → your code                                                    |
| Shape          | `await Shopify.actions.*()`                                      | `document.addEventListener('shopify:…', handler)`                    |
| Use it to      | Read the cart, change the cart, open the cart drawer             | React when the buyer views, selects, filters, adds, removes…         |
| Typical caller | An app embed, upsell widget, custom script that _does_ something | A widget that _reacts_ (badge, notification, analytics-free UI sync) |

Quick chooser:

- "I want to **add something to the cart** from my own button" → **Action** (`updateCart`)
- "I want to **know when** the buyer adds to cart" → **Event** (`shopify:cart:lines-update`)
- "I want to **open the cart drawer**" → **Action** (`openCart`)
- "I want to **react to filtering** on a collection" → **Event** (`shopify:collection:update`)
- The standard doesn't cover it (quick view, re-init after grid re-render) → **[Theme events](#theme-events)**

---

## Actions — `Shopify.actions.*`

Available on **every page, with no setup** — Shopify ships the runtime, and this
theme configures it so that a cart change **re-renders every cart surface in
place** (drawer, cart page, header badge) with **no page reload**, through the
same section-rendering machinery the theme's own UI uses.

### `getCart()` — read the cart

```js
const { cart } = await Shopify.actions.getCart();

// cart is null when the buyer has no cart yet
console.log(cart?.totalQuantity, cart?.cost.totalAmount.amount);
```

The resolved `cart` is a `CartSummary`:

| Field           | Type              | Notes                                                         |
| --------------- | ----------------- | ------------------------------------------------------------- |
| `id`            | `string`          | Cart GID (`gid://shopify/Cart/…`)                             |
| `totalQuantity` | `number`          | Items across all lines                                        |
| `cost`          | `{ totalAmount }` | `totalAmount: { amount, currencyCode }`                       |
| `lines`         | `CartLine[]`      | Each line: `id` (line GID), `quantity`, `cost`, `merchandise` |
| `discountCodes` | `array`           | Codes currently on the cart                                   |

### `updateCart(payload)` — change the cart

One call covers **add, update quantity, remove, set the note, set discount
codes, and set cart attributes**. The payload:

| Field           | Type              | Meaning                                                                                |
| --------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `lines`         | `CartLineInput[]` | Lines to add/update/remove — see below                                                 |
| `note`          | `string`          | New cart note (empty string clears it)                                                 |
| `discountCodes` | `string[]`        | The **complete** set of codes the cart should end up with (replaces, does not append)  |
| `attributes`    | `array`           | The **complete** set of cart attributes (`{ key, value }`), replacing the existing set |
| `cartId`        | `string`          | Optional — omitted, the action finds the cart from the browser cookie                  |

Each `CartLineInput`:

- **Add**: `{ merchandiseId, quantity }` — `merchandiseId` is the variant GID
  (`gid://shopify/ProductVariant/123`) or a raw numeric variant id. No `id`.
- **Update**: `{ id, quantity }` — `id` is the **existing line id** (read it
  from `getCart().cart.lines[n].id`).
- **Remove**: `{ id, quantity: 0 }`.

```js
// Add a variant
await Shopify.actions.updateCart({
  lines: [{ merchandiseId: "gid://shopify/ProductVariant/123456789", quantity: 1 }],
});

// Change a line's quantity, or remove it with quantity: 0
const { cart } = await Shopify.actions.getCart();
await Shopify.actions.updateCart({
  lines: [{ id: cart.lines[0].id, quantity: 3 }],
});

// Note / discounts / attributes
await Shopify.actions.updateCart({ note: "Please gift wrap" });
await Shopify.actions.updateCart({ discountCodes: ["WELCOME10"] }); // [] clears
```

**Always read the result** — the cart can refuse a change without the call
failing:

```js
const { cart, userErrors, warnings } = await Shopify.actions.updateCart({
  lines: [{ merchandiseId: "gid://shopify/ProductVariant/123", quantity: 99 }],
});

if (userErrors?.length) {
  // The change did NOT apply (sold out, above maximum, invalid input…).
  showMessage(userErrors[0].message);
  return;
}
if (warnings?.length) {
  // The change applied WITH an adjustment (e.g. capped at available stock).
  showMessage(warnings[0].message);
}
updateBadge(cart.totalQuantity);
```

The promise itself **rejects only when the request couldn't run at all**
(network failure, malformed payload) — handle that with `try/catch`.

Two side effects worth knowing:

- The theme re-renders every cart surface in place — you do **not** need to
  refresh anything yourself. It does **not** open the cart drawer: call
  `openCart()` when you want it shown.
- The runtime auto-emits the matching standard events (`shopify:cart:lines-update`
  etc.) with `context: 'standard-action'` — if you also listen to those events,
  don't handle your own call twice.

### `openCart()` — show the cart

```js
await Shopify.actions.openCart();
```

Opens the cart drawer (closing an open quick view first) and resolves once it
is open. Without a drawer — cart type "page" — it navigates to `/cart`; on the
cart page itself it scrolls to the cart instead. A common pair:
`updateCart(...)` then `openCart()`.

---

## Standard storefront events — `shopify:*`

All standard events **bubble to `document`**, so one listener catches them
wherever they were dispatched:

```js
document.addEventListener("shopify:cart:lines-update", (event) => {
  console.log(event.action, event.context, event.lines);
});
```

They come in two kinds — read this once, it explains every table below:

1. **View events** — report something that already happened. No promise; the
   payload is complete when the event fires.
2. **Operation events** — fire **when the operation starts**, before there is a
   result. They carry a **`promise`** that settles when it finishes:
   - The promise **resolves** even when the cart _declines_ the change — read
     `userErrors` on the resolution to know.
   - The promise **rejects** only when the request _fails_ (network error), and
     `shopify:cart:error` is dispatched alongside.

### View events (no promise)

| Event                     | Fires when                                                                                                                                                                                                                                       | Payload                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `shopify:page:view`       | Once on every page load, after `DOMContentLoaded` and before any other view event                                                                                                                                                                | `page` — `template` (the page type), `title`, `url`  |
| `shopify:product:view`    | The main product renders on a product page (`context: 'page'`); a quick view opens (`'dialog'`, on **each** open); half of a product card scrolls into view (`'collection'`, `'search'` or `'recommendation'` — never from menus, once per card) | `product` — `id` (GID), `title`, `handle`; `context` |
| `shopify:collection:view` | The buyer lands on a collection page                                                                                                                                                                                                             | `collection` — `id` (GID), `handle`, `productsCount` |
| `shopify:cart:view`       | The cart page loads (`context: 'page'`), or the cart drawer opens (`context: 'dialog'`, fires on **each** open)                                                                                                                                  | `cart`, `context`                                    |

`shopify:page:view` fires as soon as the document is ready — register its
listener **synchronously at script load**, or you'll miss it. All view events
come from the Shopify-CDN standard events library, loaded without blocking the
page: when it can't load, the theme works as usual and simply reports no views.

### Operation events (with promise)

| Event                            | Fires when                                                                                           | Key payload                                     | `promise` resolves with                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `shopify:cart:lines-update`      | Lines are added / updated / removed                                                                  | `action`, `context`, `lines`                    | `{ cart, userErrors, warnings }`                           |
| `shopify:cart:note-update`       | The cart note changes                                                                                | `note`, `context`                               | `{ cart, userErrors, warnings }`                           |
| `shopify:cart:discount-update`   | Discount codes change (payload = the complete new set)                                               | `discountCodes: [{ code }]`                     | `{ cart, userErrors, warnings }`                           |
| `shopify:cart:attributes-update` | Cart attributes change (the gift note; payload = the complete set)                                   | `attributes: [{ key, value }]`, `context`       | `{ cart, userErrors, warnings }`                           |
| `shopify:product:select`         | The buyer changes a product option                                                                   | `product`, `selectedOptions: [{ name, value }]` | `{ variant }` — `null` when the combination has no variant |
| `shopify:collection:update`      | The buyer filters or sorts a collection                                                              | `collection`, `productFilters`, `sortKey`       | `{ productsCount }`                                        |
| `shopify:search:update`          | The buyer types in predictive search, or changes filters/sort on the results page (not on page load) | `search` — `query`, `productFilters`, `sortKey` | `{ totalCount }`                                           |

And the error signal (no promise — it IS the failure notification):

| Event                | Fires when                                                                    | Payload                                       |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `shopify:cart:error` | A cart **request fails** (network/server error — never for a declined change) | `error` (message), `code` (a `CartErrorCode`) |

#### `shopify:cart:lines-update` in detail

The one event for every cart line change; `action` (`'add' | 'update' |
'remove'`) says which, `context` says where it came from: `'product'` (product
page form), `'cart'` (cart page), `'dialog'` (drawer / quick view), or
`'standard-action'` (an `updateCart` call — see above). `lines` entries carry
`merchandiseId` (adds) or `id` (the line being updated/removed) plus `quantity`.
It also fires for the changes the theme makes on its own — gift wrap lines
kept in step with the products they wrap, the quick order list — so every
request that changes the cart has its event.

```js
document.addEventListener("shopify:cart:lines-update", (event) => {
  showSpinner(); // the operation just STARTED

  event.promise
    .then(({ cart, userErrors, warnings }) => {
      if (userErrors?.length) return showMessage(userErrors[0].message); // declined
      if (warnings?.length) showMessage(warnings[0].message); // applied with adjustment
      updateBadge(cart?.totalQuantity); // cart is null when no cart exists
    })
    .catch(() => showMessage("We couldn't reach the store. Try again."))
    .finally(hideSpinner);
});
```

#### `shopify:product:select` in detail

Fires immediately on the option change — before the matching variant is known.
The promise resolves with the variant (`id` GID, `title`, `availableForSale`,
`price: { amount, currencyCode }`, `selectedOptions`), or `variant: null` when
the chosen combination doesn't exist. It **rejects** with an `AbortError` when
a newer selection overtakes it (the buyer clicked again before the first
resolved) and with a plain error when the lookup fails — so `null` always
means "no such variant", never "not looked up".

```js
document.addEventListener("shopify:product:select", (event) => {
  console.log(event.product.handle, event.selectedOptions); // [{ name: "Color", value: "Blue" }, …]
  event.promise.then(({ variant }) => {
    if (!variant) return markUnavailable();
    updatePrice(variant.price.amount, variant.price.currencyCode);
  });
});
```

#### `shopify:collection:update` / `shopify:search:update` in detail

Both fire **before** the filtered results are fetched; the promise resolves with
the result count once the grid has been updated — an update a newer filter
change overtakes still resolves, with its own query's count. `productFilters` are
parsed by the standard library itself (locale-aware prices, taxonomy
categories, metafield keys containing dots) into the Storefront API
`ProductFilter` shapes:

| Filter              | Shape                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Availability        | `{ available: true }`                                                     |
| Price range         | `{ price: { min: 10, max: 50 } }`                                         |
| Vendor / type / tag | `{ productVendor: "…" }`, `{ productType: "…" }`, `{ tag: "…" }`          |
| Variant option      | `{ variantOption: { name: "Color", value: "Blue" } }`                     |
| Category            | `{ category: { id: "gid://shopify/TaxonomyCategory/…" } }`                |
| Metafield           | `{ productMetafield: { namespace, key, value } }` (or `variantMetafield`) |

`sortKey` is the standard enum (`MANUAL`, `BEST_SELLING`, `TITLE`, `PRICE`,
`CREATED` — searches only `RELEVANCE` or `PRICE`); it carries no direction, so
ascending/descending collapse into one value.

```js
document.addEventListener("shopify:collection:update", (event) => {
  console.log(event.collection.handle, event.productFilters, event.sortKey);
  event.promise.then(({ productsCount }) => updateResultBar(productsCount));
});
```

Note: `shopify:collection:update` fires **before** the new grid HTML lands in
the DOM. To re-initialize widgets **after** the grid is re-rendered, use the
theme event [`collection:rerendered`](#theme-events) instead.

### Good to know

- **Not for analytics.** Standard events fire regardless of the buyer's
  tracking consent. Use [web pixels](https://shopify.dev/docs/apps/build/marketing-analytics/pixels)
  for analytics.
- **Development validation.** `shopify theme dev` serves a runtime that
  validates every payload and logs problems with a `[Shopify Standard Events]`
  console prefix; `yarn start:events` adds `--standard-events-inspector` for a
  live event panel (on `127.0.0.1:<port>` only).
- The theme dispatches every event above from its own UI flows,
  `shopify:page:view` included; cart changes made through
  `Shopify.actions.updateCart` are emitted by the runtime itself
  (`context: 'standard-action'`).

---

## Theme events

FoxTheme's own events, for behaviours the standard doesn't describe. Same
listening pattern — they bubble to `document`.

| Event                    | Fires when                                                                                                                                                                                                          | Payload                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `quick-view:open`        | The quick-view modal/drawer opens                                                                                                                                                                                   | `detail.productUrl`                       |
| `quick-view:loaded`      | The quick-view content finishes loading (first open per product)                                                                                                                                                    | `detail.productUrl`                       |
| `variant:changed`        | The selected variant's UI has been updated (price, media, buttons). For reacting to the _selection itself_, prefer `shopify:product:select` — it fires earlier and resolves with the matched variant.               | `detail.variant` (Shopify variant object) |
| `collection:rerendered`  | The collection/search grid has been **re-rendered in the DOM** after a filter/sort change — the moment to re-initialize badges/widgets. (`shopify:collection:update` fires _before_ the fetch; this fires _after_.) | —                                         |
| `recommendations:loaded` | Product recommendations / recently-viewed products load dynamically                                                                                                                                                 | —                                         |
| `page:loaded`            | The page-transition overlay finishes revealing the page. ⚠️ Dispatched only when **page transitions** are enabled in theme settings — for a setting-independent hook use `DOMContentLoaded` or `shopify:page:view`. | —                                         |

```js
document.addEventListener("collection:rerendered", () => {
  reinitializeThirdPartyBadges();
});

document.addEventListener("quick-view:open", (event) => {
  console.log(event.detail.productUrl);
});
```

### Legacy theme events

Still emitted for backward compatibility — new code should use the standard
replacement:

| Legacy event                                 | Use instead                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `product-ajax:added` (`detail.product`)      | `shopify:cart:lines-update` with `action: 'add'` — the resolved promise carries the cart |
| `product-ajax:error` (`detail.errorMessage`) | `userErrors` on the lines-update resolution, or `shopify:cart:error` for hard failures   |
| `cart:updated` (`detail.cart`)               | `shopify:cart:lines-update` / `Shopify.actions.getCart()`                                |
