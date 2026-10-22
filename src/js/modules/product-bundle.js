import { Component } from "@theme/component";
import { CartAddEvent, CartErrorEvent, CartGroupedSections, CartUpdateEvent, ThemeEvents } from "@theme/events";
import { fetchConfig, formatCurrency, getMoneyFormat, isMobileBreakpoint } from "@theme/utilities";
import {
  contextFor,
  dispatchCartLinesUpdate,
  rejectCartResult,
  resolveCartResult,
  toMerchandiseGid,
} from "@theme/standard-events";

export class BaseMultiProductAddToCart extends Component {
  /** @type {number | undefined} */
  #timeout;

  constructor() {
    super();
  }

  /**
   * Abstract method to get the items to add to the cart.
   * return an array of objects with id and quantity properties.
   * @returns {Array<{id: string, quantity: number}>}
   * @example
   * return [
   *   { id: "123", quantity: 1 },
   *   { id: "456", quantity: 2 },
   * ];
   */
  getItems() {
    throw new Error("Subclass must implement getItems method");
  }

  getQuantiy() {
    const items = this.getItems();
    return items.reduce((acc, item) => acc + item.quantity, 0);
  }

  /**
   * Abstract method to get the submit element.
   * @returns {HTMLButtonElement}
   */
  getSubmitElement() {
    throw new Error("Subclass must implement getSubmitElement method");
  }

  /**
   * Abstract method to get the message element.
   * @returns {HTMLDivElement}
   */
  getMessageElement() {
    throw new Error("Subclass must implement getMessageElement method");
  }

  onAddToCartClick(event) {
    event?.preventDefault();

    const items = this.getItems();
    if (!items.length) return;

    const submitElement = this.getSubmitElement();
    if (submitElement.getAttribute("aria-disabled") === "true") return;
    submitElement.setAttribute("aria-disabled", "true");
    this.#showErrorMessage();
    this.#toggleButtonLoading(true);

    const shouldRedirectToCartAfterAdd = FoxTheme.template.name == "cart" || FoxTheme.settings.cartType != "drawer";

    let sectionsToUpdate = [];
    document.dispatchEvent(new CartGroupedSections(sectionsToUpdate));

    const body = JSON.stringify({
      items,
      sections: Array.from(sectionsToUpdate).join(","),
      sections_url: window.location.pathname,
    });

    const fetchCfg = fetchConfig("json", { body });

    // Standard storefront event — apps listen for shopify:cart:lines-update.
    const standardHandles = dispatchCartLinesUpdate(this, {
      action: "add",
      context: contextFor(this, "product"),
      lines: items.map((item) => ({
        merchandiseId: toMerchandiseGid(item.id),
        quantity: item.quantity || 1,
      })),
    });

    fetch(`${FoxTheme.routes.cart_add_url}`, fetchCfg)
      .then((response) => response.json())
      .then(async (response) => {
        if (response.status) {
          resolveCartResult(standardHandles, {
            userErrors: [{ code: "INVALID", message: response.description || response.message }],
          });

          this.dispatchEvent(
            new CartErrorEvent(this.id || "", response.message, response.description, response.errors)
          );

          document.dispatchEvent(
            new CustomEvent(ThemeEvents.productAjaxError, {
              detail: { errorMessage: response.description || response.message },
            })
          );

          this.#showErrorMessage(response.description);

          // Fetch cart.js AND section HTML in parallel for instant morph (same ids as add-to-cart `sections` payload)
          const sectionIds = [...new Set(sectionsToUpdate)];
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
          return;
        } else {
          resolveCartResult(standardHandles);

          if (shouldRedirectToCartAfterAdd) {
            window.location = FoxTheme.routes.cart_url;
            return;
          }

          this.dispatchEvent(
            new CartAddEvent(response, this.id, {
              itemCount: this.getQuantiy(),
              sections: response.sections,
            })
          );

          document.dispatchEvent(
            new CustomEvent(ThemeEvents.productAjaxAdded, {
              detail: { product: response },
            })
          );
        }
      })
      .catch((e) => {
        rejectCartResult(standardHandles, this, e);
        console.error(e);
      })
      .finally(() => {
        submitElement.removeAttribute("aria-disabled");
        this.#toggleButtonLoading(false);
      });
  }

  #showErrorMessage(message = false) {
    // Clear existing timeout to reset the 5s timer
    if (this.#timeout) {
      clearTimeout(this.#timeout);
    }

    const messageElement = this.getMessageElement();

    if (messageElement) {
      messageElement.classList.toggle("hidden", !message);

      if (message) {
        messageElement.textContent = message;

        // Hide error message after 5 seconds
        this.#timeout = setTimeout(() => {
          messageElement.classList.add("hidden");
        }, 5000);
      }
    } else {
      message && alert(message);
    }
  }

  #toggleButtonLoading(isLoading) {
    const submitElement = this.getSubmitElement();
    submitElement && submitElement.classList.toggle("btn--loading", isLoading);
  }
}

export class ProductBundleVariantSelector extends Component {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { variantSelect } = this.refs;

    this.currentOptionIds = variantSelect ? variantSelect.options[variantSelect.selectedIndex].dataset.optionsId : null;
    this.currentVariantId = variantSelect ? variantSelect.value : null;
  }

  get productId() {
    return this.dataset.productId;
  }

  get productUrl() {
    return this.dataset.productUrl;
  }

  get sectionId() {
    return this.dataset.sectionId;
  }

  /**
   * @param {Element} element
   * @returns {element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement}
   */
  #isFormInputElement(element) {
    return (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    );
  }

  /**
   * @param {Element} destination
   */
  #clearVariantSyncElement(destination) {
    if (this.#isFormInputElement(destination)) {
      if (destination instanceof HTMLSelectElement) {
        destination.innerHTML = "";
        destination.value = "";
        destination.selectedIndex = -1;
      } else if (destination instanceof HTMLInputElement) {
        if (destination.type === "checkbox" || destination.type === "radio") {
          destination.checked = false;
        } else {
          destination.value = "";
        }
      } else {
        destination.value = "";
      }
      return;
    }

    destination.innerHTML = "";
  }

  /**
   * @param {Element} source
   * @param {Element} destination
   */
  #syncVariantSyncElement(source, destination) {
    if (this.#isFormInputElement(destination)) {
      if (destination instanceof HTMLSelectElement && source instanceof HTMLSelectElement) {
        const preservedValue = destination.value;
        destination.innerHTML = source.innerHTML;
        if ([...destination.options].some((option) => option.value === preservedValue)) {
          destination.value = preservedValue;
        }
        return;
      }

      const preservedValue = destination.value;
      const preservedChecked =
        destination instanceof HTMLInputElement && (destination.type === "checkbox" || destination.type === "radio")
          ? destination.checked
          : null;

      const replacement = source.cloneNode(true);
      if (replacement instanceof HTMLInputElement || replacement instanceof HTMLTextAreaElement) {
        if (preservedChecked != null) {
          replacement.checked = preservedChecked;
        } else if (preservedValue) {
          replacement.value = preservedValue;
        }
      }
      destination.replaceWith(replacement);
      return;
    }

    destination.replaceWith(source);
  }

  /**
   * @param {Element | null} sourceRoot
   * @param {Element | null} destRoot
   */
  #syncProductCardFromFetchedHtml(sourceRoot, destRoot) {
    if (!sourceRoot || !destRoot) return;

    destRoot.querySelectorAll("[data-variant-sync]").forEach((destination) => {
      const syncKey = destination.dataset.variantSync;
      if (!syncKey) return;

      const source = sourceRoot.querySelector(`[data-variant-sync="${CSS.escape(syncKey)}"]`);

      if (!source) {
        this.#clearVariantSyncElement(destination);
        return;
      }

      this.#syncVariantSyncElement(source, destination);
    });
  }

  /**
   * @param {HTMLSelectElement} variantSelect
   */
  updateVariantFromSelect(variantSelect) {
    this.currentOptionIds = variantSelect.options[variantSelect.selectedIndex].dataset.optionsId;
    this.currentVariantId = variantSelect.value;
  }

  getVariantChangeFetchUrl() {
    return `${this.productUrl.split("?")[0]}?section_id=${this.sectionId}&option_values=${this.currentOptionIds}`;
  }

  getProductCardFromSource(html) {
    return html.querySelector(this.#productCardWrapperSelector());
  }

  #productCardWrapperSelector() {
    return `[data-product-card-wrapper][data-product-id="${this.productId}"]`;
  }

  fetchAndSyncProductCard() {
    return fetch(this.getVariantChangeFetchUrl())
      .then((response) => response.text())
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, "text/html");
        const pcardSource = this.getProductCardFromSource(html);
        const pcardDestination = this.closest(this.#productCardWrapperSelector());

        this.#syncProductCardFromFetchedHtml(pcardSource, pcardDestination);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  onVariantChange(event) {
    this.updateVariantFromSelect(event.target);
    this.fetchAndSyncProductCard().then(() => {
      this.dispatchEvent(new CustomEvent("variant-change", { bubbles: true }));
    });
  }
}

if (!customElements.get("product-bundle-variant-selector")) {
  customElements.define("product-bundle-variant-selector", ProductBundleVariantSelector);
}

export class ProductBundle extends BaseMultiProductAddToCart {
  #abortController = new AbortController();

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const { hotspots } = this.refs;
    this.onHoverHandler = this.#handleHover.bind(this);

    if (hotspots) {
      hotspots.forEach((hotspot) => {
        ["mouseover", "mouseleave", "focus", "focusout"].forEach((eventName) => {
          hotspot.addEventListener(eventName, this.onHoverHandler, { signal });
        });
      });
    }

    this.#setButtonDisable();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  getItems() {
    const productForms = this.querySelectorAll("[data-product-card-form]");

    return Array.from(productForms, (form) => ({
      id: form.querySelector("[name=id]")?.value,
      quantity: Number(form.querySelector("[name=quantity]")?.value) || 1,
    })).filter((item) => item.id);
  }

  getSubmitElement() {
    return this.refs.addAllToCart;
  }

  getMessageElement() {
    return this.refs.addToCartTextError;
  }

  #handleHover(event) {
    const { type, target } = event;
    const { productList } = this.refs;
    const { products } = productList.refs;
    const hotspot = target.closest('[ref="hotspots[]"]');
    const hotspotIndex = Number(hotspot.dataset.index);
    const isEnter = "mouseover" === type || "focus" === type;

    hotspot.classList.toggle("is-selected", isEnter);
    if (!isMobileBreakpoint()) {
      this.classList.toggle("is-hover", isEnter);
    }

    let activeProduct = null;
    products.forEach((product) => {
      const productIndex = Number(product.dataset.index);
      product.classList.toggle("is-selected", hotspotIndex === productIndex);
      if (hotspotIndex === productIndex) {
        activeProduct = product;
      }
    });

    if (isEnter) {
      if (
        productList.swiperInstance &&
        typeof productList.swiperInstance === "object" &&
        !productList.swiperInstance.visibleSlidesIndexes.includes(hotspotIndex)
      ) {
        productList.swiperInstance.slideTo(hotspotIndex);
      }

      if (isMobileBreakpoint() && activeProduct) {
        this.#scrollToTop(activeProduct);
      }
    }
  }

  #scrollToTop(target, offset = 80) {
    const scrollIntoView = (selector, offset) => {
      window.scrollTo({
        behavior: "smooth",
        top: selector.getBoundingClientRect().top - document.body.getBoundingClientRect().top - offset,
      });
    };

    scrollIntoView(target, offset);
  }

  #setButtonDisable() {
    const products = this.querySelectorAll("product-bundle-variant-selector");
    const { addAllToCart } = this.refs;

    if (products.length < 1) {
      addAllToCart.disabled = true;
    }
  }
}

if (!customElements.get("product-bundle")) {
  customElements.define("product-bundle", ProductBundle);
}

export class ProductsBoughtTogether extends BaseMultiProductAddToCart {
  #abortController = new AbortController();

  constructor() {
    super();

    this.variants = [];
  }

  connectedCallback() {
    super.connectedCallback();

    if (!this.checkboxes.length) {
      return;
    }

    const { signal } = this.#abortController;
    this.onVariantChangeHandler = this.#onVariantChange.bind(this);
    this.onCheckboxChangeHandler = this.#onCheckboxChange.bind(this);
    this.onQuantityChangeHandler = this.#onQuantityChange.bind(this);

    this.addEventListener("variant-change", this.onVariantChangeHandler, { signal });

    this.checkboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", this.onCheckboxChangeHandler, { signal });
    });

    this.quantityInputs.forEach((quantityInput) => {
      quantityInput.addEventListener("change", this.onQuantityChangeHandler, { signal });
    });

    this.productCards.forEach((card) => {
      this.#updateProductCardLinePrice(card);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  get checkboxSelector() {
    return "[data-product-bought-together-checkbox]";
  }

  get productCardSelector() {
    return "product-card";
  }

  get productCards() {
    return (this._productCards = this._productCards || this.querySelectorAll(this.productCardSelector));
  }

  get checkboxes() {
    return (this._checkboxes = this._checkboxes || this.querySelectorAll(this.checkboxSelector));
  }

  get quantityInputs() {
    return (this._quantityInputs = this._quantityInputs || this.querySelectorAll("product-card [name='quantity']"));
  }

  get checkedCheckboxes() {
    return Array.from(this.checkboxes).filter((checkbox) => checkbox.checked);
  }

  getItems() {
    return this.variants.map((variant) => ({
      id: variant.id,
      quantity: variant.quantity,
    }));
  }

  getSubmitElement() {
    return this.refs.addAllToCart;
  }

  getMessageElement() {
    return this.refs.addToCartTextError;
  }

  #onCheckboxChange(event) {
    const { target: checkbox } = event;
    const isSelected = checkbox.checked;
    const productCard = checkbox.closest(this.productCardSelector);
    const productId = productCard.dataset.productId;
    productCard.classList.toggle("is-selected", isSelected);

    if (isSelected) {
      this.#addVariantFromProductCard(productCard);
    } else {
      this.removeVariant(productId);
    }
  }

  #onQuantityChange(event) {
    const { target: quantityInput } = event;
    const productCard = quantityInput.closest(this.productCardSelector);
    const checkboxEl = productCard.querySelector(this.checkboxSelector);

    if (checkboxEl?.checked) {
      this.#addVariantFromProductCard(productCard);
    } else {
      this.#updateProductCardLinePrice(productCard);
    }
  }

  #onVariantChange(event) {
    const { target } = event;
    const productCard = target.closest(this.productCardSelector);
    const checkboxEl = productCard.querySelector(this.checkboxSelector);
    const isSelected = checkboxEl.checked;

    if (!isSelected) {
      return;
    }

    this.#addVariantFromProductCard(productCard);
  }

  #addVariantFromProductCard(productCard) {
    const productId = productCard.dataset.productId;
    const variantSelect = productCard.querySelector('[name="id"]');
    const selectedOption = variantSelect.selectedOptions[0];
    const variantId = selectedOption.value;
    const baseUnitPrice = parseFloat(selectedOption.dataset.price);
    const quantityInput = productCard.querySelector('[name="quantity"]');
    const quantity = quantityInput && quantityInput.value != "" ? parseInt(quantityInput.value) : 1;
    const quantityOption = quantityInput?.selectedOptions?.[0];
    const priceContainer = productCard.querySelector('[ref="priceContainer"]');
    const usesQuantityLinePricing = priceContainer?.dataset?.quantityBreaks === "true";
    const rawLineTotal = quantityOption?.dataset?.linePrice;
    const parsedLineTotal = rawLineTotal != null && rawLineTotal !== "" ? parseFloat(rawLineTotal) : NaN;
    const lineTotalCents =
      usesQuantityLinePricing && Number.isFinite(parsedLineTotal)
        ? Math.round(parsedLineTotal)
        : Math.round(baseUnitPrice * quantity);
    const effectiveUnitPrice = quantity > 0 ? lineTotalCents / quantity : baseUnitPrice;

    this.addVariant({
      productId: productId,
      id: variantId,
      price: effectiveUnitPrice,
      quantity: quantity,
      lineTotalCents: lineTotalCents,
    });

    this.#updateProductCardLinePrice(productCard);
  }

  /** Updates card product-price to line total (uses quantity option data-line-price when set — includes volume tiers). */
  #updateProductCardLinePrice(productCard) {
    const card =
      productCard instanceof HTMLElement && productCard.tagName.toLowerCase() === "product-card"
        ? /** @type {import("../modules/product-card").ProductCard} */ (productCard)
        : null;

    const priceContainer = card.querySelector(`[ref="priceContainer"]`);
    if (!priceContainer) return;

    const variantSelect = productCard.querySelector('[name="id"]');
    const selectedOption = variantSelect?.selectedOptions?.[0];
    if (!selectedOption) return;

    const quantityInput = productCard.querySelector('[name="quantity"]');
    const quantityOption = quantityInput?.selectedOptions?.[0];
    const quantity = quantityInput && quantityInput.value !== "" ? parseInt(quantityInput.value) : 1;

    const rawLine = quantityOption?.dataset?.linePrice;
    const parsedLine = rawLine != null && rawLine !== "" ? parseFloat(rawLine) : NaN;
    const usesQuantityLinePricing = priceContainer.dataset.quantityBreaks === "true";
    const hasQuantityLineData = usesQuantityLinePricing && Number.isFinite(parsedLine) && parsedLine >= 0;

    if (!hasQuantityLineData) {
      if (priceContainer.classList.contains("volume-pricing--sale-badge")) return;

      const regularPriceElCheck = priceContainer.querySelector("[data-price-regular] [data-price-amount]");
      if (
        regularPriceElCheck &&
        (regularPriceElCheck.textContent.includes("–") || regularPriceElCheck.textContent.includes("from"))
      ) {
        return;
      }
    }

    const unitPrice = parseFloat(selectedOption.dataset.price) || 0;
    const unitCompare = parseFloat(selectedOption.dataset.compareAtPrice) || 0;
    // The card these prices overwrite is rendered by `price.liquid`, which follows the
    // "show currency code" setting.
    const moneyFormat = getMoneyFormat();

    let linePriceCents = hasQuantityLineData ? Math.round(parsedLine) : Math.round(unitPrice * quantity);
    let lineCompareCents = 0;

    if (hasQuantityLineData) {
      const rawCompareLine = quantityOption?.dataset?.compareLinePrice;
      if (rawCompareLine != null && rawCompareLine !== "") {
        lineCompareCents = Math.round(parseFloat(rawCompareLine)) || 0;
      }
    } else if (unitCompare > unitPrice) {
      lineCompareCents = Math.round(unitCompare * quantity);
    }

    const formattedPrice = formatCurrency(linePriceCents, moneyFormat);
    const formattedCompare = lineCompareCents > linePriceCents ? formatCurrency(lineCompareCents, moneyFormat) : null;

    const isOnSale = Boolean(formattedCompare);

    priceContainer.classList.toggle("price--on-sale", isOnSale);

    const salePriceDiv = priceContainer.querySelector("[data-price-sale]");
    if (salePriceDiv) {
      const salePriceEl = salePriceDiv.querySelector("[data-price-amount]");
      const comparePriceEl = salePriceDiv.querySelector("[data-compare-price]");

      if (salePriceEl) salePriceEl.textContent = formattedPrice;
      if (comparePriceEl && formattedCompare) {
        comparePriceEl.textContent = formattedCompare;
      }
    }

    const regularPriceDiv = priceContainer.querySelector("[data-price-regular]");
    if (regularPriceDiv) {
      const regularPriceEl = regularPriceDiv.querySelector("[data-price-amount]");
      if (regularPriceEl) {
        const isRangeText = regularPriceEl.textContent.includes("–") || regularPriceEl.textContent.includes("from");
        if (hasQuantityLineData || !isRangeText) {
          regularPriceEl.textContent = formattedPrice;
        }
      }
    }
  }

  addVariant(variant) {
    if (this.variants.some((v) => v.productId === variant.productId)) {
      this.variants = this.variants.map((v) => (v.productId === variant.productId ? variant : v));
    } else {
      this.variants.push(variant);
    }

    this.#updateSummary();
  }

  removeVariant(productId) {
    this.variants = this.variants.filter((v) => v.productId !== productId);

    this.#updateSummary();
  }

  updateVariant(productId, variant) {
    this.variants = this.variants.map((v) => (v.productId === productId ? { ...v, ...variant } : v));

    this.#updateSummary();
  }

  #updateSummary() {
    this.#updateButtonState();
    this.#updateCount();
    this.#updateSubTotal();
  }

  #updateButtonState() {
    const { addAllToCart } = this.refs;
    const hasVariants = this.variants.length > 0;
    if (hasVariants) {
      addAllToCart.removeAttribute("disabled");
    } else {
      addAllToCart.setAttribute("disabled", "");
    }
  }

  #updateCount() {
    const { itemCount } = this.refs;
    const { itemCountOne, itemCountOther } = itemCount.dataset;

    const checkedCount = this.variants.reduce((total, variant) => total + variant.quantity, 0);

    itemCount.textContent =
      checkedCount === 1
        ? itemCountOne.replace("{{ count }}", checkedCount)
        : itemCountOther.replace("{{ count }}", checkedCount);
  }

  #updateSubTotal() {
    const { subTotal } = this.refs;
    const totalPrice = this.variants.reduce((total, variant) => {
      if (typeof variant.lineTotalCents === "number") {
        return total + variant.lineTotalCents;
      }
      return total + variant.price * variant.quantity;
    }, 0);

    subTotal.textContent = formatCurrency(totalPrice, getMoneyFormat());
  }
}

if (!customElements.get("products-bought-together")) {
  customElements.define("products-bought-together", ProductsBoughtTogether);
}
