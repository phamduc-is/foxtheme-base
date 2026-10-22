/**
 * @capability Lazy product-type filter for search — the <select> ships with only "All product types" (plus the type the current search is filtered by) and fetches the full option list from the section-rendering endpoint the first time a pointer or focus reaches the search form, so a store with hundreds of product types keeps that list out of every page's HTML. Also folds the selected type into `q` as `product_type:X AND term` on submit when no search component owns the form (predictive search off), which the select cannot do itself — it carries no `name`.
 * @when Any search form offering the product-type filter (header search, search drawer, search page input). Reuse instead of looping `shop.types` inline — the same list would otherwise ship twice per page and again inside every predictive-search section render.
 * @contract <search-type-select class="search__types" data-types-url="<root>?section_id=section-rendering-search-product-types"> wrapping the label + <div class="select"><select ref="searchType">. The select keeps `<option value="">` first; the option for the active search type carries `data-current` so it can be swapped for the fetched one (which sorts in the merchant's order). Sets data-hydrated when the list has landed.
 * @keywords product type filter, search select, lazy options, shop.types, deferred dom, section rendering endpoint, search form, product_type query, native submit fallback
 */

/**
 * Shared across every instance on the page — header search, search drawer and the search page
 * input all want the same list, so they wait on one request.
 *
 * @type {Promise<{ value: string, label: string }[]> | null}
 */
let productTypes = null;

/**
 * @param {string} url - The section-rendering URL that returns the <option> elements.
 * @returns {Promise<{ value: string, label: string }[]>}
 */
function loadProductTypes(url) {
  productTypes ??= fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);

      return response.text();
    })
    .then((html) => {
      const parsed = new DOMParser().parseFromString(html, "text/html");

      // Map to plain values so the parsed document can be released and each instance builds
      // its own options instead of sharing (and moving) one set of nodes.
      return Array.from(parsed.querySelectorAll("option"), (option) => ({
        value: option.value,
        label: option.textContent?.trim() ?? "",
      }));
    })
    .catch((error) => {
      productTypes = null;

      throw error;
    });

  return productTypes;
}

class SearchTypeSelect extends HTMLElement {
  /** @type {AbortController} */
  #controller = new AbortController();
  #hydrating = false;

  connectedCallback() {
    // Recreated per connect: the search drawer can move this element in and out of the DOM.
    this.#controller = new AbortController();

    const { signal } = this.#controller;
    const hydrate = () => this.#hydrate();

    // The native select popup opens on pointerdown and cannot wait for a fetch, so the list has
    // to be on its way BEFORE the click: entering or focusing anywhere in the search form is the
    // earliest reliable signal (the drawer even focuses this select as it opens).
    for (const target of [this, this.closest("form")]) {
      if (!target) continue;

      target.addEventListener("pointerenter", hydrate, { signal });
      target.addEventListener("pointerdown", hydrate, { signal });
      target.addEventListener("focusin", hydrate, { signal });
    }

    this.closest("form")?.addEventListener("submit", this.#composeQuery, { signal });
  }

  disconnectedCallback() {
    this.#controller.abort();
  }

  /**
   * Folds the selected type into the query the form submits — Shopify has no separate parameter
   * for it, `product_type:X AND term` inside `q` is the only way to express it, and merging two
   * fields into one needs JS.
   *
   * Normally predictive-search / search-page-input-component do this and never let the native
   * submit run. But this select is gated on `search_by_product_type_enabled` while search.js is
   * gated on `search_predictive_enabled`: with predictive off, the header and drawer render the
   * select with nothing bound to it, and since it has no `name` the native submit dropped the
   * filter silently. `:defined` asks the precise question — has the component that owns this
   * form's submission actually upgraded? — instead of guessing at settings from JS.
   */
  #composeQuery = () => {
    const owner = this.closest("predictive-search, search-page-input-component");
    if (owner?.matches(":defined")) return;

    const select = this.querySelector("select");
    const input = this.closest("form")?.querySelector('input[name="q"]');

    if (!(select instanceof HTMLSelectElement) || !(input instanceof HTMLInputElement)) return;

    const term = input.value.trim();

    // Left unencoded: the browser encodes the field on submit.
    if (select.value && term) input.value = `product_type:${select.value} AND ${term}`;
  };

  async #hydrate() {
    const url = this.dataset.typesUrl;
    const select = this.querySelector("select");

    if (this.#hydrating || this.hasAttribute("data-hydrated") || !url || !(select instanceof HTMLSelectElement)) {
      return;
    }

    // Claimed before the await so the pointer/focus events that arrive together only fetch once.
    this.#hydrating = true;

    try {
      const types = await loadProductTypes(url);
      const fragment = document.createDocumentFragment();

      for (const { value, label } of types) {
        fragment.append(new Option(label, value));
      }

      // The server-rendered option for the active search type is a placeholder: drop it once the
      // real list is in, so the types keep the merchant's own order.
      const current = select.querySelector("option[data-current]");
      const currentValue = current?.value;

      select.append(fragment);
      current?.remove();

      if (currentValue) select.value = currentValue;

      this.setAttribute("data-hydrated", "");
    } catch (error) {
      // Leave the select as it is — "All product types" still searches everything — and let the
      // next interaction retry.
      console.error("Error loading search product types: ", error);
    } finally {
      this.#hydrating = false;
    }
  }
}

if (!customElements.get("search-type-select")) {
  customElements.define("search-type-select", SearchTypeSelect);
}
