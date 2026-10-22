import { DialogComponent } from "@theme/dialog";
import { CookieManager, getLocalStorage, onDocumentReady, setLocalStorage } from "@theme/utilities";

/**
 * @capability Newsletter/promo popup dialog that auto-opens on page load, after a 5s delay, or after scrolling 700px, then suppresses itself via localStorage for a merchant-chosen repeat interval (30 mins up to never).
 * @when Any marketing popup that must self-trigger and not nag returning visitors: newsletter signup, promo announcement, discount capture. Skips entirely in the theme editor. Pairs with src/scss/global/section-popup.scss.
 * @contract <subscribe-popup-component> (extends DialogComponent — needs its dialog markup) with data-trigger-open="delay|scroll_down|immediate" and data-repeat-open="no_repeat|every_30_mins|every_1_hr|every_6_hrs|every_12_hrs|every_day|every_3_days|every_week|every_2_weeks|every_month".
 * @keywords popup, newsletter popup, promo modal, auto open dialog, exit trigger, scroll trigger, delay open, show once, cookie suppression, subscribe modal
 */
class SubscribePopupComponent extends DialogComponent {
  connectedCallback() {
    super.connectedCallback();

    onDocumentReady(this.handleOpen.bind(this));
  }

  get triggerOpen() {
    return this.dataset.triggerOpen;
  }

  get repeatOpen() {
    return this.dataset.repeatOpen;
  }

  handleOpen() {
    if (Shopify.designMode) return;

    let savedData = getLocalStorage(CookieManager.SUBSCRIBE_POPUP);
    if (savedData && savedData.opened) {
      return false;
    }

    switch (this.triggerOpen) {
      case "delay":
        setTimeout(() => {
          this.show();
        }, 5000);
        break;
      case "scroll_down":
        this.triggerAfterScroll(700, this.show.bind(this));
        break;
      default:
        this.show();
        break;
    }
  }

  show() {
    this.setRepeatOpen();
    this.showDialog();
  }

  triggerAfterScroll(offset = 500, trigger) {
    const scrollHandler = () => {
      const scrollTop =
        window.pageYOffset || (document.documentElement || document.body.parentNode || document.body).scrollTop || 0;
      if (scrollTop > offset) {
        trigger();
        window.removeEventListener("scroll", scrollHandler, { capture: false });
      }
    };
    window.addEventListener("scroll", scrollHandler, { passive: true });
  }

  setRepeatOpen() {
    if (Shopify.designMode) return;

    const expires = this.#getRepeatOpenExpiryDays();
    setLocalStorage(CookieManager.SUBSCRIBE_POPUP, { opened: true }, expires);
  }

  #getRepeatOpenExpiryDays() {
    const EXPIRY_BY_KEY = {
      no_repeat: 365,
      every_30_mins: 1 / 2 / 24,
      every_1_hr: 1 / 24,
      every_6_hrs: 6 / 24,
      every_12_hrs: 1 / 2,
      every_day: 1,
      every_3_days: 3,
      every_week: 7,
      every_2_weeks: 14,
      every_month: 30,
    };

    return EXPIRY_BY_KEY[this.repeatOpen] ?? 7;
  }
}

if (!customElements.get("subscribe-popup-component")) {
  customElements.define("subscribe-popup-component", SubscribePopupComponent);
}
