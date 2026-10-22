import { Component } from "@theme/component";
import {
  CartGroupedSections,
  CartUpdateEvent,
  DiscountUpdateEvent,
  QuantitySelectorUpdateEvent,
  ThemeEvents,
} from "@theme/events";
import { morphSection, sectionRenderer } from "@theme/section-renderer";
import { debounce, fetchConfig, getFocusableElements, takePendingCartLineError } from "@theme/utilities";
import {
  ACTION_SOURCE,
  contextFor,
  dispatchCartLinesUpdate,
  postCartLines,
  rejectCartResult,
  resolveCartResult,
  toMerchandiseGid,
} from "@theme/standard-events";

/** @typedef {import('./utilities').TextComponent} TextComponent */

/**
 * A custom element that displays a cart items component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} quantitySelectors - The quantity selector elements.
 * @property {HTMLTableRowElement[]} cartItemRows - The cart item rows.
 * @property {TextComponent} cartTotal - The cart total.
 *
 * @extends {Component<Refs>}
 */
class CartItemsComponent extends Component {
  /**
   * One debouncer per cart line. A single shared debouncer would drop a line's
   * update whenever another line fired within the window — blur line 1, then
   * touch line 2 inside 300ms, and line 1 never reached /cart/change.
   * @type {Map<number, ReturnType<typeof debounce>>}
   */
  #quantityDebouncers = new Map();
  #timeout = 5000;
  #pendingError = null; // { lineKey, variantId, message, timeoutId }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#onQuantitySelectorUpdate);
    document.addEventListener(CartGroupedSections.eventName, this.#onGroupedSections);
    window.addEventListener("pageshow", this.#onPageShow);

    // An add-to-cart error raised on another page (a product card's quick-add,
    // with `cart_type: page`) is shown here, under the line it belongs to.
    const handedOverError = takePendingCartLineError();
    if (handedOverError) this.showLineError(handedOverError);
  }

  disconnectedCallback() {
    for (const debounced of this.#quantityDebouncers.values()) debounced.cancel();
    this.#quantityDebouncers.clear();

    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#onQuantitySelectorUpdate);
    document.removeEventListener(CartGroupedSections.eventName, this.#onGroupedSections);
    window.removeEventListener("pageshow", this.#onPageShow);

    super.disconnectedCallback();
  }

  /**
   * Re-renders the cart when the page comes back from bfcache.
   *
   * Safari hands the page back exactly as it was left — no connectedCallback, no
   * re-render — so every line key, line number, quantity and price here is frozen
   * at that moment. The cart itself moved on: checkout may have changed it, and an
   * automatic discount recomputes the line keys (the id prefix survives, the hash
   * does not). Anything driven off this DOM would post a key that no longer exists
   * and come back "no valid id or line parameter". Any quantity update still
   * waiting out its debounce is dropped for the same reason — bfcache pauses those
   * timers and resumes them on restore, where their line is no longer trustworthy.
   *
   * @param {PageTransitionEvent} event
   */
  #onPageShow = (event) => {
    if (!event.persisted) return;

    for (const debounced of this.#quantityDebouncers.values()) debounced.cancel();
    this.#quantityDebouncers.clear();

    sectionRenderer.renderSection(this.sectionId, { cache: false });
  };

  /**
   * Debounces the quantity update per cart line, so lines never cancel each other.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  #onQuantitySelectorUpdate = (event) => {
    const line = Number(event.detail?.cartLine);
    const key = Number.isFinite(line) ? line : -1;

    let debounced = this.#quantityDebouncers.get(key);
    if (!debounced) {
      debounced = debounce((/** @type {QuantitySelectorUpdateEvent} */ e) => this.#onQuantityChange(e), 300);
      this.#quantityDebouncers.set(key, debounced);
    }

    debounced(event);
  };

  /**
   * Handles QuantitySelectorUpdateEvent change event.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  async #onQuantityChange(event) {
    const { quantity, cartLine: line } = event.detail;

    if (!line) return;

    if (quantity === 0) {
      return this.onLineItemRemove(line);
    }

    const lineItemRow = this.#getRowByLine(line);
    const parentKey = lineItemRow?.dataset.key;

    if (lineItemRow) {
      const removeButtons = lineItemRow.querySelectorAll("[data-cart-remove-button]");
      removeButtons?.forEach((button) => {
        button?.classList.add("btn--loading");
      });
    }

    // 1. Update parent first; Shopify may clamp the quantity to available stock.
    await this.updateQuantity({
      ...(parentKey ? { id: parentKey } : { line }),
      line,
      quantity,
      action: "change",
    });

    // 2. Sync gift wrap lines using the actual quantity that Shopify accepted,
    // not the requested one (otherwise gift line could exceed stock-clamped parent).
    // Skip the entire roundtrip when the sync-quantity setting is off, otherwise
    // the spinner would spin while inner sync calls early-return for nothing.
    if (parentKey && this.#giftSyncQuantity) {
      // Parent line key may have changed after update (e.g. discount re-allocation
      // recomputes the line key hash), so re-read it from the morphed DOM and the
      // refreshed cart before syncing gift lines.
      const refreshedRow = this.#getRowByLine(line);
      const currentParentKey = refreshedRow?.dataset.key || parentKey;

      this.#setGiftLinesLoading(true, currentParentKey);
      try {
        const cart = await this.#fetchCartJson();
        const parentItem = cart.items.find((i) => i.key === currentParentKey) || cart.items[line - 1];
        const actualQuantity = parentItem?.quantity ?? 0;
        const effectiveParentKey = parentItem?.key || currentParentKey;
        const cartAfterPerLine = await this.#updateAssociatedGiftLines(effectiveParentKey, actualQuantity, cart);
        const cartForWholeOrder = cartAfterPerLine ?? cart;
        await this.#syncWholeOrderGiftLine(effectiveParentKey, actualQuantity, cartForWholeOrder);
      } catch (error) {
        // The failed request already reported itself (shopify:cart:error).
        console.error("[cart-items] gift wrap sync failed:", error);
      } finally {
        this.#setGiftLinesLoading(false, currentParentKey);
      }
    }
  }

  /**
   * Handles the line item removal.
   * @param {number} line - The line item index.
   */
  async onLineItemRemove(line, event) {
    event?.preventDefault();

    const cartItemRowToRemove = this.#getRowByLine(line);

    if (cartItemRowToRemove) {
      const removeButtons = cartItemRowToRemove.querySelectorAll("[data-cart-remove-button]");
      removeButtons.forEach((button) => {
        button?.classList.add("btn--loading");
      });
    }

    // Remove parent first using `line` only. Do not sync whole-order gift before
    // remove: syncing can recompute line keys when automatic discounts apply/unapply,
    // then clear fails with "no valid id or line parameter". Nested per-line gift
    // children are auto-removed with the parent; reconcile whole-order gift qty
    // after remove (same order as #onQuantityChange: parent first, then sync).
    await this.updateQuantity({
      line,
      quantity: 0,
      action: "clear",
    });

    if (!this.#giftWrapPerProduct) {
      this.#setGiftLinesLoading(true);
      try {
        await this.#reconcileWholeOrderGiftAfterLineRemoval();
      } catch (error) {
        console.error("[cart-items] gift wrap sync failed:", error);
      } finally {
        this.#setGiftLinesLoading(false);
      }
    }
  }

  /**
   * Handles the per-line gift wrap checkbox toggle on a product row.
   * @param {Event} event
   */
  onPerLineGiftToggle = async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    const parentRow = input.closest("tr[data-line]");
    const lineIndex = Number(parentRow?.dataset.line);
    if (!lineIndex) return;

    this.#disableCartItems();

    const wrapper = input.closest("[data-cart-gift-wrap-line]");
    wrapper?.classList.add("is-loading");

    try {
      if (input.checked) {
        await this.#addPerLineGift(lineIndex, input);
      } else {
        await this.#removePerLineGift(lineIndex);
      }
    } catch (error) {
      console.error("[cart-items] gift wrap toggle failed:", error);
    } finally {
      wrapper?.classList.remove("is-loading");
      this.#enableCartItems();
    }
  };

  /**
   * Adds a gift-wrap child line nested under the given parent.
   *
   * Strategy: remove the parent line, then re-add parent + child together in
   * a single /cart/add.js request using `parent_id = parent.variant_id`.
   * We can't reuse the existing parent via `parent_line_key` because
   * discounted lines have volatile keys that Shopify recomputes mid-request,
   * which would break the parent-child link.
   *
   * @param {number} lineIndex - 1-based index of the parent in cart.items.
   * @param {HTMLInputElement} lineInput
   */
  async #addPerLineGift(lineIndex, lineInput) {
    await this.#removeWholeOrderFeeLinesOnly();

    const cart = await this.#fetchCartJson();
    const parentItem = cart.items[lineIndex - 1];
    if (!parentItem) {
      console.warn("Parent line not found for gift wrap toggle");
      lineInput.checked = false;
      return;
    }

    const giftVariantId = this.#giftVariantId;
    const already = cart.items.some(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key === parentItem.key
    );
    if (already) {
      await this.#refreshCartSections();
      return;
    }

    const giftQuantity = this.#giftSyncQuantity ? parentItem.quantity || 1 : 1;

    const parentPayload = {
      id: parentItem.variant_id,
      quantity: parentItem.quantity,
      properties: { ...(parentItem.properties || {}) },
    };
    const sellingPlanId = parentItem.selling_plan_allocation?.selling_plan?.id;
    if (sellingPlanId) parentPayload.selling_plan = sellingPlanId;

    await this.#postLines(FoxTheme.routes.cart_change_url, { id: parentItem.key, quantity: 0 }, "remove", [
      { id: parentItem.key, quantity: 0 },
    ]);

    const parsed = await this.#postLines(
      FoxTheme.routes.cart_add_url,
      {
        items: [
          parentPayload,
          {
            id: giftVariantId,
            quantity: giftQuantity,
            parent_id: parentItem.variant_id,
          },
        ],
        ...this.#getCartSectionsPayload(),
      },
      "add",
      [
        { merchandiseId: toMerchandiseGid(parentItem.variant_id), quantity: parentItem.quantity },
        { merchandiseId: toMerchandiseGid(giftVariantId), quantity: giftQuantity },
      ]
    );

    if (parsed.status && parsed.message) {
      /**
       * status: 422 "only N items were added" still mutates the cart; only treat as hard
       * failure when the response has no items/sections to render.
       **/
      if (parsed.status === 422) {
        if (this.#giftSyncQuantity) {
          const cartAfter = await this.#fetchCartJson();
          const giftInCart = cartAfter.items.find((i) => {
            if (Number(i.variant_id) !== giftVariantId || !i.parent_relationship?.parent_key) return false;
            const p = cartAfter.items.find((x) => x.key === i.parent_relationship.parent_key);
            return p && Number(p.variant_id) === Number(parentItem.variant_id);
          });
          const parentInCart =
            giftInCart && cartAfter.items.find((i) => i.key === giftInCart.parent_relationship.parent_key);

          if (parentInCart && giftInCart && parentInCart.quantity !== giftInCart.quantity) {
            await this.#refreshCartSections();
            this.#setGiftLinesLoading(true, parentInCart.key);
            try {
              await this.#updateAssociatedGiftLines(parentInCart.key, parentInCart.quantity, cartAfter);
            } finally {
              this.#setGiftLinesLoading(false, parentInCart.key);
            }
            return;
          }
        } else {
          // Fetch cart.js AND section HTML in parallel for instant morph
          const sectionIds = this.#gatherGroupedSectionIds();
          const sectionsData = {};
          const sectionPromises = sectionIds.map(async (sectionId) => {
            const sectionUrl = `${window.location.pathname.split("?")[0]}?section_id=${sectionId}`;
            const res = await fetch(sectionUrl);
            sectionsData[sectionId] = await res.text();
          });

          const cartPromise = fetch(FoxTheme.routes.cart).then((res) => res.json());

          Promise.all([cartPromise, ...sectionPromises])
            .then(([cart]) => {
              this.dispatchEvent(
                new CartUpdateEvent(cart, this.id, {
                  itemCount: cart.item_count || 0,
                  sections: Object.keys(sectionsData).length > 0 ? sectionsData : undefined,
                })
              );
            })
            .catch((error) => {
              console.error("Failed to fetch cart count:", error);
            });
        }
      }

      console.error(parsed.message);
      lineInput.checked = false;
      await this.#postLines(FoxTheme.routes.cart_add_url, { items: [parentPayload] }, "add", [
        { merchandiseId: toMerchandiseGid(parentItem.variant_id), quantity: parentItem.quantity },
      ]);
      await this.#refreshCartSections();
      return;
    }

    await this.#applyPerLineCartResponse(parsed);
  }

  /**
   * Removes the nested gift-wrap child of a parent line.
   *
   * We resolve the child via `parent_relationship.parent_key` against the
   * parent at `lineIndex`, so a stale DOM attribute can't point us at a
   * wrong/volatile key after a discount recompute.
   *
   * @param {number} lineIndex - 1-based index of the parent in cart.items.
   */
  async #removePerLineGift(lineIndex) {
    if (!lineIndex) return;

    const cart = await this.#fetchCartJson();
    const parent = cart.items[lineIndex - 1];
    if (!parent) return;

    const giftVariantId = this.#giftVariantId;
    const child = cart.items.find(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key === parent.key
    );
    if (!child) return;

    const parsed = await this.#postLines(
      FoxTheme.routes.cart_change_url,
      { id: child.key, quantity: 0, ...this.#getCartSectionsPayload() },
      "remove",
      [{ id: child.key, quantity: 0 }]
    );
    await this.#applyPerLineCartResponse(parsed);
  }

  /**
   * Removes standalone (whole-order) gift-wrap fee lines. Nested per-line
   * children are untouched. Called before adding a per-line gift so the cart
   * cannot end up in a mixed state when the setting was previously the other mode.
   */
  async #removeWholeOrderFeeLinesOnly() {
    const variantId = this.#giftVariantId;
    if (!variantId) return;

    while (true) {
      const cart = await this.#fetchCartJson();
      const item = cart.items.find(
        (i) => Number(i.variant_id) === variantId && i.parent_relationship?.parent_key == null
      );
      if (!item) break;

      const parsed = await this.#postLines(
        FoxTheme.routes.cart_change_url,
        { id: item.key, quantity: 0, ...this.#getCartSectionsPayload() },
        "remove",
        [{ id: item.key, quantity: 0 }]
      );
      await this.#applyPerLineCartResponse(parsed);
    }
  }

  /**
   * A gift wrap line change the theme makes on its own, sent with its standard
   * lines-update event (see postCartLines).
   * @param {string} url
   * @param {object} body
   * @param {'add' | 'remove' | 'update'} action
   * @param {Array<{merchandiseId?: string, id?: string, quantity: number}>} lines
   * @returns {Promise<any>}
   */
  #postLines(url, body, action, lines) {
    return postCartLines(this, { url, body, event: { action, context: contextFor(this, "cart"), lines } });
  }

  async #fetchCartJson() {
    const res = await fetch(FoxTheme.routes.cart);
    return res.json();
  }

  /**
   * Shopify cart/change + cart/add JSON includes `items` when successful.
   * Passing it as CartUpdateEvent resource avoids extra `/cart.js` in listeners (e.g. price-per-item).
   * @param {object | undefined} parsed
   * @returns {object}
   */
  #cartResourceFromParsed(parsed) {
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
      return parsed;
    }
    return {};
  }

  /**
   * After removing a cart line, reconcile whole-order gift wrap: when no non-gift
   * items remain, always strip fee lines (even if gift_wrap_sync_quantity is off).
   * Otherwise match fee qty to product totals only when sync-quantity is enabled.
   * Same-instance CartUpdateEvent skips #handleCartUpdate gift sync (event.target === this),
   * so removal flows must reconcile here.
   */
  async #reconcileWholeOrderGiftAfterLineRemoval() {
    if (this.#giftWrapPerProduct) return;

    const giftVariantId = this.#giftVariantId;
    if (!giftVariantId) return;

    const cart = await this.#fetchCartJson();

    let nonGiftQuantityTotal = 0;
    for (const item of cart.items) {
      if (Number(item.variant_id) === giftVariantId) continue;
      nonGiftQuantityTotal += item.quantity;
    }

    if (nonGiftQuantityTotal === 0) {
      await this.#removeWholeOrderFeeLinesOnly();
      return;
    }

    if (this.#giftSyncQuantity) {
      await this.#syncWholeOrderGiftLine("", 0, cart);
    }
  }

  /**
   * Parses `item_count` from returned section HTML and dispatches {@link CartUpdateEvent}
   * so `cart-count` and sibling surfaces update (mirrors the notification half of
   * {@link #applyPerLineCartResponse}). Call after morphing `parsed.sections`.
   * @param {object | undefined} parsed - Parsed JSON from cart_change / cart_add.
   * @param {string} [source] - The CartUpdateEvent source.
   */
  #dispatchCartUpdateFromParsedResponse(parsed, source = "cart-items-component") {
    if (!parsed?.sections) return;

    let itemCount = 0;
    for (const sid of Object.keys(parsed.sections)) {
      const doc = new DOMParser().parseFromString(parsed.sections[sid], "text/html");
      const countEl = doc.querySelector('[ref="cartItemCount"]');
      if (countEl?.textContent) {
        itemCount = parseInt(countEl.textContent, 10) || itemCount;
      }
    }

    const resource = this.#cartResourceFromParsed(parsed);

    document.querySelectorAll("cart-items-component").forEach((comp) => {
      if (!(comp instanceof HTMLElement)) return;
      const sid = comp.dataset.sectionId;
      if (sid && parsed.sections[sid]) {
        comp.dispatchEvent(
          new CartUpdateEvent(resource, sid, {
            itemCount,
            source,
            sections: parsed.sections,
          })
        );
      }
    });
  }

  /**
   * Morphs sections + dispatches cartUpdate event. Used after per-line gift
   * mutations so sibling cart surfaces (drawer, page) stay in sync and the
   * cart count badge updates.
   * @param {object | undefined} parsed
   */
  async #applyPerLineCartResponse(parsed) {
    if (!parsed?.sections) return;

    for (const sid of Object.keys(parsed.sections)) {
      await this.#morphSection(sid, parsed.sections[sid]);
    }

    this.#dispatchCartUpdateFromParsedResponse(parsed);
  }

  /** @param {CartGroupedSections} event */
  #onGroupedSections = (event) => {
    event.detail.sections.push(this.sectionId);
  };

  /**
   * Dispatches {@link CartGroupedSections} and returns unique section ids for cart `sections` params.
   * @returns {string[]}
   */
  #gatherGroupedSectionIds() {
    const sections = [];
    document.dispatchEvent(new CartGroupedSections(sections));
    return [...new Set(sections)];
  }

  /**
   * Re-fetches cart-related sections and morphs them in place. Used when we
   * short-circuit without hitting a cart-mutating endpoint (e.g. already-wrapped).
   */
  async #refreshCartSections() {
    const ids = this.#gatherGroupedSectionIds();
    await Promise.all(
      ids.map(async (sid) => {
        const url = `${window.location.pathname.split("?")[0]}?section_id=${sid}`;
        const res = await fetch(url);
        const html = await res.text();
        await this.#morphSection(sid, html);
      })
    );
  }

  /**
   * Look up a cart item row by its 1-based line index. DOM order may not match
   * `cart.items` order (e.g. gift wrap rows are rendered last), so we resolve by
   * the `data-line` attribute instead of array index.
   *
   * @param {number} line - 1-based line index from cart.items.
   * @returns {HTMLTableRowElement | undefined}
   */
  #getRowByLine(line) {
    const rows = this.refs.cartItemRows;
    if (!Array.isArray(rows)) return undefined;
    return /** @type {HTMLTableRowElement | undefined} */ (rows.find((row) => Number(row.dataset.line) === line));
  }

  /**
   * {@link morphSection}, keeping keyboard focus on the line the buyer was working on.
   * A row's id carries the line key, and an automatic discount rehashes that key on
   * every quantity change, so the morph inserts a fresh row and drops the old one —
   * with the focused input or +/− button in it, leaving focus on <body> (outside the
   * drawer). The morph runs synchronously inside morphSection, so focus is put back
   * as soon as it returns.
   *
   * @param {string} sectionId
   * @param {string} html
   * @returns {Promise<void>}
   */
  #morphSection(sectionId, html) {
    const focus = this.#captureLineFocus();
    const morphed = morphSection(sectionId, html);
    if (focus) this.#restoreLineFocus(focus);
    return morphed;
  }

  /**
   * Where focus sits inside a cart line: its 1-based line and its position among
   * the row's focusable elements.
   *
   * @returns {{ element: HTMLElement, line: string, index: number } | null}
   */
  #captureLineFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.contains(active)) return null;

    const row = active.closest('[ref="cartItemRows[]"]');
    if (!(row instanceof HTMLElement) || !row.dataset.line) return null;

    return { element: active, line: row.dataset.line, index: getFocusableElements(row).indexOf(active) };
  }

  /**
   * Puts focus back on the same control of the same line once the morph dropped it:
   * the row now at that line (after a removal, the line that moved up), else the
   * last row, else the first focusable element left in the cart (an emptied cart).
   * Rows are queried, not read from `this.refs`: refs follow a MutationObserver
   * and are still the old rows here.
   *
   * @param {{ element: HTMLElement, line: string, index: number }} focus
   */
  #restoreLineFocus({ element, line, index }) {
    if (element.isConnected) return;

    const rows = Array.from(this.querySelectorAll('[ref="cartItemRows[]"]'));
    const row = rows.find((r) => r instanceof HTMLElement && r.dataset.line === line) ?? rows.at(-1);
    const candidates = getFocusableElements(row instanceof HTMLElement ? row : this);
    const target = (row && candidates[index]) || candidates[0];

    target?.focus({ preventScroll: true });
  }

  /**
   * Toggles loading on gift wrap rows via `is-quantity-syncing` on the `<tr>`
   * (gift lines use the quantity sync spinner only; no remove control). Mirrors
   * the parent line's loading state while gift sync is in flight, since the morph
   * from the gift sync request may not run when nothing needs to change.
   *
   * Only toggles:
   * - The per-line nested gift row whose `data-parent-key` matches `parentKey`
   *   (the gift line nested under the parent being changed).
   * - Any whole-order gift row (no `data-parent-key`), because its quantity may
   *   sync on every parent line change when sync-quantity is enabled.
   *
   * @param {boolean} on
   * @param {string} [parentKey]
   */
  #setGiftLinesLoading(on, parentKey = "") {
    const rows = this.refs.cartItemRows;
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      if (!row.hasAttribute("data-cart-gift-wrap-row")) return;

      const rowParentKey = row.dataset.parentKey || "";
      const isWholeOrderGift = !rowParentKey;
      const isLinkedNestedGift = parentKey && rowParentKey === parentKey;

      if (!isWholeOrderGift && !isLinkedNestedGift) return;

      row.classList.toggle("is-quantity-syncing", on);
    });
  }

  /**
   * Builds the Shopify `sections` payload via {@link CartGroupedSections} listeners.
   */
  #getCartSectionsPayload() {
    return {
      sections: this.#gatherGroupedSectionIds().join(","),
      sections_url: window.location.pathname,
    };
  }

  /**
   * Morphs each rendered section returned by a `/cart/*.js` response.
   * @param {object | undefined} parsed - Parsed JSON from cart_change_url / cart_add_url.
   */
  #morphSectionsFromResponse(parsed) {
    if (!parsed?.sections) return;
    Object.keys(parsed.sections).forEach((sid) => this.#morphSection(sid, parsed.sections[sid]));
  }

  get #giftVariantId() {
    return Number(this.dataset.giftVariantId) || 0;
  }

  get #giftWrapPerProduct() {
    return this.dataset.giftWrapPerProduct === "true";
  }

  get #giftSyncQuantity() {
    return this.dataset.giftSyncQuantity === "true";
  }

  /**
   * Updates quantity of the per-line gift wrap child nested under the given parent.
   * Uses Shopify's native `parent_relationship.parent_key` to resolve linkage.
   *
   * @param {string} parentKey - The parent line's stable cart line key.
   * @param {number} quantity - The new quantity (0 to remove).
   * @param {{ items?: unknown[] } | undefined} [preloadedCart]
   * @param {string} [source] - CartUpdateEvent source for the re-render (ACTION_SOURCE when following an app's change).
   * @returns {Promise<{ items?: unknown[] } | undefined>} Full cart from last `/cart/change` when lines were updated; otherwise `undefined` (caller may reuse `preloadedCart`).
   */
  async #updateAssociatedGiftLines(parentKey, quantity, preloadedCart, source) {
    if (!this.#giftWrapPerProduct) return undefined;
    if (quantity > 0 && !this.#giftSyncQuantity) return undefined;
    if (!parentKey) return undefined;

    const giftVariantId = this.#giftVariantId;
    if (!giftVariantId) return undefined;

    const cart = preloadedCart && Array.isArray(preloadedCart.items) ? preloadedCart : await this.#fetchCartJson();
    const giftItems = cart.items.filter(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key === parentKey
    );

    const sectionsPayload = this.#getCartSectionsPayload();
    let lastParsed;
    for (const giftItem of giftItems) {
      if (giftItem.quantity === quantity) continue;
      lastParsed = await this.#postLines(
        FoxTheme.routes.cart_change_url,
        { id: giftItem.key, quantity, ...sectionsPayload },
        quantity === 0 ? "remove" : "update",
        [{ id: giftItem.key, quantity }]
      );
    }

    this.#morphSectionsFromResponse(lastParsed);
    this.#dispatchCartUpdateFromParsedResponse(lastParsed, source);

    return lastParsed && Array.isArray(lastParsed.items) ? lastParsed : undefined;
  }

  /**
   * Syncs the whole-order gift wrap line quantity to the total non-gift quantity.
   * @param {string} changingItemKey - The key of the item being changed.
   * @param {number} newQuantity - The new quantity for that item.
   * @param {{ items?: { variant_id?: number; quantity?: number; key?: string; parent_relationship?: { parent_key?: string | null } }[] } | undefined} [preloadedCart] - When set (e.g. from a just-fetched /cart.js), skip a duplicate fetch.
   * @param {string} [source] - CartUpdateEvent source for the re-render (ACTION_SOURCE when following an app's change).
   */
  async #syncWholeOrderGiftLine(changingItemKey, newQuantity, preloadedCart, source) {
    if (this.#giftWrapPerProduct) return;
    if (newQuantity > 0 && !this.#giftSyncQuantity) return;

    const giftVariantId = this.#giftVariantId;
    if (!giftVariantId) return;

    const cart = preloadedCart && Array.isArray(preloadedCart.items) ? preloadedCart : await this.#fetchCartJson();

    const giftItem = cart.items.find(
      (i) => Number(i.variant_id) === giftVariantId && i.parent_relationship?.parent_key == null
    );
    if (!giftItem) return;

    let totalQuantity = 0;
    for (const item of cart.items) {
      if (Number(item.variant_id) === giftVariantId) continue;
      totalQuantity += item.key === changingItemKey ? newQuantity : item.quantity;
    }

    if (giftItem.quantity === totalQuantity) return;

    const parsed = await this.#postLines(
      FoxTheme.routes.cart_change_url,
      { id: giftItem.key, quantity: totalQuantity, ...this.#getCartSectionsPayload() },
      totalQuantity === 0 ? "remove" : "update",
      [{ id: giftItem.key, quantity: totalQuantity }]
    );
    this.#morphSectionsFromResponse(parsed);
    this.#dispatchCartUpdateFromParsedResponse(parsed, source);
  }

  /**
   * Updates the quantity.
   * @param {Object} config - The config.
   * @param {number} [config.line] - The 1-based line index.
   * @param {string} [config.id] - The line item key (used instead of line when provided).
   * @param {number} config.quantity - The quantity.
   * @param {string} config.action - The action.
   */
  updateQuantity(config) {
    this.#disableCartItems();

    const { line, quantity, id } = config;

    // Standard storefront event — dispatched before the request so apps can
    // show a pending state; settled below when the mutation completes.
    const standardRow = line != null ? this.#getRowByLine(line) : undefined;
    const standardLineKey = id || standardRow?.dataset.key;
    // What the line held before this request: a declined change leaves it
    // there, a change capped at the stock available moves it (see below).
    const previousQuantity = Number(standardRow?.dataset.quantity);
    const standardHandles = standardLineKey
      ? dispatchCartLinesUpdate(this, {
          action: quantity === 0 ? "remove" : "update",
          context: contextFor(this, "cart"),
          lines: [{ id: standardLineKey, quantity }],
        })
      : null;

    const sectionsToUpdate = this.#gatherGroupedSectionIds();

    const body = JSON.stringify({
      ...(id ? { id } : { line }),
      line: line,
      quantity: quantity,
      sections: sectionsToUpdate.join(","),
      sections_url: window.location.pathname,
    });

    return fetch(`${FoxTheme.routes.cart_change_url}`, fetchConfig("json", { body }))
      .then((response) => {
        return response.text();
      })
      .then(async (responseText) => {
        const parsedResponseText = JSON.parse(responseText);

        this.querySelectorAll("[data-cart-remove-button]").forEach((button) => {
          button.classList.remove("btn--loading");
        });

        // The cart read back after an error response — set below when the
        // response carried no sections.
        /** @type {any} */
        let cartJson = null;

        // Even with errors, backend may have updated cart to max available
        // Update UI and cart count if we have sections
        if (parsedResponseText.sections && parsedResponseText.sections[this.sectionId]) {
          const newSectionHTML = new DOMParser().parseFromString(
            parsedResponseText.sections[this.sectionId],
            "text/html"
          );

          // Grab the new cart item count from a hidden element
          const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
          const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

          const resource = this.#cartResourceFromParsed(parsedResponseText);

          this.dispatchEvent(
            new CartUpdateEvent(resource, this.sectionId, {
              itemCount: newCartItemCount,
              source: "cart-items-component",
              sections: parsedResponseText.sections,
            })
          );

          this.#morphSection(this.sectionId, parsedResponseText.sections[this.sectionId]);

          this.#dispatchCartUpdated(parsedResponseText);
        } else if (parsedResponseText.errors) {
          // No sections in error response - fetch cart.js for accurate count and quantity

          const cartSectionsData = {};
          const cartSectionsPromises = sectionsToUpdate.map(async (sectionId) => {
            const sectionUrl = `${window.location.pathname.split("?")[0]}?section_id=${sectionId}`;

            const res = await fetch(sectionUrl);
            const html = await res.text();

            cartSectionsData[sectionId] = html;
          });

          const cartJsonPromises = fetch(FoxTheme.routes.cart)
            .then((res) => res.json())
            .then((data) => {
              cartJson = data;
            });

          await Promise.all([...cartSectionsPromises, cartJsonPromises]);

          cartJson["sections"] = cartSectionsData;

          this.dispatchEvent(
            new CartUpdateEvent(cartJson, "", {
              itemCount: cartJson.item_count || 0,
              sections: cartJson.sections,
            })
          );

          this.#morphSection(this.sectionId, cartJson.sections[this.sectionId]);

          this.#dispatchCartUpdated(cartJson);
        }

        // Detect errors from quantity mismatch or explicit error response
        let hasError = !!parsedResponseText.errors;
        let responseLineKey = standardLineKey; // Fallback to old key if response doesn't have it
        if (!hasError && line != null && quantity > 0 && Array.isArray(parsedResponseText.items)) {
          const actualItem = parsedResponseText.items[line - 1];
          // Capture lineKey from response in case auto-discount recomputed the variant hash
          if (actualItem?.key) {
            responseLineKey = actualItem.key;
          }
          // Only report error if Shopify clamped the quantity (actual < requested).
          // Skip when removing items (quantity = 0) or when quantity stays same.
          if (actualItem && actualItem.quantity < quantity) {
            hasError = true;
            const errorMsg = this.#getQuantityLimitMessage(actualItem.quantity);
            parsedResponseText.message = errorMsg;
          }
        }

        // The AJAX API answers a change capped at the stock available with the
        // same 422 as one it declined outright. Tell them apart from the cart:
        // a line that moved off its old quantity took the change in part, which
        // the standard reports as a warning rather than a user error.
        if (parsedResponseText.errors) {
          const standardMessage =
            typeof parsedResponseText.errors === "string"
              ? parsedResponseText.errors
              : parsedResponseText.message || "Cart error";
          // By key, then by position: an automatic discount can rehash the key.
          const lineAfter =
            cartJson?.items?.find((/** @type {any} */ item) => item.key === standardLineKey) ??
            (line != null ? cartJson?.items?.[line - 1] : undefined);
          const partlyApplied =
            quantity > 0 &&
            Number.isFinite(previousQuantity) &&
            lineAfter != null &&
            lineAfter.quantity !== previousQuantity;
          resolveCartResult(
            standardHandles,
            partlyApplied
              ? { warnings: [{ code: "MERCHANDISE_NOT_ENOUGH_STOCK", message: standardMessage }] }
              : { userErrors: [{ code: "INVALID", message: standardMessage }] }
          );
        } else if (hasError) {
          // Accepted without an error, but capped below what was asked for.
          resolveCartResult(standardHandles, {
            warnings: [{ code: "MERCHANDISE_NOT_ENOUGH_STOCK", message: parsedResponseText.message }],
          });
        } else {
          this.#clearPendingError();
          resolveCartResult(standardHandles);
        }

        /**
         * Show error message if exists (e.g. quantity exceeds available)
         * Call after morph section to avoid message disappear
         */
        if (hasError && line != null) {
          setTimeout(() => this.#handleCartError(line, parsedResponseText, responseLineKey), 0);
        }
      })
      .catch((error) => {
        rejectCartResult(standardHandles, this, error);
        console.error(error);
      })
      .finally(() => {
        this.#enableCartItems();
        // cartPerformance.measureFromMarker(cartPerformaceUpdateMarker);
      });
  }

  /**
   * Returns a localized quantity limit error message with proper pluralization.
   * @param {number} count - The available quantity.
   * @returns {string} The translated message.
   */
  #getQuantityLimitMessage(count) {
    const template =
      count === 1 ? FoxTheme.translations.cart_quantity_limit_one : FoxTheme.translations.cart_quantity_limit_other;
    return template.replace("{{ count }}", count);
  }

  /**
   * Clears the pending error state.
   */
  #clearPendingError() {
    if (this.#pendingError) {
      clearTimeout(this.#pendingError.timeoutId);
      this.#pendingError = null;
    }
  }

  /**
   * Shows an error under the cart line for a variant. Public entry point for
   * errors raised OUTSIDE the cart — a product card's quick-add hitting the
   * stock limit — where the cart is opened to explain why nothing was added.
   * @param {object} error - The error to show.
   * @param {string} error.variantId - The variant that could not be added.
   * @param {string} error.message - The message to show under that line.
   */
  showLineError({ variantId, message }) {
    if (!variantId || !message) return;

    this.#clearPendingError();
    this.#pendingError = { variantId: String(variantId), message, timeoutId: null };

    // refs are MutationObserver-driven, so a morph triggered in this same tick
    // has not reached them yet — apply on the next turn, like the other
    // post-morph error paths below.
    this.#pendingError.timeoutId = setTimeout(() => this.#applyPendingError(), 0);
  }

  /**
   * Restores the pending error message after DOM morphing completes.
   * Uses lineKey to find the current line index after reordering.
   */
  #applyPendingError() {
    if (!this.#pendingError) return;

    const { lineKey, variantId, message } = this.#pendingError;
    const rows = this.refs.cartItemRows;
    if (!Array.isArray(rows)) return;

    // A line key is exact; a variant id is the only handle an outside caller
    // has, and picks the first line holding that variant.
    const row =
      (lineKey ? rows.find((r) => r.dataset.key === lineKey) : undefined) ??
      (variantId ? rows.find((r) => r.dataset.variantId === variantId) : undefined);
    if (!row) return;

    // The line number may have shifted since the request (another line removed,
    // reordered), so read the current one off the row we matched by key.
    const currentLine = Number(row.dataset.line);
    if (!Number.isFinite(currentLine)) return;

    const cartItemError = this.refs[`cartItemError-${currentLine}`];
    const cartItemErrorContainer = this.refs[`cartItemErrorContainer-${currentLine}`];

    if (cartItemError instanceof HTMLElement && cartItemErrorContainer instanceof HTMLElement) {
      cartItemError.textContent = message;
      cartItemErrorContainer.classList.remove("hidden");

      if (this.#pendingError.timeoutId) {
        clearTimeout(this.#pendingError.timeoutId);
      }

      const timeoutId = setTimeout(() => {
        cartItemErrorContainer.classList.add("hidden");
        this.#clearPendingError();
      }, this.#timeout);

      this.#pendingError.timeoutId = timeoutId;
    }
  }

  /**
   * Handles the discount update.
   * @param {DiscountUpdateEvent} event - The event.
   */
  handleDiscountUpdate = (event) => {
    if (event?.detail?.sourceId === this.sectionId) return;
    if (this.#pendingError) return;
    this.#handleCartUpdate(event);
  };

  /**
   * Handles the cart error.
   * @param {number} line - The line.
   * @param {Object} parsedResponseText - The parsed response text.
   * @param {string} parsedResponseText.errors - The errors.
   * @param {string} [lineKey] - The line key from the response, used to re-find the row after morph.
   */
  #handleCartError = (line, parsedResponseText, lineKey) => {
    const message =
      (typeof parsedResponseText.errors === "string" ? parsedResponseText.errors : null) ||
      parsedResponseText.message ||
      "Cart error";

    const cartItemError = this.refs[`cartItemError-${line}`];
    const cartItemErrorContainer = this.refs[`cartItemErrorContainer-${line}`];

    if (!(cartItemError instanceof HTMLElement) || !(cartItemErrorContainer instanceof HTMLElement)) {
      return;
    }

    this.#clearPendingError();

    // If error came directly from Shopify API (parsedResponseText.errors),
    // show immediately at current line. Otherwise, defer via pending so row can
    // be re-found by lineKey after morph (prevents showing at wrong line after remove/reorder).
    const isApiError = typeof parsedResponseText.errors === "string";

    if (isApiError) {
      // API error: show immediately at old line (may be wrong after morph, but Shopify
      // API errors are terminal — user needs to see it now)
      cartItemError.textContent = message;
      cartItemErrorContainer.classList.remove("hidden");

      const timeoutId = setTimeout(() => {
        cartItemErrorContainer.classList.add("hidden");
        this.#clearPendingError();
      }, this.#timeout);

      this.#pendingError = { lineKey, message, timeoutId };
    } else {
      // Computed error (quantity mismatch): pending to apply after morph
      this.#pendingError = { lineKey, message, timeoutId: null };

      const timeoutId = setTimeout(() => {
        this.#applyPendingError();
      }, 0);

      this.#pendingError.timeoutId = timeoutId;
    }
  };

  /**
   * Handles the cart update.
   *
   * @param {DiscountUpdateEvent | CartUpdateEvent | import("@theme/events").CartAddEvent} event
   */
  #handleCartUpdate = async (event) => {
    // Self-dispatched: updateQuantity() already morphed sections and called #dispatchCartUpdated.
    if (event.target === this) return;

    // Morph FIRST when the event already carries this section's HTML — synchronously,
    // in the same dispatch tick, so the cart drawer's one-frame showDialog() defer
    // opens onto the NEW content. The /cart.js fetch below (feeding the 3rd-party
    // cart:updated event and gift sync) used to run before the morph and held it
    // back a full network round-trip: the first add-to-cart opened the drawer on
    // the empty-cart layout, which then flipped to the populated state.
    // Discount events keep their own path: cart-discount morphs its host section
    // itself, and sibling instances re-render below with cache: false.
    const isDiscountUpdate = event instanceof DiscountUpdateEvent;
    const cartItemsHtml = isDiscountUpdate ? undefined : event.detail?.data?.sections?.[this.sectionId];
    // An app's Shopify.actions.updateCart: refreshCart recorded what each line
    // held BEFORE it morphed, so the gift sync below can tell which side of a
    // gift pair the app changed and follow it rather than undo it.
    const isActionUpdate = event.detail?.data?.source === ACTION_SOURCE;
    const previousQuantities = isActionUpdate ? event.detail?.data?.previousQuantities || new Map() : null;
    // The follow-up sync is part of the app's change, not the buyer adding to
    // cart: its own CartUpdateEvent keeps the action source (the drawer stays shut).
    const syncSource = isActionUpdate ? ACTION_SOURCE : undefined;
    if (cartItemsHtml) {
      this.#morphSection(this.sectionId, cartItemsHtml);
    }

    // Reuse cart data already present in the event (from cart/change or cart/add response)
    // to avoid an extra /cart.js round-trip. Fall back to fetch only when not available.
    const preloadedResource = event.detail?.resource;
    const hasPreloadedCart =
      preloadedResource && typeof preloadedResource === "object" && Array.isArray(preloadedResource.items);

    const cartJson = hasPreloadedCart ? preloadedResource : await this.#fetchCartJson();
    cartJson["sections"] = event.detail?.data?.sections;
    this.#dispatchCartUpdated(cartJson);

    if (isDiscountUpdate) {
      if (event?.detail?.sourceId === this.sectionId) return;
      sectionRenderer.renderSection(this.sectionId, { cache: false });
      return;
    }

    if (!cartItemsHtml) {
      await sectionRenderer.renderSection(this.sectionId, { cache: false });
    }

    // After morphing, restore any pending error message using the updated refs
    setTimeout(() => this.#applyPendingError(), 0);

    // Sync per-line gift wrap: for each parent item without a parent_relationship,
    // update its nested gift children when enabled and sync-quantity is on.
    if (this.#giftWrapPerProduct && this.#giftSyncQuantity && Array.isArray(cartJson.items)) {
      for (const item of cartJson.items) {
        if (item.parent_relationship?.parent === null || item.parent_relationship?.parent === undefined) {
          const parentKey = item.key;
          if (parentKey && !this.#appChangedGiftLine(cartJson, previousQuantities, parentKey)) {
            this.#setGiftLinesLoading(true, parentKey);
            try {
              await this.#updateAssociatedGiftLines(parentKey, item.quantity, cartJson, syncSource);
            } catch (error) {
              // The failed request already reported itself (shopify:cart:error).
              console.error("[cart-items] gift wrap sync failed:", error);
            } finally {
              this.#setGiftLinesLoading(false, parentKey);
            }
          }
        }
      }
    }

    // External cart updates (add to cart, AJAX errors with partial cart, etc.) do not
    // run #onQuantityChange. Reconcile whole-order gift qty when sync mode is on.
    // #syncWholeOrderGiftLine no-ops when there is no fee line or qty already matches.
    if (
      !this.#giftWrapPerProduct &&
      this.#giftSyncQuantity &&
      !this.#appChangedGiftLine(cartJson, previousQuantities, null)
    ) {
      this.#setGiftLinesLoading(true);
      try {
        await this.#syncWholeOrderGiftLine("", 0, cartJson, syncSource);
      } catch (error) {
        console.error("[cart-items] gift wrap sync failed:", error);
      } finally {
        this.#setGiftLinesLoading(false);
      }
    }
  };

  /**
   * Whether an app's cart change touched a gift wrap line itself — the nested
   * child of `parentKey`, or the whole-order fee line when `parentKey` is null
   * — rather than the products it wraps. The sync then leaves that line as the
   * app set it instead of forcing it back to the products' quantity; a change
   * to the products still makes the gift line follow. Always false for the
   * buyer's own changes (`previousQuantities` is null).
   * @param {{ items?: any[] }} cart - The cart after the change.
   * @param {Map<string, number> | null} previousQuantities
   * @param {string | null} parentKey
   * @returns {boolean}
   */
  #appChangedGiftLine(cart, previousQuantities, parentKey) {
    if (!previousQuantities || !Array.isArray(cart.items)) return false;
    const giftVariantId = this.#giftVariantId;
    return cart.items.some(
      (item) =>
        Number(item.variant_id) === giftVariantId &&
        (item.parent_relationship?.parent_key ?? null) === parentKey &&
        previousQuantities.get(item.key) !== item.quantity
    );
  }

  /**
   * Dispatches a cart updated event for 3rd party.
   * @param {Object} cart - The cart data.
   */
  #dispatchCartUpdated(cart) {
    document.dispatchEvent(
      new CustomEvent(ThemeEvents.cartUpdated, {
        detail: { cart },
      })
    );
  }

  /**
   * Disables the cart items.
   */
  #disableCartItems() {
    this.classList.add("cart-items-disabled");
  }

  /**
   * Enables the cart items.
   */
  #enableCartItems() {
    this.classList.remove("cart-items-disabled");
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error("Section id missing");

    return sectionId;
  }
}

if (!customElements.get("cart-items-component")) {
  customElements.define("cart-items-component", CartItemsComponent);
}
