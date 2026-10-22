import { Component } from "@theme/component";
import { QuantitySelectorUpdateEvent } from "@theme/events";

/**
 * A custom element that allows the user to select a quantity.
 *
 * @typedef {Object} Refs
 * @property {HTMLInputElement} quantityInput
 * @property {HTMLButtonElement[]} quantityButtons
 *
 * @extends {Component<Refs>}
 */
class QuantitySelectorComponent extends Component {
  requiredRefs = ["quantityInput"];

  /** @type {boolean} */
  #hasValueChanged = false;

  /**
   * Value the input held when it took focus. Lets blur skip a genuine no-op —
   * the quantity rules clamping what was typed back to that same value — without
   * ever suppressing a real update.
   * @type {string | null}
   */
  #valueOnFocus = null;

  /** @type {AbortController | null} */
  #abortController = null;

  connectedCallback() {
    super.connectedCallback();

    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    // Track when user actually types in the input
    this.refs.quantityInput.addEventListener(
      "input",
      () => {
        this.#hasValueChanged = true;
        this.#updateQuantityButtonStates();
      },
      { signal }
    );

    // A cart line's input sits in cart-form, whose only submit button is checkout,
    // so Enter would submit the form through it and leave for checkout.
    if (this.dataset.context === "cart-items") {
      this.addEventListener("keydown", this.#onCartEnter, { signal });
    }

    window.addEventListener("pageshow", this.#onPageShow, { signal });

    this.#updateQuantityButtonStates();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;

    super.disconnectedCallback();
  }

  updatedCallback() {
    super.updatedCallback();
    this.#updateQuantityButtonStates();
  }

  /**
   * Drops any pending edit when the page comes back from bfcache.
   *
   * Safari restores this instance's fields along with the DOM, so a half-finished
   * edit survives the round trip — and it restores focus too, so the next click
   * fires blur and commits it. That edit is already gone: pressing Enter in the
   * input submits cart-form, which updates the quantities and leaves for checkout.
   * Meanwhile an automatic discount triggered by the new quantity makes Shopify
   * recompute the line keys, so the key frozen in this DOM no longer resolves and
   * the update comes back "no valid id or line parameter".
   *
   * @param {PageTransitionEvent} event
   */
  #onPageShow = (event) => {
    if (!event.persisted) return;

    this.#hasValueChanged = false;
    this.#valueOnFocus = null;
  };

  /**
   * Enter commits the typed quantity in place, as blur does, instead of submitting
   * cart-form. Focus stays in the field, so the later blur has nothing left to send.
   *
   * @param {KeyboardEvent} event
   */
  #onCartEnter = (event) => {
    if (event.key !== "Enter" || event.isComposing || event.target !== this.refs.quantityInput) return;

    event.preventDefault();
    if (this.#hasValueChanged) this.#onQuantityChange();

    this.#hasValueChanged = false;
    this.#valueOnFocus = this.refs.quantityInput.value;
  };

  /**
   * Handles the quantity increase event.
   * @param {Event} event - The event.
   */
  increaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    this.refs.quantityInput.stepUp();
    this.#hasValueChanged = true;
    this.#onQuantityChange();
  }

  /**
   * Handles the quantity decrease event.
   * @param {Event} event - The event.
   */
  decreaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    this.refs.quantityInput.stepDown();
    this.#hasValueChanged = true;
    this.#onQuantityChange();
  }

  /**
   * When our input gets focused, we want to fully select the value.
   * @param {FocusEvent} event
   */
  selectInputValue(event) {
    const { quantityInput } = this.refs;
    if (!(event.target instanceof HTMLInputElement) || document.activeElement !== quantityInput) return;

    // Use setTimeout to avoid interfering with focus management
    setTimeout(() => {
      quantityInput.select();
    }, 0);

    // Reset the change flag when focusing (user might just be navigating)
    this.#hasValueChanged = false;
    this.#valueOnFocus = quantityInput.value;
  }

  /**
   * Commits the quantity when the input loses focus (blur).
   * @param {FocusEvent} event - Blur event; `event.target` is the quantity input.
   */
  setQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    if (event.target instanceof HTMLInputElement) {
      // `event.target` is the quantity input itself (on:blur is delegated on
      // document), so comparing its value to itself proves nothing — the `input`
      // event is what tells us the user actually edited the field.
      if (this.#hasValueChanged) {
        this.#onQuantityChange();
      }

      // Reset the flag after processing
      this.#hasValueChanged = false;
      this.#valueOnFocus = null;
    }
  }

  /**
   * Handles the quantity change event.
   */
  #onQuantityChange() {
    const { quantityInput } = this.refs;

    const valueBeforeRules = quantityInput.value;
    this.#checkQuantityRules();
    this.#updateQuantityButtonStates();

    // Skip only a true no-op: the rules clamped what was typed (e.g. above max)
    // straight back to the value the field already held on focus. Anything else
    // must reach the cart — a blur that edited the quantity always sends it.
    const wasClamped = quantityInput.value !== valueBeforeRules;
    if (wasClamped && this.#valueOnFocus !== null && quantityInput.value === this.#valueOnFocus) {
      return;
    }

    const newValue = parseInt(quantityInput.value, 10);

    quantityInput.dispatchEvent(new QuantitySelectorUpdateEvent(newValue, Number(quantityInput.dataset.cartLine)));
  }

  /**
   * Checks the quantity rules are met
   */
  #checkQuantityRules = () => {
    const { quantityInput } = this.refs;
    const { min, max, value: newValue } = quantityInput;

    if (min != "" && parseFloat(newValue) < parseFloat(min)) quantityInput.value = min;
    if (max != "" && parseFloat(newValue) > parseFloat(max)) quantityInput.value = max;
  };

  /**
   * Disables minus at min, plus at max, respecting input disabled.
   */
  #updateQuantityButtonStates() {
    const { quantityInput, quantityButtons } = this.refs;
    const buttons = Array.isArray(quantityButtons) ? quantityButtons : [];
    const [minusButton, plusButton] = buttons;

    if (!(minusButton instanceof HTMLButtonElement) || !(plusButton instanceof HTMLButtonElement)) return;

    const inputDisabled = quantityInput.disabled;
    const rawValue = parseFloat(quantityInput.value);

    let atMin = false;
    let atMax = false;

    if (!Number.isNaN(rawValue)) {
      const { min: minAttr, max: maxAttr } = quantityInput;
      if (minAttr !== "") {
        const minNum = parseFloat(minAttr);
        if (!Number.isNaN(minNum)) atMin = rawValue <= minNum;
      }
      if (maxAttr !== "") {
        const maxNum = parseFloat(maxAttr);
        if (!Number.isNaN(maxNum)) atMax = rawValue >= maxNum;
      }
    }

    minusButton.disabled = inputDisabled || atMin;
    plusButton.disabled = inputDisabled || atMax;
  }
}

if (!customElements.get("quantity-selector-component")) {
  customElements.define("quantity-selector-component", QuantitySelectorComponent);
}
