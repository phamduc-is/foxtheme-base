import { Component } from "@theme/component";
import { sectionRenderer } from "@theme/section-renderer";
import { debounce, prefersReducedMotion } from "@theme/utilities";

const SECTION_ID = "section-rendering-product-finder";
const DESKTOP_QUERY = "(min-width: 768px)";
const COLLAPSE_DURATION = 280;
const COLLAPSE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Sequential progressive-enable cascade + JS-driven mobile collapse for the "Shop By Vehicle" finder.
 *
 * **Cascade:** options come from the target collection's native storefront filters, fetched via the
 * Section Rendering API. On connect, one fetch (no filter params) against the collection URL populates
 * every field's full option list and enables field 1. Choosing a field re-fetches with the cumulative
 * `filter.*` selections applied; downstream fields' option lists are replaced from the narrowed response
 * (only `count > 0`, preserving a still-valid current selection), the next field is enabled, fields
 * further down are reset + disabled. Submit is clickable at any step.
 *
 * **Collapse:** the header is a toggle button + `__panel`. Mode is derived from the viewport
 * (`matchMedia('(min-width: 768px)')`) and the `mobile_collapsible` setting:
 *   - Desktop → panel always open, arrow hidden, cannot close.
 *   - Mobile + collapsible → closed by default, arrow shown, toggles (height-animated).
 *   - Mobile + not collapsible → open, arrow hidden, cannot close.
 * Re-evaluated on debounced `resize` so editor desktop↔mobile switching works. Without JS the panel
 * stays open (markup default) and a `<noscript>` link is the hard fallback.
 *
 * @typedef {object} Refs
 * @property {HTMLSelectElement[]} [fields] - The cascade `<select>` elements, document order = cascade order.
 * @property {HTMLButtonElement} [submit] - The submit button.
 * @property {HTMLButtonElement} [toggle] - The header toggle button.
 * @property {HTMLElement} [panel] - The collapsible panel.
 * @property {HTMLElement} [panelInner] - The panel's inner content wrapper (measured for the open animation).
 *
 * @extends {Component<Refs>}
 */
class ProductFinder extends Component {
  #abortController = new AbortController();
  /** @type {Animation | null} */
  #animation = null;
  /** @type {boolean} Current open state of the panel. */
  #open = true;
  /** @type {boolean | null} Whether the previous sync was in collapsible mode. */
  #wasCollapsible = null;

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;

    const fields = this.#fields;
    fields.forEach((field, index) => {
      field.addEventListener("change", () => this.#handleFieldChange(index), { signal });
    });

    const form = this.querySelector("form");
    form?.addEventListener("submit", this.#handleSubmit, { signal });

    this.refs.toggle?.addEventListener("click", this.#handleToggle, { signal });
    window.addEventListener("resize", this.#handleResize, { signal });

    this.#syncCollapseMode();
    this.#initialize();
  }

  disconnectedCallback() {
    this.#abortController.abort();
    this.#animation?.cancel();
    super.disconnectedCallback();
  }

  // ── Cascade ─────────────────────────────────────────────────────────────────

  /** @returns {HTMLSelectElement[]} */
  get #fields() {
    const { fields } = this.refs;
    if (!fields) return [];
    return Array.isArray(fields) ? /** @type {HTMLSelectElement[]} */ (fields) : [fields];
  }

  /** @returns {URL | null} The target collection URL as an absolute URL. */
  #collectionUrl() {
    const raw = this.dataset.collectionUrl;
    if (!raw) return null;
    try {
      return new URL(raw, window.location.origin);
    } catch {
      return null;
    }
  }

  /** On connect: fetch the full filter values, populate every field, enable field 1, disable the rest. */
  async #initialize() {
    const url = this.#collectionUrl();
    if (!url) return;

    this.#setLoading(true);
    const filters = await this.#fetchFilters(url);
    if (this.#abortController.signal.aborted) return;
    this.#setLoading(false);
    if (!filters) return;

    const fields = this.#fields;
    fields.forEach((field, index) => {
      this.#populateField(field, filters);
      field.disabled = index !== 0;
    });
  }

  /**
   * Re-fetch with the cumulative selections, then replace downstream option lists.
   * @param {number} changedIndex
   */
  #handleFieldChange = debounce(async (changedIndex) => {
    const collectionUrl = this.#collectionUrl();
    if (!collectionUrl) return;

    const fields = this.#fields;
    const url = new URL(collectionUrl);

    // Cumulative `filter.*` params from every selected field up to and including the changed one.
    for (let i = 0; i <= changedIndex; i++) {
      const field = fields[i];
      const paramName = field.dataset.filterName;
      if (paramName && field.value) url.searchParams.set(paramName, field.value);
    }

    this.#setLoading(true);
    const filters = await this.#fetchFilters(url);
    if (this.#abortController.signal.aborted) return;
    this.#setLoading(false);
    if (!filters) return;

    // Re-enable the changed field + every upstream field — they stay selectable so the user can
    // change an earlier choice (e.g. pick a different Make). Loading disabled them all; restore them.
    for (let i = 0; i <= changedIndex; i++) fields[i].disabled = false;

    // Cascade downstream: the next field is narrowed + enabled, the rest are reset + disabled.
    for (let i = changedIndex + 1; i < fields.length; i++) {
      const field = fields[i];
      if (i === changedIndex + 1) {
        this.#populateField(field, filters);
        field.disabled = false;
      } else {
        this.#resetField(field);
        field.disabled = true;
      }
    }
  }, 200);

  /**
   * Toggle the in-flight fetch state: while loading, all fields are disabled and the submit button
   * carries `aria-busy="true"` + `is-loading`. On clear, the submit is re-enabled and the fields are
   * left for the populate/cascade logic to re-enable per the enable rules.
   * @param {boolean} loading
   */
  #setLoading(loading) {
    const { submit } = this.refs;
    if (submit) {
      submit.classList.toggle("btn--loading", loading);
      // Disable the submit while fetching so a click mid-load can't navigate with stale params.
      submit.disabled = loading;
      if (loading) {
        submit.setAttribute("aria-busy", "true");
      } else {
        submit.removeAttribute("aria-busy");
      }
    }

    if (loading) {
      for (const field of this.#fields) field.disabled = true;
    }
  }

  /**
   * Fetch the standalone data-endpoint section against `url` and parse its filter `<select>`s.
   * @param {URL} url
   * @returns {Promise<HTMLElement | null>} A detached container holding the response's filter selects.
   */
  async #fetchFilters(url) {
    const html = await sectionRenderer.getSectionHTML(SECTION_ID, false, url);
    if (this.#abortController.signal.aborted) return null;
    return new DOMParser().parseFromString(html, "text/html").body;
  }

  /**
   * Find the response `<select>` that matches this field's `data-filter` (by `param_name` first,
   * else by `label`, case-insensitive).
   * @param {HTMLSelectElement} field
   * @param {HTMLElement} filters
   * @returns {HTMLSelectElement | null}
   */
  #matchSource(field, filters) {
    const wanted = (field.dataset.filter ?? "").trim();
    if (!wanted) return null;

    const byName = filters.querySelector(`select[data-filter-name="${CSS.escape(wanted)}"]`);
    if (byName instanceof HTMLSelectElement) return byName;

    const lower = wanted.toLowerCase();
    for (const source of filters.querySelectorAll("select[data-filter-label]")) {
      if ((source.getAttribute("data-filter-label") ?? "").trim().toLowerCase() === lower) {
        return /** @type {HTMLSelectElement} */ (source);
      }
    }
    return null;
  }

  /**
   * Replace a field's options from its matching source select, preserving a still-valid selection
   * and recording the real `param_name` (for cumulative params + submit).
   * @param {HTMLSelectElement} field
   * @param {HTMLElement} filters
   */
  #populateField(field, filters) {
    const source = this.#matchSource(field, filters);
    const previous = field.value;

    // Keep the placeholder (first option), drop the rest.
    const placeholder = field.options[0];
    field.replaceChildren(placeholder);

    if (!source) {
      field.selectedIndex = 0;
      return;
    }

    field.dataset.filterName = source.dataset.filterName ?? "";

    for (const option of source.options) {
      const count = Number(option.getAttribute("data-count") ?? "0");
      if (!option.value || count <= 0) continue;
      field.add(/** @type {HTMLOptionElement} */ (option.cloneNode(true)));
    }

    // Preserve a still-valid prior selection; otherwise fall back to the placeholder.
    field.value = previous;
    if (field.value !== previous) field.selectedIndex = 0;
  }

  /**
   * Reset a select to its placeholder, dropping all real options.
   * @param {HTMLSelectElement} field
   */
  #resetField(field) {
    const placeholder = field.options[0];
    field.replaceChildren(placeholder);
    field.selectedIndex = 0;
  }

  /**
   * Prune empty selects before navigation so no blank `filter.*=` param leaks.
   * @param {SubmitEvent} event
   */
  #handleSubmit = (event) => {
    event.preventDefault();

    const collectionUrl = this.#collectionUrl();
    if (!collectionUrl) return;

    const url = new URL(collectionUrl);
    for (const field of this.#fields) {
      const paramName = field.dataset.filterName;
      if (paramName && field.value) url.searchParams.set(paramName, field.value);
    }

    window.location.assign(url.toString());
  };

  // ── Collapse ────────────────────────────────────────────────────────────────

  /** @returns {boolean} True on desktop (panel always open, toggle hidden). */
  get #isDesktop() {
    return window.matchMedia?.(DESKTOP_QUERY)?.matches ?? true;
  }

  /** @returns {boolean} The `mobile_collapsible` setting (collapse into an accordion on mobile). */
  get #mobileCollapsible() {
    return this.dataset.mobileCollapsible === "true";
  }

  /** @returns {boolean} True when the panel is collapsible (mobile + the collapsible setting on). */
  get #collapsible() {
    return !this.#isDesktop && this.#mobileCollapsible;
  }

  /**
   * Set the static collapse state for the current viewport/setting: when not collapsible the panel is
   * forced open and the toggle inert; when collapsible the toggle is active and the panel reflects the
   * current open state (default closed on first entry into the collapsible mode).
   */
  #syncCollapseMode() {
    const { toggle, panel } = this.refs;
    if (!toggle || !panel) return;

    const collapsible = this.#collapsible;
    if (collapsible === this.#wasCollapsible) return; // No mode change → nothing to re-sync.

    if (!collapsible) {
      // Desktop or mobile-open-by-default: always open, no toggling.
      this.#cancelAnimation();
      this.#open = true;
      panel.style.height = "";
      panel.style.overflow = "";
      panel.hidden = false;
      this.dataset.collapsible = "false";
      toggle.setAttribute("aria-expanded", "true");
    } else {
      // Entering mobile-collapsible mode → start collapsed (no animation).
      this.dataset.collapsible = "true";
      this.#setClosed(false);
    }

    this.#wasCollapsible = collapsible;
  }

  #handleResize = debounce(() => {
    this.#syncCollapseMode();
  }, 150);

  #handleToggle = () => {
    if (!this.#collapsible) return;
    this.#open ? this.#setClosed(true) : this.#setOpen(true);
  };

  /**
   * Open the panel.
   * @param {boolean} animate
   */
  #setOpen(animate) {
    const { toggle, panel } = this.refs;
    if (!panel || !toggle) return;

    this.#open = true;
    this.dataset.open = "true";
    toggle.setAttribute("aria-expanded", "true");
    panel.hidden = false;

    if (!animate || prefersReducedMotion()) {
      this.#cancelAnimation();
      panel.style.height = "";
      return;
    }
    // Measure the inner content height (mirrors accordion-component, which measures `.accordion__inner`).
    const inner = this.refs.panelInner;
    const target = inner instanceof HTMLElement ? inner.scrollHeight : panel.scrollHeight;
    this.#animateHeight(panel, 0, target, () => {
      panel.style.height = "";
    });
  }

  /**
   * Close the panel.
   * @param {boolean} animate
   */
  #setClosed(animate) {
    const { toggle, panel } = this.refs;
    if (!panel || !toggle) return;

    this.#open = false;
    this.dataset.open = "false";
    toggle.setAttribute("aria-expanded", "false");

    if (!animate || prefersReducedMotion()) {
      this.#cancelAnimation();
      panel.style.height = "0px";
      panel.hidden = true;
      return;
    }
    const from = panel.getBoundingClientRect().height || panel.scrollHeight;
    this.#animateHeight(panel, from, 0, () => {
      panel.style.height = "0px";
      panel.hidden = true;
    });
  }

  /**
   * Animate a panel's height between two values, mirroring accordion-component's #animateOpen/#animateClose.
   * @param {HTMLElement} panel
   * @param {number} from
   * @param {number} to
   * @param {() => void} onFinish
   */
  #animateHeight(panel, from, to, onFinish) {
    this.#cancelAnimation();
    panel.style.overflow = "hidden";
    panel.style.height = `${from}px`;

    const run = () => {
      const anim = panel.animate(
        [
          { height: `${from}px`, opacity: from === 0 ? 0 : 1 },
          { height: `${to}px`, opacity: to === 0 ? 0 : 1 },
        ],
        { duration: COLLAPSE_DURATION, easing: COLLAPSE_EASING, fill: "forwards" }
      );
      this.#animation = anim;

      const cleanup = () => {
        if (this.#animation !== anim) return;
        this.#animation = null;
        anim.cancel();
        panel.style.overflow = "";
        panel.style.opacity = "";
        onFinish();
      };
      anim.addEventListener("finish", cleanup, { once: true });
      anim.addEventListener("cancel", cleanup, { once: true });
    };

    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else run();
  }

  #cancelAnimation() {
    if (this.#animation) {
      this.#animation.cancel();
      this.#animation = null;
    }
  }
}

if (!customElements.get("product-finder")) {
  customElements.define("product-finder", ProductFinder);
}
