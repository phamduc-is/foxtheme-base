import { Component } from "@theme/component";
import { DialogComponent } from "@theme/dialog";
import { ThemeEvents } from "@theme/events";
import {
  CookieManager,
  getLocalStorage,
  getSectionId,
  removeLocalStorage,
  setLocalStorage,
} from "@theme/utilities";

class CompareUtils {
  static isCompareActive() {
    return (
      getLocalStorage(CookieManager.COMPARE_IS_ACTIVE) || getLocalStorage(CookieManager.COMPARE_IS_ACTIVE) === "true"
    );
  }

  static setCompareActive(isActive) {
    setLocalStorage(CookieManager.COMPARE_IS_ACTIVE, isActive);
  }

  static getSelectedProducts() {
    const products = getLocalStorage(CookieManager.COMPARE_PRODUCTS);
    return products || [];
  }

  static setSelectedProducts(products) {
    if (products.length > 0) {
      setLocalStorage(CookieManager.COMPARE_PRODUCTS, products);
    } else {
      removeLocalStorage(CookieManager.COMPARE_PRODUCTS);
    }
  }

  static getProductsCount() {
    return this.getSelectedProducts().length;
  }

  /**
   * Check the given product id in compare list.
   * @param {*} productId
   * @returns {boolean}
   */
  static isProductInList(productId) {
    const products = this.getSelectedProducts();

    return products.find((product) => product.id === productId);
  }

  /**
   * @param {*} productId
   * @param {*} productUrl
   * @returns {boolean} True if the product added to list.
   */
  static addToList(productId, productUrl) {
    let products = getLocalStorage(CookieManager.COMPARE_PRODUCTS) || [];

    if (products.length < this.getLimit()) {
      if (!products.some((product) => product.id === productId)) {
        products.push({ id: productId, url: productUrl });
      }

      this.setSelectedProducts(products);
      this.updateCompareCheckboxes(products);

      document.dispatchEvent(
        new CustomEvent(ThemeEvents.compareAdd, {
          detail: {
            products: products,
            productId: productId,
            productUrl: productUrl,
          },
        })
      );

      return true;
    } else {
      alert(FoxTheme.translations.compare_limit_message);

      return false;
    }
  }

  /**
   * @param {*} productId
   * @param {HTMLElement | null} [trigger] - Element that initiated the remove action
   */
  static removeFromList(productId, trigger = null) {
    let products = this.getSelectedProducts();
    if (products) {
      products = products.filter((product) => product.id !== productId);
    }
    this.setSelectedProducts(products);
    this.updateCompareCheckboxes(products);
    document.dispatchEvent(
      new CustomEvent(ThemeEvents.compareRemove, {
        detail: {
          products: products,
          productId: productId,
          trigger,
        },
      })
    );
  }

  static clearList() {
    const products = this.getSelectedProducts();
    if (products) {
      products.forEach((product) => {
        this.removeFromList(product.id);
      });
    }
  }

  static updateCompareCheckboxes(products = null) {
    products = products || this.getSelectedProducts();
    document.querySelectorAll("[data-compare-checkbox]").forEach((checkbox) => {
      checkbox.checked = products.filter((product) => product.id === checkbox.dataset.productId).length;
    });
  }

  static getTemplateUrl(productUrl, queryObj = {}) {
    let url = productUrl;
    const separator = productUrl.includes("?") ? "&" : "?";
    const params = new URLSearchParams();

    for (const key in queryObj) {
      if (Object.hasOwn(queryObj, key)) {
        params.append(key, queryObj[key]);
      }
    }

    // Append parameters to the URL if any were added.
    if (Array.from(params).length > 0) {
      url += `${separator}${params.toString()}`;
    }

    return url;
  }

  static getSectionNameForCompareBarItem() {
    return "section-rendering-compare-bar-item";
  }

  static getCompareBarItemTemplate(productUrl) {
    return this.getTemplateUrl(productUrl, {
      sections: this.getSectionNameForCompareBarItem(),
    });
  }

  static getLimit() {
    return Number(FoxTheme.settings.compareLimit);
  }
}

class CompareSwitch extends Component {
  requiredRefs = ["checkbox"];

  /** @type {AbortController | null} */
  #abortController = null;

  connectedCallback() {
    super.connectedCallback();

    // A bfcache restore re-syncs the rest of the compare UI through `compareRestore` (see the
    // pageshow handler at the end of this file) but nothing was listening on behalf of the
    // switch, so it alone came back stale after a back/forward between collection and search.
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    document.addEventListener(ThemeEvents.compareRestore, this.syncFromStorage, {
      signal: this.#abortController.signal,
    });

    this.#init();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;

    super.disconnectedCallback();
  }

  #init() {
    const isActive = CompareUtils.isCompareActive();

    // Assigned unconditionally, not only when active. Browsers restore form-control state on a
    // back/forward even WITHOUT bfcache -- and then `pageshow` fires with `persisted === false`,
    // so the restore path above never runs. The box can come back ticked while storage says the
    // feature is off; the old one-way branch had no way to correct that.
    this.refs.checkbox.checked = isActive;

    if (isActive) {
      this.#handleChange(isActive);
    }
  }

  /**
   * Mirror storage onto the DOM, both directions. Deliberately does NOT write storage or fire
   * `compareToggle`: this is a passive re-read, not a user action.
   *
   * Needed on two paths that never re-run `connectedCallback` -- a morph of the section (sorting
   * or filtering re-renders it, and morph's updateInput copies the server's `checked === false`
   * onto the live input), and a bfcache restore.
   */
  syncFromStorage = () => {
    const isActive = CompareUtils.isCompareActive();

    this.refs.checkbox.checked = isActive;
    document.body.classList.toggle("compare-is-active", isActive);
  };

  updatedCallback() {
    super.updatedCallback();

    this.syncFromStorage();
  }

  onSwitch(event) {
    event.preventDefault();
    const { target } = event;

    this.#handleChange(target.checked);
  }

  #handleChange(isActive) {
    requestAnimationFrame(() => {
      document.body.classList.toggle("compare-is-active", isActive);
    });

    CompareUtils.setCompareActive(isActive);

    document.dispatchEvent(new CustomEvent(ThemeEvents.compareToggle, { detail: { isActive } }));
  }
}
customElements.define("compare-switch", CompareSwitch);

class CompareCheckbox extends Component {
  requiredRefs = ["checkbox"];

  connectedCallback() {
    super.connectedCallback();

    this.#init();
  }

  #init() {
    const { checkbox } = this.refs;
    const { productId } = checkbox.dataset;
    checkbox.checked = CompareUtils.isProductInList(productId);
  }

  /**
   * Same as the switch: the tick is a property restored from localStorage, and every card in
   * the grid is morphed on sort/filter, so each one silently lost its tick.
   */
  updatedCallback() {
    super.updatedCallback();

    this.#init();
  }

  onChange(event) {
    event.preventDefault();

    const { checkbox } = this.refs;
    const { productId, productUrl } = checkbox.dataset;

    if (checkbox.checked) {
      const isAdded = CompareUtils.addToList(productId, productUrl);

      if (!isAdded) {
        checkbox.checked = false;
      }
    } else {
      CompareUtils.removeFromList(productId, checkbox);
    }
  }
}
customElements.define("compare-checkbox", CompareCheckbox);

class CompareRemove extends HTMLButtonElement {
  constructor() {
    super();

    this.clickHandler = this.onClick.bind(this);
    this.addEventListener("click", this.clickHandler);
  }

  onClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const { productId } = this.dataset;

    CompareUtils.removeFromList(productId, this);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.clickHandler);
  }
}
customElements.define("compare-remove", CompareRemove, { extends: "button" });

/**
 * The compare bar's "Compare" button. Opens the compare drawer (or navigates to
 * the compare page) and stays disabled until at least two products are selected.
 */
class CompareOpen extends HTMLButtonElement {
  /** @type {AbortController | null} */
  #abortController = null;

  // The controller is rebuilt on every connect, never once as a field. A morph can move
  // this element (insertBefore/appendChild on a live node fires disconnected + connected on
  // the SAME instance), and a field-initialised controller is aborted by that first
  // disconnect and never replaced -- every later addEventListener binds an already-aborted
  // signal and silently does nothing. That is why toggling the compare switch stopped
  // opening the bar after sorting.
  connectedCallback() {
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    this.addEventListener("click", this.onClick.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareAdd, this.#updateState.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRemove, this.#updateState.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRestore, this.#updateState.bind(this), { signal });

    this.#updateState();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
  }

  onClick(event) {
    event.preventDefault();

    if (CompareUtils.getProductsCount() < 2) return;

    const { pageUrl } = this.dataset;
    if (pageUrl) {
      window.location.href = pageUrl;
    } else {
      document.querySelector("compare-dialog")?.showDialog();
    }
  }

  #updateState() {
    const disabled = CompareUtils.getProductsCount() < 2;

    this.disabled = disabled;
    this.classList.toggle("disabled", disabled);
  }
}
customElements.define("compare-open", CompareOpen, { extends: "button" });

/**
 * The compare bar's "Remove all" button. Clears the compare list and stays
 * disabled while the list is empty.
 */
class CompareClear extends HTMLButtonElement {
  /** @type {AbortController | null} */
  #abortController = null;

  // The controller is rebuilt on every connect, never once as a field. A morph can move
  // this element (insertBefore/appendChild on a live node fires disconnected + connected on
  // the SAME instance), and a field-initialised controller is aborted by that first
  // disconnect and never replaced -- every later addEventListener binds an already-aborted
  // signal and silently does nothing. That is why toggling the compare switch stopped
  // opening the bar after sorting.
  connectedCallback() {
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    this.addEventListener("click", this.onClick.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareAdd, this.#updateState.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRemove, this.#updateState.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRestore, this.#updateState.bind(this), { signal });

    this.#updateState();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
  }

  onClick(event) {
    event.preventDefault();

    if (CompareUtils.getProductsCount() < 1) return;

    CompareUtils.clearList();
  }

  #updateState() {
    const disabled = CompareUtils.getProductsCount() < 1;

    this.disabled = disabled;
    this.classList.toggle("disabled", disabled);

    // Opt-in per instance, not the default: on the compare page the table's own empty
    // state already says the list is empty, so a greyed-out "Remove all" above it is
    // noise. The compare bar keeps its copy visible-but-disabled — it is a fixed
    // toolbar, and a button that leaves the row shifts the ones beside it.
    if (this.hasAttribute("data-hide-on-empty")) this.classList.toggle("hidden", disabled);
  }
}
customElements.define("compare-clear", CompareClear, { extends: "button" });

class CompareBar extends Component {
  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {ResizeObserver | null} */
  #resizeObserver = null;

  /** @type {number | null} */
  #publishedHeight = null;

  constructor() {
    super();

    this.classes = {
      collapsed: "is-collapsed",
    };

    this.atLeastItemToShow = Math.min(5, CompareUtils.getLimit()); // Total compare products and placeholders.
  }

  connectedCallback() {
    super.connectedCallback();

    // Listeners belong here, not in the constructor, and on a controller rebuilt per connect.
    // A morph can move this element, which fires disconnected + connected on the SAME instance;
    // a field-initialised controller is aborted by that first disconnect and never replaced, so
    // the bar goes permanently deaf to compareAdd/Remove/Restore -- toggling the switch stopped
    // opening it after a sort.
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    document.addEventListener(ThemeEvents.compareAdd, this.onItemAdded.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRemove, this.onItemRemoved.bind(this), { signal });
    // Rebuild from storage rather than patch: the restored list can differ from
    // storage by any number of items, in either direction.
    document.addEventListener(ThemeEvents.compareRestore, this.#renderBar.bind(this), { signal });

    this.#restoreCollapsedState();
    this.#renderBar();

    // The page's bottom padding reads --compare-bar-height, so the value has to follow
    // the collapse transition frame by frame: one measurement taken when the class flips
    // reads a height mid-animation and freezes there. Observing also covers what the old
    // matchMedia listener covered (the breakpoint swaps the bar's paddings and the
    // mobile-only "Remove all" row) — and it is torn down on disconnect, which that
    // listener never was.
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => this.#setHeight());
    this.#resizeObserver.observe(this);
  }

  /**
   * A morph that leaves this element in place never re-runs connectedCallback, and the bar's
   * items are injected from localStorage -- the server HTML has none of them, so the morph
   * wipes the list and the bar reads as closed. Rebuild it from storage instead.
   */
  updatedCallback() {
    super.updatedCallback();

    this.#restoreCollapsedState();
    this.#renderBar();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;

    super.disconnectedCallback();
  }

  onItemAdded(event) {
    const { products, productId, productUrl } = event.detail;

    this.#appendBarItem(products, productId, productUrl);
    this.#updateComponents(products);
  }

  onItemRemoved(event) {
    const { products, productId } = event.detail;
    const { compareList } = this.refs;
    if (!compareList) return;

    const itemToDelete = compareList.querySelector(`[data-compare-bar-item-id="${productId}"]`);

    itemToDelete && itemToDelete.remove();
    this.#updateComponents(products);
    this.#removePlaceholdes();
    this.#addPlaceholders(products.length);
  }

  async #renderBar() {
    const products = CompareUtils.getSelectedProducts();
    const { compareList } = this.refs;

    let output = "";
    const compareItemHtmls = await this.#getBarItems(products);
    compareItemHtmls.forEach((htmlStr) => {
      output += htmlStr;
    });

    this.#removePlaceholdes();
    compareList.innerHTML = output;
    this.#addPlaceholders(products.length);

    this.#updateComponents(products);

    setTimeout(() => {
      this.setAttribute("data-compare-bar-ready", "");
    }, 100);
  }

  async #getBarItems(products) {
    const tmps = [];
    await Promise.all(
      products.map(async (product) => {
        const fetchUrl = CompareUtils.getCompareBarItemTemplate(product.url);
        await fetch(CompareUtils.getCompareBarItemTemplate(product.url))
          .then((response) => response.json())
          .then((response) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response[CompareUtils.getSectionNameForCompareBarItem()], "text/html");
            const itemHtml = doc.querySelector(".shopify-section");

            tmps[product.id] = itemHtml.innerHTML;
          });
      })
    );

    const returns = [];
    products.forEach((product) => returns.push(tmps[product.id]));
    return returns;
  }

  async #appendBarItem(products, productId, productUrl) {
    const { compareList } = this.refs;

    this.#removePlaceholdes();
    compareList.insertAdjacentHTML(
      "beforeend",
      `<li class="compare-bar__item" data-compare-bar-item-id="${productId}"></li>`
    );
    this.#addPlaceholders(products.length);

    await fetch(CompareUtils.getCompareBarItemTemplate(productUrl))
      .then((response) => response.json())
      .then((response) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(response[CompareUtils.getSectionNameForCompareBarItem()], "text/html");
        const itemHtml = doc.querySelector(".shopify-section");

        const itemEl = compareList.querySelector('[data-compare-bar-item-id="' + productId + '"]');
        if (itemEl) {
          itemEl.outerHTML = itemHtml.innerHTML;
        }
      });
  }

  handleToggleList(event) {
    event.preventDefault();

    const isCollapsed = this.classList.contains(this.classes.collapsed);
    this.classList.toggle(this.classes.collapsed, !isCollapsed);
    setLocalStorage(CookieManager.COMPARE_BAR_COLLAPSED, !isCollapsed);
  }

  #restoreCollapsedState() {
    const isCollapsed = getLocalStorage(CookieManager.COMPARE_BAR_COLLAPSED) === true;
    this.classList.toggle(this.classes.collapsed, isCollapsed);
  }

  #updateComponents(products) {
    // The open/clear buttons (compare-open, compare-clear) manage their own disabled state.
    this.#updateCounters(products.length);
  }

  #updateCounters(count) {
    const { counter } = this.refs;
    if (!counter) return;

    counter.innerText = count;
  }

  #removePlaceholdes() {
    Array.from(this.refs.compareList.querySelectorAll("[data-compare-bar-item-placeholder]")).forEach((li) => {
      li.remove();
    });
  }

  /** Not CompareTable's `placeholderSelector` — that one names a table ROW template. */
  get placeholderTemplateSelector() {
    return "[data-compare-bar-placeholder-template]";
  }

  /**
   * An empty slot is cloned from the template compare-bar.liquid renders, so its markup —
   * the dashed SVG frame included — is written once, in Liquid. The template sits outside
   * the list, which #renderBar rebuilds with `innerHTML`.
   */
  #addPlaceholders(count) {
    const placeholderCount = this.atLeastItemToShow - count;
    const template = this.querySelector(this.placeholderTemplateSelector);
    if (!template) return;

    for (let i = 0; i < placeholderCount; i++) {
      this.refs.compareList.appendChild(template.content.cloneNode(true));
    }
  }

  /**
   * Publish the bar's height for the page padding to read.
   *
   * Sub-pixel rather than offsetHeight's rounded integer, or the padding steps in 1px
   * jerks through the transition. Guarded on the last published value because the
   * padding it feeds can add or remove the page scrollbar, which resizes the bar and
   * calls back in here — the guard is what stops that settling loop from running on.
   */
  #setHeight() {
    const height = Math.round(this.getBoundingClientRect().height * 100) / 100;
    if (height === this.#publishedHeight) return;

    this.#publishedHeight = height;
    document.documentElement.style.setProperty("--compare-bar-height", `${height}px`);
  }
}
customElements.define("compare-bar", CompareBar);

class CompareDialog extends DialogComponent {
  /** @type {AbortController | null} */
  #abortController = null;

  connectedCallback() {
    super.connectedCallback();

    // Rebuilt per connect — see the note on CompareBar.
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    // The nested <compare-table> loads the products and tells us when it's ready.
    this.addEventListener(ThemeEvents.compareLoaded, this.onCompareLoaded.bind(this), { signal });
    this.addEventListener(ThemeEvents.compareEmpty, this.onCompareEmpty.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRemove, this.onItemRemoved.bind(this), { signal });
  }

  get #compareTable() {
    return this.querySelector("compare-table");
  }

  shouldShowDialog() {
    if (Shopify.designMode) return true;

    return CompareUtils.getProductsCount() > 1;
  }

  /**
   * Open the dialog, then trigger the nested <compare-table> to (re)load its products.
   *
   * Open first, load second: the table fetches one whole product page per compared
   * product, and waiting for `compare:loaded` before opening left the Compare button
   * with no feedback at all for as long as that took. The table paints its own
   * skeleton while it fetches, so the dialog has something to show immediately.
   * --number-items is read from storage up front so the modal is already the right
   * width when it animates in, rather than widening under the visitor.
   */
  async showDialog() {
    if (!this.shouldShowDialog()) return;

    this.updateProductsCount();
    super.showDialog();

    this.#compareTable?.render();
  }

  onCompareLoaded(event) {
    this.updateProductsCount(event.detail.renderedCount);

    // Normally already open (showDialog above); this covers a render started elsewhere.
    if (!this.refs.dialog?.open) super.showDialog();
  }

  onCompareEmpty() {
    if (this.refs.dialog?.open) this.closeDialog();
  }

  onItemRemoved() {
    if (!this.refs.dialog?.open) return;

    // The nested <compare-table> removes the column itself; the dialog only
    // needs to close when fewer than two products remain.
    const count = CompareUtils.getProductsCount();
    if (count < 2) {
      this.closeDialog();
    } else {
      this.updateProductsCount(count);
    }
  }

  updateProductsCount(count) {
    this.style.setProperty("--number-items", count || CompareUtils.getProductsCount());
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;

    super.disconnectedCallback();
  }
}
customElements.define("compare-dialog", CompareDialog);

class CompareTable extends Component {
  requiredRefs = ["compareTable"];

  /** @type {AbortController | null} */
  #abortController = null;

  get sourceSelector() {
    return "[data-compare-rows-template]";
  }

  get placeholderSelector() {
    return "[data-compare-placeholder-row-template]";
  }

  get skeletonSelector() {
    return "[data-compare-skeleton-row-template]";
  }

  connectedCallback() {
    super.connectedCallback();

    // Registered in the right place already, but the controller has to be rebuilt too: on a
    // second connect a field-initialised one is still aborted, so these three bind a dead
    // signal and never fire again.
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    document.addEventListener(ThemeEvents.compareAdd, this.onItemAdded.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRemove, this.onItemRemoved.bind(this), { signal });
    document.addEventListener(ThemeEvents.compareRestore, this.onRestore.bind(this), { signal });

    // Deferred tables (e.g. inside the compare dialog) wait for an explicit
    // render() call so they don't load/dispatch on page load.
    if (!this.hasAttribute("defer")) {
      this.render();
    }
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;

    super.disconnectedCallback();
  }

  async render() {
    this.setAttribute("data-compare-loading", "");
    this.setAttribute("aria-busy", "true");
    this.#cleanTable();

    try {
      const products = CompareUtils.getSelectedProducts();
      const shouldFetch = products.length >= 2;

      // The skeleton stands in for the columns being fetched, so it is only drawn when
      // there is something to fetch: under two products the table has nothing to load
      // and goes straight to its empty state (or, in the editor, to the placeholders).
      if (shouldFetch) this.#renderSkeleton(products.length);

      let compareRows = shouldFetch ? await this.#getCompareRows(products) : [];

      // Before appending, not in the `finally`: real cells are appended to the end of
      // each row, so a skeleton still in place would leave a frame showing both.
      this.#clearSkeleton();

      if (Shopify.designMode && compareRows.length < 3) {
        compareRows = compareRows.concat(this.#getPlaceholderRows(3 - compareRows.length));
      }

      const hasRows = compareRows.length > 0;
      this.#toggleEmptyState(compareRows.length);

      if (hasRows) {
        const tableRows = this.refs.compareTable.querySelectorAll("tr");
        compareRows.forEach((compareRow) => {
          tableRows.forEach((row) => {
            const compareCol = compareRow.querySelector(`td[data-compare-key="${row.dataset.compareKey}"]`);
            if (compareCol) row.appendChild(compareCol);
          });
        });
      }

      this.setAttribute("data-compare-results", compareRows.length);
      this.#dispatchState(hasRows, compareRows.length, products.length);
    } finally {
      // Also here, so a failed fetch cannot leave the table frozen mid-skeleton.
      this.#clearSkeleton();
      this.removeAttribute("data-compare-loading");
      this.removeAttribute("aria-busy");
    }
  }

  #dispatchState(hasRows, renderedCount, productsCount) {
    const eventName = hasRows ? ThemeEvents.compareLoaded : ThemeEvents.compareEmpty;

    this.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles: true,
        detail: {
          count: productsCount,
          renderedCount,
          products: CompareUtils.getSelectedProducts(),
        },
      })
    );
  }

  onItemAdded() {
    // Deferred tables are rebuilt on demand (e.g. each time the dialog opens).
    if (this.hasAttribute("defer")) return;

    this.render();
  }

  onRestore() {
    // Same rule as onItemAdded: only a live table needs rebuilding here.
    if (this.hasAttribute("defer")) return;

    this.render();
  }

  onItemRemoved(event) {
    const { products, trigger } = event.detail;

    this.#toggleEmptyState(products.length);

    if (!trigger || !this.refs.compareTable.contains(trigger)) return;

    const cell = trigger.closest("td");
    if (!cell) return;

    const colIndex = cell.cellIndex;
    this.refs.compareTable.querySelectorAll("tr").forEach((row) => {
      const cellToRemove = row.cells[colIndex];
      cellToRemove && cellToRemove.remove();
    });
  }

  async #getCompareRows(products) {
    const rows = [];
    const sectionId = getSectionId(this);

    await Promise.all(
      products.map(async (product) => {
        const fetchUrl = CompareUtils.getTemplateUrl(product.url, { section_id: sectionId });
        const responseText = await fetch(fetchUrl).then((response) => response.text());
        const rowTemplate = new DOMParser()
          .parseFromString(responseText, "text/html")
          .querySelector(this.sourceSelector);

        if (rowTemplate) {
          rows[product.id] = rowTemplate.content.cloneNode(true);
        }
      })
    );

    return products.map((product) => rows[product.id]).filter(Boolean);
  }

  #getPlaceholderRows(count) {
    const rowTemplate = this.querySelector(this.placeholderSelector);
    if (!rowTemplate) return [];

    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(rowTemplate.content.cloneNode(true));
    }

    return rows;
  }

  /**
   * Clone the skeleton column `count` times and distribute its cells into the rows,
   * exactly the way the fetched columns are distributed — same template shape, so the
   * table keeps its final geometry and does not reflow when the real cells land.
   */
  #renderSkeleton(count) {
    const template = this.querySelector(this.skeletonSelector);
    if (!template) return;

    // A previous render may have left the empty state showing; the skeleton needs the
    // table container back before it has anything to draw into.
    this.#toggleEmptyState(count);

    const tableRows = this.refs.compareTable.querySelectorAll("tr");
    for (let i = 0; i < count; i++) {
      const skeletonRow = template.content.cloneNode(true);

      tableRows.forEach((row) => {
        const cell = skeletonRow.querySelector(`td[data-compare-key="${CSS.escape(row.dataset.compareKey)}"]`);
        if (cell) row.appendChild(cell);
      });
    }

    this.setAttribute("data-compare-skeleton", "");
  }

  #clearSkeleton() {
    this.refs.compareTable.querySelectorAll("[data-compare-skeleton-col]").forEach((cell) => cell.remove());
    this.removeAttribute("data-compare-skeleton");
  }

  #cleanTable() {
    this.refs.compareTable.querySelectorAll("tr").forEach((row) => {
      row.querySelectorAll("td:not([data-compare-table-col-label])").forEach((cell) => cell.remove());
    });
  }

  #toggleEmptyState(count) {
    const { emptyState, content } = this.refs;
    const isEmpty = !count;

    emptyState?.classList.toggle("hidden", !isEmpty);
    content?.classList.toggle("hidden", isEmpty);
  }
}
customElements.define("compare-table", CompareTable);

// A back/forward-cache restore hands back the DOM exactly as it was left and does
// NOT re-run any connectedCallback, so every count, disabled flag and bar item is
// frozen at the moment the page was left. Meanwhile localStorage — the source of
// truth — kept changing on the pages visited since. Re-sync on restore, otherwise
// a product removed before navigating away is still listed while no longer counted.
window.addEventListener("pageshow", (event) => {
  // Runs for EVERY pageshow, not only the bfcache one. A back/forward that re-parses the page
  // still has the browser restore form-control state, and it does that AFTER the custom element
  // upgraded and ran connectedCallback -- so the switch's `checked` gets overwritten back to how
  // the page was left, undoing the value read from storage. `pageshow` fires after restoration
  // has finished, which is the first moment the DOM can be trusted.
  CompareUtils.updateCompareCheckboxes();
  document.querySelectorAll("compare-switch").forEach((element) => element.syncFromStorage?.());

  // The heavier rebuild stays gated: a bfcache restore hands back a DOM frozen with the bar and
  // its counts as they were, while a re-parsed page already rendered them from storage on connect.
  if (!event.persisted) return;

  document.dispatchEvent(new CustomEvent(ThemeEvents.compareRestore));
});
