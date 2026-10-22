import { Component } from "@theme/component";

/**
 * @capability Line-clamp text truncation with a "Read more / Read less" toggle — collapses long text to N lines via max-height (lineHeight × clamp), swaps the button label, and hides the button entirely when the text already fits.
 * @when Long description/paragraph blocks that should collapse on load: product descriptions, collection descriptions, About text. Pairs with src/scss/global/_block-collapsible-text-readmore.scss. Reuse instead of writing a new clamp/toggle.
 * @contract <read-more data-toggle-class data-show-text data-hide-text data-line-clamp="N"> with ref="readMoreButton" (bound via on:click="/onToggleClick"), ref="readMoreButtonText", ref="readMoreContent" (content also reads the --line-clamp CSS var); toggles is-collapsed/is-disabled state classes.
 * @keywords read more, show less, line clamp, truncate text, collapse text, expand text, long description, see more toggle, max-height
 */
class ReadMore extends Component {
  /** @type {string[]} */
  requiredRefs = ["readMoreButton", "readMoreButtonText", "readMoreContent"];

  constructor() {
    super();

    this.classes = {
      isDisabled: "is-disabled",
      isCollapsed: "is-collapsed",
    };

    this.toggleClass = this.dataset.toggleClass;
    this.showText = this.dataset.showText;
    this.hideText = this.dataset.hideText;
    this.lineClamp = parseInt(this.dataset.lineClamp);
  }

  connectedCallback() {
    super.connectedCallback();

    this.init();
  }

  init() {
    const { readMoreButton: button, readMoreContent: content } = this.refs;

    const lineHeight = parseFloat(window.getComputedStyle(content).lineHeight);
    const contentHeight = content.scrollHeight;
    const maxHeight = lineHeight * this.lineClamp;

    if (contentHeight <= maxHeight) {
      button.style.display = "none";
      return;
    }

    this.classList.remove(this.classes.isDisabled);
    content.classList.remove(this.toggleClass);
    this.showLess();
  }

  showMore() {
    const { readMoreContent: content, readMoreButtonText: buttonText } = this.refs;

    this.classList.remove(this.classes.isCollapsed);
    content.classList.remove(this.toggleClass);
    buttonText.textContent = this.hideText;
    buttonText.closest("[data-label]")?.setAttribute("data-label", this.hideText);
    this.resetHeight();
  }

  showLess() {
    const { readMoreContent: content, readMoreButtonText: buttonText } = this.refs;

    this.classList.add(this.classes.isCollapsed);
    content.classList.add(this.toggleClass);
    buttonText.textContent = this.showText;
    buttonText.closest("[data-label]")?.setAttribute("data-label", this.showText);
    this.setHeight();
  }

  setHeight() {
    const { readMoreContent: content } = this.refs;

    const contentStyle = window.getComputedStyle(content);

    const lineHeight = parseFloat(contentStyle.lineHeight);
    const lines = parseInt(contentStyle.getPropertyValue("--line-clamp"));
    const maxHeight = lineHeight * lines;
    content.style.setProperty("max-height", maxHeight + "px");
  }

  resetHeight() {
    const { readMoreContent: content } = this.refs;

    content.style.removeProperty("max-height");
  }

  onToggleClick(event) {
    event.preventDefault();

    const { readMoreContent: content } = this.refs;

    if (content.classList.contains(this.toggleClass)) {
      this.showMore();
    } else {
      this.showLess();
    }
  }
}

if (!customElements.get("read-more")) {
  customElements.define("read-more", ReadMore);
}
