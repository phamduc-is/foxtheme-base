import { ThemeEvents, VariantUpdateEvent } from "@theme/events";

/**
 * Custom element that displays a product title.
 *
 * Updates when a combined listing variant switch loads a new product.
 * Listens for VariantUpdateEvent with newProduct + html, then replaces
 * inner content from the freshly-rendered section HTML.
 */
class ProductTitle extends HTMLElement {
  #variantUpdateTarget = null;

  connectedCallback() {
    const target = this.closest("product-card") || this.closest(".shopify-section, dialog");
    if (!target) return;

    this.#variantUpdateTarget = target;
    target.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
  }

  disconnectedCallback() {
    this.#variantUpdateTarget?.removeEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
    this.#variantUpdateTarget = null;
  }

  /** @param {VariantUpdateEvent} event */
  #handleVariantUpdate = (event) => {
    const { newProduct, html } = event.detail.data;
    if (!newProduct || !html) return;

    // Keep our productId in sync before matching — the combined-listing switch is
    // exactly what makes it change.
    this.dataset.productId = newProduct.id;

    const newTitle = this.#findNewTitle(html);
    if (!newTitle) return;

    this.innerHTML = newTitle.innerHTML;
  };

  /**
   * Finds this element's counterpart in the fetched document — a WHOLE page, where a
   * bare `querySelector("product-title")` returns whichever comes first, not
   * necessarily ours. Same matching order as product-price / product-metas.
   *
   * @param {Document} html - The fetched document.
   * @returns {Element | null} The title to copy from, or null.
   */
  #findNewTitle(html) {
    const { blockId, productId } = this.dataset;
    /** @type {Element | null | undefined} */
    let newTitle = null;

    if (blockId) {
      newTitle = html.querySelector(`product-title[data-block-id="${CSS.escape(blockId)}"]`);
    }

    if (!newTitle && productId) {
      newTitle = [...html.querySelectorAll("product-title")].find((el) => el.dataset.productId === productId);
    }

    return newTitle ?? html.querySelector("product-title");
  }
}

if (!customElements.get("product-title")) {
  customElements.define("product-title", ProductTitle);
}
