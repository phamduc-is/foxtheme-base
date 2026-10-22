import { morph } from "@theme/morph";

/**
 * @capability Section Rendering API plumbing — fetches a section's HTML via ?section_id= (current URL preserved, so filters/params apply), caches responses, dedupes in-flight requests, aborts superseded renders, and morphs the result into the live .shopify-section element.
 * @when Any time a section must re-render after state changes (variant selected, cart mutated, filters applied) — never hand-roll a fetch("?section_id=...") + innerHTML swap.
 * @contract import { sectionRenderer, morphSection } from "@theme/section-renderer"; await sectionRenderer.renderSection(sectionId, { cache }) to fetch+morph, sectionRenderer.getSectionHTML(sectionId, useCache, url) to fetch only, morphSection(sectionId, html) to morph pre-fetched HTML (e.g. from a cart response's sections payload); components get updatedCallback after the morph.
 * @keywords section rendering api, renderSection, morphSection, re-render section, section_id, fetch section, sectionRenderer, cache, updatedCallback
 */

/**
 * A class to re-render sections using the Section Rendering API
 */
class SectionRenderer {
  /**
   * The cache of section HTML
   * @type {Map<string, string>}
   */
  #cache = new Map();

  /**
   * The abort controllers by section ID
   * @type {Map<string, AbortController>}
   */
  #abortControllersBySectionId = new Map();

  /**
   * The pending promises
   * @type {Map<string, Promise<string>>}
   */
  #pendingPromises = new Map();

  constructor() {
    window.addEventListener("load", this.#cachePageSections.bind(this));
  }

  /**
   * Renders a section
   * @param {string} sectionId - The section ID
   * @param {Object} [options] - The options
   * @param {boolean} [options.cache] - Whether to use the cache
   * @returns {Promise<string>} The rendered section HTML
   */
  async renderSection(sectionId, options) {
    const { cache = !Shopify.designMode } = options ?? {};

    this.#abortPendingMorph(sectionId);

    const abortController = new AbortController();
    this.#abortControllersBySectionId.set(sectionId, abortController);

    const sectionHTML = await this.getSectionHTML(sectionId, cache);

    if (!abortController.signal.aborted) {
      this.#abortControllersBySectionId.delete(sectionId);

      morphSection(sectionId, sectionHTML);
    }

    return sectionHTML;
  }

  /**
   * Aborts an existing morph for a section
   * @param {string} sectionId - The section ID
   */
  #abortPendingMorph(sectionId) {
    const existingAbortController = this.#abortControllersBySectionId.get(sectionId);
    if (existingAbortController) {
      existingAbortController.abort();
    }
  }

  /**
   * Gets the HTML for a section
   * @param {string} sectionId - The section ID
   * @param {boolean} useCache - Whether to use the cache
   * @param {URL} url - The URL to render the section for
   * @returns {Promise<string>} The rendered section HTML
   */
  async getSectionHTML(sectionId, useCache = true, url = new URL(window.location.href)) {
    const sectionUrl = buildSectionRenderingURL(sectionId, url);

    let pendingPromise = this.#pendingPromises.get(sectionUrl);
    if (pendingPromise) return pendingPromise;

    if (useCache) {
      const cachedHTML = this.#cache.get(sectionUrl);

      if (cachedHTML) return cachedHTML;
    }

    let responseOk = false;
    pendingPromise = fetch(sectionUrl).then((response) => {
      responseOk = response.ok;
      return response.text();
    });

    this.#pendingPromises.set(sectionUrl, pendingPromise);

    // Always drop the in-flight entry, even when the fetch rejects: a rejected promise left in
    // `#pendingPromises` would be returned to every later call for this URL, so a retry could
    // never recover. An error response (non-2xx) is returned as before but never cached.
    let sectionHTML;
    try {
      sectionHTML = await pendingPromise;
    } finally {
      this.#pendingPromises.delete(sectionUrl);
    }

    if (responseOk) this.#cache.set(sectionUrl, sectionHTML);
    return sectionHTML;
  }

  /**
   * Caches the page sections
   */
  #cachePageSections() {
    for (const section of document.querySelectorAll(".shopify-section")) {
      const url = buildSectionRenderingURL(section.id);
      if (this.#cache.get(url)) return;
      if (containsShadowRoot(section)) return;

      this.#cache.set(url, section.outerHTML);
    }
  }
}

const SECTION_ID_PREFIX = "shopify-section-";

/**
 * Builds a section rendering URL
 * @param {string} sectionId - The section ID
 * @param {URL} url - The URL to render the section for
 * @returns {string} The section rendering URL
 */
function buildSectionRenderingURL(sectionId, url = new URL(window.location.href)) {
  const sectionUrl = new URL(url); // Prevent edit or append to the original URL

  sectionUrl.searchParams.set("section_id", normalizeSectionId(sectionId));
  sectionUrl.searchParams.sort();

  return sectionUrl.toString();
}

/**
 * Builds a section selector
 * @param {string} sectionId - The section ID
 * @returns {string} The section selector
 */
export function buildSectionSelector(sectionId) {
  return `${SECTION_ID_PREFIX}${sectionId}`;
}

/**
 * Normalizes a section ID
 * @param {string} sectionId - The section ID
 * @returns {string} The normalized section ID
 */
export function normalizeSectionId(sectionId) {
  return sectionId.replace(new RegExp(`^${SECTION_ID_PREFIX}`), "");
}

/**
 * Checks if an element contains a shadow root
 * @param {Element} element - The element to check
 * @returns {boolean} Whether the element contains a shadow root
 */
function containsShadowRoot(element) {
  return !!element.shadowRoot || Array.from(element.children).some(containsShadowRoot);
}

/**
 * @typedef {(previousElement: HTMLElement, newElement: HTMLElement) => void} UpdateCallback
 */

/**
 * Morphs the existing section element with the new section contents
 *
 * @param {string} sectionId - The section ID
 * @param {string} html - The new markup the section should morph into
 */
export async function morphSection(sectionId, html) {
  const fragment = new DOMParser().parseFromString(html, "text/html");
  const existingElement = document.getElementById(buildSectionSelector(sectionId));
  const newElement = fragment.getElementById(buildSectionSelector(sectionId));

  if (!existingElement) {
    throw new Error(`Section ${sectionId} not found`);
  }

  if (!newElement) {
    throw new Error(`Section ${sectionId} not found in the section rendering response`);
  }

  morph(existingElement, newElement);

  // `shopify:section:load` does not run for Section Rendering API morphs — re-apply
  // "below product media" block placement when this section contains product information.
  if (existingElement instanceof HTMLElement && existingElement.querySelector("[data-product-information-main]")) {
    queueMicrotask(() => {
      import("./product-information-below-media.js")
        .then((m) => m.syncProductInformationBelowMediaLayouts())
        .catch(() => {});
    });
  }
}

export const sectionRenderer = new SectionRenderer();
