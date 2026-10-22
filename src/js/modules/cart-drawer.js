import { DialogComponent } from "@theme/dialog";
import { ThemeEvents, CartAddEvent, CartUpdateEvent, CartGroupedSections } from "@theme/events";
import { getSectionId, prefersReducedMotion } from "@theme/utilities";
import { ACTION_SOURCE } from "@theme/standard-events";

/**
 * A custom element that manages a cart drawer.
 *
 * @extends {DialogComponent}
 */

class CartDrawerComponent extends DialogComponent {
  /** @type {number | null} */
  #currentCartItemCount = null;

  connectedCallback() {
    super.connectedCallback();

    // Initialize cart count from DOM if available
    this.#initializeCartCount();

    // Listen to cart update events (both CartAddEvent and CartUpdateEvent use ThemeEvents.cartUpdate)
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);

    this.getSectionToRenderListener = this.#getSectionToRender.bind(this);
    document.addEventListener(CartGroupedSections.eventName, this.getSectionToRenderListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(CartGroupedSections.eventName, this.getSectionToRenderListener);
  }

  /**
   * Initialize cart count from DOM or cart-count component
   */
  #initializeCartCount() {
    // Try to get count from cart-count component (not in drawer)
    const cartCountElement = document.querySelector('cart-count:not([data-context="drawer"])');
    if (cartCountElement?.refs?.cartBubbleCount) {
      this.#currentCartItemCount = parseInt(cartCountElement.refs.cartBubbleCount.textContent ?? "0", 10);
      return;
    }

    // Fallback: read from data-cart-bubble-count when refs not ready yet
    const cartBubbleCount = document.querySelector("[data-cart-bubble-count]");
    if (cartBubbleCount) {
      this.#currentCartItemCount = parseInt(cartBubbleCount.textContent ?? "0", 10);
      return;
    }

    // If no count found, initialize to 0
    this.#currentCartItemCount = 0;
  }

  /**
   * Checks if the drawer is currently open
   * @returns {boolean}
   */
  #isDrawerOpen() {
    return this.refs.dialog?.open ?? false;
  }

  /**
   * Handles cart update events (both CartAddEvent and CartUpdateEvent)
   * Only opens drawer if cart item count actually increased
   * @param {CartAddEvent | CartUpdateEvent} event
   */
  #handleCartUpdate = (event) => {
    if (!this.hasAttribute("auto-open")) {
      return;
    }

    // Don't open drawer if event comes from cart-items inside this drawer
    // This prevents drawer from reopening when user updates quantity inside drawer
    const sourceId = event.detail.sourceId;
    const source = event.detail.data?.source;
    // An app's Shopify.actions.updateCart is not the buyer adding to cart:
    // opening the cart is the app's call to make, through openCart.
    if ((source === "cart-items-component" && this.#isDrawerOpen()) || source === ACTION_SOURCE) {
      // Still update count for tracking, but don't open drawer
      this.#updateCartCount(event);
      return;
    }

    const itemCount = event.detail.data?.itemCount;
    const isIncremental = event.detail.data?.isIncremental ?? false;

    // If itemCount is missing or invalid, skip processing
    if (itemCount === undefined || itemCount === null) {
      return;
    }

    let newCartItemCount;

    if (isIncremental) {
      // CartAddEvent: itemCount is the delta (quantity added)
      // Handle negative values (shouldn't happen, but defensive)
      const currentCount = this.#currentCartItemCount ?? 0;
      newCartItemCount = Math.max(0, currentCount + itemCount);
    } else {
      // CartUpdateEvent: itemCount is the absolute total count
      // Ensure non-negative
      newCartItemCount = Math.max(0, itemCount);
    }

    const currentCount = this.#currentCartItemCount ?? 0;

    // Only open drawer if cart count actually increased
    // This handles:
    // - Adding items that exceed max quantity (count doesn't increase)
    // - Updating quantity in drawer (count may increase, but drawer already open)
    // - Removing items (count decreases, drawer shouldn't open)
    if (newCartItemCount > currentCount) {
      // Only open if drawer is not already open
      // This prevents reopening when quantity is updated inside drawer
      if (!this.#isDrawerOpen()) {
        // Defer to next frame so sibling cart-items listeners (registered
        // later in DOM order) finish their synchronous morphSection() call
        // before the drawer animates in. Without this, the first add-to-cart
        // on an empty cart opens the drawer showing the empty-cart layout
        // for a frame, then flips to the populated state.
        requestAnimationFrame(() => {
          if (!this.#isDrawerOpen()) this.showDialog();
        });
      } else if (source !== "gift-wrapping-component") {
        // Already open and something was ADDED from inside it — a recommendation
        // under the summary, a quick add — while the shopper is scrolled to
        // wherever that control lives. The new line lands at the TOP of the
        // list, out of view; bring it into view once the morph has run.
        // Not for gift wrap: that toggle sits in the summary the shopper is
        // using, and pulling them away from it mid-interaction is worse than
        // the line arriving unseen.
        requestAnimationFrame(() => this.#scrollToTop(prefersReducedMotion() ? "auto" : "smooth"));
      }
    }

    // Always update tracked count to stay in sync
    this.#currentCartItemCount = newCartItemCount;
  };

  /**
   * Updates cart count from event without opening drawer
   * Used when event comes from inside drawer
   * @param {CartAddEvent | CartUpdateEvent} event
   */
  #updateCartCount(event) {
    const itemCount = event.detail.data?.itemCount;
    const isIncremental = event.detail.data?.isIncremental ?? false;

    if (itemCount === undefined || itemCount === null) {
      return;
    }

    if (isIncremental) {
      const currentCount = this.#currentCartItemCount ?? 0;
      this.#currentCartItemCount = Math.max(0, currentCount + itemCount);
    } else {
      this.#currentCartItemCount = Math.max(0, itemCount);
    }
  }

  /**
   * The drawer's scroll position outlived it: close it scrolled to the
   * summary, add another item from a product page, and it reopened on the
   * summary with the new line — first in the list — out of sight. A reopen is
   * a fresh look at the cart, so it starts at the top; smooth scrolling is for
   * a drawer that is already open (see #handleCartUpdate).
   */
  showDialog() {
    // A new opening is a new look at the recommendations: their standard
    // product views may fire again (see the s-view-event definition in
    // snippets/scripts.liquid, which fills this set).
    /** @type {any} */ (this).viewedProducts?.clear();
    super.showDialog();
    this.#scrollToTop("instant");
  }

  /**
   * @param {ScrollBehavior} behavior
   */
  #scrollToTop(behavior) {
    // Which box scrolls is a stylesheet decision — core scrolls the whole
    // content column, a fork may pin the summary and scroll the item list
    // inside it — so every candidate carries the attribute and all of them
    // are reset; the ones that do not scroll are a no-op. Addressed by data
    // attribute because they sit inside cart-items-component, a nested
    // Component that would claim a `ref`.
    for (const region of this.querySelectorAll("[data-cart-drawer-scroll]")) {
      if (behavior === "instant") {
        region.scrollTop = 0;
      } else {
        region.scrollTo({ top: 0, behavior });
      }
    }
  }

  /** @param {Event} [event] - Absent when called from code rather than a click. */
  open(event) {
    event?.preventDefault();
    this.showDialog();

    /**
     * Close cart drawer when installments CTA is clicked to avoid overlapping dialogs
     */
    customElements.whenDefined("shopify-payment-terms").then(() => {
      const installmentsContent = document.querySelector("shopify-payment-terms")?.shadowRoot;
      const cta = installmentsContent?.querySelector("#shopify-installments-cta");
      cta?.addEventListener("click", this.closeDialog, { once: true });
    });
  }

  close() {
    this.closeDialog();
  }

  #getSectionToRender(event) {
    event.detail.sections.push(getSectionId(this));
  }
}

if (!customElements.get("cart-drawer-component")) {
  customElements.define("cart-drawer-component", CartDrawerComponent);
}
