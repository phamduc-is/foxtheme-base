import { ThemeEvents } from "@theme/events";
import { formatCurrency } from "@theme/utilities";

class ProductBadge extends HTMLElement {
  connectedCallback() {
    // Prefer product-card so stopPropagation() in ProductCard.#handleVariantUpdate
    // (line: event.stopPropagation()) does not block the bubble — listeners on the
    // same target still fire after stopPropagation. Fallback for product page and dialogs.
    const target = this.closest("product-card") || this.closest(".shopify-section, dialog");
    if (!target) return;
    this.#variantUpdateTarget = target;
    target.addEventListener(ThemeEvents.variantUpdate, this.updateBadge);
    this.addEventListener("badge:update-optimistic", this.updateBadgeOptimistic);
  }

  disconnectedCallback() {
    this.#variantUpdateTarget?.removeEventListener(ThemeEvents.variantUpdate, this.updateBadge);
    this.#variantUpdateTarget = null;
    this.removeEventListener("badge:update-optimistic", this.updateBadgeOptimistic);
  }

  #variantUpdateTarget = null;

  /**
   * Updates the badge.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updateBadge = (event) => {
    const isProductChange = !!event.detail.data.newProduct;

    if (isProductChange) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (
      event.target instanceof HTMLElement &&
      event.target.dataset.productId !== this.dataset.productId
    ) {
      return;
    }

    // Skip if no HTML (cache hit - will sync via background fetch)
    if (!event.detail.data.html) return;

    // Find the correct product-badge in HTML by matching productId
    // This prevents taking badge from wrong product (e.g. recommendations)
    const productId = this.dataset.productId;
    let newBadge = null;

    if (productId) {
      // Find all product-badge elements and match by productId
      const allBadges = event.detail.data.html.querySelectorAll("product-badge");
      for (const badge of allBadges) {
        if (badge.dataset.productId === productId) {
          newBadge = badge.querySelector('[ref="badgesContainer"]');
          break;
        }
      }
    }

    // Fallback: if no productId match, use first badge (for single product pages)
    if (!newBadge) {
      const fallbackBadge = event.detail.data.html.querySelector("product-badge");
      newBadge = fallbackBadge?.querySelector('[ref="badgesContainer"]');
    }

    const currentBadge = this.querySelector('[ref="badgesContainer"]');

    if (!newBadge || !currentBadge) return;

    if (isProductChange) {
      // Combined-listing product change: tags differ → replace whole badges
      if (currentBadge.innerHTML !== newBadge.innerHTML) {
        currentBadge.replaceWith(newBadge);
      }
      return;
    }

    // Same product, different variant: only sync variant-driven state.
    // Custom tag badges (new/hot/popular) are product-level and unchanged.
    // Avoid replaceWith here — the section render uses generic settings (e.g. show_sale_badge:
    // settings.pcard_show_sale_badge) that would overwrite placement-specific layout
    // (on-media vs on-content) configured at initial render in product-card-markup.liquid.
    currentBadge.dataset.available = newBadge.dataset.available;
    currentBadge.dataset.onSale = newBadge.dataset.onSale;
    // Copy the whole sale-badge content, not just [data-sale-value]: a discount
    // that rounds below 1% renders a different inner structure (the "On sale"
    // fallback, without the "Save" prefix), so a value-only copy would produce
    // "Save On sale". Moving the nodes keeps the badge element (and its
    // placement-specific classes) untouched.
    const newSaleBadge = newBadge.querySelector('[data-badge-type="sale"]');
    const currentSaleBadge = currentBadge.querySelector('[data-badge-type="sale"]');
    if (newSaleBadge && currentSaleBadge && currentSaleBadge.innerHTML !== newSaleBadge.innerHTML) {
      currentSaleBadge.replaceChildren(...newSaleBadge.childNodes);
    }
  };

  /**
   * ⚡ Optimistic badge update from cached variant data (instant, no network delay)
   *
   * Updates:
   * - .badge--sold-out visibility based on variant.available
   * - .badge--sale visibility based on compare_at_price > price
   * - .badge--sale [data-sale-value] amount for percentage/fixed_amount types
   * - product-badges--empty class based on visible badge count
   *
   * Note: Custom tag badges (new/hot/popular) are product-level and unchanged per variant.
   * Note: If a badge element doesn't exist in the DOM (e.g. initial render was non-sale),
   *       it cannot be created optimistically — the HTML morph will handle that case.
   *
   * @param {CustomEvent} event - The optimistic update event with variant data
   */
  updateBadgeOptimistic = (event) => {
    const variant = event.detail.variant;
    const badgesContainer = this.querySelector('[ref="badgesContainer"]');
    if (!badgesContainer || !variant) return;

    const isAvailable = Boolean(variant.available);
    const isOnSale = variant.compare_at_price > variant.price;

    // Flip data attributes — CSS handles show/hide of all badge groups
    badgesContainer.dataset.available = String(isAvailable);
    badgesContainer.dataset.onSale = String(isOnSale);

    // Update sale badge amount text. When not on sale, reset the value so the
    // hidden DOM doesn't expose a stale percentage to crawlers / screen readers.
    const saleBadge = badgesContainer.querySelector('[data-badge-type="sale"]');
    const saleValueEl = saleBadge?.querySelector("[data-sale-value]");
    if (saleValueEl) {
      const badgeType = badgesContainer.dataset.saleBadgeType;
      const moneyFormat = window.FoxTheme?.moneyFormat || "${{amount}}";
      const showValue = isAvailable && isOnSale;

      if (badgeType === "percentage") {
        // product-badges uses save_price_html: "Save <span data-sale-value>20%</span>" (no minus prefix)
        const pct = showValue
          ? Math.round(((variant.compare_at_price - variant.price) / variant.compare_at_price) * 100)
          : 0;
        if (pct > 0) {
          saleValueEl.textContent = `${pct}%`;
        } else {
          // Below 0.5% there is no meaningful percentage: show the "On sale"
          // fallback on its own — keeping the localized "Save" prefix would
          // read "Save On sale". Keep the value span itself so a later switch
          // can still patch it; the section render restores the full markup.
          saleBadge.replaceChildren(saleValueEl);
          saleValueEl.textContent = saleBadge.dataset.saleFallback || "";
        }
      } else if (badgeType === "fixed_amount") {
        saleValueEl.textContent = showValue
          ? formatCurrency(variant.compare_at_price - variant.price, moneyFormat)
          : "0";
      }
      // default ("On sale"): static text, no [data-sale-value] in DOM.
    }

    // Recalculate empty class based on what CSS would show
    let visibleCount = 0;
    if (!isAvailable) {
      visibleCount = badgesContainer.querySelectorAll('[data-badge-type="sold-out"]').length;
    } else if (isOnSale) {
      visibleCount = badgesContainer.querySelectorAll('[data-badge-type]:not([data-badge-type="sold-out"])').length;
    } else {
      visibleCount = badgesContainer.querySelectorAll(
        '[data-badge-type]:not([data-badge-type="sold-out"]):not([data-badge-type="sale"])'
      ).length;
    }
    badgesContainer.classList.toggle("product-badges--empty", visibleCount === 0);
  };
}

if (!customElements.get("product-badge")) {
  customElements.define("product-badge", ProductBadge);
}
