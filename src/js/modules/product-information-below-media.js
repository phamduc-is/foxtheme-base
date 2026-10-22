import { mediaQueryLarge } from "@theme/utilities";

const SELECTOR_MAIN = ".product-information--main";
const SELECTOR_SLOT = "[data-product-information-below-gallery]";
const SELECTOR_DETAILS_CONTENT = ".product-information__details .group-block-content";
const SELECTOR_FLAG = '[data-show-below-product-media="true"]';

/** @type {Map<string, ProductInformationBelowMedia>} */
const controllers = new Map();

let mediaQueryListenerAttached = false;

function attachMediaQueryListener() {
  if (mediaQueryListenerAttached) return;
  mediaQueryListenerAttached = true;
  mediaQueryLarge.addEventListener("change", () => {
    for (const controller of controllers.values()) {
      controller.syncLayout();
    }
  });
}

/**
 * Moves blocks under `.product-information__details` that expose
 * `data-show-below-product-media="true"` into the media-column slot (desktop only).
 */
class ProductInformationBelowMedia {
  /**
   * @param {HTMLElement} section - Shopify section wrapper (`#shopify-section-…`)
   * @param {HTMLElement} main - `.product-information--main`
   */
  constructor(section, main) {
    this.#main = main;
    this.#sectionId = section.id;
  }

  /** @type {HTMLElement} */
  #main;

  /** @type {string} */
  #sectionId;

  /** @type {{ el: HTMLElement; next: Element | null }[]} */
  #movedBatch = [];

  connect() {
    attachMediaQueryListener();
    controllers.set(this.#sectionId, this);
    requestAnimationFrame(() => this.syncLayout());
  }

  disconnect() {
    if (this.#main.isConnected) {
      this.#restore();
    } else {
      this.#movedBatch = [];
    }
    controllers.delete(this.#sectionId);
  }

  syncLayout() {
    const slot = this.#main.querySelector(SELECTOR_SLOT);
    const detailsContent = this.#main.querySelector(SELECTOR_DETAILS_CONTENT);
    if (!(slot instanceof HTMLElement) || !(detailsContent instanceof HTMLElement)) {
      return;
    }

    this.#restore();

    if (!mediaQueryLarge.matches) {
      return;
    }

    const children = Array.from(detailsContent.children);
    /** @type {{ el: HTMLElement; next: Element | null }[]} */
    const batch = [];

    for (const el of children) {
      if (!(el instanceof HTMLElement)) continue;
      // SHALLOW on purpose. The flag normally sits on the block root, but a block whose markup
      // wraps that root in <motion-component> when animation is on puts it one level down, so
      // direct children must count too. A deeper search would match a flagged block nested inside
      // `_product-info-group` and relocate the whole group along with its unflagged siblings.
      const hasFlag =
        el.matches(SELECTOR_FLAG) || Array.from(el.children).some((child) => child.matches(SELECTOR_FLAG));
      if (hasFlag) {
        batch.push({ el, next: el.nextElementSibling });
      }
    }

    if (!batch.length) {
      return;
    }

    this.#movedBatch = batch;
    for (const { el } of batch) {
      slot.appendChild(el);
    }
  }

  #restore() {
    if (!this.#movedBatch.length) {
      return;
    }

    const detailsContent = this.#main.querySelector(SELECTOR_DETAILS_CONTENT);
    const slot = this.#main.querySelector(SELECTOR_SLOT);
    if (!(detailsContent instanceof HTMLElement) || !(slot instanceof HTMLElement)) {
      this.#movedBatch = [];
      return;
    }

    if (!detailsContent.isConnected || !slot.isConnected) {
      this.#movedBatch = [];
      return;
    }

    for (let i = this.#movedBatch.length - 1; i >= 0; i--) {
      const { el, next } = this.#movedBatch[i];
      if (!(el instanceof HTMLElement)) continue;
      if (el.parentElement !== slot) continue;
      detailsContent.insertBefore(el, next);
    }

    this.#movedBatch = [];
  }
}

/**
 * @param {Event} event
 */
function onSectionLoad(event) {
  const section = /** @type {HTMLElement | null} */ (event.target);
  if (!(section instanceof HTMLElement) || !section.id.startsWith("shopify-section-")) {
    return;
  }

  const main = section.querySelector(SELECTOR_MAIN);
  if (!(main instanceof HTMLElement)) {
    return;
  }

  controllers.get(section.id)?.disconnect();

  const controller = new ProductInformationBelowMedia(section, main);
  controller.connect();
}

/**
 * @param {Event} event
 */
function onSectionUnload(event) {
  const section = /** @type {HTMLElement | null} */ (event.target);
  if (!(section instanceof HTMLElement)) {
    return;
  }

  controllers.get(section.id)?.disconnect();
}

/**
 * Re-bind layout after `<main>` was morphed (e.g. variant-picker `updateMain`).
 * Disconnects stale controllers (detached DOM skips restore) and registers fresh roots.
 */
export function syncProductInformationBelowMediaLayouts() {
  for (const main of document.querySelectorAll(SELECTOR_MAIN)) {
    if (!(main instanceof HTMLElement)) continue;
    const section = main.closest('[id^="shopify-section-"]');
    if (!(section instanceof HTMLElement)) continue;

    controllers.get(section.id)?.disconnect();

    const controller = new ProductInformationBelowMedia(section, main);
    controller.connect();
  }
}

function boot() {
  document.removeEventListener("shopify:section:load", onSectionLoad);
  document.removeEventListener("shopify:section:unload", onSectionUnload);
  document.addEventListener("shopify:section:load", onSectionLoad);
  document.addEventListener("shopify:section:unload", onSectionUnload);

  attachMediaQueryListener();

  syncProductInformationBelowMediaLayouts();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
