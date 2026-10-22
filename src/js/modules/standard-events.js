import { CartGroupedSections, CartUpdateEvent } from "@theme/events";
import { morphSection } from "@theme/section-renderer";
import { fetchConfig } from "@theme/utilities";

/**
 * @capability Bridge to Shopify's Standard Storefront Events & Actions (shopify.dev/docs/api/storefront-events-and-actions) — dispatch helpers that emit the standard `shopify:cart:*` DOM events (lines-update, note-update, discount-update, error) plus the interaction events (product:select, collection:update, search:update) from the theme's own cart mutations so apps/agents get the standard payloads, plus the theme-side handlers behind `Shopify.actions.openCart` / `Shopify.actions.updateCart` (configured from an inline script in snippets/scripts.liquid) so an app-triggered cart change re-renders through the house section machinery instead of a full page reload.
 * @when Any NEW cart mutation path (a component that POSTs to /cart/add, /cart/change or /cart/update) must also dispatch the matching standard event via these helpers — alongside, never instead of, the ThemeEvents Cart*Event. Do NOT dispatch a standard cart event for a change made through `Shopify.actions.updateCart`: the action runtime auto-emits those itself (listeners would see it twice).
 * @contract import { dispatchCartLinesUpdate, dispatchCartNoteUpdate, dispatchCartDiscountUpdate, dispatchCartAttributesUpdate, dispatchCartError, resolveCartResult, rejectCartResult, settleCartResponse, postCartLines, getAjaxError, contextFor, toMerchandiseGid, refreshCart, ACTION_SOURCE } from "@theme/standard-events". Dispatch helpers return { promise, resolve, reject, settled } handles (or null when the payload can't be built) — settle them via resolveCartResult(handles, { userErrors | warnings }) on completion or rejectCartResult(handles | handles[], target, error) on a network failure (ONE shopify:cart:error per request; already-settled handles are skipped). A theme-made line change (gift sync, quick order) goes through postCartLines so it carries its event. refreshCart() re-renders every cart section in place and emits a CartUpdateEvent whose source is ACTION_SOURCE for an app's updateCart — listeners use it to leave the app's change alone. The event classes come from the Shopify-CDN library mapped as "@shopify/standard-events" in the import map (snippets/scripts.liquid); if the CDN import fails every helper degrades to a silent no-op, so cart flows never depend on it. View events: render snippets/standard-view-event.liquid; the element itself, and shopify:page:view, are set up in snippets/scripts.liquid.
 * @keywords standard events, storefront events, storefront actions, Shopify.actions, openCart, updateCart, getCart, shopify:cart:lines-update, shopify:cart:note-update, shopify:cart:discount-update, shopify:cart:error, shopify:product:select, shopify:collection:update, shopify:search:update, shopify:cart:attributes-update, shopify:page:view, shopify:product:view, product filters mapping, sort key mapping, app integration, agent integration
 */

/** @type {Promise<object | null> | undefined} */
let libPromise;

/**
 * Lazily imports the standard events library from the Shopify CDN
 * (mapped as "@shopify/standard-events" in the import map).
 * Resolves to null when the library can't be loaded — callers no-op.
 * @returns {Promise<object | null>}
 */
function loadLib() {
  if (!libPromise) {
    libPromise = import("@shopify/standard-events").catch((error) => {
      console.warn("[standard-events] library unavailable:", error);
      return null;
    });
  }
  return libPromise;
}

/**
 * @typedef {object} StandardEventHandles
 * @property {Promise<object>} promise - The promise carried by the dispatched event.
 * @property {(result: object) => void} resolve
 * @property {(error: Error) => void} reject
 * @property {boolean} [settled] - Set once a helper starts settling the handles: an error thrown by
 *   the code that runs after a request succeeded must not turn into a reject + `shopify:cart:error`.
 */

/** @returns {StandardEventHandles} */
function createHandles() {
  let resolve = () => {};
  let reject = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The event's listeners get their own rejection; our internal reference
  // must never surface as an unhandled rejection.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * Loads the library and dispatches the event `build` constructs.
 * @param {EventTarget | null | undefined} target
 * @param {(lib: object, promise: Promise<object>) => Event} build
 * @returns {StandardEventHandles}
 */
function dispatchWithHandles(target, build) {
  const handles = createHandles();
  loadLib().then((lib) => {
    if (!lib) return;
    try {
      const event = build(lib, handles.promise);
      // The library hands listeners a promise DERIVED from ours (`.then` for
      // lines/note/discount), so a rejection surfaces there too — keep it out
      // of the console as an `Uncaught (in promise)` when nobody listens.
      /** @type {any} */ (event).promise?.catch?.(() => {});
      (target || document).dispatchEvent(event);
    } catch (error) {
      console.warn("[standard-events] dispatch failed:", error);
    }
  });
  return handles;
}

/**
 * Dispatches `shopify:cart:lines-update`.
 * @param {EventTarget | null} target - The element the interaction happened on.
 * @param {object} payload
 * @param {'add' | 'remove' | 'update'} payload.action
 * @param {'product' | 'cart' | 'dialog'} payload.context
 * @param {Array<{merchandiseId?: string, id?: string, quantity?: number}>} payload.lines - `merchandiseId` (variant GID) for adds; `id` (cart line key) for update/remove.
 * @returns {StandardEventHandles | null}
 */
export function dispatchCartLinesUpdate(target, { action, context, lines }) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return dispatchWithHandles(
    target,
    (lib, promise) => new lib.CartLinesUpdateEvent({ action, context, lines, promise })
  );
}

/**
 * Dispatches `shopify:cart:note-update`.
 * @param {EventTarget | null} target
 * @param {object} payload
 * @param {'cart' | 'dialog'} payload.context
 * @param {string} payload.note - Empty string clears the note.
 * @returns {StandardEventHandles}
 */
export function dispatchCartNoteUpdate(target, { context, note }) {
  return dispatchWithHandles(target, (lib, promise) => new lib.CartNoteUpdateEvent({ context, note, promise }));
}

/**
 * Dispatches `shopify:cart:discount-update`. Send the COMPLETE desired code
 * set — it replaces the existing codes rather than appending.
 * @param {EventTarget | null} target
 * @param {object} payload
 * @param {Array<{code: string}>} payload.discountCodes
 * @returns {StandardEventHandles}
 */
export function dispatchCartDiscountUpdate(target, { discountCodes }) {
  return dispatchWithHandles(target, (lib, promise) => new lib.CartDiscountUpdateEvent({ discountCodes, promise }));
}

/**
 * Dispatches `shopify:cart:attributes-update`. Send the COMPLETE attribute set
 * the cart will hold — a key left out reads to listeners as removed.
 * @param {EventTarget | null} target
 * @param {object} payload
 * @param {'product' | 'cart' | 'dialog'} payload.context
 * @param {Record<string, unknown>} payload.attributes - Every cart attribute, as `cart.attributes` holds them.
 * @returns {StandardEventHandles}
 */
export function dispatchCartAttributesUpdate(target, { context, attributes }) {
  const list = Object.entries(attributes).map(([key, value]) => ({ key, value: value == null ? "" : String(value) }));
  return dispatchWithHandles(
    target,
    (lib, promise) => new lib.CartAttributesUpdateEvent({ context, attributes: list, promise })
  );
}

/**
 * POSTs a line change the THEME makes on its own (gift wrap sync, quick order
 * list…) with its `shopify:cart:lines-update`, so apps see every request that
 * changes the cart — not only the ones a buyer clicked. Resolves with the
 * parsed response; a declined change resolves the event with `userErrors`,
 * a failed request rejects both (and emits `shopify:cart:error`).
 * @param {EventTarget | null} target
 * @param {object} options
 * @param {string} options.url - A `/cart/*.js` route.
 * @param {object} options.body - The JSON body.
 * @param {Parameters<typeof dispatchCartLinesUpdate>[1]} options.event - The lines-update payload.
 * @returns {Promise<any>}
 */
export async function postCartLines(target, { url, body, event }) {
  const handles = dispatchCartLinesUpdate(target, event);
  try {
    const response = await fetch(url, fetchConfig("json", { body: JSON.stringify(body) }));
    const parsed = await response.json().catch(() => null);
    if (response.status >= 500) {
      throw new Error(getAjaxError(parsed) || `Cart request failed: ${response.status}`);
    }
    const message = getAjaxError(parsed);
    resolveCartResult(handles, message ? { userErrors: [{ code: "INVALID", message }] } : {});
    return parsed;
  } catch (error) {
    rejectCartResult(handles, target, error);
    throw error;
  }
}

/**
 * Dispatches `shopify:cart:error`. Only for a request that actually FAILED
 * (network error / rejected promise) — a cart that declines a change resolves
 * with `userErrors` instead and gets no error event.
 * @param {EventTarget | null} target
 * @param {object} payload
 * @param {string} payload.error - Human-readable failure description.
 * @param {string} [payload.code] - A Storefront API CartErrorCode.
 */
export function dispatchCartError(target, { error, code = "INVALID" }) {
  loadLib().then((lib) => {
    if (!lib) return;
    try {
      (target || document).dispatchEvent(new lib.CartErrorEvent({ error, code }));
    } catch (dispatchError) {
      console.warn("[standard-events] error dispatch failed:", dispatchError);
    }
  });
}

/**
 * Resolves a dispatched event's promise with the standard result shape.
 * The cart is read back through `Shopify.actions.getCart()` (deduped by the
 * runtime) so listeners get the exact StandardEventCart shape; resolves with
 * `cart: null` when the action isn't available or the read fails.
 * @param {StandardEventHandles | null} handles
 * @param {object} [extra]
 * @param {Array<{code: string, message: string, field?: string[]}>} [extra.userErrors]
 * @param {Array<object>} [extra.warnings]
 */
export async function resolveCartResult(handles, { userErrors = [], warnings = [] } = {}) {
  if (!handles || handles.settled) return;
  // Settled from here on, before the getCart round-trip: a later failure in
  // the caller is not a failed cart request (see rejectCartResult).
  handles.settled = true;
  let cart = null;
  try {
    const actions = window.Shopify?.actions;
    if (actions?.getCart) {
      const result = await actions.getCart();
      cart = result?.cart ?? null;
      // getCart can hand back `lines` as a GraphQL connection ({ nodes: [...] })
      // while the event schema expects CartLine[] — the dev runtime's resolved-
      // value validation then throws (.map on a non-array) and rejects the
      // event promise. Normalize before resolving.
      if (cart && cart.lines && !Array.isArray(cart.lines) && Array.isArray(cart.lines.nodes)) {
        cart = { ...cart, lines: cart.lines.nodes };
      }
    }
  } catch (error) {
    // cart stays null — the resolution itself must never fail.
  }
  handles.resolve({ cart, userErrors, warnings });
}

/**
 * Rejects a dispatched event's promise after a request failure and emits the
 * matching `shopify:cart:error`. Pass an AbortError to skip the error event
 * (an aborted request is a cancellation, not a failure). Handles that already
 * settled are left alone — the request succeeded, so whatever threw after it
 * is not a cart error. Pass `null` handles for a request that opened no event,
 * or an array for one request that opened several — it still reports ONE
 * `shopify:cart:error`.
 * @param {StandardEventHandles | null | Array<StandardEventHandles | null>} handles
 * @param {EventTarget | null} target
 * @param {unknown} error
 */
export function rejectCartResult(handles, target, error) {
  const list = (Array.isArray(handles) ? handles : [handles]).filter((item) => item != null);
  if (list.length > 0 && list.every((item) => item.settled)) return;
  const normalized = error instanceof Error ? error : new Error(String(error));
  for (const item of list) {
    if (item.settled) continue;
    item.settled = true;
    item.reject(normalized);
  }
  if (normalized.name === "AbortError") return;
  dispatchCartError(target, { error: normalized.message || "Cart request failed", code: "SERVICE_UNAVAILABLE" });
}

/**
 * The message of an AJAX cart error response, or null when the response is a
 * cart (or any other success body).
 * @param {any} state - Parsed JSON from a /cart/*.js request.
 * @returns {string | null}
 */
export function getAjaxError(state) {
  if (!state || typeof state !== "object") return null;
  if (state.status) return state.description || state.message || String(state.status);
  if (state.errors) {
    return typeof state.errors === "string" ? state.errors : Object.values(state.errors).flat().join(" ");
  }
  return null;
}

/**
 * Settles a cart event from a `/cart/*.js` response the caller has not read
 * yet: a server failure (5xx) rejects with a `shopify:cart:error`, a declined
 * change (4xx) resolves with `userErrors`, anything else resolves plainly.
 * Returns the parsed body (or null when it was not JSON) so the caller can
 * carry on with it.
 * @param {StandardEventHandles | null} handles
 * @param {EventTarget | null} target
 * @param {Response} response
 * @returns {Promise<any>}
 */
export async function settleCartResponse(handles, target, response) {
  const body = await response.json().catch(() => null);
  if (response.status >= 500) {
    rejectCartResult(handles, target, new Error(getAjaxError(body) || `Cart request failed: ${response.status}`));
  } else if (!response.ok) {
    const message = getAjaxError(body) || `Cart request failed: ${response.status}`;
    resolveCartResult(handles, { userErrors: [{ code: "INVALID", message }] });
  } else {
    resolveCartResult(handles);
  }
  return body;
}

/**
 * Standard-event `context` for an interaction: 'dialog' inside any <dialog>
 * (cart drawer, quick view), else the given fallback.
 * @param {Element | null} element
 * @param {'product' | 'cart'} fallback
 * @returns {'product' | 'cart' | 'dialog'}
 */
export function contextFor(element, fallback) {
  return element?.closest?.("dialog") ? "dialog" : fallback;
}

/**
 * @param {string | number} variantId
 * @returns {string} The variant GID standard events expect as `merchandiseId`.
 */
export function toMerchandiseGid(variantId) {
  return `gid://shopify/ProductVariant/${variantId}`;
}

/**
 * `CartUpdateEvent` source for a re-render that follows an app's
 * `Shopify.actions.updateCart`. Listeners that react to the buyer's own cart
 * changes (the drawer's auto-open, gift wrap sync) check it so they neither
 * treat the app's change as a theme "added to cart" nor undo it.
 */
export const ACTION_SOURCE = "standard-action";

/**
 * Theme handler behind `Shopify.actions.openCart` (configured in
 * snippets/scripts.liquid). Closes an open quick view first (the drawer would
 * otherwise stack over it), then opens the cart drawer. Without a drawer —
 * cart type "page", or the cart page itself, where the drawer section renders
 * nothing — it scrolls to the cart on the cart page and navigates there
 * anywhere else. Resolves once the drawer is open.
 */
export async function openCartHandler() {
  const drawer = /** @type {any} */ (document.querySelector("cart-drawer-component"));
  if (drawer && typeof drawer.showDialog === "function") {
    const openQuickViews = [...document.querySelectorAll("quick-view-dialog")].filter(
      (dialog) => /** @type {any} */ (dialog).refs?.dialog?.open
    );
    await Promise.all(openQuickViews.map((dialog) => /** @type {any} */ (dialog).closeDialog()));
    drawer.showDialog();
    return;
  }

  const cartUrl = window.FoxTheme?.routes?.cart_url || "/cart";
  if (window.location.pathname === cartUrl) {
    document.querySelector("cart-items-component")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  window.location.href = cartUrl;
}

/** @type {AbortController | null} */
let refreshController = null;

/**
 * Re-renders every cart-aware section from the server and notifies the theme
 * through a CartUpdateEvent carrying the fresh cart (so listeners skip their
 * own /cart.js read). A newer call aborts an older one still in flight, so two
 * quick updates can't morph out of order. Rejects on failure — an AbortError
 * when superseded.
 *
 * Sections are requested from the CURRENT page: they render in the context of
 * the URL they come from, and `/cart.js` ignores `sections`.
 * @param {object} [options]
 * @param {string} [options.source] - Carried as the CartUpdateEvent `source`.
 * @returns {Promise<object>} The AJAX cart.
 */
export async function refreshCart({ source = ACTION_SOURCE } = {}) {
  refreshController?.abort();
  const controller = new AbortController();
  refreshController = controller;
  const { signal } = controller;

  /** @type {string[]} */
  const sectionIds = [];
  document.dispatchEvent(new CartGroupedSections(sectionIds));
  const ids = [...new Set(sectionIds)];

  const readJson = (/** @type {Response} */ response) => {
    if (!response.ok) throw new Error(`Cart refresh request failed: ${response.status}`);
    return response.json();
  };
  const [cart, sections] = await Promise.all([
    fetch(window.FoxTheme?.routes?.cart || "/cart.js", { signal }).then(readJson),
    ids.length > 0 ? fetch(`${window.location.pathname}?sections=${ids.join(",")}`, { signal }).then(readJson) : null,
  ]);

  // A newer refresh started while this one was fetching: it renders the
  // latest cart, so don't morph this older one over it.
  if (signal.aborted) throw new DOMException("Superseded by a newer cart refresh", "AbortError");

  // What every rendered cart line held BEFORE this render (rows carry
  // data-key + data-quantity): listeners that compare quantities — the gift
  // wrap sync telling which side of a gift pair the app changed — can't read
  // it after the morph below has replaced the rows.
  /** @type {Map<string, number>} */
  const previousQuantities = new Map();
  for (const row of document.querySelectorAll("[data-key][data-quantity]")) {
    if (row instanceof HTMLElement && row.dataset.key) {
      previousQuantities.set(row.dataset.key, Number(row.dataset.quantity));
    }
  }

  if (sections) {
    await Promise.all(Object.keys(sections).map((sectionId) => morphSection(sectionId, sections[sectionId])));
  }

  document.dispatchEvent(
    new CartUpdateEvent(cart, source, {
      itemCount: cart.item_count ?? 0,
      source,
      sections: sections || undefined,
      previousQuantities,
    })
  );
  if (refreshController === controller) refreshController = null;
  return cart;
}

/**
 * Theme handler behind `Shopify.actions.updateCart` (configured in
 * snippets/scripts.liquid). Runs the default handler (which performs the
 * mutation and auto-emits the standard cart events), then re-renders the cart
 * in place through {@link refreshCart} instead of the default full page
 * reload. A refresh that fails falls back to that reload, so the page never
 * shows a cart the server no longer has.
 * @param {() => Promise<object>} defaultHandler
 * @returns {Promise<object>}
 */
export async function updateCartHandler(defaultHandler) {
  const result = await defaultHandler();

  try {
    await refreshCart({ source: ACTION_SOURCE });
  } catch (error) {
    // Superseded by a newer refresh, which renders the latest cart.
    if (/** @type {Error} */ (error)?.name !== "AbortError") {
      console.error("[standard-events] cart re-render after updateCart failed; reloading.", error);
      window.location.reload();
    }
  }

  return result;
}

/**
 * Maps a theme variant JSON object (Shopify AJAX shape — numeric id, integer
 * cents price) to the standard ProductVariant shape carried by product:select
 * resolutions. `price.amount` is a decimal string to two places, which the
 * spec accepts for zero-decimal currencies (JPY) too.
 * @param {object | null | undefined} variant
 * @param {string[]} [optionNames] - The product's option names in position order.
 * @returns {object | null}
 */
function toStandardProductVariant(variant, optionNames = []) {
  if (!variant || !variant.id) return null;
  /** @type {Record<string, unknown>} */
  const standard = {
    id: `gid://shopify/ProductVariant/${variant.id}`,
    title: variant.title || "",
  };
  if (typeof variant.available === "boolean") standard.availableForSale = variant.available;
  if (typeof variant.price === "number") {
    standard.price = {
      amount: (variant.price / 100).toFixed(2),
      currencyCode: window.Shopify?.currency?.active || "",
    };
  }
  if (Array.isArray(variant.options) && optionNames.length === variant.options.length) {
    standard.selectedOptions = variant.options.map((value, index) => ({ name: optionNames[index], value }));
  }
  return standard;
}

/**
 * Dispatches `shopify:product:select` from the element holding the option
 * picker. Fires when the buyer changes a product option, BEFORE the variant is
 * resolved — settle via {@link resolveProductSelect}.
 * @param {EventTarget | null} target
 * @param {object} payload
 * @param {{id: string, title: string, handle: string}} payload.product - id is the product GID.
 * @param {Array<{name: string, value: string}>} payload.selectedOptions - At least one entry.
 * @returns {StandardEventHandles | null}
 */
export function dispatchProductSelect(target, { product, selectedOptions }) {
  if (!product?.id || !Array.isArray(selectedOptions) || selectedOptions.length === 0) return null;
  return dispatchWithHandles(
    target,
    (lib, promise) => new lib.ProductSelectEvent({ product, selectedOptions, promise })
  );
}

/**
 * Resolves a product:select promise. A selection with no matching variant
 * resolves with `variant: null` rather than rejecting.
 * @param {StandardEventHandles | null} handles
 * @param {object | null} [themeVariant] - The matched variant in the theme's AJAX JSON shape.
 * @param {string[]} [optionNames] - The product's option names in position order.
 */
export function resolveProductSelect(handles, themeVariant, optionNames) {
  if (!handles || handles.settled) return;
  handles.settled = true;
  handles.resolve({ variant: toStandardProductVariant(themeVariant, optionNames) });
}

/**
 * Rejects a product:select promise: an AbortError when a newer selection
 * superseded it, any other error when the variant lookup failed.
 * @param {StandardEventHandles | null} handles
 * @param {Error} error
 */
export function rejectProductSelect(handles, error) {
  if (!handles || handles.settled) return;
  handles.settled = true;
  handles.reject(error);
}

/**
 * The library's own filter/sort parsing for a collection or search URL:
 * locale-aware prices ("1.000,50"), one filter per availability value,
 * taxonomy (`filter.v.t.*`) and metafield keys that contain dots. Read from
 * the event class at dispatch time, since the library only exists once loaded.
 * @param {any} EventClass - lib.CollectionUpdateEvent or lib.SearchUpdateEvent.
 * @param {URLSearchParams} params
 * @returns {{productFilters?: object[], sortKey?: string}}
 */
function parseResultsParams(EventClass, params) {
  /** @type {{productFilters?: object[], sortKey?: string}} */
  const parsed = {};
  const productFilters = EventClass.parseProductFilters?.(params, { locale: window.Shopify?.locale });
  if (Array.isArray(productFilters) && productFilters.length > 0) parsed.productFilters = productFilters;
  const sortKey = EventClass.getSortKey?.(params);
  if (sortKey) parsed.sortKey = sortKey;
  return parsed;
}

/**
 * Dispatches `shopify:collection:update` when the buyer filters or sorts a
 * collection. Settle the handles with `{ productsCount }` once the storefront
 * has run the query.
 * @param {EventTarget | null} target
 * @param {object} payload
 * @param {{id: string | null, handle: string, productsCount: number}} payload.collection - id is the collection GID, null for built-in collections.
 * @param {URLSearchParams} payload.params - The results URL's search params (filters + sort_by).
 * @returns {StandardEventHandles | null}
 */
export function dispatchCollectionUpdate(target, { collection, params }) {
  if (!collection || typeof collection.handle !== "string") return null;
  return dispatchWithHandles(
    target,
    (lib, promise) =>
      new lib.CollectionUpdateEvent({ collection, ...parseResultsParams(lib.CollectionUpdateEvent, params), promise })
  );
}

/**
 * Dispatches `shopify:search:update` when the buyer runs a search or refines
 * its filters/sort. Settle the handles with `{ totalCount }`.
 * @param {EventTarget | null} target
 * @param {object} payload
 * @param {string} payload.query
 * @param {URLSearchParams} [payload.params] - The results URL's search params (filters + sort_by).
 * @returns {StandardEventHandles | null}
 */
export function dispatchSearchUpdate(target, { query, params = new URLSearchParams() }) {
  return dispatchWithHandles(target, (lib, promise) => {
    const { productFilters, sortKey } = parseResultsParams(lib.SearchUpdateEvent, params);
    /** @type {Record<string, unknown>} */
    const search = { query: query || "", sortKey: sortKey || "RELEVANCE" };
    if (productFilters) search.productFilters = productFilters;
    return new lib.SearchUpdateEvent({ search, promise });
  });
}
