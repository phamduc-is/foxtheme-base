import { inView } from "@theme/animation";
import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";
import { revealSwap } from "@theme/reveal-swap";
import { CookieManager, getLocalStorage, hasLocalStorage, setLocalStorage } from "@theme/utilities";

/** Mirrors REVEAL_DURATION in product-recommendations.js and the CSS transition. */
const REVEAL_DURATION = 250;

class RecentlyViewedProducts extends Component {
  /** Cancels the reveal in flight (if any). @type {(() => void) | null} */
  #finishReveal = null;

  connectedCallback() {
    super.connectedCallback();

    if (Shopify.designMode) return;

    // The list lives in localStorage, so the server rendered the section hidden with a
    // skeleton in it. Whether there IS a list is known right here, synchronously: no history →
    // the section goes, and a first-time shopper never sees a skeleton that then vanishes.
    // A history → un-hide now, so the skeleton holds the space the cards will take, and fetch
    // once the section comes within a viewport of the fold.
    const queryUrl = this.getQueryUrl();
    if (!queryUrl) {
      this.removeSection();
      return;
    }

    this.#section()?.classList.remove("hidden");
    inView(this, () => this.init(queryUrl), { margin: "0px 0px 100% 0px" });
  }

  disconnectedCallback() {
    this.#finishReveal?.();
    super.disconnectedCallback();
  }

  /** @param {string} [queryUrl] */
  init(queryUrl = this.getQueryUrl() || "") {
    if (!queryUrl) {
      this.removeSection();
      return;
    }

    fetch(queryUrl)
      .then((response) => response.text())
      .then((responseText) => {
        const sectionInnerHTML = new DOMParser()
          .parseFromString(responseText, "text/html")
          .querySelector(".shopify-section");

        if (sectionInnerHTML === null) return;

        const recommendations = sectionInnerHTML.querySelector("recently-viewed-products");
        // The ids in localStorage may all be gone from the store — nothing came back.
        if (!recommendations?.querySelector("product-card")) {
          this.removeSection();
          return;
        }

        recommendations.querySelector("[data-recommendations-section]")?.classList.remove("hidden");

        // Morph over the skeleton (the carousel survives and re-initialises in place) while the
        // host transitions from the skeleton height to the real one — not innerHTML, which
        // rebuilt the carousel from a flat list and let the page jump to the new height.
        this.#finishReveal?.();
        this.#finishReveal = revealSwap(this, recommendations, { duration: REVEAL_DURATION });
        this.dispatchEvent(new CustomEvent(ThemeEvents.recommendationsLoaded, { bubbles: true }));
      })
      .catch((e) => {
        console.error(e);
        this.removeSection();
      });
  }

  /** @returns {HTMLElement | null} */
  #section() {
    return this.querySelector("[data-recommendations-section]");
  }

  getQueryUrl() {
    const items = getLocalStorage(CookieManager.PRODUCT_RECENTLY_VIEWED) || [];
    const productId = parseInt(this.dataset.productId);
    const limit = parseInt(this.dataset.limit);

    if (this.dataset.productId && items.includes(productId)) {
      items.splice(items.indexOf(productId), 1);
    }

    if (items.length > 0) {
      const queryParams = items
        .map((item) => "id:" + item)
        .slice(0, limit)
        .join(" OR ");

      return this.dataset.url + queryParams;
    }

    return false;
  }

  removeSection() {
    this.#finishReveal?.();
    this.remove();
  }
}

if (!customElements.get("recently-viewed-products")) {
  customElements.define("recently-viewed-products", RecentlyViewedProducts);
}

class ProductRecentlyViewed extends HTMLElement {
  constructor() {
    super();

    if (hasLocalStorage()) {
      this.#addToRecentlyViewed();
    }
  }

  #addToRecentlyViewed() {
    if (!this.dataset.productId) {
      return;
    }

    const productId = parseInt(this.dataset.productId);
    const items = getLocalStorage(CookieManager.PRODUCT_RECENTLY_VIEWED) || [];

    if (items.includes(productId)) {
      items.splice(items.indexOf(productId), 1);
    }

    items.unshift(productId);

    setLocalStorage(CookieManager.PRODUCT_RECENTLY_VIEWED, items.slice(0, 20));
  }
}

if (!customElements.get("product-recently-viewed")) {
  customElements.define("product-recently-viewed", ProductRecentlyViewed);
}
