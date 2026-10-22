import { Component } from "@theme/component";
import { debounce } from "@theme/utilities";

/**
 * A custom element that allows the user to clean a search input.
 *
 * @typedef {object} Refs
 * @property {HTMLInputElement} searchInput - The search input element.
 * @property {HTMLSelectElement} [searchType] - Optional product type filter select.
 * @extends {Component<Refs>}
 */
class SearchPageInputComponent extends Component {
  requiredRefs = ["searchInput"];

  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    this.refs.searchInput.form?.addEventListener("submit", this.#handleSubmit, { signal });
  }

  disconnectedCallback() {
    this.#abortController.abort();
    super.disconnectedCallback();
  }

  /**
   * Handles the click event on the clear button and submits an empty search.
   * This clears the search input and resubmits the form if the page is not
   * already in an empty state.
   */
  handleClearClick() {
    this.#submitEmptySearch();
  }

  /**
   * Handles the keydown event on the search input and resets the search when
   * empty and Escape is pressed.
   *
   * @param {KeyboardEvent} event - The keyboard event.
   */
  handleKeyDown = debounce((event) => {
    const value = this.refs.searchInput.value.trim();

    if (event.key === "Escape" && value === "") {
      this.#submitEmptySearch();
    }
  }, 100);

  #submitEmptySearch() {
    const { searchInput, searchType } = this.refs;

    searchInput.focus();
    searchInput.value = "";

    if (searchType) searchType.value = "";

    if (this.#isEmptyState()) return;

    window.location.assign(this.#getSearchPageURL());
  }

  onProductTypeChange() {
    this.#doSearch();
  }

  #handleSubmit = (event) => {
    event.preventDefault();

    this.#doSearch();
  };

  #doSearch() {
    const { searchInput } = this.refs;

    if (searchInput.value.trim() === "") {
      searchInput.focus();
      return;
    }

    window.location.assign(this.#getSearchPageURL());
  }

  #getSearchQuery() {
    const { searchInput, searchType } = this.refs;
    let searchTerm = searchInput.value.trim();

    // Not encoded here: the caller hands this to URLSearchParams, which encodes it. Encoding it
    // first made `blue shirt` reach Shopify as the literal `blue%20shirt` — and only on the
    // filtered branch, since the plain term above is used raw.
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

  #isEmptyState = () => {
    const url = new URL(window.location.href);
    const queryParam = url.searchParams.get("q") ?? "";

    return queryParam.trim() === "";
  };
}

if (!customElements.get("search-page-input-component")) {
  customElements.define("search-page-input-component", SearchPageInputComponent);
}
