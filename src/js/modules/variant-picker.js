import { Component } from "@theme/component";
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent } from "@theme/events";
import { morph } from "@theme/morph";
import { requestIdleCallback, requestYieldCallback } from "@theme/utilities";
import { dispatchProductSelect, rejectProductSelect, resolveProductSelect } from "@theme/standard-events";

/**
 * Global cache shared across all variant picker instances
 * This allows cache to persist when switching between products in combined listings
 *
 * HYBRID APPROACH:
 * - Cache preloaded variants for instant switching (no network delay)
 * - Fetch lightweight JSON for uncached variants (faster than full HTML)
 * - Fallback to full HTML when variant ID not available
 */
const globalVariantsCache = new Map();
const globalMediaCache = new Map();
/** The preloaded variants of each product, in full — what option availability is recomputed from. */
const globalVariantsByProduct = new Map();

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [Refs = {}]
 *
 * @extends Component<Refs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /**
   * Separate controllers for section HTML fetch and lightweight JSON fetch.
   * The two run in parallel for cache-miss path; using one shared controller
   * would have the section fetch abort the in-flight JSON fetch (and vice-versa
   * on rapid clicks), which kills the optimistic update path.
   *
   * @type {AbortController | undefined}
   */
  #sectionAbortController;

  /** @type {AbortController | undefined} */
  #jsonAbortController;

  /** @type {string | undefined} */
  #lastProductId;

  /** Monotonic token so aborted/outdated section fetches don't clear the fetching state too early. */
  /** @type {number} */
  #variantFetchGeneration = 0;

  // Created per connect, not once per instance: a MOVE (the PDP "below media" container
  // relocates its whole subtree into the media column) fires disconnect → abort, and an
  // AbortController is single-use — a signal created once would leave the reconnected
  // picker with no listeners at all.
  /** @type {AbortController | null} */
  #abortController = null;

  connectedCallback() {
    super.connectedCallback();

    this.#abortController = new AbortController();

    // Store initial product ID
    this.#lastProductId = this.dataset.productId;

    // HYBRID: Load and cache preloaded variants for instant switching
    this.#loadVariantsCache();

    this.addEventListener("change", this.variantChanged.bind(this), { signal: this.#abortController.signal });
  }

  disconnectedCallback() {
    // Abort any pending fetch requests + auto-remove the change listener via signal
    this.#sectionAbortController?.abort();
    this.#jsonAbortController?.abort();
    this.#abortController?.abort();
    this.#abortController = null;
    super.disconnectedCallback();
  }

  updatedCallback() {
    super.updatedCallback?.();

    // When product changes (combine listing), re-load cache for new product
    const currentProductId = this.dataset.productId;
    if (currentProductId !== this.#lastProductId) {
      this.#lastProductId = currentProductId;
      // HYBRID: Re-load cache for new product
      this.#loadVariantsCache();
    }
  }

  /** @type {{controller: AbortController, handles: object} | null} */
  #standardSelectPending = null;

  /**
   * Standard storefront event — shopify:product:select. Dispatched when the
   * buyer changes an option; settled with the matched variant (or null) once
   * the theme resolves it via the next non-background variantUpdate.
   * @param {HTMLElement} selectedOption
   */
  #dispatchStandardProductSelect(selectedOption) {
    // A rapid re-selection supersedes the previous pending one. Reject it as
    // aborted: resolving `variant: null` would tell listeners the combination
    // does not exist, when it was simply never looked up.
    if (this.#standardSelectPending) {
      this.#standardSelectPending.controller.abort();
      rejectProductSelect(this.#standardSelectPending.handles, new DOMException("Superseded", "AbortError"));
      this.#standardSelectPending = null;
    }

    const productId = this.dataset.productId;
    if (!productId) return;

    /** @type {Array<{name: string, value: string}>} */
    const selectedOptions = [];
    const selectedEls = this.querySelectorAll("select option[selected], [data-variant-option] input:checked");
    for (const el of selectedEls) {
      if (!(el instanceof HTMLOptionElement) && !(el instanceof HTMLInputElement)) continue;
      const wrapper = el.closest("[data-variant-option]");
      const name = wrapper instanceof HTMLElement ? wrapper.dataset.optionName : undefined;
      if (!name) continue;
      selectedOptions.push({ name, value: el.value });
    }

    const handles = dispatchProductSelect(this, {
      product: {
        id: `gid://shopify/Product/${productId}`,
        title: this.dataset.productTitle || "",
        handle: this.dataset.productHandle || "",
      },
      selectedOptions,
    });
    if (!handles) return;

    const optionNames = selectedOptions.map((option) => option.name);

    if (!selectedOption.dataset.variantId && !this.#getCachedVariant()) {
      // No variant maps to this combination. The server answers option changes
      // with a fallback variant (selected_or_first_available_variant), so the
      // missing data-variant-id on the chosen input is the reliable null signal.
      resolveProductSelect(handles, null);
      return;
    }

    const controller = new AbortController();
    this.#standardSelectPending = { controller, handles };
    this.addEventListener(
      ThemeEvents.variantUpdate,
      (event) => {
        if (event.detail?.data?.isBackgroundSync) return;
        controller.abort();
        if (this.#standardSelectPending?.controller === controller) this.#standardSelectPending = null;
        resolveProductSelect(handles, event.detail?.resource || null, optionNames);
      },
      { signal: controller.signal }
    );
    // Safety net — no update event landed, so the lookup failed. That is an
    // error, not "no such variant", and must still settle the promise.
    setTimeout(() => {
      if (controller.signal.aborted) return;
      controller.abort();
      if (this.#standardSelectPending?.controller === controller) this.#standardSelectPending = null;
      rejectProductSelect(handles, new Error("Variant lookup did not complete"));
    }, 10000);
  }

  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const selectedOption =
      event.target instanceof HTMLSelectElement ? event.target.options[event.target.selectedIndex] : event.target;

    if (!selectedOption) return;

    const fetchToken = this.beginVariantFetch();

    this.updateSelectedOption(event.target);
    this.#updateLabelValueOptimistic(event.target);
    this.#updateOptionAvailabilityOptimistic();
    this.dispatchEvent(
      new VariantSelectedEvent({
        id: selectedOption.dataset.optionValueId ?? "",
      })
    );

    this.#dispatchStandardProductSelect(selectedOption);

    const isOnProductPage =
      this.dataset.templateProductMatch === "true" &&
      !event.target.closest("product-card") &&
      !event.target.closest("quick-view-dialog");

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split("?")[0];
    const newUrl = selectedOption.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;

    // HYBRID APPROACH: Cache first, then JSON fetch, then full HTML fallback
    const variantId = selectedOption.dataset.variantId;
    const cachedVariant = this.#getCachedVariant();

    if (cachedVariant) {
      // ⚡ CACHE HIT: Instant update with no network delay
      this.#updateCriticalUI(cachedVariant, true);

      // Detect if product changed (for combine listings in quick-add drawer, product cards, etc.)
      const newProductUrl = selectedOption.dataset.connectedProductUrl;
      const currentProductUrl = this.dataset.productUrl?.split("?")[0];
      const hasProductChanged = newProductUrl && currentProductUrl !== newProductUrl;

      // Dispatch event immediately for other components
      if (this.selectedOptionId) {
        this.dispatchEvent(
          new VariantUpdateEvent(cachedVariant, this.selectedOptionId, {
            html: null, // No HTML yet
            productId: this.dataset.productId ?? "",
            newProduct: hasProductChanged ? { id: null, url: newProductUrl } : undefined,
            fromCache: true, // Flag to indicate this is from cache
          })
        );
      }

      // Still fetch HTML in background for morph (custom elements, etc.)
      requestIdleCallback(() => {
        this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), loadsNewProduct, true, fetchToken);
      });
    } else if (variantId) {
      // CACHE MISS: Fetch lightweight JSON (faster than full HTML)
      // Detect if product changed (for combine listings in quick-add drawer, product cards, etc.)
      const newProductUrl = selectedOption.dataset.connectedProductUrl;
      const currentProductUrl = this.dataset.productUrl?.split("?")[0];
      const hasProductChanged = newProductUrl && currentProductUrl !== newProductUrl;

      this.#fetchVariantJson(variantId)
        .then((variantData) => {
          if (variantData) {
            // Update UI with fetched JSON data
            this.#updateCriticalUI(variantData, true);

            // Dispatch event immediately for other components
            if (this.selectedOptionId) {
              this.dispatchEvent(
                new VariantUpdateEvent(variantData, this.selectedOptionId, {
                  html: null, // No HTML yet
                  productId: this.dataset.productId ?? "",
                  newProduct: hasProductChanged ? { id: null, url: newProductUrl } : undefined,
                  fromCache: true, // Treated as cache hit for UI logic
                })
              );
            }
          }
        })
        .catch((error) => {
          console.warn("Failed to fetch variant JSON:", error);
        });

      // Fetch full HTML in background for morph (custom elements, etc.)
      requestIdleCallback(() => {
        this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), loadsNewProduct, true, fetchToken);
      });
    } else {
      // FALLBACK: No variant ID - fetch full HTML as fallback. When the preloaded
      // list is complete and holds no variant for this combination, the answer
      // is already known: paint the unavailable state now, the HTML restates it.
      if (!loadsNewProduct && this.#isKnownMissingCombination(selectedOption)) this.#updateUnavailableOptimistic();
      this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), loadsNewProduct, false, fetchToken);
    }

    const url = new URL(window.location.href);

    if (isOnProductPage) {
      if (variantId) {
        url.searchParams.set("variant", variantId);
      } else {
        url.searchParams.delete("variant");
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      requestYieldCallback(() => {
        history.replaceState({}, "", url.toString());
      });
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === "string") {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error("Target element not found");

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error("Option not found");

      for (const option of target.options) {
        option.removeAttribute("selected");
      }

      newSelectedOption.setAttribute("selected", "selected");
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];

    if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(",")}`);
    } else if (source === "product-card") {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(",")}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of quick-add-component or swatches-variant-picker-component, we need to append section_id=section-rendering-product-card to the URL
    if (this.closest("quick-view-dialog") || this.closest("swatches-variant-picker")) {
      let sectionId = this.quickAddDrawerId;
      if (this.closest("swatches-variant-picker")) {
        sectionId = "section-rendering-product-card";
      }
      if (productUrl?.includes("?")) {
        productUrl = productUrl.split("?")[0];
      }
      // Prefer variant=X over option_values=... for product-card swatches:
      // option_values requires ALL option values to match a variant exactly. For multi-option
      // products (color + size), product-card swatches only set ONE option, so Shopify falls
      // back to first_available_variant — making badges/availability reflect product-level state
      // rather than the clicked swatch's variant.
      const variantId = selectedOption.dataset.variantId;
      const sectionParams = [`section_id=${sectionId}`];
      if (variantId) {
        sectionParams.push(`variant=${variantId}`);
      } else if (params.length) {
        sectionParams.push(...params);
      }
      return `${productUrl}?${sectionParams.join("&")}`;
    }
    return `${productUrl}?${params.join("&")}`;
  }

  /**
   * @param {boolean} isFetching - Whether section HTML is being fetched.
   */
  #setVariantFetching(isFetching) {
    this.classList.toggle("is-variant-fetching", isFetching);
  }

  /**
   * Marks this picker as fetching section HTML until the matching request completes.
   * Used with CSS (e.g. `:has(variant-picker.is-variant-fetching)`) for dependent UI like spinners.
   * @returns {number} Token to pass to `fetchUpdatedSection` so only the latest fetch clears the class.
   */
  beginVariantFetch() {
    const fetchToken = ++this.#variantFetchGeneration;
    this.#setVariantFetching(true);
    return fetchToken;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {boolean} shouldMorphMain - If the entire main content should be morphed. By default, only the variant picker is morphed.
   * @param {boolean} isBackgroundSync - If this is a background sync after cache hit (don't dispatch events again)
   * @param {number} [fetchToken] - When set, clears fetching state only if still the latest fetch (see {@link beginVariantFetch}).
   */
  fetchUpdatedSection(requestUrl, shouldMorphMain = false, isBackgroundSync = false, fetchToken) {
    // Abort previous SECTION fetch only — leave the in-flight JSON fetch alone
    // so it can complete and fire the optimistic update.
    this.#sectionAbortController?.abort();
    this.#sectionAbortController = new AbortController();

    fetch(requestUrl, { signal: this.#sectionAbortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        this.#pendingRequestUrl = undefined;

        const html = new DOMParser().parseFromString(responseText, "text/html");
        const variantData = this.#extractVariantData(html);

        if (variantData) {
          if (!isBackgroundSync) {
            // Update critical UI immediately (only if not from cache)
            // Note: Media is NOT updated here - will be replaced via HTML morph
            this.#updateCriticalUI(variantData, false);
          }
        } else {
          console.warn("No variant data extracted - dispatching without optimistic update");
        }

        // Morph HTML (will happen after critical UI update)
        if (shouldMorphMain) {
          this.updateMain(html);
        } else {
          const newProduct = this.updateVariantPicker(html);

          // Always dispatch event with HTML (even without variantData or for background sync)
          // Components need HTML to morph elements (button text, inventory, badge)
          if (this.selectedOptionId) {
            this.dispatchEvent(
              new VariantUpdateEvent(variantData || null, this.selectedOptionId, {
                html,
                productId: this.dataset.productId ?? "",
                newProduct,
                fromCache: false, // Explicitly set to false for HTML fetch
                isBackgroundSync, // Flag to indicate this is background sync
              })
            );
          }
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          console.warn("Fetch aborted by user");
        } else {
          console.error(error);
        }
      })
      .finally(() => {
        if (fetchToken !== undefined && fetchToken === this.#variantFetchGeneration) {
          this.#setVariantFetching(false);
        }
      });
  }

  /**
   * Fetch lightweight JSON data for a specific variant
   * This is faster than fetching full HTML (smaller payload)
   *
   * @param {string} variantId - The variant ID to fetch
   * @returns {Promise<Object|null>} The variant data or null
   */
  async #fetchVariantJson(variantId) {
    if (!variantId) return null;

    try {
      // Build URL to fetch variant-data section
      const productUrl = this.dataset.productUrl || window.location.pathname;
      const url = new URL(productUrl, window.location.origin);
      url.searchParams.set("sections", "variant-data");
      url.searchParams.set("variant", variantId);

      // Abort previous JSON fetch only (rapid clicking) — independent of
      // section fetch's controller.
      this.#jsonAbortController?.abort();
      this.#jsonAbortController = new AbortController();

      // Fetch section (Shopify wraps in HTML, not pure JSON)
      const response = await fetch(url.toString(), { signal: this.#jsonAbortController.signal });

      if (!response.ok) {
        console.warn(`Variant JSON fetch failed: ${response.status}`);
        return null;
      }

      // Section Rendering API returns: { "variant-data": "HTML string" }
      const data = await response.json();
      const htmlString = data["variant-data"];

      if (!htmlString) {
        console.warn("No variant-data in response");
        return null;
      }

      // Parse HTML to extract JSON from section content
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = htmlString;
      const sectionDiv = tempDiv.querySelector("#shopify-section-variant-data");

      if (!sectionDiv?.textContent) {
        console.warn("Could not extract JSON from section");
        return null;
      }

      // Parse the JSON from section content
      const variantData = JSON.parse(sectionDiv.textContent);

      return variantData;
    } catch (error) {
      // Silent abort errors (user clicked another variant)
      if (error.name === "AbortError") return null;

      console.error("Error fetching variant JSON:", error);
      return null;
    }
  }

  /**
   * Extract variant data from HTML response
   * @param {Document} html - The parsed HTML document
   * @returns {Object | null} The variant data or null if not found
   */
  #extractVariantData(html) {
    const scriptTag = html.querySelector('variant-picker script[type="application/json"]');

    if (!scriptTag?.textContent) {
      console.warn("No variant data found in response");
      return null;
    }

    try {
      return JSON.parse(scriptTag.textContent);
    } catch (e) {
      console.error("Failed to parse variant data:", e);
      return null;
    }
  }

  /**
   * Update critical UI elements immediately with variant data
   * @param {Object} variantData - The variant object from JSON
   * @param {boolean} isFromCache - Whether this update is from cache (true) or from server (false)
   */
  #updateCriticalUI(variantData, isFromCache = false) {
    // 1. Update price immediately
    this.#updatePriceOptimistic(variantData);

    // 2. Update media gallery (only for cache, server fetch will replace entire gallery)
    if (isFromCache) {
      this.#updateMediaOptimistic(variantData);
    }

    // 3. Update button state
    this.#updateButtonStateOptimistic(variantData);

    // 4. Update badge
    this.#updateBadgeOptimistic(variantData);

    document.dispatchEvent(
      new CustomEvent(ThemeEvents.variantChanged, {
        detail: { variant: variantData },
      })
    );
  }

  /**
   * Update price optimistically from variant data
   * @param {Object} variant - The variant object
   */
  #updatePriceOptimistic(variant) {
    // IMPORTANT: Scope to product-card first to avoid affecting other cards in the same section
    const scope = this.closest("product-card") || this.closest(".shopify-section, dialog");
    const priceComponent = scope?.querySelector("product-price");

    if (!priceComponent) return;

    // Dispatch optimistic update event
    priceComponent.dispatchEvent(
      new CustomEvent("price:update-optimistic", {
        detail: { variant },
        bubbles: false,
      })
    );
  }

  /**
   * Update media gallery optimistically
   * @param {Object} variant - The variant object
   */
  #updateMediaOptimistic(variant) {
    if (!variant.featured_media) return;

    // IMPORTANT: Scope to product-card first to avoid affecting other cards in the same section
    const scope = this.closest("product-card") || this.closest(".shopify-section, dialog");
    const mediaGallery = scope?.querySelector("media-gallery");

    if (!mediaGallery) return;

    // Dispatch optimistic media switch event
    mediaGallery.dispatchEvent(
      new CustomEvent("media:switch-optimistic", {
        detail: { variant },
        bubbles: false,
      })
    );
  }

  /**
   * Update button state optimistically
   * @param {Object} variant - The variant object
   */
  #updateButtonStateOptimistic(variant) {
    // IMPORTANT: Scope to product-card first to avoid affecting other cards in the same section
    const scope = this.closest("product-card") || this.closest(".shopify-section, dialog");
    const productForm = scope?.querySelector("product-form-component");

    if (!productForm) return;

    const addToCartButton = productForm.querySelector('[ref="addToCartButton"]');

    if (!addToCartButton) return;

    // Update button state based on availability
    addToCartButton.disabled = !variant.available;
  }

  /**
   * Update the selected label value text optimistically
   * @param {HTMLElement} target - The changed input or select element
   */
  #updateLabelValueOptimistic(target) {
    const variantOption = target.closest("[data-variant-option]");
    if (!variantOption) return;

    const labelValue = variantOption.querySelector("[data-variant-option-label]");
    if (!labelValue) return;

    labelValue.textContent = target.value;
  }

  /**
   * Every option value carries three facts Liquid computed for the variant the
   * page was rendered with: `data-option-available`, `data-variant-id` and the
   * strikethrough (plus `aria-disabled` in the main picker). All three depend
   * on what else is selected, so after a change they are stale until the section
   * HTML is morphed in (~0.7 s): a shopper who clicks quickly sees the previous
   * combination's strikethroughs, and the cache-miss path reads a
   * `data-variant-id` that belongs to it. The preloaded variants list has what
   * is needed to restate them now, with Liquid's own semantics (verified against
   * server-rendered sections, see shopify.dev product_option_value):
   * - `available` CASCADES: a value is available when, given the selected values
   *   of the options BEFORE it, some purchasable variant carries it — later
   *   options do not constrain it. (Not "the exact combination is in stock":
   *   the selected size stays available when only its selected colour sold out.)
   * - `variant` is the variant with this value plus the selected values of
   *   every OTHER option — none when that combination does not exist, the
   *   selected value included (the rendered section leaves it empty there,
   *   whatever the docs say about a fallback).
   * The HTML morph later restates the same facts; nothing here survives it.
   * Skipped when the cache may be partial (Liquid caps `product.variants` at
   * 250): a value whose variant is not cached would otherwise be struck through.
   * Skipped too when the picker renders fewer options than the variants have
   * (a product card shows one swatch row): the other values are unknown here.
   * Dropdown option text ("Red - Unavailable") is rewritten only when an
   * unavailable option already exists to copy the localized suffix from.
   */
  #updateOptionAvailabilityOptimistic() {
    const productId = this.dataset.productId;
    const variants = productId ? globalVariantsByProduct.get(productId) : undefined;
    if (!variants?.length || variants.length >= 250) return;
    if (!variants.every((variant) => Array.isArray(variant.options))) return;

    const selected = Array.from(
      this.querySelectorAll("select option[selected], .variant-option--fieldset input:checked")
    ).map((el) => el.value);
    if (selected.length === 0 || selected.length !== variants[0].options.length) return;

    const productUrl = this.dataset.productUrl?.split("?")[0];
    const usesAriaDisabled = this.tagName.toLowerCase() === "variant-picker";
    const values = Array.from(this.querySelectorAll("select option[data-input-id], input[type=radio][data-input-id]"));
    // The localized " - Unavailable" suffix, learned from an option that carries
    // it: Liquid prints the bare value otherwise, and <option> has no
    // data-option-available to key off.
    let unavailableSuffix = null;
    for (const el of values) {
      if (!(el instanceof HTMLOptionElement)) continue;
      const text = el.textContent?.trim() ?? "";
      if (text.startsWith(el.value) && text.length > el.value.length) {
        unavailableSuffix = text.slice(el.value.length);
        break;
      }
    }

    for (const el of values) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLOptionElement)) continue;
      // A combined-listing sibling: its availability lives in another product's variants.
      const connected = el.dataset.connectedProductUrl;
      if (connected && productUrl && connected !== productUrl) continue;

      const position = Number(el.dataset.inputId?.split("-")[0]) - 1;
      if (!(position >= 0 && position < selected.length)) continue;

      const available = variants.some(
        (variant) =>
          variant.available &&
          variant.options.every((option, index) =>
            index === position ? option === el.value : index < position ? option === selected[index] : true
          )
      );
      const match = variants.find((variant) =>
        variant.options.every((option, index) => option === (index === position ? el.value : selected[index]))
      );

      el.dataset.optionAvailable = String(available);
      if (match) el.dataset.variantId = String(match.id);
      else delete el.dataset.variantId;

      if (el instanceof HTMLOptionElement) {
        if (unavailableSuffix !== null) el.textContent = available ? el.value : el.value + unavailableSuffix;
        continue;
      }

      if (usesAriaDisabled) {
        if (available) el.removeAttribute("aria-disabled");
        else el.setAttribute("aria-disabled", "true");
      }

      const label = el.closest("label");
      if (!label) continue;
      const strikethrough = Array.from(label.children).find((child) =>
        child.classList.contains("strikethrough-variant")
      );
      if (available) {
        strikethrough?.remove();
      } else if (!strikethrough) {
        const div = document.createElement("div");
        div.className = "strikethrough-variant";
        label.appendChild(div);
      }
    }
  }

  /**
   * True only when the preloaded variants list is complete and no variant
   * carries the selected values — a combination that does not exist, as
   * opposed to one the cache missed. Liquid returns the first 250 variants,
   * exactly 250 when there are more, so a shorter list is the whole list. An
   * option value that belongs to a combined-listing sibling is never judged
   * against this product's list.
   * @param {HTMLElement} selectedOption
   */
  #isKnownMissingCombination(selectedOption) {
    const productId = this.dataset.productId;
    const variants = productId ? globalVariantsByProduct.get(productId) : undefined;
    if (!variants?.length || variants.length >= 250) return false;

    const connected = selectedOption.dataset.connectedProductUrl;
    const productUrl = this.dataset.productUrl?.split("?")[0];
    if (connected && connected !== productUrl) return false;
    if (!variants.every((variant) => Array.isArray(variant.options))) return false;

    const selected = Array.from(
      this.querySelectorAll("select option[selected], .variant-option--fieldset input:checked")
    ).map((el) => el.value);
    if (selected.length === 0 || selected.length !== variants[0].options.length) return false;

    return !variants.some((variant) => variant.options.every((option, index) => option === selected[index]));
  }

  /**
   * The unavailable state, without waiting for the HTML: the price hides and
   * the buy button reads "Unavailable" through the same null-variant event the
   * HTML path dispatches later (product-form, sticky bar listen for it).
   */
  #updateUnavailableOptimistic() {
    this.#updatePriceOptimistic(null);

    if (this.selectedOptionId) {
      this.dispatchEvent(
        new VariantUpdateEvent(null, this.selectedOptionId, {
          html: null,
          productId: this.dataset.productId ?? "",
          fromCache: true,
        })
      );
    }
  }

  /**
   * Update badge optimistically from variant data
   * @param {Object} variant - The variant object
   */
  #updateBadgeOptimistic(variant) {
    const scope = this.closest("product-card") || this.closest(".shopify-section, dialog");
    const badgeComponent = scope?.querySelector("product-badge");

    if (!badgeComponent) return;

    badgeComponent.dispatchEvent(
      new CustomEvent("badge:update-optimistic", {
        detail: { variant },
        bubbles: false,
      })
    );
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    if (!newHtml) return;

    /** @type {NewProduct | undefined} */
    let newProduct;

    const newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    if (!newVariantPickerSource) {
      throw new Error("No new variant picker source found");
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    morph(this, newVariantPickerSource);

    return newProduct;
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector("main");
    const newMain = newHtml.querySelector("main");

    if (!main || !newMain) {
      throw new Error("No new main source found");
    }

    morph(main, newMain);

    if (this.dataset.templateProductMatch === "true") {
      requestAnimationFrame(() => {
        import("./product-information-below-media.js")
          .then((m) => m.syncProductInformationBelowMediaLayouts())
          .catch(() => {
            /* module only shipped on product template */
          });
      });
    }
  }

  /**
   * Gets the selected option.
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption = this.querySelector("select option[selected], .variant-option--fieldset input:checked");

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error("No option value ID found");
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(
      this.querySelectorAll("select option[selected], .variant-option--fieldset input:checked")
    );

    return selectedOptions.map((option) => {
      const { optionValueId } = option.dataset;

      if (!optionValueId) throw new Error("No option value ID found");

      return optionValueId;
    });
  }

  get quickAddDrawerId() {
    const quickViewDrawer = document.getElementById("quick-view-drawer");
    return quickViewDrawer?.dataset.sectionId;
  }

  /**
   * HYBRID APPROACH: Load and cache preloaded variants for instant switching
   * Variants are preloaded in the initial HTML for zero-latency updates
   */
  #loadVariantsCache() {
    const cacheScript = this.querySelector("script[data-variants-cache]");

    if (!cacheScript?.textContent) {
      console.warn("⚠️ No variants cache found - will fetch from server");
      return;
    }

    const productId = this.dataset.productId;
    if (!productId) {
      console.warn("No productId found - cannot cache variants");
      return;
    }

    try {
      const data = JSON.parse(cacheScript.textContent);

      // Cache variants indexed by productId + option values for fast lookup
      if (data.variants && Array.isArray(data.variants)) {
        globalVariantsByProduct.set(productId, data.variants);
        data.variants.forEach((variant) => {
          // Create cache key from productId + option values
          const key = this.#buildCacheKey(variant);
          globalVariantsCache.set(key, variant);
        });
      }

      // Cache media for quick reference (with productId prefix)
      if (data.media && Array.isArray(data.media)) {
        data.media.forEach((media) => {
          const mediaKey = `${productId}|${media.id}`;
          globalMediaCache.set(mediaKey, media);
        });
      }
    } catch (e) {
      console.error("Failed to load variants cache:", e);
    }
  }

  #buildCacheKey(variant) {
    const productId = this.dataset.productId;
    if (!productId) {
      console.warn("No productId for cache key");
      return "";
    }

    // Build key from productId + available options (option1, option2, option3)
    const parts = [productId];
    if (variant.option1) parts.push(variant.option1);
    if (variant.option2) parts.push(variant.option2);
    if (variant.option3) parts.push(variant.option3);
    return parts.join("|");
  }

  #getCachedVariant() {
    const productId = this.dataset.productId;
    if (!productId) {
      console.warn("No productId - cannot get cached variant");
      return null;
    }

    // Get currently selected option values (scoped to this variant-picker instance)
    const selectedOptions = Array.from(
      this.querySelectorAll("select option[selected], .variant-option--fieldset input:checked")
    );

    if (selectedOptions.length === 0) return null;

    // Build cache key from productId + selected values
    const optionValues = selectedOptions.map((el) => el.value).join("|");
    const key = `${productId}|${optionValues}`;

    return globalVariantsCache.get(key) || null;
  }
}

if (!customElements.get("variant-picker")) {
  customElements.define("variant-picker", VariantPicker);
}
