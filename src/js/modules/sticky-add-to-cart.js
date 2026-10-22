import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";
import { morph } from "@theme/morph";

/**
 * @capability Fixed add-to-cart bar for the product page — appears once the real buy buttons scroll out of view, hides again near the footer, morphs its content on variant change (price/image/availability), and proxies its button click to the real product form's add-to-cart button with a loading spinner.
 * @when Product templates that need a persistent purchase bar on scroll. Pairs with src/scss/global/_sticky-add-to-cart.scss. Reuse instead of building a new IntersectionObserver-driven sticky bar or duplicating variant sync.
 * @contract <sticky-add-to-cart data-product-id> with ref="stickyBar" (data-sticky="true|false" drives visibility), ref="addToCartButton" (carries data-add-to-cart-text/data-sold-out-text/data-unavailable-text), ref="addToCartSpinner", ref="addToCartText", optional [data-sticky-variant-title] + [data-sticky-image]; requires a .buy-buttons-block inside the section's product-form-component and a page footer; listens to ThemeEvents variantUpdate/variantSelected/cartUpdate/cartError.
 * @keywords sticky add to cart, sticky buy bar, fixed bottom bar, scroll reveal bar, variant sync, add to cart proxy, product page sticky, floating cart button
 */
class StickyAddToCart extends Component {
  requiredRefs = ["stickyBar", "addToCartButton", "addToCartSpinner", "addToCartText"];

  #abortController = new AbortController();
  #buyButtonsIntersectionObserver = null;
  #footerSectionObserver = null;
  #isSticky = false;
  #hiddenInFooter = false;

  connectedCallback() {
    super.connectedCallback();

    this.#setupIntersectionObserver();
    const { signal } = this.#abortController;
    const target = this.closest(".shopify-section");

    target?.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate, { signal });
    target?.addEventListener(ThemeEvents.variantSelected, this.#handleVariantSelected, { signal });

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.cartError, this.#handleCartAddComplete, { signal });
  }

  disconnectedCallback() {
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#footerSectionObserver?.disconnect();
    this.#abortController.abort();
    super.disconnectedCallback();
  }

  updatedCallback() {
    super.updatedCallback?.();
    // Re-setup observers with fresh DOM references after morph
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#footerSectionObserver?.disconnect();
    this.#setupIntersectionObserver();
  }

  #setupIntersectionObserver() {
    const productForm = this.#getProductForm();
    if (!productForm) return;

    const buyButtonsBlock = productForm.closest(".buy-buttons-block");
    if (!buyButtonsBlock) return;

    const footer = document.querySelector("footer") ?? document.querySelector(".shopify-section-group-footer-group");
    if (!footer) return;

    this.#buyButtonsIntersectionObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      if (!entry.isIntersecting && !this.#isSticky) {
        const rect = entry.target.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top < 0) {
          this.#show();
        }
      } else if (this.#isSticky && entry.isIntersecting) {
        this.#hiddenInFooter = false;
        this.#hide();
      }
    });

    this.#footerSectionObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) return;
        if (entry.isIntersecting && this.#isSticky) {
          this.#hiddenInFooter = true;
          this.#hide();
        } else if (!entry.isIntersecting && this.#hiddenInFooter) {
          const rect = buyButtonsBlock.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top < 0) {
            this.#hiddenInFooter = false;
            this.#show();
          }
        }
      },
      {
        rootMargin: "0px 0px -200px 0px",
      }
    );

    this.#buyButtonsIntersectionObserver.observe(buyButtonsBlock);
    this.#footerSectionObserver.observe(footer);
  }

  #handleVariantUpdate = (event) => {
    if (event.detail.data.productId !== this.dataset.productId) return;

    const variant = event.detail.resource;
    const html = event.detail.data?.html;

    if (!html) {
      if (event.detail.data?.isBackgroundSync) return;
      if (variant) {
        this.#applyVariantOptimistic(variant);
      } else if (event.detail.data?.fromCache) {
        // A combination with no variant, known from the preloaded list.
        const price = this.querySelector("product-price");
        if (price instanceof HTMLElement) price.style.display = "none";
        this.dataset.variantAvailable = "false";
        this.#handleVariantUnavailable();
      }
      return;
    }

    const newStickyAddToCart = html.querySelector("sticky-add-to-cart");
    if (!newStickyAddToCart) return;

    const newStickyBar = newStickyAddToCart.querySelector('[ref="stickyBar"]');
    if (!newStickyBar) return;

    const currentSticky = this.refs.stickyBar.getAttribute("data-sticky") || "false";
    const variantAvailable = newStickyAddToCart.dataset.variantAvailable;

    // Use default MORPH_OPTIONS (not a plain object) so onAfterUpdate fires,
    // which triggers updatedCallback on responsive-image and re-adds .loaded/.in-view.
    morph(this.refs.stickyBar, newStickyBar);

    this.refs.stickyBar.setAttribute("data-sticky", currentSticky);
    this.dataset.variantAvailable = variantAvailable;

    if (variant && variant.id) {
      this.dataset.currentVariantId = variant.id;
    }

    const isSoldOut = variant && !variant.available && variant.inventory_management === "shopify";
    this.#updateButtonText(variant?.available, isSoldOut);

    if (variant == null) {
      this.#handleVariantUnavailable();
    }
  };

  /**
   * Cache-hit / JSON path: the event carries the variant but no HTML yet. The
   * bar is where the shopper sees price, title and button side by side, so it
   * must not trail the main price by the section round-trip (~0.7 s). The morph
   * that follows restates everything set here.
   * @param {{ id: string | number, available?: boolean, inventory_management?: string | null, title?: string, featured_media?: { preview_image?: { src?: string } } }} variant
   */
  #applyVariantOptimistic(variant) {
    this.dataset.currentVariantId = String(variant.id);
    this.dataset.variantAvailable = String(Boolean(variant.available));

    const price = this.querySelector("product-price");
    if (price instanceof HTMLElement) {
      price.dispatchEvent(new CustomEvent("price:update-optimistic", { detail: { variant }, bubbles: false }));
      // Liquid hides the price of an unavailable variant; the price component only knows "variant or none".
      price.style.display = variant.available ? "" : "none";
    }

    const title = this.querySelector("[data-sticky-variant-title]");
    const content = title?.closest("[data-singleton]");
    if (title && variant.title && content?.dataset.singleton !== "true") title.textContent = variant.title;

    const image = this.querySelector("[data-sticky-image] img");
    const src = variant.featured_media?.preview_image?.src;
    if (image instanceof HTMLImageElement && src) {
      const url = new URL(src, window.location.origin);
      const at = (width) => {
        url.searchParams.set("width", String(width));
        return url.href;
      };
      image.srcset = `${at(240)} 240w, ${at(480)} 480w`;
      image.src = at(240);
    }

    const isSoldOut = !variant.available && variant.inventory_management === "shopify";
    this.#updateButtonText(Boolean(variant.available), isSoldOut);
    const { addToCartButton } = this.refs;
    if (addToCartButton instanceof HTMLButtonElement) addToCartButton.disabled = !variant.available;
  }

  #handleVariantSelected = (event) => {
    const variantId = event.detail.resource?.id;
    if (!variantId) return;
    this.dataset.currentVariantId = variantId;
  };

  #handleVariantUnavailable = () => {
    this.dataset.currentVariantId = "";
    const variantTitleElement = this.querySelector("[data-sticky-variant-title]");
    const productId = this.dataset.productId;
    const variantPicker = document.querySelector(`variant-picker[data-product-id="${productId}"]`);
    if (!variantTitleElement || !variantPicker) return;

    // Check if variant picker uses input radio buttons or select dropdowns
    // They don't exist simultaneously, so we only need to check one type
    const hasInputs = variantPicker.querySelector("input[type='radio']") !== null;
    let selectedOptions = "";

    if (hasInputs) {
      // Get selected values from input radio buttons
      selectedOptions = Array.from(variantPicker.querySelectorAll("input:checked"))
        .map((option) => option.value)
        .filter((value) => value !== "")
        .join(" / ");
    } else {
      // Get selected values from select dropdowns
      selectedOptions = Array.from(variantPicker.querySelectorAll("select.variant-option__select"))
        .map((select) => {
          const selectedOption = select.options[select.selectedIndex];
          return selectedOption ? selectedOption.value : "";
        })
        .filter((value) => value !== "")
        .join(" / ");
    }

    if (!selectedOptions) return;
    variantTitleElement.textContent = selectedOptions;

    this.#updateButtonText(false);
  };

  handleAddToCartClick = () => {
    const productForm = this.#getProductForm();
    const targetButton = productForm?.querySelector('[ref="addToCartButton"]');
    if (!targetButton) return;
    this.#addLoading();
    targetButton.click();
  };

  #handleCartAddComplete = () => {
    this.#removeLoading();
  };

  #updateButtonText = (isAvailable, isSoldOut = false) => {
    const { addToCartText, addToCartButton } = this.refs;
    if (!addToCartText) return;

    let label;
    if (isAvailable) {
      label = addToCartButton.dataset.addToCartText;
    } else if (isSoldOut) {
      label = addToCartButton.dataset.soldOutText;
    } else {
      label = addToCartButton.dataset.unavailableText;
    }

    addToCartText.textContent = label;
    // Same reason as product-form: left behind, the bar would keep offering
    // "Add to cart" for a variant that is sold out.
    addToCartText.closest("[data-label]")?.setAttribute("data-label", label);
  };

  #getProductForm() {
    const productId = this.dataset.productId;
    if (!productId) return null;

    const sectionElement = this.closest(".shopify-section");
    if (!sectionElement) return null;

    const sectionId = sectionElement.id.replace("shopify-section-", "");
    return document.querySelector(
      `#shopify-section-${sectionId} product-form-component[data-product-id="${productId}"]`
    );
  }

  #show() {
    const { stickyBar } = this.refs;
    this.#isSticky = true;
    stickyBar.dataset.sticky = "true";

    // The global reveal IntersectionObserver excludes the bottom 50px (rootMargin -50px),
    // so the fixed sticky bar is never detected as in-viewport by it.
    // Force-add .in-view when the bar becomes visible so zoom-reveal images display correctly.
    // Inside [data-sticky-image] is the responsive-image wrapper (.media).
    const mediaWrapper = stickyBar.querySelector("[data-sticky-image]")?.firstElementChild;
    if (mediaWrapper?.classList.contains("loaded")) {
      mediaWrapper.classList.add("in-view");
    }
  }

  #hide() {
    const { stickyBar } = this.refs;
    this.#isSticky = false;
    stickyBar.dataset.sticky = "false";
  }

  #addLoading() {
    this.refs.addToCartButton.classList.add("btn--loading");
    this.refs.addToCartSpinner.classList.remove("hidden");
  }

  #removeLoading() {
    this.refs.addToCartButton.classList.remove("btn--loading");
    this.refs.addToCartSpinner.classList.add("hidden");
  }
}

if (!customElements.get("sticky-add-to-cart")) {
  customElements.define("sticky-add-to-cart", StickyAddToCart);
}
