import { Component } from "@theme/component";
import { DialogCloseEvent, DialogComponent } from "@theme/dialog";
import { CartAddEvent, CartUpdateEvent, ThemeEvents } from "@theme/events";
import { getIOSVersion } from "@theme/utilities";

/**
 * @capability Quick-view trigger — fetches the product page via the Section Rendering API (?section_id=), caches it per variant URL, injects the [data-quick-view-content] fragment into the global quick-view drawer or modal (re-executing inline scripts, syncing the card's selected variant), then opens the QuickViewDialog; the dialog self-closes when the cart count grows.
 * @when Product cards/grids that need a "quick view / quick shop" preview without leaving the page. Pairs with src/scss/global/quick-view.scss. Reuse instead of fetching + injecting product HTML yourself.
 * @contract <quick-view-component data-product-url [data-quick-view-style="modal|drawer"]> (usually inside <product-card>) with a [data-quick-view-trigger] button (bound via on:click="/handleClick") and [data-quick-view-spinner]; requires the global #quick-view-dialog/#quick-view-modal-dialog <quick-view-dialog> section with #quick-view-drawer-content/#quick-view-modal-content containers; dispatches ThemeEvents.quickViewLoaded/quickViewOpened.
 * @keywords quick view, quick shop, product preview, product modal, product drawer, section rendering fetch, view product popup, card preview dialog
 */
export class QuickViewComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Map<string, Element>} */
  #cachedContent = new Map();

  /** @returns {"drawer" | "modal"} */
  get #style() {
    if (document.getElementById("quick-view-modal-dialog")) return "modal";
    if (document.getElementById("quick-view-dialog")) return "drawer";
    return /** @type {"drawer" | "modal"} */ (this.dataset.quickViewStyle || "modal");
  }

  get productUrl() {
    return this.dataset?.productUrl;
  }

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest("product-card"));
    const productLink = productCard?.getProductCardLink();

    // The ref can legitimately be missing: `refs.productCardLink` belongs to the
    // nearest UPGRADED Component ancestor, so a card that nests its own component
    // around the title link leaves <product-card> without it — and returning ""
    // here makes handleClick build a relative `?section_id=` URL that re-fetches
    // the CURRENT page, so the drawer shows the wrong product. The component
    // already carries the URL via `data-product-url`; fall back to it.
    const baseUrl = productLink?.href || this.productUrl;

    if (!baseUrl) return "";

    // `data-product-url` is a root-relative path, so a base is required.
    const url = new URL(baseUrl, window.location.origin);

    if (url.searchParams.has("variant")) {
      return url.toString();
    }

    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) {
      url.searchParams.set("variant", selectedVariantId);
    }

    return url.toString();
  }

  #getSelectedVariantId() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest("product-card"));
    return productCard?.getSelectedVariantId() || null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.quickViewButtonSpinner = this.querySelector("[data-quick-view-spinner]");
    this.quickViewButton = this.querySelector("[data-quick-view-trigger]");
  }

  /** @param {QuickViewDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute("stay-visible", true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute("stay-visible", false), {
      once: true,
    });
  }

  #openQuickViewDialog = () => {
    const id = this.#style === "modal" ? "quick-view-modal-dialog" : "quick-view-dialog";
    const dialogComponent = document.getElementById(id);
    if (!(dialogComponent instanceof QuickViewDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);
    dialogComponent.showDialog();
  };

  handleClick = async (event) => {
    event.preventDefault();

    const currentUrl = `${this.productPageUrl.split("?")[0]}?section_id=${this.quickViewDrawerId}&${this.productPageUrl.split("?")[1]}`;

    let quickViewContent = this.#cachedContent.get(currentUrl);

    if (!quickViewContent) {
      this.addLoading();
      const html = await this.fetchProductPage(currentUrl);
      if (html) {
        const quickViewContentElement = html.querySelector("[data-quick-view-content]");
        if (quickViewContentElement) {
          quickViewContent = /** @type {Element} */ (quickViewContentElement.cloneNode(true));
          this.#cachedContent.set(currentUrl, quickViewContent);
        }
      }
      this.removeLoading();
    }

    if (quickViewContent) {
      const freshContent = /** @type {Element} */ (quickViewContent.cloneNode(true));
      await this.updateQuickViewContent(freshContent);
    }

    this.#openQuickViewDialog();
  };

  /**
   * @param {string} productPageUrl
   * @returns {Promise<Document | null>}
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();

      document.dispatchEvent(
        new CustomEvent(ThemeEvents.quickViewLoaded, {
          detail: { productUrl: this.productUrl },
        })
      );

      return new DOMParser().parseFromString(responseText, "text/html");
    } catch (error) {
      if (error.name === "AbortError") {
        return null;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  async updateQuickViewContent(quickViewContent) {
    const contentId = this.#style === "modal" ? "quick-view-modal-content" : "quick-view-drawer-content";
    const container = document.getElementById(contentId);
    if (!quickViewContent || !container) return;

    container.innerHTML = quickViewContent.innerHTML;
    this.#reExecuteInlineScripts(container);
    this.#syncVariantSelection(quickViewContent);
  }

  /** Re-executes inline scripts after innerHTML assignment (they don't auto-run). */
  #reExecuteInlineScripts(container) {
    container.querySelectorAll('script:not([src]):not([type="application/json"])').forEach((script) => {
      const clone = document.createElement("script");
      clone.textContent = script.textContent;
      document.head.appendChild(clone);
      clone.remove();
    });
  }

  /** @param {Element} modalContent */
  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;

    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
    }
  }

  addLoading() {
    this.quickViewButton?.classList.add("btn--loading");
    this.quickViewButtonSpinner?.classList.remove("hidden");
  }

  removeLoading() {
    this.quickViewButton?.classList.remove("btn--loading");
    this.quickViewButtonSpinner?.classList.add("hidden");
  }

  get quickViewDrawerId() {
    const quickViewDrawer = document.getElementById("quick-view-drawer");
    return quickViewDrawer?.dataset.sectionId;
  }
}

if (!customElements.get("quick-view-component")) {
  customElements.define("quick-view-component", QuickViewComponent);
}

class QuickViewDialog extends DialogComponent {
  // Created per connect, not once per instance: a MOVE (the PDP "below media" container
  // relocates its whole subtree into the media column) fires disconnect → abort, and an
  // AbortController is single-use — a signal created once would leave the reconnected
  // dialog with no listeners at all.
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {number | null} */
  #currentCartItemCount = null;

  connectedCallback() {
    super.connectedCallback();

    this.#initializeCartCount();

    this.#abortController = new AbortController();
    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, {
      signal: this.#abortController.signal,
    });

    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController?.abort();
    this.#abortController = null;
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  get productUrl() {
    return this.querySelector("[data-quick-view-content]")?.dataset?.productUrl;
  }

  showDialog() {
    super.showDialog();

    document.dispatchEvent(
      new CustomEvent(ThemeEvents.quickViewOpened, {
        detail: { productUrl: this.productUrl },
      })
    );

    this.#dispatchProductView();
  }

  /**
   * Standard `shopify:product:view` (context `dialog`) for the product now
   * loaded, once per opening. The element is `manual` (see
   * sections/quick-view.liquid); it is defined only once the standard events
   * library loads, so wait for that rather than skip the view.
   */
  #dispatchProductView() {
    const viewEvent = this.querySelector('s-view-event[view-event-trigger="manual"]');
    if (!viewEvent) return;
    customElements
      .whenDefined("s-view-event")
      .then(() => {
        if (viewEvent.isConnected) /** @type {any} */ (viewEvent).dispatchViewEvent?.();
      })
      .catch(() => {});
  }

  #initializeCartCount() {
    const cartCountElement = document.querySelector('cart-count:not([data-context="drawer"])');
    if (cartCountElement?.refs?.cartBubbleCount) {
      this.#currentCartItemCount = parseInt(cartCountElement.refs.cartBubbleCount.textContent ?? "0", 10);
      return;
    }

    const cartBubbleCount = document.querySelector("[data-cart-bubble-count]");
    if (cartBubbleCount) {
      this.#currentCartItemCount = parseInt(cartBubbleCount.textContent ?? "0", 10);
      return;
    }

    this.#currentCartItemCount = 0;
  }

  /**
   * @param {CartAddEvent | CartUpdateEvent} event
   */
  handleCartUpdate = (event) => {
    if (event.detail.data?.didError) return;

    const itemCount = event.detail.data?.itemCount;
    const isIncremental = event.detail.data?.isIncremental ?? false;

    if (itemCount === undefined || itemCount === null) return;

    let newCartItemCount;

    if (isIncremental) {
      const currentCount = this.#currentCartItemCount ?? 0;
      newCartItemCount = Math.max(0, currentCount + itemCount);
    } else {
      newCartItemCount = Math.max(0, itemCount);
    }

    const currentCount = this.#currentCartItemCount ?? 0;

    if (newCartItemCount > currentCount) {
      this.closeDialog();
    }

    this.#currentCartItemCount = newCartItemCount;
  };

  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    /**
     * Patch for iOS 16.0 UI freeze when dialog closes.
     */
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      /** @type {HTMLElement | null} */
      const grid = document.querySelector("#ResultsList [product-grid-view]");
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = "";
        });
      }
    });
  };
}

if (!customElements.get("quick-view-dialog")) {
  customElements.define("quick-view-dialog", QuickViewDialog);
}
