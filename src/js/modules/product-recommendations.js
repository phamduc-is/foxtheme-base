import { ThemeEvents } from "@theme/events";
import { revealSwap } from "@theme/reveal-swap";

/**
 * How long the host grows/shrinks from the placeholder height to the real one,
 * and how long the fetched list fades in. Kept in sync with
 * src/scss/global/_component-product-recommendations.scss.
 */
const REVEAL_DURATION = 250;

class ProductRecommendations extends HTMLElement {
  /**
   * The observer for the product recommendations.
   * Fires a full viewport early so the swap usually lands before the buyer can see it.
   * @type {IntersectionObserver}
   */
  #intersectionObserver = new IntersectionObserver(
    (entries, observer) => {
      if (!entries[0]?.isIntersecting) return;

      observer.disconnect();
      this.#loadRecommendations();
    },
    { rootMargin: "0px 0px 100% 0px" }
  );

  /**
   * Observing changes to the elements attributes
   * @type {MutationObserver}
   */
  #mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Only attribute changes are interesting
      if (mutation.target !== this || mutation.type !== "attributes") continue;

      // Ignore error attribute changes
      if (mutation.attributeName === "data-error") continue;

      // Ignore addition of hidden class because it means there's an error with the display
      if (mutation.attributeName === "class" && this.classList.contains("hidden")) continue;

      // Ignore when the data-recommendations-performed attribute has been set to 'true'
      if (
        mutation.attributeName === "data-recommendations-performed" &&
        this.dataset.recommendationsPerformed === "true"
      )
        continue;

      // All other attribute changes trigger a reload
      this.#loadRecommendations();
      break;
    }
  });

  /**
   * The cached recommendations
   * @type {Record<string, string>}
   */
  #cachedRecommendations = {};

  /**
   * An abort controller for the active fetch (if there is one)
   * @type {AbortController | null}
   */
  #activeFetch = null;

  /**
   * Cancels the reveal in flight (if any), so a swap that lands mid-reveal (the cart drawer
   * refetches on every cart change) starts clean.
   * @type {(() => void) | null}
   */
  #finishReveal = null;

  connectedCallback() {
    this.#intersectionObserver.observe(this);
    this.#mutationObserver.observe(this, { attributes: true });
  }

  disconnectedCallback() {
    this.#mutationObserver.disconnect();
    this.#intersectionObserver.disconnect();
    this.#finishReveal?.();
  }

  /**
   * Load the product recommendations
   */
  #loadRecommendations() {
    const { productId, recommendationsPerformed, sectionId, intent, useManualProducts } = this.dataset;
    const id = this.id;

    if (!productId || !id) {
      throw new Error("Product ID and an ID attribute are required");
    }

    // If manual products are being used, skip API fetch
    if (useManualProducts === "true") {
      return;
    }

    // If the recommendations have already been loaded, accounts for the case where the Theme Editor
    // is loaded the section from the editor's visual preview context.
    if (recommendationsPerformed === "true") {
      return;
    }

    this.#fetchCachedRecommendations(productId, sectionId, intent)
      .then((result) => {
        if (!result.success) {
          // The Theme Editor will place a section element element in the DOM whose section_id is not available
          // to the Section Renderer API. In this case, we can safely ignore the error.
          if (!Shopify.designMode) {
            this.#handleError(new Error(`Server returned ${result.status}`));
          }
          return;
        }

        const html = document.createElement("div");
        html.innerHTML = result.data || "";
        const recommendations = html.querySelector(`product-recommendations[id="${id}"]`);

        if (recommendations?.innerHTML && recommendations.innerHTML.trim().length) {
          this.dataset.recommendationsPerformed = "true";
          this.#swapContent(recommendations);
          this.dispatchEvent(new CustomEvent(ThemeEvents.recommendationsLoaded, { bubbles: true }));
        } else {
          this.#handleError(new Error("No recommendations available"));
        }
      })
      .catch((e) => {
        // A newer request superseded this one (rapid cart changes) — not an error,
        // and hiding the element here would hide the response that is still coming.
        if (e?.name === "AbortError") return;
        this.#handleError(e);
      });
  }

  /**
   * Replace the placeholder with the fetched markup without the layout jump — see
   * `revealSwap` (morph, not innerHTML, so the heading, controls and carousel survive; the host
   * transitions from the placeholder height to the real one while the list fades in).
   *
   * @param {Element} recommendations - the fetched <product-recommendations> element
   */
  #swapContent(recommendations) {
    this.#finishReveal?.();
    this.#finishReveal = revealSwap(this, recommendations, { duration: REVEAL_DURATION });
  }

  /**
   * Fetches the recommendations and cached the result for future use
   * @param {string} productId
   * @param {string | undefined} sectionId
   * @param {string | undefined} intent
   * @returns {Promise<{ success: true, data: string } | { success: false, status: number }>}
   */
  async #fetchCachedRecommendations(productId, sectionId, intent) {
    const url = `${this.dataset.url}&product_id=${productId}&section_id=${sectionId}&intent=${intent}`;

    // Skip cache in design mode to always show fresh content when merchant edits settings
    if (!Shopify.designMode) {
      const cachedResponse = this.#cachedRecommendations[url];
      if (cachedResponse) {
        return { success: true, data: cachedResponse };
      }
    }

    this.#activeFetch?.abort();
    this.#activeFetch = new AbortController();

    try {
      const response = await fetch(url, { signal: this.#activeFetch.signal });
      if (!response.ok) {
        return { success: false, status: response.status };
      }

      const text = await response.text();
      // Only cache if not in design mode
      if (!Shopify.designMode) {
        this.#cachedRecommendations[url] = text;
      }
      return { success: true, data: text };
    } finally {
      this.#activeFetch = null;
    }
  }

  /**
   * Handle errors in a consistent way
   * @param {Error} error
   */
  #handleError(error) {
    console.error("Product recommendations error:", error.message);
    this.classList.add("hidden");
    this.dataset.error = "Error loading product recommendations";
  }
}

if (!customElements.get("product-recommendations")) {
  customElements.define("product-recommendations", ProductRecommendations);
}
