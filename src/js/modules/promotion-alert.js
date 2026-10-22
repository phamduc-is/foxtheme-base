import { Component } from "@theme/component";

/**
 * @component promotion-alert
 * @capability Dismissible inline alert — hides itself when its close button is clicked and remembers that choice in sessionStorage, so the alert stays gone for the rest of the browsing session but returns on the next visit.
 * @when Any promotional / informational strip a shopper should be able to close without losing it forever (promo alerts, shipping notices, inline banners). Pair with src/scss/scoped/promotion-alert.scss.
 * @contract <promotion-alert data-storage-key="..."> containing a trigger wired with on:click="/dismiss"; hidden state is the host's `hidden` attribute. Persistence is skipped in the theme editor so the merchant never loses the block.
 * @keywords promotion alert, dismiss, dismissible, close button, hide banner, session storage, remember dismissed, inline notice
 */
class PromotionAlert extends Component {
  connectedCallback() {
    super.connectedCallback();

    if (this.#isDismissed()) this.hidden = true;
  }

  /**
   * Hides the alert and remembers it for the rest of the session.
   */
  dismiss() {
    this.hidden = true;

    this.#remember();
  }

  /**
   * @returns {string | undefined}
   */
  get #storageKey() {
    return this.dataset.storageKey;
  }

  /**
   * The theme editor never restores a dismissal — a merchant closing the alert
   * while editing must not make the block disappear from their preview.
   * @returns {boolean}
   */
  #isDismissed() {
    if (Shopify.designMode || !this.#storageKey) return false;

    try {
      return sessionStorage.getItem(this.#storageKey) === "true";
    } catch {
      // Storage blocked (private mode, cookies disabled) — treat as not dismissed.
      return false;
    }
  }

  #remember() {
    if (Shopify.designMode || !this.#storageKey) return;

    try {
      sessionStorage.setItem(this.#storageKey, "true");
    } catch {
      // Storage blocked — the alert stays hidden for this page view only.
    }
  }
}

customElements.define("promotion-alert", PromotionAlert);
