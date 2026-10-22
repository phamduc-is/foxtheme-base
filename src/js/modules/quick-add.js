import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";

/**
 * @capability Switches a product card's quick-add button between direct "add" and "choose options" mode when a variant is selected on the card — single-option products get one-click add, multi-option products open the options flow.
 * @when Product cards with an add-to-cart shortcut whose behaviour depends on how many options the product has. Reuse with quick-view for the "choose" path.
 * @contract <quick-add-component data-product-options-count="N"> inside a <product-card>; listens to ThemeEvents.variantSelected scoped to its own card and sets data-quick-add-button="add|choose" (CSS/markup branch on that attribute).
 * @keywords quick add, add to cart button, choose options, one-click add, product card button state, variant selected, quick buy
 */
export class QuickAddComponent extends Component {
  // Created per connect, not once per instance: a MOVE (the PDP "below media" container
  // relocates its whole subtree into the media column) fires disconnect → abort, and an
  // AbortController is single-use — a signal created once would leave the reconnected
  // button with no listeners at all.
  /** @type {AbortController | null} */
  #abortController = null;

  connectedCallback() {
    super.connectedCallback();

    this.#abortController = new AbortController();
    document.addEventListener(ThemeEvents.variantSelected, this.#updateQuickAddButtonState, {
      signal: this.#abortController.signal,
    });
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
    super.disconnectedCallback();
  }

  #updateQuickAddButtonState = (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest("product-card") !== this.closest("product-card")) return;
    const productOptionsCount = this.dataset.productOptionsCount;
    const quickAddButton = productOptionsCount === "1" ? "add" : "choose";
    this.setAttribute("data-quick-add-button", quickAddButton);
  };
}

if (!customElements.get("quick-add-component")) {
  customElements.define("quick-add-component", QuickAddComponent);
}
