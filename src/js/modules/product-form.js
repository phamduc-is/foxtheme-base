import { Component } from "@theme/component";
import { CartAddEvent, CartErrorEvent, CartUpdateEvent, ThemeEvents, VariantUpdateEvent } from "@theme/events";
import { fetchConfig, setPendingCartLineError } from "@theme/utilities";
import {
  contextFor,
  dispatchCartLinesUpdate,
  rejectCartResult,
  resolveCartResult,
  toMerchandiseGid,
} from "@theme/standard-events";

/**
 * A custom element that manages an add to cart button.
 *
 * @typedef {object} AddToCartRefs
 * @property {HTMLButtonElement} addToCartButton - The add to cart button.
 * @extends Component<AddToCartRefs>
 */
export class AddToCartComponent extends Component {
  requiredRefs = ["addToCartButton"];

  // Created per connect, not once per instance: a MOVE (the PDP "below media" container relocates
  // its whole subtree into the media column) fires disconnect → abort, and an AbortController is
  // single-use — a signal created once would leave the reconnected button with no listeners at all.
  /** @type {AbortController | null} */
  #abortController = null;

  connectedCallback() {
    super.connectedCallback();

    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    document.addEventListener(CartAddEvent.eventName, this.#onCartAddDone, { signal });
    document.addEventListener(CartErrorEvent.eventName, this.#onCartAddDone, { signal });
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
    super.disconnectedCallback();
  }

  /**
   * Disables the add to cart button.
   */
  disable() {
    this.refs.addToCartButton.disabled = true;
  }

  /**
   * Enables the add to cart button.
   */
  enable() {
    this.refs.addToCartButton.disabled = false;
  }

  /**
   * Adds loading class to the add to cart button.
   */
  addLoading() {
    this.refs.addToCartButton.classList.add("btn--loading");
    this.refs.addToCartSpinner.classList.remove("hidden");
  }

  /**
   * Removes loading class from the add to cart button.
   */
  removeLoading() {
    this.refs.addToCartButton.classList.remove("btn--loading");
    this.refs.addToCartSpinner.classList.add("hidden");
  }

  /**
   * Handles cart add completion (success or error).
   * Removes loading state from the button.
   */
  #onCartAddDone = () => {
    this.removeLoading();
  };
}

if (!customElements.get("add-to-cart-component")) {
  customElements.define("add-to-cart-component", AddToCartComponent);
}

/**
 * A custom element that manages a product form.
 *
 * @typedef {object} ProductFormRefs
 * @property {HTMLInputElement} variantId - The form input for submitting the variant ID.
 * @property {AddToCartComponent | undefined} addToCartButtonContainer - The add to cart button container element.
 * @property {HTMLElement | undefined} addToCartTextError - The add to cart text error.
 * @property {HTMLElement | undefined} acceleratedCheckoutButtonContainer - The accelerated checkout button container element.
 * @property {HTMLElement} liveRegion - The live region.
 *
 * @extends Component<ProductFormRefs>
 */
class ProductFormComponent extends Component {
  requiredRefs = ["variantId", "liveRegion"];

  // Created per connect, not once per instance: a MOVE (the PDP "below media" container relocates
  // its whole subtree into the media column) fires disconnect → abort, and an AbortController is
  // single-use — a signal created once would leave the reconnected form with no listeners at all.
  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {number | undefined} */
  #timeout;

  connectedCallback() {
    super.connectedCallback();

    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    const target = this.closest(".shopify-section, dialog, product-card");
    target?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, {
      signal,
    });
    target?.addEventListener(ThemeEvents.variantSelected, this.#onVariantSelected, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController?.abort();
    this.#abortController = null;
  }

  /**
   * Handles the submit event for the product form.
   *
   * @param {Event} event - The submit event.
   */
  handleSubmit(event) {
    const { addToCartTextError } = this.refs;
    // Stop default behaviour from the browser
    event.preventDefault();

    if (this.#timeout) clearTimeout(this.#timeout);

    // Check if the add to cart button is disabled and do an early return if it is
    if (this.refs.addToCartButtonContainer?.refs.addToCartButton?.disabled) return;

    // Add loading state to the add to cart button
    this.refs.addToCartButtonContainer?.addLoading();

    // Send the add to cart information to the cart
    const form = this.querySelector("form");

    if (!form) throw new Error("Product form element missing");

    const formData = new FormData(form);

    // Request sections for cart-items components
    const cartItemsComponents = document.querySelectorAll("cart-items-component");
    const cartItemComponentsSectionIds = [];
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        cartItemComponentsSectionIds.push(item.dataset.sectionId);
      }
    });

    if (cartItemComponentsSectionIds.length > 0) {
      formData.append("sections", cartItemComponentsSectionIds.join(","));
    }

    // Standard storefront event — apps listen for shopify:cart:lines-update.
    const standardVariantId = formData.get("id");
    const standardHandles = standardVariantId
      ? dispatchCartLinesUpdate(this, {
          action: "add",
          context: contextFor(this, "product"),
          lines: [
            {
              merchandiseId: toMerchandiseGid(standardVariantId.toString()),
              quantity: Number(formData.get("quantity")) || Number(this.dataset.quantityDefault) || 1,
            },
          ],
        })
      : null;

    const fetchCfg = fetchConfig("javascript", { body: formData });

    fetch(FoxTheme.routes.cart_add_url, {
      ...fetchCfg,
      headers: {
        ...fetchCfg.headers,
        Accept: "text/html",
      },
    })
      .then((response) => response.json())
      .then((response) => {
        if (response.status) {
          const errorMessage = response.description || response.message;

          resolveCartResult(standardHandles, {
            userErrors: [{ code: "INVALID", message: errorMessage }],
          });

          this.dispatchEvent(
            new CartErrorEvent(form.getAttribute("id") || "", response.message, response.description, response.errors)
          );

          document.dispatchEvent(
            new CustomEvent(ThemeEvents.productAjaxError, {
              detail: { errorMessage },
            })
          );

          this.refs.addToCartButtonContainer?.removeLoading();

          // Clear existing timeout to reset the 5s timer
          if (this.#timeout) {
            clearTimeout(this.#timeout);
          }

          if (addToCartTextError) {
            // Set error message (replaces any existing message)
            addToCartTextError.textContent = errorMessage;
            addToCartTextError.classList.remove("hidden");
          }

          // Announce error for screen readers
          this.#setLiveRegionText(response.message);

          // Hide error message after 5 seconds
          this.#timeout = setTimeout(() => {
            addToCartTextError?.classList.add("hidden");
            this.#clearLiveRegionText();
          }, 5000);

          // Sync the cart first: the message points at a cart line, so the cart
          // has to hold the quantity the server actually settled on before it
          // is shown.
          this.#syncCartAfterError(response).then(() => {
            if (this.dataset.errorDisplay === "cart") this.#showErrorInCart(errorMessage);
          });

          return;
        } else {
          resolveCartResult(standardHandles);

          const id = formData.get("id");

          if (addToCartTextError) {
            addToCartTextError.classList.add("hidden");
            addToCartTextError.removeAttribute("aria-live");
          }

          if (!id) throw new Error("Form ID is required");

          // Add aria-live region to inform screen readers that the item was added
          if (this.refs.addToCartButtonContainer?.refs.addToCartButton) {
            const addedText = FoxTheme.translations.added;
            this.#setLiveRegionText(addedText);

            setTimeout(() => {
              this.#clearLiveRegionText();
            }, 5000);
          }

          this.dispatchEvent(
            new CartAddEvent({}, id.toString(), {
              source: "product-form-component",
              itemCount: Number(formData.get("quantity")) || Number(this.dataset.quantityDefault),
              productId: this.dataset.productId,
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
      .catch((error) => {
        rejectCartResult(standardHandles, this, error);
        console.error(error);
      })
      .finally(() => {
        // add more thing to do in here if needed.
        // cartPerformance.measureFromEvent("add:user-action", event);
      });
  }

  /**
   * Re-syncs the cart after a failed add.
   *
   * When the error is a quantity one (e.g. adding more items than available),
   * the backend still adds the max allowed amount, so the rendered cart and the
   * cart count are both stale. Dispatches a CartUpdateEvent carrying the fresh
   * cart-items sections; resolves once every listener has morphed.
   *
   * @param {Object} response - The parsed cart/add response.
   * @param {Object} [response.sections] - The cart-items sections, when the server returned them.
   * @returns {Promise<void>} Resolves when the sync is done (or when there is nothing to sync).
   */
  #syncCartAfterError(response) {
    if (response.sections) {
      for (const section of Object.values(response.sections)) {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = section;

        // Try cart-items ref first, fallback to cart-count bubble
        const itemCountElement =
          tempDiv.querySelector('[ref="cartItemCount"]') || tempDiv.querySelector("[data-cart-bubble-count]");

        if (itemCountElement) {
          this.dispatchEvent(
            new CartUpdateEvent({}, this.id, {
              itemCount: parseInt(itemCountElement.textContent || "0", 10),
              source: "product-form-component",
              productId: this.dataset.productId,
              sections: response.sections,
            })
          );
          break;
        }
      }

      return Promise.resolve();
    }

    // Shopify doesn't return sections on 422 errors. Batch-fetch the
    // cart-items sections in a single `?sections=a,b,c` request and
    // read the new cart count from the returned HTML — avoids a
    // separate cart.js round-trip since the count is already in the
    // section markup (same source the success path uses above).
    const sectionIds = new Set();
    document.querySelectorAll("cart-items-component").forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        sectionIds.add(item.dataset.sectionId);
      }
    });

    if (sectionIds.size === 0) return Promise.resolve();

    const sectionsParam = Array.from(sectionIds).join(",");
    const sectionsUrl = `${window.location.pathname.split("?")[0]}?sections=${sectionsParam}`;

    return fetch(sectionsUrl)
      .then((res) => res.json())
      .then((sectionsData) => {
        let actualItemCount = 0;
        for (const html of Object.values(sectionsData)) {
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = html;
          const itemCountElement =
            tempDiv.querySelector('[ref="cartItemCount"]') || tempDiv.querySelector("[data-cart-bubble-count]");
          if (itemCountElement) {
            actualItemCount = parseInt(itemCountElement.textContent || "0", 10);
            break;
          }
        }

        this.dispatchEvent(
          new CartUpdateEvent({}, this.id, {
            itemCount: actualItemCount,
            source: "product-form-component",
            productId: this.dataset.productId,
            sections: sectionsData,
          })
        );
      })
      .catch((error) => {
        console.error("Failed to fetch cart sections:", error);
      });
  }

  /**
   * Surfaces an add-to-cart error inside the cart itself — for forms with no
   * room for an inline message (a product card's quick-add), where the error is
   * about a line already in the cart ("all N are in your cart"). Opens the cart
   * drawer and flags that line; with `cart_type: page` the message is handed to
   * the cart page, which is opened instead.
   *
   * @param {string} message - The error message from the server.
   */
  #showErrorInCart(message) {
    const variantId = this.refs.variantId?.value;
    if (!message || !variantId) return;

    // The drawer is not rendered on the cart template, so its absence means the
    // cart itself is the page to show this on.
    const drawer = FoxTheme.settings?.cartType === "drawer" ? document.querySelector("cart-drawer-component") : null;

    if (drawer) {
      if (typeof drawer.showDialog === "function") drawer.showDialog();
      this.#showLineError(drawer.querySelector("cart-items-component"), { variantId, message });
      return;
    }

    const cartItems = document.querySelector("cart-items-component");

    if (cartItems) {
      this.#showLineError(cartItems, { variantId, message });
      return;
    }

    // Nothing renders the cart here, so the message has to survive a navigation
    // — worth one only if the variant really has a line to point at. A stale
    // page (a tab left open, a bfcache restore) can fail on a variant that sold
    // out meanwhile and is in nobody's cart; sending the visitor to an
    // unexplained cart page would be worse than staying put.
    fetch(FoxTheme.routes.cart)
      .then((response) => response.json())
      .then((cart) => {
        const hasLine =
          Array.isArray(cart.items) && cart.items.some((item) => String(item.variant_id) === String(variantId));

        if (!hasLine) return;

        setPendingCartLineError({ variantId, message });
        window.location.href = FoxTheme.routes.cart_url;
      })
      .catch((error) => {
        console.error("Failed to fetch cart:", error);
      });
  }

  /**
   * Flags a cart line with an error, when the cart is rendered and upgraded.
   *
   * @param {Element | null} cartItems - The cart-items-component holding the line.
   * @param {{ variantId: string, message: string }} error - The variant and the message to show.
   */
  #showLineError(cartItems, error) {
    // @ts-expect-error - showLineError is defined by cart-items-component.
    if (typeof cartItems?.showLineError === "function") cartItems.showLineError(error);
  }

  /**
   * @param {*} text
   */
  #setLiveRegionText(text) {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = text;
  }

  #clearLiveRegionText() {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = "";
  }

  /**
   * @param {VariantUpdateEvent} event
   */
  #onVariantUpdate = (event) => {
    // VariantPicker's cache-miss path fires twice: first when the JSON
    // payload resolves (state-only), then again when the background HTML
    // fetch completes (carries `html` for VariantPicker's own morph). State
    // we apply here — button text, disabled, variantId — was already set
    // by the first event, so skip the background re-run.
    if (event.detail.data.isBackgroundSync) return;

    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.detail.data.productId !== this.dataset.productId) {
      return;
    }

    const { variantId, addToCartButtonContainer } = this.refs;

    // The add-to-cart block is optional: a merchant can hide it and keep only the
    // accelerated checkout, which submits the variant from the same `id` input.
    // So only the button's own updates wait on it — the variant ID and the
    // accelerated checkout visibility must follow every variant change.
    const currentAddToCartButton = addToCartButtonContainer?.refs.addToCartButton;

    // Update the button state and text optimistically (always do this, even from cache)
    const variant = event.detail.resource;
    const isAvailable = variant?.available ?? false;

    // Determine correct unavailable state
    // Sold out: Has inventory management (shopify) → inventory = 0
    // Unavailable: No inventory management OR variant is null/undefined → other reasons
    const isSoldOut = !isAvailable && variant && variant.inventory_management === "shopify";

    if (!isAvailable) {
      if (currentAddToCartButton) addToCartButtonContainer.disable();
      this.refs.acceleratedCheckoutButtonContainer?.setAttribute("hidden", "true");
    } else {
      if (currentAddToCartButton) addToCartButtonContainer.enable();
      this.refs.acceleratedCheckoutButtonContainer?.removeAttribute("hidden");
    }

    // Update button text optimistically (works for both available and unavailable)
    // This handles ALL cases: cache hit, JSON fetch, and HTML fallback
    this.#updateButtonTextOptimistic(currentAddToCartButton, isAvailable, isSoldOut);

    // Update the variant ID (always do this)
    if (event.detail.resource?.id) {
      variantId.value = event.detail.resource.id ?? "";
    } else {
      variantId.value = "";
    }
  };

  /**
   * Updates button text optimistically based on variant availability
   * @param {HTMLElement} button - The add to cart button element
   * @param {boolean} isAvailable - Whether the variant is available
   * @param {boolean} isSoldOut - Whether the variant is sold out (has inventory_management = "shopify")
   */
  #updateButtonTextOptimistic(button, isAvailable, isSoldOut = false) {
    if (!button) return;

    // A button may carry MORE than one label copy — a card that swaps to a short label when it
    // is narrow ships both, and the CSS shows one. Every copy has to move together, or the
    // hidden one is stale the moment the container query flips.
    const textElements = button.querySelectorAll("[data-add-to-cart-text-content]");

    if (!textElements.length) return;

    // Get text from data attributes (translations from Liquid)
    const availableText = button.dataset.addToCartText || "Add to cart";
    const soldOutText = button.dataset.soldOutText || "Sold out";
    const unavailableText = button.dataset.unavailableText || "Unavailable";

    // Determine correct text based on state
    // - Available: variant.available = true → "Add to cart"
    // - Sold out: variant.available = false + inventory_management = "shopify" → "Sold out"
    // - Unavailable: variant.available = false + no inventory_management → "Unavailable"
    // Only the available label has a short form; "Sold out" and "Unavailable" are short already.
    const shortText = button.dataset.addToCartTextShort || availableText;

    for (const textElement of textElements) {
      let newText;
      if (isAvailable) {
        newText = textElement.dataset.addToCartTextContent === "short" ? shortText : availableText;
      } else if (isSoldOut) {
        newText = soldOutText;
      } else {
        newText = unavailableText;
      }

      textElement.textContent = newText;

      // A label that rolls on hover carries a second copy of itself in
      // `data-label` (see the `.btn__text` hook). Rewriting the text without the
      // attribute leaves the copy behind: the button would read "Sold out" and
      // hover to "Add to cart". The attribute may be on the text element or on a
      // wrapper around it, so ask for the nearest one either way.
      textElement.closest("[data-label]")?.setAttribute("data-label", newText);
    }
  }

  /**
   * Disable the add to cart button while the UI is updating before #onVariantUpdate is called.
   * Accelerated checkout button is also disabled via its own event listener not exposed to the theme.
   */
  #onVariantSelected = () => {
    this.refs.addToCartButtonContainer?.disable();
  };
}

if (!customElements.get("product-form-component")) {
  customElements.define("product-form-component", ProductFormComponent);
}
