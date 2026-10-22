import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";

/**
 * A custom element that displays a cart icon.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} cartBubbleCount - The cart bubble count element.
 *
 * @extends {Component<Refs>}
 */
class CartCount extends Component {
  requiredRefs = ["cartBubbleCount"];

  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {number} */
  get currentCartCount() {
    return parseInt(this.refs.cartBubbleCount.textContent ?? "0", 10);
  }

  set currentCartCount(value) {
    this.refs.cartBubbleCount.textContent = value < 100 ? String(value) : "99+";
  }

  get inDrawer() {
    return this.dataset.context === "drawer";
  }

  connectedCallback() {
    super.connectedCallback();

    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    document.addEventListener(ThemeEvents.cartUpdate, this.onCartUpdate, { signal });
    window.addEventListener("pageshow", this.onPageShow, { signal });
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;

    super.disconnectedCallback();
  }

  /**
   * Re-syncs the count from the server when the page returns from bfcache.
   *
   * The count has to come from /cart.js, not from anything this tab remembered:
   * the cart can change without a single cartUpdate event firing here — pressing
   * Enter in a quantity input submits cart-form (a full POST + navigation), and
   * checkout itself can add or remove lines. Both leave this page's rendered
   * count, and anything derived from it, frozen at the pre-navigation value.
   *
   * @param {PageTransitionEvent} event - The page show event.
   */
  onPageShow = (event) => {
    if (!event.persisted) return;

    this.#syncFromServer();
  };

  /**
   * Fetches the authoritative item count and re-renders the bubble if it moved.
   */
  async #syncFromServer() {
    try {
      const response = await fetch(FoxTheme.routes.cart, { signal: this.#abortController?.signal });
      const cart = await response.json();
      const itemCount = cart?.item_count ?? 0;

      if (itemCount !== this.currentCartCount) this.renderCartBubble(itemCount);
    } catch (_) {
      // no-op: offline, or the component went away mid-flight — the rendered count stands
    }
  }

  /**
   * Handles the cart update event
   * Supports both incremental (CartAddEvent) and absolute (CartUpdateEvent) count updates
   * @param {Event} event - The cart update event.
   */
  onCartUpdate = async (event) => {
    const itemCount = event.detail.data?.itemCount ?? 0;
    const isIncremental = event.detail.data?.isIncremental ?? false;

    if (isIncremental) {
      // Incremental update: add delta to current count
      let currentCount = parseInt(this.refs.cartBubbleCount.textContent ?? "0", 10);

      if (!this.inDrawer) {
        currentCount += itemCount;
      }

      this.renderCartBubble(currentCount);
    } else {
      // Absolute update: set count directly from server
      this.renderCartBubble(itemCount);
    }
  };

  /**
   * Renders the cart bubble.
   * @param {number} itemCount - The number of items in the cart.
   */
  renderCartBubble = async (itemCount) => {
    this.currentCartCount = itemCount;

    // A `data-show-zero` count (a "Cart (0)" label) stays visible on an empty cart.
    this.classList.toggle("hidden", itemCount === 0 && !this.hasAttribute("data-show-zero"));
    this.classList.toggle("cart-count--small-medium", itemCount > 99);
    document.body.classList.toggle("cart-has-items", itemCount > 0);
  };
}

if (!customElements.get("cart-count")) {
  customElements.define("cart-count", CartCount);
}
