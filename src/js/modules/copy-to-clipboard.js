import { Component } from "@theme/component";

/**
 * Handles copying text to clipboard, from an event like a click.
 * Optionally, reveals a success message after copying.
 * @extends {Component}
 */
/**
 * @component copy-to-clipboard-component
 * @capability Copies a preset string to the clipboard on click and shows a temporary "copied" success state (label swap + .is-copied class, auto-reset after 5s).
 * @when Share-link buttons, coupon/discount code copy, "copy URL/email" affordances — anywhere a click should put text on the clipboard with visual feedback.
 * @contract <copy-to-clipboard-component data-copy-value="..." data-copy-label="..." data-copied-label="..."> with a child trigger wired on:click="/copyToClipboard"; optional ref="copyButtonText" element whose text swaps between the labels.
 * @keywords copy to clipboard, copy link, share url, coupon code, discount code, copy button, copied feedback, clipboard writeText
 */
class CopyToClipboardComponent extends Component {
  #resetTimer = null;

  async copyToClipboard() {
    const { copyValue } = this.dataset;

    if (!copyValue) return;

    if (!(await this.#writeText(copyValue))) return;

    this.#updateState(true);

    if (this.#resetTimer) clearTimeout(this.#resetTimer);
    this.#resetTimer = setTimeout(() => {
      this.#updateState(false);
    }, 5000);
  }

  /**
   * Writes to the clipboard, falling back to the legacy path when the async API
   * is unavailable — the Shopify theme editor preview iframe is not granted
   * `clipboard-write`, so `writeText` rejects there with NotAllowedError.
   * @param {string} value
   * @returns {Promise<boolean>} whether the value reached the clipboard
   */
  async #writeText(value) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Blocked by permissions policy or a non-secure context — fall through.
    }

    return this.#writeTextLegacy(value);
  }

  /**
   * @param {string} value
   * @returns {boolean} whether the copy command succeeded
   */
  #writeTextLegacy(value) {
    const textarea = document.createElement("textarea");

    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    this.append(textarea);
    textarea.select();

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    textarea.remove();

    return copied;
  }

  #updateButtonText(label) {
    const { copyButtonText } = this.refs;

    if (!copyButtonText || !label) return;

    copyButtonText.textContent = label;
    // A fork that rolls its button labels paints them from `data-label`, not
    // from the text node, so the confirmation would never be seen without this.
    copyButtonText.closest("[data-label]")?.setAttribute("data-label", label);
  }

  #updateState(isCopied) {
    const { copyLabel, copiedLabel } = this.dataset;

    this.classList.toggle("is-copied", isCopied);
    this.#updateButtonText(isCopied ? copiedLabel : copyLabel);
  }

  disconnectedCallback() {
    if (this.#resetTimer) clearTimeout(this.#resetTimer);
    super.disconnectedCallback();
  }
}

if (!customElements.get("copy-to-clipboard-component")) {
  customElements.define("copy-to-clipboard-component", CopyToClipboardComponent);
}
