import { Component } from "@theme/component";
import { revealSwap } from "@theme/reveal-swap";
import { debounce, getSectionId, removeScrollLockClass } from "@theme/utilities";
import { dispatchSearchUpdate } from "@theme/standard-events";

/**
 * Every instance rendering the SAME panel shares one request — the header search and the search
 * drawer usually point at one section-rendering endpoint, so the second one to open costs
 * nothing. Keyed by URL rather than held in a single promise: a theme may give the two contexts
 * different endpoints (a wide header panel and a narrow drawer want different column counts, and
 * a section cannot read query params to tell them apart), and a lone promise served whichever
 * fetch happened to fire first to both.
 *
 * @type {Map<string, Promise<string>>}
 */
const recommendationsRequests = new Map();

/**
 * @param {string} url - Section-rendering URL for the recommendations panel.
 * @returns {Promise<string>}
 */
function fetchRecommendations(url) {
  const request = () =>
    fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);

      return response.text();
    });

  // The theme editor re-renders the section whenever the merchant edits a recommendation setting,
  // so a cached response would keep showing the products from before the edit.
  if (window.Shopify?.designMode) return request();

  let cached = recommendationsRequests.get(url);

  if (!cached) {
    cached = request().catch((error) => {
      recommendationsRequests.delete(url);

      throw error;
    });

    recommendationsRequests.set(url, cached);
  }

  return cached;
}

class PredictiveSearch extends Component {
  requiredRefs = ["searchInput", "searchResults", "searchContent"];
  #abortController = new AbortController();
  #lastKeydown = null;
  #focusoutTimeout = null;
  #isLoading = false;
  #isLoadingRecommendations = false;
  /** @type {(() => void) | null} */
  #finishReveal = null;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;

    this.cachedMap = new Map();
    this.onInputDebounced = debounce(this.onChange.bind(this), 300);

    this.escKeyPressHandler = this.#handleEscKeyPress.bind(this);
    this.clickOutsideHandler = this.#handleClickOutside.bind(this);

    this.focusOutHandler = this.#handleFocusOut.bind(this);
    this.addEventListener("focusout", this.focusOutHandler, { signal });

    if (this.refs.recommendations) {
      // Both fire before the panel finishes its open transition, so the recommendations are
      // usually in place by the time it is visible.
      this.addEventListener("pointerenter", this.#loadRecommendations, { signal });
      this.addEventListener("focusin", this.#loadRecommendations, { signal });
    }

    this.states = {
      OPEN: "predictive-search-open",
      SEARCH_OPEN: "search-open",
    };

    this.transitionEndHandler = null;
  }

  disconnectedCallback() {
    this.#abortController.abort();
    this.#cancelCloseAnimation();
    this.#finishReveal?.();
    super.disconnectedCallback();
  }

  get isEmptyRecommendations() {
    return this.dataset.emptyRecommendations === "true";
  }

  get isHeaderSearch() {
    return this.dataset.context === "header";
  }

  get header() {
    return this.isHeaderSearch ? this.closest("header") : null;
  }

  getQuery() {
    return this.refs.searchInput.value.trim();
  }

  hasQuery() {
    return this.getQuery().length > 0;
  }

  #getSearchQuery() {
    let searchTerm = this.getQuery();
    const { searchType } = this.refs;

    // Not encoded here: both callers hand this to URLSearchParams, which encodes it. Encoding it
    // first made `blue shirt` reach Shopify as the literal `blue%20shirt` — and only on the
    // filtered branch, since the plain term below is returned raw.
    if (searchType && searchType.value != "") {
      searchTerm = `product_type:${searchType.value} AND ${searchTerm}`;
    }

    return searchTerm;
  }

  #getSearchPageURL() {
    const form = this.refs.searchInput.form;
    const url = new URL(FoxTheme.routes.search_url, FoxTheme.routes.shop_url);

    for (const [name, value] of new FormData(form)) {
      url.searchParams.append(name, value);
    }

    url.searchParams.set("q", this.#getSearchQuery());

    return url;
  }

  setupURL() {
    const url = new URL(`${FoxTheme.routes.shop_url}${FoxTheme.routes.predictive_search_url}`);

    url.searchParams.set("q", this.#getSearchQuery());
    url.searchParams.set("resources[limit]", this.dataset.resultsLimit || 3);
    url.searchParams.set("resources[limit_scope]", "each");
    url.searchParams.set("section_id", getSectionId(this));

    return url;
  }

  /**
   * Swaps the recommendation products skeleton for the fetched carousel. Skipped while a query is
   * present: the results replace the panel, and clearing the query closes the search anyway, so
   * the next focus loads it.
   */
  #loadRecommendations = () => {
    const container = this.refs.recommendations;

    if (!container || container.hasAttribute("data-loaded") || this.#isLoadingRecommendations) return;
    if (this.hasQuery()) return;

    const url = container.dataset.recommendationsUrl;
    const host = container.querySelector("[data-recommendations-content]");

    // Keywords-only recommendations have no skeleton and nothing to fetch.
    if (!url || !host) return;

    this.#isLoadingRecommendations = true;

    fetchRecommendations(url)
      .then((responseText) => {
        const parsed = new DOMParser().parseFromString(responseText, "text/html");
        const content = parsed.querySelector("[data-recommendations-content]");

        if (!content) throw new Error("Recommendations content not found in the parsed response.");

        // The skeleton reserves the height, so what is left is the difference between it and the
        // real cards — revealSwap transitions that instead of letting the panel jump.
        this.#finishReveal?.();
        this.#finishReveal = revealSwap(host, content);
        container.setAttribute("data-loaded", "");
      })
      .catch((error) => {
        // The panel stays empty rather than breaking the search; the next focus retries.
        console.error("Error fetching search recommendations: ", error);
      })
      .finally(() => {
        this.#isLoadingRecommendations = false;
      });
  };

  onFocus(event) {
    if (!this.hasQuery() && this.isEmptyRecommendations) {
      return;
    }

    this.toggleSearchState(true);

    if (!this.hasQuery()) {
      this.refs.searchContent.classList.remove("hidden");
    } else {
      const url = this.setupURL().toString();
      // A refocus re-renders the same search: no shopify:search:update.
      this.renderSection(url);
    }
  }

  #handleEscKeyPress(event) {
    const { key } = event;

    this.#lastKeydown = key;

    if (key === "Escape") {
      this.clear();
    }
  }

  close(event) {
    event?.preventDefault();

    this.toggleSearchState(false);
  }

  clear(event = null) {
    event?.preventDefault();

    this.refs.searchInput.value = "";
    this.refs.searchInput.focus();
    this.removeAttribute("data-results");
    this.toggleSearchState(false);
  }

  onSubmit(event) {
    event.preventDefault();

    if (!this.hasQuery()) {
      this.refs.searchInput.focus();
      return;
    }

    window.location.assign(this.#getSearchPageURL());
  }

  onChange() {
    if (!this.hasQuery()) {
      this.clear();
      return;
    }

    this.#doSearch();
  }

  onProductTypeChange() {
    if (!this.hasQuery()) return;

    this.#doSearch();
  }

  /**
   * The buyer typed (or changed the product type): a new search, so it carries
   * the standard shopify:search:update. Re-opening the panel on focus renders
   * the same results again and reports nothing.
   */
  #doSearch() {
    const url = this.setupURL().toString();
    // A new search: its result cards may report their product views again
    // (the s-view-event definition in snippets/scripts.liquid fills this set).
    /** @type {any} */ (this).viewedProducts?.clear();
    const searchUpdate = dispatchSearchUpdate(this, { query: this.getQuery() });
    this.renderSection(url, searchUpdate);
  }

  /**
   * @param {string} url
   * @param {import("@theme/standard-events").StandardEventHandles | null} [searchUpdate]
   */
  renderSection(url, searchUpdate = null) {
    this.cachedMap.has(url)
      ? this.renderSectionFromCache(url, searchUpdate)
      : this.renderSectionFromFetch(url, searchUpdate);
  }

  /**
   * @param {string} url
   * @param {import("@theme/standard-events").StandardEventHandles | null} [searchUpdate]
   */
  renderSectionFromCache(url, searchUpdate = null) {
    const responseText = this.cachedMap.get(url);
    this.renderSearchResults(responseText);
    this.setAttribute("data-results", "");
    searchUpdate?.resolve({ totalCount: this.#getTotalResults() });
  }

  /**
   * @param {string} url
   * @param {import("@theme/standard-events").StandardEventHandles | null} [searchUpdate]
   */
  async renderSectionFromFetch(url, searchUpdate = null) {
    this.#setLoadingState(true);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Network response was not ok");

      const responseText = await response.text();
      this.cachedMap.set(url, responseText);
      this.#setLoadingState(false);
      this.renderSearchResults(responseText);
      searchUpdate?.resolve({ totalCount: this.#getTotalResults() });
    } catch (error) {
      searchUpdate?.reject(error instanceof Error ? error : new Error(String(error)));
      console.error("Error fetching data: ", error);
      this.setAttribute("error", "Failed to load data");
      this.#setLoadingState(false);
    }
  }

  /** Product results the rendered predictive search holds (see snippets/predictive-search.liquid). */
  #getTotalResults() {
    const counter = this.refs.searchResults.querySelector("[data-total-results]");
    return counter instanceof HTMLElement ? Number(counter.dataset.totalResults) || 0 : 0;
  }

  renderSearchResults(responseText) {
    const { searchResults, searchContent } = this.refs;

    const id = searchResults.id;
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(responseText, "text/html");
    const contentElement = parsedDoc.getElementById(id);

    if (!contentElement) {
      console.error(`Element with id '${id}' not found in the parsed response.`);
      return;
    }

    searchContent.classList.remove("hidden");
    searchResults.innerHTML = contentElement.innerHTML;

    this.toggleSearchState(true);
  }

  #handleClickOutside(event) {
    const { target } = event;

    if (this.contains(target)) {
      clearTimeout(this.#focusoutTimeout);
      return;
    }

    if (this.isHeaderSearch && !target.hasAttribute("data-header-backdrop") && !target.closest("header")) {
      return;
    }

    setTimeout(() => this.toggleSearchState(false));
  }

  #handleFocusOut(event) {
    const { relatedTarget } = event;

    if (!relatedTarget || this.contains(relatedTarget)) {
      return;
    }

    if (this.#lastKeydown === "Tab" && this.classList.contains(this.states.OPEN)) {
      this.#focusoutTimeout = setTimeout(() => this.toggleSearchState(false), 200);
    }
  }

  toggleSearchState(shouldOpen) {
    const isOpened = this.classList.contains(this.states.OPEN);

    if (isOpened === shouldOpen) return;

    if (this.#isLoading) return;

    this.classList.toggle(this.states.OPEN, shouldOpen);

    if (this.isHeaderSearch) {
      if (shouldOpen) {
        this.#setViewportHeight();

        // Opening: cancel any pending close animation and add class
        this.#cancelCloseAnimation();
        document.body.classList.add(this.states.SEARCH_OPEN);
        document.addEventListener("click", this.clickOutsideHandler);
        document.addEventListener("keydown", this.escKeyPressHandler);
      } else {
        // Closing: remove class and wait for transition to complete
        this.#closeSearchWithAnimation();
        document.removeEventListener("click", this.clickOutsideHandler);
        document.removeEventListener("keydown", this.escKeyPressHandler);
      }
    }

    if (!shouldOpen && this.isEmptyRecommendations) {
      this.refs.searchContent?.classList.add("hidden");
    }
  }

  #getContentInner() {
    return this.refs.searchContent?.querySelector("[data-search-content-inner]");
  }

  #cancelCloseAnimation() {
    if (!this.transitionEndHandler) return;

    const contentInner = this.#getContentInner();
    if (contentInner) {
      contentInner.removeEventListener("transitionend", this.transitionEndHandler);
    }
    this.transitionEndHandler = null;
  }

  #closeSearchWithAnimation() {
    const contentInner = this.#getContentInner();
    if (!contentInner) {
      removeScrollLockClass(document.body, this.states.SEARCH_OPEN);
      return;
    }

    this.#cancelCloseAnimation();
    removeScrollLockClass(document.body, this.states.SEARCH_OPEN);

    // Listen for transition end on transform (longest duration: 0.35s)
    this.transitionEndHandler = (event) => {
      if (event.target === contentInner && event.propertyName === "transform") {
        this.transitionEndHandler = null;
      }
    };

    contentInner.addEventListener("transitionend", this.transitionEndHandler, { once: true });
  }

  #setLoadingState(isLoading) {
    this.#isLoading = isLoading;
    if (isLoading) {
      this.setAttribute("data-loading", "");
    } else {
      this.removeAttribute("data-loading");
      this.setAttribute("data-results", "");
    }
  }

  #setViewportHeight() {
    document.documentElement.style.setProperty("--viewport-height", `${window.innerHeight}px`);

    const header = this.header;
    if (header) {
      document.documentElement.style.setProperty(
        "--header-bottom-position",
        `${parseInt(header.getBoundingClientRect().bottom)}px`
      );
    }
  }
}
customElements.define("predictive-search", PredictiveSearch);
