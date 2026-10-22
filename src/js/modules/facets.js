import { Component } from "@theme/component";
import { FilterUpdateEvent, ThemeEvents } from "@theme/events";
import { sectionRenderer } from "@theme/section-renderer";
import { debounce, formatMoney } from "@theme/utilities";
import { dispatchCollectionUpdate, dispatchSearchUpdate } from "@theme/standard-events";

const SEARCH_QUERY = "q";

/**
 * Handles the main facets form functionality
 *
 * @typedef {Object} FacetsFormRefs
 * @property {HTMLFormElement} facetsForm - The main facets form element
 * @property {HTMLElement | undefined} facetStatus - The facet status element
 *
 * @extends {Component<FacetsFormRefs>}
 */
class FacetsFormComponent extends Component {
  requiredRefs = ["facetsForm"];

  /** @type {import("@theme/standard-events").StandardEventHandles | null} */
  #pendingStandardUpdate = null;

  /** Bumped per results update, so an update a newer one overtook can tell. */
  #updateGeneration = 0;

  // No search:update on page load (pagination, reload, back included): the
  // event reports the buyer refining results in place, as in Dawn — a search
  // submitted from the header is a navigation, and the page view covers it.

  get #isSearch() {
    return this.dataset.searchResults === "true";
  }

  /**
   * Standard storefront event for a filter/sort change —
   * shopify:search:update on the search page, shopify:collection:update
   * elsewhere. Settled in {@link FacetsFormComponent##updateSection} once the
   * re-rendered section carries the new results count.
   * @param {URLSearchParams} parameters
   * @returns {import("@theme/standard-events").StandardEventHandles | null}
   */
  #dispatchStandardResultsUpdate(parameters) {
    if (this.#isSearch) {
      return dispatchSearchUpdate(this, {
        query: parameters.get(SEARCH_QUERY) || "",
        params: parameters,
      });
    }
    const collectionId = this.dataset.collectionId;
    return dispatchCollectionUpdate(this, {
      collection: {
        id: collectionId ? `gid://shopify/Collection/${collectionId}` : null,
        handle: this.dataset.collectionHandle || "",
        productsCount: Number(this.dataset.totalResultsCount) || 0,
      },
      params: parameters,
    });
  }

  static #notifyCollectionRerendered = debounce(() => {
    document.dispatchEvent(new CustomEvent(ThemeEvents.collectionRerendered));
  }, 50);

  /**
   * Creates URL parameters from form data
   * @param {FormData} [formData] - Optional form data to use instead of the main form
   * @returns {URLSearchParams} The processed URL parameters
   */
  createURLParameters(formData = new FormData(this.refs.facetsForm)) {
    let newParameters = new URLSearchParams(/** @type any */ (formData));

    if (newParameters.get("filter.v.price.gte") === "") newParameters.delete("filter.v.price.gte");
    if (newParameters.get("filter.v.price.lte") === "") newParameters.delete("filter.v.price.lte");

    newParameters.delete("page");

    const searchQuery = this.#getSearchQuery();
    if (searchQuery) newParameters.set(SEARCH_QUERY, searchQuery);

    return newParameters;
  }

  /**
   * Gets the search query parameter from the current URL
   * @returns {string} The search query
   */
  #getSearchQuery() {
    const url = new URL(window.location.href);
    return url.searchParams.get(SEARCH_QUERY) ?? "";
  }

  get sectionId() {
    const id = this.getAttribute("section-id");
    if (!id) throw new Error("Section ID is required");
    return id;
  }

  /**
   * Updates the URL hash with current filter parameters
   */
  #updateURLHash() {
    const url = new URL(window.location.href);
    const urlParameters = this.createURLParameters();

    url.search = "";
    for (const [param, value] of urlParameters.entries()) {
      url.searchParams.append(param, value);
    }

    history.pushState({ urlParameters: urlParameters.toString() }, "", url.toString());
  }

  /**
   * Updates filters and renders the section
   */
  updateFilters = () => {
    this.#updateURLHash();
    const parameters = this.createURLParameters();
    this.dispatchEvent(new FilterUpdateEvent(parameters));
    this.#pendingStandardUpdate = this.#dispatchStandardResultsUpdate(parameters);
    this.#updateSection();
  };

  /**
   * Updates the section
   */
  async #updateSection() {
    const pending = this.#pendingStandardUpdate;
    this.#pendingStandardUpdate = null;
    const generation = ++this.#updateGeneration;

    /** @type {string} */
    let sectionHTML;
    try {
      sectionHTML = await sectionRenderer.renderSection(this.sectionId);
    } catch (error) {
      pending?.reject(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    if (pending) {
      let count;
      if (generation !== this.#updateGeneration) {
        // A newer update overtook this one: the renderer skipped its morph, so
        // the dataset is not this query's. Its own HTML still came back and
        // carries its count — resolve with that rather than reject: the query
        // ran, and a listener gets a true answer instead of an AbortError.
        const counter = new DOMParser().parseFromString(sectionHTML, "text/html").querySelector("[data-results-count]");
        count = counter instanceof HTMLElement ? Number(counter.dataset.resultsCount) || 0 : 0;
      } else {
        // The morphed section carries the fresh count on this element's dataset.
        count = Number(this.dataset.resultsCount) || 0;
      }
      pending.resolve(this.#isSearch ? { totalCount: count } : { productsCount: count });
    }

    FacetsFormComponent.#notifyCollectionRerendered();

    // Scroll to top after section is updated
    this.#scrollToTop();
  }

  /**
   * Updates filters based on a provided URL
   * @param {string} url - The URL to update filters with
   */
  async updateFiltersByURL(url) {
    history.pushState("", "", url);
    const parameters = this.createURLParameters();
    this.dispatchEvent(new FilterUpdateEvent(parameters));
    this.#pendingStandardUpdate = this.#dispatchStandardResultsUpdate(parameters);
    await this.#updateSection();
  }

  /**
   * Brings the top of the results back into view after a re-render — only when
   * the buyer has scrolled past it (ticking a filter from a sticky sidebar
   * halfway down the grid), never when it is already on screen. Offsets by the
   * header only when one is sticky; a static header has scrolled away.
   */
  #scrollToTop() {
    const target = this.closest("results-list") ?? this.closest(".shopify-section");
    if (!target) return;

    const stickyHeader = document.querySelector('header[is="sticky-header"]');
    const headerHeight = stickyHeader
      ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 0
      : 0;

    // Breathing room under the header comes from the target's own
    // `scroll-margin-top` (template-collection.scss), the same knob a native
    // anchor scroll would honour.
    const gap = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const targetTop = target.getBoundingClientRect().top - headerHeight - gap;
    if (targetTop >= 0) return;

    window.scrollTo({
      top: Math.max(0, window.scrollY + targetTop),
      behavior: "smooth",
    });
  }
}

if (!customElements.get("facets-form-component")) {
  customElements.define("facets-form-component", FacetsFormComponent);
}

/**
 * @typedef {Object} FacetInputsRefs
 * @property {HTMLInputElement[]} facetInputs - The facet input elements
 */

/**
 * Handles individual facet input functionality
 * @extends {Component<FacetInputsRefs>}
 */
class FacetInputsComponent extends Component {
  get sectionId() {
    const id = this.closest(".shopify-section")?.id;
    if (!id) throw new Error("FacetInputs component must be a child of a section");
    return id;
  }

  /**
   * Updates filters and the selected facet summary
   */
  updateFilters() {
    const facetsForm = this.closest("facets-form-component");

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    // this.#updateSelectedFacetSummary();
  }

  /**
   * Handles keydown events for the facets form
   * @param {KeyboardEvent} event - The keydown event
   */
  handleKeyDown(event) {
    if (!(event.target instanceof HTMLElement)) return;
    const closestInput = event.target.querySelector("input");

    if (!(closestInput instanceof HTMLInputElement)) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      closestInput.checked = !closestInput.checked;
      this.updateFilters();
    }
  }

  /**
   * Handles mouseover events on facet labels
   * @param {MouseEvent} event - The mouseover event
   */
  prefetchPage = debounce((event) => {
    if (!(event.target instanceof HTMLElement)) return;

    const form = this.closest("form");
    if (!form) return;

    const formData = new FormData(form);
    const inputElement = event.target.querySelector("input");

    if (!(inputElement instanceof HTMLInputElement)) return;

    if (!inputElement.checked) formData.append(inputElement.name, inputElement.value);

    const facetsForm = this.closest("facets-form-component");
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    const urlParameters = facetsForm.createURLParameters(formData);

    const url = new URL(window.location.pathname, window.location.origin);

    for (const [key, value] of urlParameters) url.searchParams.append(key, value);

    if (inputElement.checked) url.searchParams.delete(inputElement.name, inputElement.value);

    sectionRenderer.getSectionHTML(this.sectionId, true, url);
  }, 200);

  cancelPrefetchPage = () => this.prefetchPage.cancel();

  /**
   * Updates the selected facet summary
   */
  #updateSelectedFacetSummary() {
    if (!this.refs.facetInputs) return;

    const checkedInputElements = this.refs.facetInputs.filter((input) => input.checked);
    const details = this.closest("details");
    const statusComponent = details?.querySelector("facet-status-component");

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent.updateListSummary(checkedInputElements);
  }
}

if (!customElements.get("facet-inputs-component")) {
  customElements.define("facet-inputs-component", FacetInputsComponent);
}

/**
 * Handles price facet functionality
 * @extends {Component<PriceFacetRefs>}
 */
class PriceFacetComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("keydown", this.#onKeyDown);
    this.#initializeRangeInputs();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.#onKeyDown);
    this.#cleanupRangeInputs();
  }

  /**
   * Handles keydown events to restrict input to valid characters
   * @param {KeyboardEvent} event - The keydown event
   */
  #onKeyDown = (event) => {
    if (event.metaKey) return;

    const pattern = /[0-9]|\.|,|'| |Tab|Backspace|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Delete|Escape/;
    if (!event.key.match(pattern)) event.preventDefault();
  };

  /**
   * Updates price filter and results
   */
  updatePriceFilterAndResults() {
    const { minInput, maxInput } = this.refs;

    this.#adjustToValidValues(minInput);
    this.#adjustToValidValues(maxInput);

    const facetsForm = this.closest("facets-form-component");
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    this.#setMinAndMaxValues();
    // this.#updateSummary();
  }

  /**
   * Adjusts input values to be within valid range
   * @param {HTMLInputElement} input - The input element to adjust
   */
  #adjustToValidValues(input) {
    if (input.value.trim() === "") return;

    const value = Number(input.value);
    const min = Number(formatMoney(input.getAttribute("data-min") ?? ""));
    const max = Number(formatMoney(input.getAttribute("data-max") ?? ""));

    if (value < min) input.value = min.toString();
    if (value > max) input.value = max.toString();
  }

  /**
   * Sets min and max values for the inputs
   */
  #setMinAndMaxValues() {
    const { minInput, maxInput } = this.refs;

    if (maxInput.value) minInput.setAttribute("data-max", maxInput.value);
    if (minInput.value) maxInput.setAttribute("data-min", minInput.value);
    if (minInput.value === "") maxInput.setAttribute("data-min", "0");
    if (maxInput.value === "") minInput.setAttribute("data-max", maxInput.getAttribute("data-max") ?? "");
  }

  /**
   * Updates the price summary
   */
  #updateSummary() {
    const { minInput, maxInput } = this.refs;
    const details = this.closest("details");
    const statusComponent = details?.querySelector("facet-status-component");

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent?.updatePriceSummary(minInput, maxInput);
  }

  /**
   * Initialize range inputs functionality
   */
  #initializeRangeInputs() {
    const { rangeMin, rangeMax, minInput, maxInput } = this.refs;
    if (!rangeMin || !rangeMax) return;

    // Bind range input events
    rangeMin.addEventListener("input", this.#onRangeMinInput);
    rangeMax.addEventListener("input", this.#onRangeMaxInput);
    rangeMin.addEventListener("change", this.#onRangeMinChange);
    rangeMax.addEventListener("change", this.#onRangeMaxChange);

    // Text input change events
    minInput.addEventListener("change", this.#onMinInputChange);
    maxInput.addEventListener("change", this.#onMaxInputChange);

    // Initialize visual range
    this.#updateRangeVisual();
  }

  /**
   * Cleanup range inputs events
   */
  #cleanupRangeInputs() {
    const { rangeMin, rangeMax, minInput, maxInput } = this.refs;

    if (rangeMin) {
      rangeMin.removeEventListener("input", this.#onRangeMinInput);
      rangeMin.removeEventListener("change", this.#onRangeMinChange);
    }
    if (rangeMax) {
      rangeMax.removeEventListener("input", this.#onRangeMaxInput);
      rangeMax.removeEventListener("change", this.#onRangeMaxChange);
    }
    if (minInput) minInput.removeEventListener("change", this.#onMinInputChange);
    if (maxInput) maxInput.removeEventListener("change", this.#onMaxInputChange);
  }

  /**
   * Handle min range input (while dragging)
   */
  #onRangeMinInput = (event) => {
    const { rangeMax, minInput } = this.refs;
    const value = parseInt(event.target.value);
    const maxValue = parseInt(rangeMax.value);

    // Ensure min doesn't exceed max
    if (value >= maxValue) {
      event.target.value = maxValue - 1;
    }

    // Update text input with formatted money
    minInput.value = this.#centsToMoney(parseInt(event.target.value));

    // Update visual
    this.#updateRangeVisual();
  };

  /**
   * Handle max range input (while dragging)
   */
  #onRangeMaxInput = (event) => {
    const { rangeMin, maxInput } = this.refs;
    const value = parseInt(event.target.value);
    const minValue = parseInt(rangeMin.value);

    // Ensure max doesn't go below min
    if (value <= minValue) {
      event.target.value = minValue + 1;
    }

    // Update text input with formatted money
    maxInput.value = this.#centsToMoney(parseInt(event.target.value));

    // Update visual
    this.#updateRangeVisual();
  };

  /**
   * Handle min range change (when drag ends)
   */
  #onRangeMinChange = () => {
    // Trigger filter update when user stops dragging
    this.updatePriceFilterAndResults();
  };

  /**
   * Handle max range change (when drag ends)
   */
  #onRangeMaxChange = () => {
    // Trigger filter update when user stops dragging
    this.updatePriceFilterAndResults();
  };

  /**
   * Convert cents to money format (divide by 100)
   * Returns string formatted to match locale (e.g., "2.629,95" for European)
   */
  #centsToMoney(cents) {
    const value = cents / 100;
    // Format with European style: dot for thousands, comma for decimals
    return value.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Convert money string to cents (multiply by 100)
   * Uses formatMoney utility to handle different number formats (commas, dots, spaces)
   */
  #moneyToCents(money) {
    // formatMoney handles: "2,629.95", "2.629,95", "2 629.95" → "2629.95"
    const cleanNumber = formatMoney(String(money));
    return Math.round(parseFloat(cleanNumber) * 100);
  }

  /**
   * Handle min input change
   */
  #onMinInputChange = (event) => {
    const { rangeMin, maxInput } = this.refs;
    // Convert money input to cents
    const valueInCents = this.#moneyToCents(event.target.value) || 0;
    const maxInCents = this.#moneyToCents(maxInput.value) || parseInt(rangeMin.max);
    const minRange = parseInt(rangeMin.min) || 0;

    const constrainedValue = Math.max(minRange, Math.min(valueInCents, maxInCents - 1));

    // Update text input with formatted money
    event.target.value = this.#centsToMoney(constrainedValue);
    // Update range input with cents
    rangeMin.value = constrainedValue;
    this.#updateRangeVisual();
  };

  /**
   * Handle max input change
   */
  #onMaxInputChange = (event) => {
    const { rangeMax, minInput } = this.refs;
    // Convert money input to cents
    const valueInCents = this.#moneyToCents(event.target.value) || parseInt(rangeMax.max);
    const minInCents = this.#moneyToCents(minInput.value) || 0;
    const maxRange = parseInt(rangeMax.max);

    const constrainedValue = Math.min(maxRange, Math.max(valueInCents, minInCents + 1));

    // Update text input with formatted money
    event.target.value = this.#centsToMoney(constrainedValue);
    // Update range input with cents
    rangeMax.value = constrainedValue;
    this.#updateRangeVisual();
  };

  /**
   * Update range visual CSS custom properties
   */
  #updateRangeVisual() {
    const { rangeMin, rangeMax } = this.refs;
    if (!rangeMin || !rangeMax) return;

    const rangeInputs = this.querySelector("[data-range-inputs]");
    if (!rangeInputs) return;

    const minValue = parseInt(rangeMin.value);
    const maxValue = parseInt(rangeMax.value);
    const maxRange = parseInt(rangeMax.max);

    const minPercent = (minValue / maxRange) * 100;
    const maxPercent = (maxValue / maxRange) * 100;

    rangeInputs.style.setProperty("--range-min", `${minPercent}%`);
    rangeInputs.style.setProperty("--range-max", `${maxPercent}%`);

    const intersectThresholdPercent = this.dataset.intersectThresholdPercent;
    const intersectThreshold = (maxRange * intersectThresholdPercent) / 100;
    const isIntersecting = minValue + intersectThreshold >= maxRange;

    if (isIntersecting) {
      this.style.setProperty("--range-min-z-index", "2");
    } else {
      this.style.removeProperty("--range-min-z-index");
    }
  }
}

if (!customElements.get("price-facet-component")) {
  customElements.define("price-facet-component", PriceFacetComponent);
}

/**
 * Handles sorting filter functionality
 *
 * @typedef {Object} SortingFilterRefs
 * @property {HTMLDetailsElement} details - The details element
 * @property {HTMLElement} summary - The summary element
 * @property {HTMLElement} listbox - The listbox element
 *
 * @extends {Component}
 */
class SortingFilterComponent extends Component {
  // NOTE: no manual change listeners here. The component root carries
  // on:change="/updateFilterAndSorting" (snippets/sorting.liquid) which
  // catches the bubbled change from both the select and the radios; the
  // previous connectedCallback ALSO bound the same handler directly to
  // sortingSelect/sortingInputs, so every sort change ran updateFilters twice
  // (double FilterUpdateEvent + double section fetch, masked by the
  // section-renderer's request dedupe) — and the listeners were never removed
  // on disconnect.

  /**
   * Updates filter and sorting
   * @param {Event} event - The change event
   */
  updateFilterAndSorting = (event) => {
    const facetsForm =
      this.closest("facets-form-component") || this.closest(".shopify-section")?.querySelector("facets-form-component");

    if (!(facetsForm instanceof FacetsFormComponent)) return;
    facetsForm.updateFilters();
    // this.updateFacetStatus(event);
  };

  /**
   * Updates the facet status
   * @param {Event} event - The change event
   */
  updateFacetStatus(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;

    const details = this.querySelector("details");
    if (!details) return;

    const facetStatus = details.querySelector("facet-status-component");
    if (!(facetStatus instanceof FacetStatusComponent)) return;

    const value = target.value;
    const defaultSortBy = details.dataset.defaultSortBy;
    const optionName =
      target.dataset.optionName ||
      (target instanceof HTMLSelectElement ? target.options[target.selectedIndex]?.text : "");

    facetStatus.textContent = value !== defaultSortBy ? (optionName ?? "") : "";
  }
}

if (!customElements.get("sorting-filter-component")) {
  customElements.define("sorting-filter-component", SortingFilterComponent);
}

/**
 * @typedef {Object} FacetRemoveComponentRefs
 * @property {HTMLInputElement | undefined} clearButton - The button to clear filters
 */

/**
 * Handles removal of individual facet filters
 * @extends {Component<FacetRemoveComponentRefs>}
 */
class FacetRemoveComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Removes the filter
   * @param {Object} data - The data object
   * @param {string} data.form - The form to remove the filter from
   * @param {Event} event - The click event
   */
  removeFilter({ form }, event) {
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
    }

    const url = this.dataset.url;
    if (!url) return;

    let facetsForm;
    if (form) {
      facetsForm = document.getElementById(form);
    } else {
      // First try to find facets-form-component in parent elements
      facetsForm = this.closest("facets-form-component");

      // If not found, search in the entire document
      if (!facetsForm) {
        facetsForm = document.querySelector("facets-form-component");
      }
    }

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFiltersByURL(url);
  }

  /**
   * Toggle clear button visibility when filters are applied. Happens before the
   * Section Rendering Request resolves.
   *
   * @param {FilterUpdateEvent} event
   */
  #handleFilterUpdate = (event) => {
    const { clearButton } = this.refs;
    if (clearButton instanceof Element) {
      clearButton.classList.toggle("active", event.shouldShowClearAll());
    }
  };
}

if (!customElements.get("facet-remove-component")) {
  customElements.define("facet-remove-component", FacetRemoveComponent);
}
