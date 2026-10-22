import { DialogComponent } from "@theme/dialog";
import { AccordionComponent } from "@theme/modules";
import { getFocusableElements } from "@theme/utilities";

class MenuDrawerDetails extends HTMLDetailsElement {
  #abortController = new AbortController();
  #animationFrameId = null;
  #boundHandleKeyDown = null;
  #boundHandleToggle = null;
  /** @type {Array<{ element: HTMLDetailsElement; tabindex: string | null }>} */
  #detailsOutsideRestore = [];
  /** @type {HTMLElement[]} - focusable inside item submenu, filled in #setDetailsTabindex, used in #setupFocusTrap */
  #focusableElements = [];
  /** @type {((event: KeyboardEvent) => void) | null} */
  #focusTrapHandler = null;

  constructor() {
    super();

    this.onSummaryClick = this.onSummaryClick.bind(this);
    this.onCloseButtonClick = this.onCloseButtonClick.bind(this);
    this.onOpenSubmenuButtonClick = this.onOpenSubmenuButtonClick.bind(this);
    this.#boundHandleKeyDown = this.#handleKeyDown.bind(this);
    this.#boundHandleToggle = this.#handleToggle.bind(this);
  }

  get parent() {
    return this.closest("[data-parent]");
  }

  get summary() {
    return this.querySelector("summary");
  }

  get closeButton() {
    return this.querySelector("[data-menu-drawer-item-back]");
  }

  get openSubmenuButton() {
    return this.querySelector("[data-menu-drawer-item-open]");
  }

  connectedCallback() {
    const summary = this.summary;
    const closeButton = this.closeButton;
    const openSubmenuButton = this.openSubmenuButton;
    const { signal } = this.#abortController;

    if (summary) {
      summary.addEventListener("click", this.onSummaryClick, { signal });
      this.#setupAriaAttributes();
    }

    if (openSubmenuButton) {
      openSubmenuButton.addEventListener("click", this.onOpenSubmenuButtonClick, { signal });
    }

    if (closeButton) {
      closeButton.addEventListener("click", this.onCloseButtonClick, { signal });
    }

    // Handle Escape key to close drawer
    document.addEventListener("keydown", this.#boundHandleKeyDown);

    this.addEventListener("toggle", this.#boundHandleToggle, { signal });

    // Sync aria-expanded with open attribute
    this.#syncAriaExpanded();
  }

  disconnectedCallback() {
    this.#abortController.abort();

    document.removeEventListener("keydown", this.#boundHandleKeyDown);

    this.#removeFocusTrap();
    this.#restoreDetailsTabindex();

    // Cancel any pending animation
    if (this.#animationFrameId) {
      window.cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
  }

  #handleToggle() {
    if (this.open) {
      this.#setDetailsTabindex();
      this.#setupFocusTrap();
    } else {
      this.#removeFocusTrap();
      this.#restoreDetailsTabindex();
    }
  }

  #setupFocusTrap() {
    if (this.#focusableElements.length === 0) return;

    const firstElement = this.#focusableElements[0];
    const lastElement = this.#focusableElements[this.#focusableElements.length - 1];

    const handleTabKey = (event) => {
      if (event.key !== "Tab") return;

      const activeElement = document.activeElement;
      const isFocusInDrawer = this.#focusableElements.includes(activeElement);

      if (event.shiftKey) {
        if (activeElement === firstElement || !isFocusInDrawer) {
          event.preventDefault();
          event.stopPropagation();
          lastElement.focus();
        }
      } else {
        if (activeElement === lastElement || !isFocusInDrawer) {
          event.preventDefault();
          event.stopPropagation();
          firstElement.focus();
        }
      }
    };

    this.closeButton && this.closeButton.focus();
    this.addEventListener("keydown", handleTabKey, true);
    this.#focusTrapHandler = handleTabKey;
  }

  #removeFocusTrap() {
    if (this.#focusTrapHandler) {
      this.removeEventListener("keydown", this.#focusTrapHandler, true);
      this.#focusTrapHandler = null;
    }
    this.#focusableElements = [];
  }

  #setDetailsTabindex() {
    this.#restoreDetailsTabindex();

    const dialog = this.closest(".dialog");
    const dialogHeader = dialog?.querySelector("[data-menu-drawer-header]");
    const submenu = this.querySelector("[data-menu-drawer-item-submenu]");
    const focusableElements = getFocusableElements(dialog);

    this.#focusableElements = [];

    focusableElements.forEach((el) => {
      if (submenu?.contains(el) || dialogHeader?.contains(el)) {
        this.#focusableElements.push(el);
        return;
      }

      const tabindex = el.getAttribute("tabindex");
      this.#detailsOutsideRestore.push({ element: el, tabindex });
      el.setAttribute("tabindex", "-1");
    });
  }

  #restoreDetailsTabindex() {
    for (const { element, tabindex } of this.#detailsOutsideRestore) {
      if (tabindex === null) {
        element.removeAttribute("tabindex");
      } else {
        element.setAttribute("tabindex", tabindex);
      }
    }
    this.#detailsOutsideRestore.length = 0;
  }

  #setupAriaAttributes() {
    const summary = this.summary;
    if (!summary) return;

    const contentId = summary.id || `${this.tagName.toLowerCase()}-content`;
    summary.id = summary.id || contentId;

    summary.setAttribute("aria-expanded", this.hasAttribute("open") ? "true" : "false");
  }

  #syncAriaExpanded() {
    const summary = this.summary;
    if (!summary) return;

    summary.setAttribute("aria-expanded", this.hasAttribute("open") ? "true" : "false");
  }

  #handleKeyDown(event) {
    if (event.key !== "Escape" || !this.hasAttribute("open")) return;

    // Only close if the event target is within this component
    const closestDrawer = event.target.closest("menu-drawer-details");
    if (!closestDrawer || closestDrawer !== this) return;

    event.preventDefault();
    this.onCloseButtonClick();
  }

  onSummaryClick(event) {
    const summary = this.summary;
    const href = summary.dataset.linkUrl;

    if (href) {
      event.preventDefault();
      window.location.href = href;

      return;
    }
  }

  onOpenSubmenuButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const parent = this.parent;
    const summary = this.summary;

    setTimeout(() => {
      if (!parent || !summary) return;

      if (!this.open) {
        this.open = true;
      }
      parent.classList.add("active");
      this.classList.add("active");
      this.#syncAriaExpanded();
    }, 100);
  }

  onCloseButtonClick() {
    const parent = this.parent;
    const summary = this.summary;

    if (!parent || !summary) return;

    parent.classList.remove("active");
    this.classList.remove("active");
    this.#syncAriaExpanded();

    this.#closeAnimation();
  }

  #closeAnimation() {
    // Cancel any existing animation
    if (this.#animationFrameId) {
      window.cancelAnimationFrame(this.#animationFrameId);
    }

    let animationStart;

    const handleAnimation = (time) => {
      if (animationStart === undefined) {
        animationStart = time;
      }

      const elapsedTime = time - animationStart;

      if (elapsedTime < 400) {
        this.#animationFrameId = window.requestAnimationFrame(handleAnimation);
      } else {
        this.removeAttribute("open");
        this.#animationFrameId = null;
        this.#syncAriaExpanded();
      }
    };

    this.#animationFrameId = window.requestAnimationFrame(handleAnimation);
  }
}
customElements.define("menu-drawer-details", MenuDrawerDetails, { extends: "details" });

class MenuDrawerSubmenu extends AccordionComponent {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
  }

  onSummaryClick(event) {
    event.preventDefault();

    const { target } = event;
    const summary = target.closest("summary");

    if (summary) {
      const href = summary.dataset.linkUrl;

      if (href) {
        window.location.href = href;
        return;
      }
    }
  }

  onArrowClick(event) {
    event.preventDefault();
    event.stopPropagation();

    super.onSummaryClick(event);
  }
}
customElements.define("menu-drawer-submenu", MenuDrawerSubmenu);

class MenuDrawer extends DialogComponent {
  /** @type {number | null} */
  #shopifyAbortController;
  // Timer to prevent closing the drawer menu when a nested block is selected
  #shopifyBlockDeselectTimer = null;

  connectedCallback() {
    super.connectedCallback();

    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;

    super.disconnectedCallback();
  }

  #registerDesignModeEvents() {
    if (!(window.Shopify && Shopify.designMode)) return;

    if (!this.sectionEl) return;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    this.sectionEl.addEventListener(
      "shopify:block:select",
      (event) => {
        const { target } = event;
        const menuDrawerBlocks = target.closest("[data-menu-drawer-blocks]");
        if (menuDrawerBlocks) {
          clearTimeout(this.#shopifyBlockDeselectTimer);
          this.showDialog();
        }
      },
      { signal }
    );

    this.sectionEl.addEventListener(
      "shopify:block:deselect",
      (event) => {
        const { target } = event;
        const menuDrawerBlocks = target.closest("[data-menu-drawer-blocks]");
        if (menuDrawerBlocks) {
          this.#shopifyBlockDeselectTimer = setTimeout(() => {
            this.closeDialog();
          }, 100);
        }
      },
      { signal }
    );
  }

  get sectionEl() {
    return (this._sectionEl = this._sectionEl || this.closest(".shopify-section"));
  }
}
customElements.define("menu-drawer", MenuDrawer);
