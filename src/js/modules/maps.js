import { Component } from "@theme/component";

/**
 * Google Maps Embed API endpoints.
 *
 * `place` and `view` are NOT interchangeable: `q` is documented as a place name / address / plus code
 * / place ID (coordinates are not a documented value), while `view` centers on `lat,lng` but returns a
 * map with NO marker. So the mode is picked from the VALUE SHAPE, never from a setting.
 */
const EMBED_PLACE = "https://www.google.com/maps/embed/v1/place";
const EMBED_VIEW = "https://www.google.com/maps/embed/v1/view";

/** `lat,lng` (with optional whitespace). Anything else is treated as an address. */
const LAT_LNG = /^\s*-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/;

/**
 * State class shown while the Embed iframe (re)loads. A STATE class on purpose: `is-*` is the
 * documented exception to the no-class-selectors DOM contract, so `check-js-contract` stays green.
 */
const LOADING_CLASS = "is-loading";

/**
 * Hard ceiling on the loading state, in ms.
 *
 * A bad key still fires `load` (Google renders its own error page inside the iframe), so `load`
 * covers the ordinary failure path. This only exists for a request that never resolves at all —
 * without it a hung network would leave the spinner turning forever.
 */
const LOAD_TIMEOUT = 8000;

/**
 * @capability Deferred Google Maps embed with a multi-branch switcher — loads the free Embed API iframe only on first viewport entry, builds the URL in JS (address → place mode with pin, lat,lng → view mode), and a <select> of store locations swaps both the visible info panel and the map, with an is-loading spinner state per swap.
 * @when Store-locator / contact / "our stores" designs: one map plus one or more location cards. Theme-editor block selection reveals the matching panel. Pairs with src/scss/global/_block-maps.scss. Reuse instead of embedding a Google iframe in Liquid or adding the JS Maps API.
 * @contract <maps-component data-api-key data-zoom data-maptype="roadmap|satellite" [data-fallback-query data-fallback-title]> with ref="map" (iframe slot), optional ref="select" whose <option>s carry data-map-query/data-map-title, and ref="panels[]" in the same DOM order as the options (select.selectedIndex ↔ panels index).
 * @keywords google map, store locator, map embed, branch switcher, location picker, deferred iframe, lazy map, our stores, contact map, address pin
 */
/**
 * Maps: a deferred Google map plus a card whose `<select>` switches the visible branch panel.
 *
 * **The Embed API is the only implementation.** It is free, unlimited and needs no billing account,
 * which is the whole merchant-onboarding argument for it; nothing in the design needs what the
 * JavaScript API would buy (no custom pin, no map styling).
 *
 * **Why the URL is built here and not in Liquid:** the child block owns `map_query` while the parent
 * owns the API key / zoom / map type, and neither can read the other's settings. The child emits
 * `data-map-query` on its `<option>`, the parent emits the config on this root, and JS composes the
 * URL. It costs nothing because the map is deferred to viewport entry anyway.
 *
 * **Deferral is the only load path** — one IntersectionObserver, disconnected after the first load.
 * Nothing is requested from Google until the block enters the viewport.
 *
 * **Pairing contract:** `select.selectedIndex` ↔ `panels[selectedIndex]`. DOM order is the contract;
 * no index is emitted anywhere.
 *
 * @typedef {object} Refs
 * @property {HTMLSelectElement} [select] - The branch dropdown (hidden by CSS when there is one branch).
 * @property {HTMLElement} [map] - The map slot; the iframe is injected into it.
 * @property {HTMLElement[]} [panels] - The branch info panels, document order = option order.
 *
 * @extends {Component<Refs>}
 */
class MapsComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {IntersectionObserver | null} */
  #observer = null;
  /** @type {HTMLIFrameElement | null} */
  #iframe = null;
  #loaded = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #loadTimer = null;

  connectedCallback() {
    super.connectedCallback();

    // Recreated on every connect: a one-time controller would leave a reconnected instance aborted.
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    this.#showPanel(this.#activeIndex);

    // Theme editor: selecting a Location — or any block nested inside one — reveals that Location's
    // panel, which would otherwise stay hidden behind the dropdown selection.
    if (/** @type {any} */ (window).Shopify?.designMode) {
      this.addEventListener("shopify:block:select", this.#handleBlockSelect, { signal });
    }

    if (!this.#apiKey) return; // No key → the placeholder stays and nothing third-party is requested.

    this.#observe();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
    this.#observer?.disconnect();
    this.#observer = null;
    this.#endLoading();
    super.disconnectedCallback();
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  /** @returns {string} */
  get #apiKey() {
    return (this.dataset.apiKey ?? "").trim();
  }

  /** @returns {number} */
  get #zoom() {
    const zoom = Number.parseInt(this.dataset.zoom ?? "", 10);
    return Number.isFinite(zoom) ? zoom : 14;
  }

  /** @returns {string} The Embed API `maptype` parameter. */
  get #mapType() {
    return this.dataset.maptype === "satellite" ? "satellite" : "roadmap";
  }

  /**
   * Query to use when there is no `<select>` to read the active branch from — i.e. when the card is
   * not rendered (`show_card` off, or no Location at all). Liquid has already resolved it down three
   * tiers (first location → the shop's own address → the demo address), so it is never blank when
   * present, and it is only emitted in that case: with options present this is absent by design.
   *
   * @returns {string}
   */
  get #fallbackQuery() {
    return (this.dataset.fallbackQuery ?? "").trim();
  }

  /** @returns {string} The iframe title that goes with `#fallbackQuery` — never empty. */
  get #fallbackTitle() {
    return this.dataset.fallbackTitle ?? "";
  }

  /** @returns {HTMLOptionElement[]} Every branch option, in DOM order. */
  get #options() {
    const { select } = this.refs;
    return select ? Array.from(select.options) : [];
  }

  /** @returns {HTMLElement[]} */
  get #panels() {
    const { panels } = this.refs;
    if (!panels) return [];
    return Array.isArray(panels) ? panels : [panels];
  }

  /** @returns {number} */
  get #activeIndex() {
    const index = this.refs.select?.selectedIndex ?? 0;
    return index < 0 ? 0 : index;
  }

  // ── Panels ──────────────────────────────────────────────────────────────────

  /**
   * Show exactly one panel; every other panel leaves the flow so the card height follows the
   * selected branch only.
   *
   * @param {number} index
   */
  #showPanel(index) {
    this.#panels.forEach((panel, position) => {
      panel.hidden = position !== index;
    });
  }

  /** Handles the dropdown's `change` (mouse and keyboard both land here). */
  handleSelect() {
    const index = this.#activeIndex;
    this.#showPanel(index);

    if (!this.#loaded) return; // Map not requested yet — the deferral trigger will use this index.

    this.#renderEmbed(this.#options[index]);
  }

  /**
   * Theme editor: reveal the panel the merchant just selected in the sidebar.
   *
   * The match is CONTAINMENT, not identity: `event.target` is the selected block's own element,
   * which since round 3 is usually a `text` block nested INSIDE a location's panel rather than the
   * panel root itself. `Node.contains()` returns true for the node itself as well, so one predicate
   * covers both "the Location was selected" and "a block inside the Location was selected" — and it
   * is a DOM relationship, not a selector, so the JS DOM contract stays satisfied (no `closest('.…')`).
   *
   * Selection then goes through `#selectIndex`, i.e. the same `change` path a shopper's click takes,
   * so `select.selectedIndex` stays in sync with the visible panel and the map `src` swap + loading
   * state fire exactly as they do for a user-driven change.
   *
   * With `show_card: false` there are no panels in the DOM at all, so `#panels` is `[]`,
   * `findIndex` returns -1 and this is a silent no-op — the same as any unrelated block select.
   *
   * `shopify:block:select` is a Shopify platform event, deliberately a hardcoded string (as in
   * `carousel.js` / `menu-drawer.js` / `details-dropdown.js`) — it is not a `ThemeEvents` constant.
   *
   * @param {Event} event
   */
  #handleBlockSelect = (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const index = this.#panels.findIndex((panel) => panel.contains(target));
    if (index < 0) return;
    this.#selectIndex(index);
  };

  /**
   * Select a branch programmatically and let the normal `change` path do the rest.
   *
   * @param {number} index
   */
  #selectIndex(index) {
    const { select } = this.refs;
    if (!select) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Deferral ────────────────────────────────────────────────────────────────

  #observe() {
    if (!("IntersectionObserver" in window)) {
      this.#loadMap();
      return;
    }

    this.#observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.#observer?.disconnect();
        this.#observer = null;
        this.#loadMap();
      },
      { rootMargin: "200px" }
    );

    this.#observer.observe(this);
  }

  /** Loads the map once, on the first viewport entry. */
  #loadMap() {
    if (this.#loaded || !this.#apiKey) return;
    this.#loaded = true;

    this.#observer?.disconnect();
    this.#observer = null;

    this.#renderEmbed(this.#options[this.#activeIndex]);
  }

  // ── Embed API ───────────────────────────────────────────────────────────────

  /**
   * Build the Embed URL for one branch. An address goes to `place` (which renders a pin); `lat,lng`
   * goes to `view` (centred, no pin) because coordinates are not a documented `q` value.
   *
   * @param {string} query
   * @returns {string}
   */
  #embedUrl(query) {
    const isCoordinates = LAT_LNG.test(query);
    const url = new URL(isCoordinates ? EMBED_VIEW : EMBED_PLACE);

    url.searchParams.set("key", this.#apiKey);
    if (isCoordinates) {
      url.searchParams.set("center", query.replace(/\s+/g, ""));
    } else {
      url.searchParams.set("q", query);
    }
    url.searchParams.set("zoom", String(this.#zoom));
    url.searchParams.set("maptype", this.#mapType);

    return url.toString();
  }

  /**
   * Create (or re-point) the embed iframe. A branch with a blank `map_query` keeps the previous view
   * instead of loading a broken URL.
   *
   * `option` is undefined only when there are no options at all — no card, so no `<select>` — and
   * that is the ONLY case the Liquid-resolved fallback is used for. A branch that exists but has a
   * blank query still keeps the previous view rather than silently jumping to the shop's address:
   * the merchant named that branch, so guessing on its behalf would be wrong.
   *
   * @param {HTMLOptionElement | undefined} option
   */
  #renderEmbed(option) {
    const query = option ? (option.dataset.mapQuery ?? "").trim() : this.#fallbackQuery;
    if (!query) return;

    const title = option ? (option.dataset.mapTitle ?? "") : this.#fallbackTitle;

    const { map } = this.refs;
    if (!map) return;

    const isFirstRender = this.#iframe === null;

    if (isFirstRender) {
      const iframe = document.createElement("iframe");
      iframe.loading = "lazy";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allowFullscreen = true;
      iframe.classList.add("maps__frame");
      // Bound once, on the element that outlives every swap: `load` fires again on each navigation,
      // so one listener clears the loading state for the first load AND every branch switch.
      iframe.addEventListener("load", this.#endLoading, {
        signal: this.#abortController?.signal,
      });
      this.#iframe = iframe;
    }

    const iframe = this.#iframe;
    if (!iframe) return;

    // Started BEFORE `src` is re-pointed, so the spinner is already up when the frame goes blank.
    this.#beginLoading();

    iframe.title = title;
    iframe.src = this.#embedUrl(query);

    // Attached only AFTER `src` is set: appending a src-less iframe queues an `about:blank`
    // navigation whose `load` would clear the loading state before the real map ever arrives.
    if (isFirstRender) map.appendChild(iframe);
  }

  // ── Loading state ───────────────────────────────────────────────────────────

  /**
   * Show the spinner while the iframe (re)loads.
   *
   * Applied on every `src` write, not only on a branch switch: the first load has the same blank
   * period, and one unconditional path is one less way to leave the state stuck. The indicator is
   * absolutely positioned inside the map box, which already holds its own height — nothing moves.
   */
  #beginLoading() {
    this.classList.add(LOADING_CLASS);

    if (this.#loadTimer) clearTimeout(this.#loadTimer);
    this.#loadTimer = setTimeout(this.#endLoading, LOAD_TIMEOUT);
  }

  /**
   * Clear the loading state. Idempotent, and the ONLY way out — reached from the iframe's `load`,
   * from the timeout, and from `disconnectedCallback`.
   */
  #endLoading = () => {
    if (this.#loadTimer) {
      clearTimeout(this.#loadTimer);
      this.#loadTimer = null;
    }
    this.classList.remove(LOADING_CLASS);
  };
}

if (!customElements.get("maps-component")) {
  customElements.define("maps-component", MapsComponent);
}
