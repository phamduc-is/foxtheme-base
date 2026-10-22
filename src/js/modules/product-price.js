import { ThemeEvents, VariantUpdateEvent } from "@theme/events";
import { formatCurrency, getMoneyFormat } from "@theme/utilities";

/**
 * Custom element that displays a product price.
 *
 * Two-stage update on variant change:
 *   1. Optimistic (instant) — class toggle + text mutation from cached/fetched
 *      variant JSON. Provides 0ms visual feedback.
 *   2. Background HTML morph (~100–300ms) — replaceWith from the section render
 *      response. Settles structural differences that class-toggle can't patch
 *      (e.g. .price--no-compare on initial render vs absent on variant render,
 *      sale-badge wrapper variations).
 *
 * Both stages always run on variant change — they are not mutually exclusive.
 * The bg-sync replaceWith with structurally identical content is a visual
 * no-op, and it guarantees the next optimistic update operates on a clean,
 * variant-correct DOM.
 */
class ProductPrice extends HTMLElement {
  #variantUpdateTarget = null;

  connectedCallback() {
    // Prefer product-card so stopPropagation() in ProductCard.#handleVariantUpdate
    // does not block the bubble — listeners on the same target still fire after
    // stopPropagation. Fallback for product page and dialogs.
    const target = this.closest("product-card") || this.closest(".shopify-section, dialog");
    if (!target) return;

    this.#variantUpdateTarget = target;
    target.addEventListener(ThemeEvents.variantUpdate, this.updatePrice);
    this.addEventListener("price:update-optimistic", this.updatePriceOptimistic);
  }

  disconnectedCallback() {
    this.#variantUpdateTarget?.removeEventListener(ThemeEvents.variantUpdate, this.updatePrice);
    this.#variantUpdateTarget = null;
    this.removeEventListener("price:update-optimistic", this.updatePriceOptimistic);
  }

  /**
   * Background HTML morph. Always runs when full HTML arrives — no skip-on-match
   * gating with the optimistic update, since optimistic is a class+text patch,
   * not a structural one.
   *
   * @param {VariantUpdateEvent} event
   */
  updatePrice = (event) => {
    const variant = event.detail.resource;

    // Cache hit / JSON dispatch carries html: null. The follow-up bg sync
    // (with html populated) will deliver the structure morph.
    if (!event.detail.data.html) return;

    // Combined-listing product change: keep our productId in sync.
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (
      event.target instanceof HTMLElement &&
      event.target.dataset.productId &&
      this.dataset.productId &&
      event.target.dataset.productId !== this.dataset.productId
    ) {
      // Filter only when both sides have a productId set.
      return;
    }

    const newPrice = this.#findNewPriceContainer(event.detail.data.html);
    const currentPrice = this.querySelector('[ref="priceContainer"]');
    if (!newPrice || !currentPrice) return;

    // No variant resolved (fallback fetch path) — hide.
    if (!variant) {
      this.style.display = "none";
      return;
    }
    this.style.display = "";

    const soldOutChanged =
      currentPrice.classList.contains("price--sold-out") !== newPrice.classList.contains("price--sold-out");

    if (currentPrice.innerHTML !== newPrice.innerHTML || soldOutChanged) {
      currentPrice.replaceWith(newPrice);
    }
  };

  /**
   * Finds this element's counterpart in the fetched document — a WHOLE page, where a
   * bare `querySelector('product-price …')` returns whichever comes first: a header
   * mega-menu card, whose product-level "From $X" then landed here after every variant
   * switch. Match on block id, then product id, the way product-metas and product-badge
   * do; the first-element fallback covers product cards, whose response holds one card.
   *
   * Cloned because `replaceWith` would MOVE the node out of the parsed document, which
   * the page's other product-price elements read from after us.
   *
   * @param {Document} html - The fetched document.
   * @returns {Element | null} The price container to adopt, or null.
   */
  #findNewPriceContainer(html) {
    const { blockId, productId } = this.dataset;
    /** @type {Element | null | undefined} */
    let host = null;

    if (blockId) {
      host = html.querySelector(`product-price[data-block-id="${CSS.escape(blockId)}"]`);
    }

    if (!host && productId) {
      host = [...html.querySelectorAll("product-price")].find((el) => el.dataset.productId === productId);
    }

    host ??= html.querySelector("product-price");

    const container = host?.querySelector('[ref="priceContainer"]');

    return container ? /** @type {Element} */ (container.cloneNode(true)) : null;
  }

  /**
   * Optimistic price update from cached / freshly-fetched variant JSON.
   * Runs synchronously in variant-picker before the bg HTML fetch completes,
   * giving the user 0ms feedback. Patches text content + visibility classes
   * only — the bg HTML morph handles structural differences.
   *
   * @param {CustomEvent} event
   */
  updatePriceOptimistic = (event) => {
    const variant = event.detail.variant;
    const priceContainer = this.querySelector('[ref="priceContainer"]');
    if (!priceContainer) return;

    if (!variant) {
      this.style.display = "none";
      return;
    }
    this.style.display = "";

    try {
      const moneyFormat = getMoneyFormat();
      // The fixed-amount sale badge mirrors `| money` in price.liquid — no currency
      // code, even when the setting is on.
      const badgeMoneyFormat = getMoneyFormat(false);
      const price = formatCurrency(variant.price, moneyFormat);
      const comparePrice =
        variant.compare_at_price > variant.price ? formatCurrency(variant.compare_at_price, moneyFormat) : null;
      const isOnSale = Boolean(comparePrice);

      // Visibility: .price--on-sale toggles .price__regular vs .price__sale
      priceContainer.classList.toggle("price--on-sale", isOnSale);

      // .price--no-compare is set by initial product-level render when a
      // meaningful product-level compare can't be computed. Once we have
      // a specific variant, that condition no longer applies.
      priceContainer.classList.remove("price--no-compare");

      // Sale block: only filled when the variant is on sale (kept empty
      // otherwise so the DOM doesn't expose a duplicate sale price to crawlers).
      const salePriceDiv = priceContainer.querySelector("[data-price-sale]");
      if (salePriceDiv) {
        const salePriceEl = salePriceDiv.querySelector("[data-price-amount]");
        const comparePriceEl = salePriceDiv.querySelector("[data-compare-price]");
        if (salePriceEl) salePriceEl.textContent = isOnSale ? price : "";
        if (comparePriceEl) comparePriceEl.textContent = isOnSale && comparePrice ? comparePrice : "";

        const saleBadgeEl = salePriceDiv.querySelector("[data-sale-badge]");
        const saleValueEl = saleBadgeEl?.querySelector("[data-sale-value]");
        if (saleValueEl) {
          const badgeType = saleBadgeEl.dataset.saleBadgeType;
          if (badgeType === "percentage") {
            // A discount smaller than 0.5% rounds to 0 and "-0" is meaningless,
            // so fall back to the localized "On sale" text — same rule as the
            // Liquid render in snippets/price.liquid.
            const pct = isOnSale
              ? Math.round(((variant.compare_at_price - variant.price) / variant.compare_at_price) * 100)
              : 0;
            saleValueEl.textContent = pct > 0 ? `-${pct}%` : saleBadgeEl.dataset.saleFallback || "";
          } else if (badgeType === "fixed_amount") {
            saleValueEl.textContent = isOnSale
              ? formatCurrency(variant.compare_at_price - variant.price, badgeMoneyFormat)
              : "0";
          }
          // default ("On sale"): static, no update.
        }
      }

      // Regular block: only filled when NOT on sale. Skip mutation when text
      // currently shows a price range ("From X" / "X – Y") since variant data
      // can't represent the range.
      const regularPriceDiv = priceContainer.querySelector("[data-price-regular]");
      const regularPriceEl = regularPriceDiv?.querySelector("[data-price-amount]");
      if (
        regularPriceEl &&
        !regularPriceEl.textContent.includes("–") &&
        !regularPriceEl.textContent.includes("from")
      ) {
        regularPriceEl.textContent = isOnSale ? "" : price;
      }

      // Unit price
      const unitPriceEl = priceContainer.querySelector("[data-unit-price]");
      if (variant.unit_price && variant.unit_price_measurement) {
        const unitPrice = formatCurrency(variant.unit_price, moneyFormat);
        const { reference_value, reference_unit } = variant.unit_price_measurement;
        const unitLabel = reference_value !== 1 ? `${reference_value}${reference_unit}` : reference_unit;
        const unitPriceText = ` ${unitPrice}/${unitLabel} `;
        if (unitPriceEl) {
          const textNode = [...unitPriceEl.childNodes].find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== ""
          );
          if (textNode) textNode.textContent = unitPriceText;
          else unitPriceEl.appendChild(document.createTextNode(unitPriceText));
          unitPriceEl.style.display = "";
        } else {
          const small = document.createElement("small");
          small.className = "unit-price color-subtext";
          small.dataset.unitPrice = "";
          small.innerHTML = `<span class="visually-hidden">${
            window.FoxTheme?.translations?.unit_price || "Unit price"
          }</span>${unitPriceText}`;
          priceContainer.appendChild(small);
        }
      } else if (unitPriceEl) {
        unitPriceEl.style.display = "none";
      }
    } catch (error) {
      console.error("Error updating price:", error);
    }
  };
}

if (!customElements.get("product-price")) {
  customElements.define("product-price", ProductPrice);
}
