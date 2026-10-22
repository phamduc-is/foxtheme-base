import { onDocumentReady } from "@theme/utilities";

class MenuSidebar extends HTMLElement {
  #intersectionObserver = null;
  #abortController = null;

  constructor() {
    super();

    this.classes = {
      visible: "is-visible",
    };

    this.sidenavMenuToggleHandler = this.handleSidenavMenuToggle.bind(this);
    this.keyDownHandler = this.handleKeyDown.bind(this);
    this.summaryClickHandler = this.handleSummaryClick.bind(this);
  }

  get summarys() {
    return this.querySelectorAll("summary");
  }

  get activeSummary() {
    return Array.from(this.summarys).find((summary) => summary.classList.contains(this.classes.visible));
  }

  get containerEl() {
    return (this._containerEl = this._containerEl || this.closest("[data-mega-menu-wrapper]"));
  }

  connectedCallback() {
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    this.#setupAriaAttributes();

    onDocumentReady(this.setInitialMinHeight.bind(this));

    this.summarys.forEach((summary) => {
      summary.addEventListener("mouseenter", this.sidenavMenuToggleHandler, { signal });
      summary.addEventListener("keydown", this.keyDownHandler, { signal });
      summary.addEventListener("click", this.summaryClickHandler, { signal });
    });

    this.setupIntersectionObserver();
  }

  handleSummaryClick(event) {
    // Prevent default for mouse clicks to avoid toggling details element
    // Keyboard activation (Enter/Space) is handled in handleKeyDown
    event.preventDefault();

    const summaryEl = event.target.closest("summary");
    this.#goToLink(summaryEl);
  }

  setInitialMinHeight() {
    requestAnimationFrame(() => {
      this.setPromotionsHeight();
    });
  }

  setPromotionsHeight() {
    if (!this.containerEl) return;

    const promotionsEl = this.containerEl.querySelector("[data-mega-menu-promotions]");
    if (!promotionsEl) return;

    const promotionsHeight = promotionsEl.offsetHeight;
    this.containerEl.style.setProperty("--promotions-height", `${promotionsHeight}px`);
  }

  #setupAriaAttributes() {
    this.summarys.forEach((summary, index) => {
      const contentEl = summary.nextElementSibling;
      if (!contentEl) return;

      const summaryId = summary.id || `menu-sidebar-item-${index}`;
      const contentId = contentEl.id || `menu-sidebar-content-${index}`;

      summary.id = summaryId;
      contentEl.id = contentId;

      summary.setAttribute("role", "menuitem");
      summary.setAttribute("aria-controls", contentId);
      summary.setAttribute("aria-expanded", "false");
      contentEl.setAttribute("role", "menu");
      contentEl.setAttribute("aria-labelledby", summaryId);
    });
  }

  setupIntersectionObserver() {
    this.#intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            this.updateHeight();
            this.setPromotionsHeight();
          }, 100);
        }
      });
    });

    this.#intersectionObserver.observe(this);
  }

  updateHeight() {
    const activeSummary = this.activeSummary;
    if (!activeSummary || !this.containerEl) return;

    // Active item may have no content panel (e.g. a level-2 link without a
    // sub-menu) — reset to 0 so a previously taller panel's height doesn't stick.
    const contentEl = activeSummary.nextElementSibling;

    // Called from IntersectionObserver + setTimeout(100ms), layout is stable
    // No rAF needed - 50-100ms reflow timing is acceptable
    const contentHeight = contentEl ? contentEl.offsetHeight : 0;
    this.containerEl.style.setProperty("--sidebar-height", `${contentHeight}px`);
  }

  setActiveItem(summaryEl, isUpdateHeight = true) {
    const lastSidenavEl = this.activeSummary;
    if (lastSidenavEl) {
      lastSidenavEl.classList.remove(this.classes.visible);
      lastSidenavEl.setAttribute("aria-expanded", "false");
    }

    summaryEl.classList.add(this.classes.visible);
    summaryEl.setAttribute("aria-expanded", "true");

    isUpdateHeight && this.updateHeight();
  }

  handleSidenavMenuToggle(event) {
    const summaryEl = event.target.closest("summary");
    if (summaryEl) {
      this.setActiveItem(summaryEl);
    }
  }

  handleKeyDown(event) {
    const summaryEl = event.target.closest("summary");
    if (!summaryEl) return;

    const summaries = Array.from(this.summarys);
    const currentIndex = summaries.indexOf(summaryEl);
    if (currentIndex === -1) return;

    const key = event.key;
    let targetIndex = currentIndex;

    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        targetIndex = currentIndex + 1;
        if (targetIndex >= summaries.length) targetIndex = 0;
        summaries[targetIndex].focus();
        this.setActiveItem(summaries[targetIndex]);
        break;

      case "ArrowUp":
        event.preventDefault();
        targetIndex = currentIndex - 1;
        if (targetIndex < 0) targetIndex = summaries.length - 1;
        summaries[targetIndex].focus();
        this.setActiveItem(summaries[targetIndex]);
        break;

      case "Home":
        event.preventDefault();
        summaries[0].focus();
        this.setActiveItem(summaries[0]);
        break;

      case "End":
        event.preventDefault();
        summaries[summaries.length - 1].focus();
        this.setActiveItem(summaries[summaries.length - 1]);
        break;

      case "Enter":
        event.preventDefault();
        this.setActiveItem(summaryEl);
        this.#goToLink(summaryEl);
        break;

      case " ":
        event.preventDefault();
        this.setActiveItem(summaryEl);
        break;

      default:
        return;
    }
  }

  #goToLink(summaryEl) {
    const linkUrl = summaryEl.dataset.linkUrl;
    if (linkUrl) {
      window.location.href = linkUrl;
    }
  }

  disconnectedCallback() {
    if (this.#abortController) {
      this.#abortController.abort();
      this.#abortController = null;
    }

    if (this.#intersectionObserver) {
      this.#intersectionObserver.disconnect();
      this.#intersectionObserver = null;
    }
  }
}
customElements.define("menu-sidebar", MenuSidebar);
