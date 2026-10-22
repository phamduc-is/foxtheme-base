import { Component } from "@theme/component";

class NewsletterForm extends Component {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    this.init();
  }

  /**
   * Show message when user re-subscribe with exists email.
   */
  init() {
    const { input, messageDialog } = this.refs;
    const messageDialogRefs = messageDialog?.refs ?? {};
    const { alert, messageErrorSubscribed } = messageDialogRefs;

    const liveUrl = window.location.href;
    const result = liveUrl.includes("form_type=customer");
    const isSubscribed = result && input.value.length != 0;

    if (isSubscribed && messageErrorSubscribed && !alert) {
      messageErrorSubscribed.classList.remove("hidden");
    }

    if (isSubscribed || alert) {
      if (!window.isMessageDialogShow) {
        messageDialog && messageDialog.showDialog();
        window.isMessageDialogShow = true;
      }
    }
  }
}

if (!customElements.get("newsletter-form")) {
  customElements.define("newsletter-form", NewsletterForm);
}
