import { prefersReducedMotion, mediaHoverFine, removeScrollLockClass, waitForEvent } from "@theme/utilities";
import { animate } from "@theme/animation";

const lockDropdownCount = new WeakMap();
// Animation timing constants
const ANIMATION_TIMING = {
  hoverEnterDelay: 100,
  hoverLeaveDelay: 150,
  contentOpenDelay: 100,
};

// Grace period before the scroll lock is actually released, shared by every
// dropdown. Hovering from one menu to the next drops the open count to zero for
// a moment: this menu closes hoverLeaveDelay (150ms) after the pointer leaves,
// the next one opens hoverEnterDelay (100ms) after it arrives, so the gap is
// (pointer travel - 50ms). Releasing the lock synchronously in there unsets
// `overflow: hidden` on <html>, and the page scrollbar blinks back in and out
// on every handoff. 300ms covers a comfortable traverse of a nav bar; pausing
// long enough on an intermediate item opens it, which cancels the release
// outright. Deliberately short of the 600ms close animation so that closing a
// menu for real gives the page back promptly.
const SCROLL_UNLOCK_GRACE = 300;
let scrollUnlockTimer = null;

function cancelScrollUnlock() {
  if (scrollUnlockTimer === null) return;
  clearTimeout(scrollUnlockTimer);
  scrollUnlockTimer = null;
}

/**
 * @component details-dropdown
 * @capability Animated dropdown built on native <details> — click or debounced-hover open (hover falls back to click on touch), outside-click/Escape/focus-out close, animated show/hide, viewport-edge overflow flip (.needs-reverse), and body class "dropdown-open" while open.
 * @when Header nav dropdowns, sort/filter menus, language/currency pickers — any disclosure that opens a floating panel from a trigger. Use the trigger="hover" attribute for hover menus; summary data-link makes hover-triggered summaries navigate on click.
 * @contract <details is="details-dropdown" [trigger="hover"] [level]> whose FIRST child is the <summary> trigger and LAST child is the content panel; optional data-link on the summary (hover mode navigates on click).
 * @keywords dropdown, details summary, disclosure, hover menu, nav dropdown, sort menu, popover panel, open on hover, click outside close, flyout
 */
class DetailsDropdown extends HTMLDetailsElement {
  constructor() {
    super();
    // Initialize properties
    this.classes = { bodyClass: "dropdown-open" };
    this.events = {
      handleAfterHide: "menu:handleAfterHide",
      handleAfterShow: "menu:handleAfterShow",
    };

    // Reference to first and last child elements
    this.summaryElement = this.firstElementChild;
    this.contentElement = this.lastElementChild;

    // Initial state based on attributes
    this._open = this.hasAttribute("open");

    // Setup hover detection with debouncing
    this.hoverEnterTimer = null;
    this.hoverLeaveTimer = null;
    this.isHoveringItem = false;
    this.isHoveringContent = false;

    // Cache for performance optimization
    this._cachedTrigger = null;
    this._cachedTranslateY = null;

    // Binding methods to ensure 'this' context is correct when they are called
    this.handleSummaryClick = this.handleSummaryClick.bind(this);
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.handleEscKeyPress = this.handleEscKeyPress.bind(this);
    this.handleFocusOut = this.handleFocusOut.bind(this);
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handleContentMouseEnter = this.handleContentMouseEnter.bind(this);
    this.handleContentMouseLeave = this.handleContentMouseLeave.bind(this);
  }

  connectedCallback() {
    // Event listeners for summary element
    this.summaryElement.addEventListener("click", this.handleSummaryClick);

    if (this.trigger === "hover") {
      this.summaryElement.addEventListener("focusin", this.#handleFocusIn);
      this.summaryElement.addEventListener("focusout", this.#handleFocusOutInternal);

      // Setup hover detection on dropdown content to prevent closing when moving to dropdown
      this.contentElement.addEventListener("mouseenter", this.handleContentMouseEnter);
      this.contentElement.addEventListener("mouseleave", this.handleContentMouseLeave);
    }

    // Setup hover detection with debouncing
    this.addEventListener("mouseenter", this.handleMouseEnter);
    this.addEventListener("mouseleave", this.handleMouseLeave);
  }

  disconnectedCallback() {
    // Cleanup timers first to prevent any pending callbacks
    this.#clearHoverTimers();

    // Remove event listeners
    this.summaryElement.removeEventListener("click", this.handleSummaryClick);
    if (this.trigger === "hover") {
      this.summaryElement.removeEventListener("focusin", this.#handleFocusIn);
      this.summaryElement.removeEventListener("focusout", this.#handleFocusOutInternal);
      this.contentElement.removeEventListener("mouseenter", this.handleContentMouseEnter);
      this.contentElement.removeEventListener("mouseleave", this.handleContentMouseLeave);
    }
    this.removeEventListener("mouseenter", this.handleMouseEnter);
    this.removeEventListener("mouseleave", this.handleMouseLeave);

    // Cleanup document-level listeners (prevent memory leak)
    // These might have been added in #setupOpenState
    document.removeEventListener("click", this.handleOutsideClick);
    document.removeEventListener("keydown", this.handleEscKeyPress);
    document.removeEventListener("focusout", this.handleFocusOut);

    // Clear cached values
    this._cachedTrigger = null;
    this._cachedTranslateY = null;
    this._cachedChildEl = null;
  }

  #handleFocusIn = (event) => {
    if (event.target === this.summaryElement) {
      this.open = true;
    }
  };

  #handleFocusOutInternal = (event) => {
    if (!this.contentElement.contains(event.relatedTarget)) {
      this.open = false;
    }
  };

  handleMouseEnter() {
    this.isHoveringItem = true;
    this.#clearHoverTimer("leave");
    this.hoverEnterTimer = setTimeout(() => {
      this.detectHover({ type: "mouseenter" });
    }, ANIMATION_TIMING.hoverEnterDelay);
  }

  handleMouseLeave(event) {
    this.isHoveringItem = false;
    this.#clearHoverTimer("enter");

    // Only start close timer if menu is open and not hovering over dropdown content
    if (this.open && !this.isHoveringContent) {
      this.hoverLeaveTimer = setTimeout(() => {
        // Double-check menu is still open before closing (prevent race condition)
        if (this.open) {
          this.detectHover({ type: "mouseleave" });
        }
      }, ANIMATION_TIMING.hoverLeaveDelay);
    }
  }

  handleContentMouseEnter() {
    this.isHoveringContent = true;
    // Cancel close timer when entering dropdown content
    this.#clearHoverTimer("leave");
  }

  handleContentMouseLeave() {
    this.isHoveringContent = false;
    // Only start close timer if menu is open and not hovering over item
    if (this.open && !this.isHoveringItem) {
      this.hoverLeaveTimer = setTimeout(() => {
        // Double-check menu is still open before closing (prevent race condition)
        if (this.open) {
          this.detectHover({ type: "mouseleave" });
        }
      }, ANIMATION_TIMING.hoverLeaveDelay);
    }
  }

  #clearHoverTimer(type) {
    const timer = type === "enter" ? this.hoverEnterTimer : this.hoverLeaveTimer;
    if (timer) {
      clearTimeout(timer);
      if (type === "enter") {
        this.hoverEnterTimer = null;
      } else {
        this.hoverLeaveTimer = null;
      }
    }
  }

  #clearHoverTimers() {
    if (this.hoverEnterTimer) {
      clearTimeout(this.hoverEnterTimer);
      this.hoverEnterTimer = null;
    }
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
  }

  set open(value) {
    // Check if the new value is different from the current value
    if (value !== this._open) {
      // Update the internal state
      this._open = value;

      // Perform actions based on whether the element is connected to the DOM
      if (this.isConnected) {
        // If connected, perform a transition
        this.transition(value);
      } else {
        // If not connected, directly manipulate the 'open' attribute
        if (value) {
          this.setAttribute("open", "");
        } else {
          this.removeAttribute("open");
        }
      }
    }
  }

  get open() {
    return this._open;
  }

  get trigger() {
    // Cache trigger value to avoid repeated media queries and DOM reads
    if (this._cachedTrigger === null) {
      // For touch devices, always use click events
      if (!mediaHoverFine()) {
        this._cachedTrigger = "click";
      } else {
        // For non-touch devices, check for custom trigger attribute
        this._cachedTrigger = this.getAttribute("trigger") || "click";
      }
    }
    return this._cachedTrigger;
  }

  handleSummaryClick(event) {
    // Prevent the default action of the event
    event.preventDefault();

    // Check if the device is not touch-enabled and the trigger type is 'hover'
    if (mediaHoverFine() && this.trigger === "hover" && this.summaryElement.hasAttribute("data-link")) {
      // If conditions are met, navigate to the URL specified in 'data-link'
      window.location.href = this.summaryElement.getAttribute("data-link");
    } else {
      // Otherwise, toggle the 'open' state
      this.open = !this.open;
    }
  }

  beforeOpen() {}

  beforeClose() {}

  get level() {
    return this.hasAttribute("level") ? this.getAttribute("level") : "top";
  }

  async transition(value) {
    if (value) {
      this.beforeOpen();
      this.#incrementDropdownCount();
      this.#setupOpenState();
      await this.showWithTransition();
      this.needsReverse();
      return waitForEvent(this, this.events.handleAfterShow);
    } else {
      this.beforeClose();
      this.#decrementDropdownCount();
      this.#cleanupOpenState();
      await this.hideWithTransition();
      if (!this.open) {
        this.removeAttribute("open");
      }
      return waitForEvent(this, this.events.handleAfterHide);
    }
  }

  #incrementDropdownCount() {
    // An opening dropdown outranks a release that has not happened yet.
    cancelScrollUnlock();
    lockDropdownCount.set(DetailsDropdown, (lockDropdownCount.get(DetailsDropdown) || 0) + 1);
  }

  #decrementDropdownCount() {
    const count = (lockDropdownCount.get(DetailsDropdown) || 0) - 1;
    lockDropdownCount.set(DetailsDropdown, count);

    if (count > 0) {
      document.body.classList.add(this.classes.bodyClass);
      return;
    }

    // Nothing is open right now, but a menu-to-menu handoff spends
    // (travel - 50ms) in exactly this state — see SCROLL_UNLOCK_GRACE.
    cancelScrollUnlock();
    scrollUnlockTimer = setTimeout(() => {
      scrollUnlockTimer = null;
      // Use helper with callback to check count (prevents race condition)
      removeScrollLockClass(document.body, this.classes.bodyClass, () => {
        // Only remove if no other dropdowns are open
        return (lockDropdownCount.get(DetailsDropdown) || 0) === 0;
      });
    }, SCROLL_UNLOCK_GRACE);
  }

  #setupOpenState() {
    document.body.classList.add(this.classes.bodyClass);
    if (document.body.classList.contains("search-open")) {
      document.body.classList.remove("search-open");
    }
    this.setAttribute("open", "");
    this.summaryElement.setAttribute("open", "");
    setTimeout(() => {
      this.contentElement.setAttribute("open", "");
    }, ANIMATION_TIMING.contentOpenDelay);
    document.addEventListener("click", this.handleOutsideClick);
    document.addEventListener("keydown", this.handleEscKeyPress);
    document.addEventListener("focusout", this.handleFocusOut);
  }

  #cleanupOpenState() {
    this.summaryElement.removeAttribute("open");
    this.contentElement.removeAttribute("open");
    // Clear any pending hover timers when closing
    this.#clearHoverTimers();
    document.removeEventListener("click", this.handleOutsideClick);
    document.removeEventListener("keydown", this.handleEscKeyPress);
    document.removeEventListener("focusout", this.handleFocusOut);
  }

  get parentEl() {
    return this.contentElement;
  }

  get childEl() {
    // Cache child element reference
    if (!this._cachedChildEl) {
      this._cachedChildEl = this.parentEl.firstElementChild;
    }
    return this._cachedChildEl;
  }

  #getTranslateY() {
    // Cache translateY calculation to avoid repeated level checks
    if (this._cachedTranslateY === null) {
      this._cachedTranslateY = this.level === "top" ? "-3rem" : "2rem";
    }
    return this._cachedTranslateY;
  }

  async showWithTransition() {
    const reducedMotion = prefersReducedMotion();
    animate(
      this.parentEl,
      { opacity: [0, 1], visibility: "visible" },
      { duration: reducedMotion ? 0 : 0.3, easing: "ease-in-out" }
    );
    const translateY = this.#getTranslateY();
    return animate(
      this.childEl,
      { transform: [`translateY(${translateY})`, "translateY(0)"] },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.3, 1, 0.3, 1] }
    ).finished;
  }

  async hideWithTransition() {
    const reducedMotion = prefersReducedMotion();
    animate(
      this.parentEl,
      { opacity: 0, visibility: "hidden" },
      { duration: reducedMotion ? 0 : 0.2, easing: "ease-in-out" }
    );
    const translateY = this.#getTranslateY();
    return animate(
      this.childEl,
      { transform: `translateY(${translateY})` },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.3, 1, 0.3, 1] }
    ).finished;
  }

  handleOutsideClick(event) {
    const isClickInside = this.contains(event.target);
    const isClickOnDetailsDropdown = event.target.closest("details") instanceof DetailsDropdown;

    if (!isClickInside && !isClickOnDetailsDropdown) {
      this.open = false;
    }
  }

  handleEscKeyPress(event) {
    if (event.code === "Escape") {
      const targetMenu = event.target.closest("details[open]");
      if (targetMenu) {
        targetMenu.open = false;
      } else if (this.open) {
        this.open = false;
      }
    }
  }

  handleFocusOut(event) {
    if (event.relatedTarget && !this.contains(event.relatedTarget)) {
      this.open = false;
    }
  }

  detectHover(event) {
    // Only process hover events if trigger is hover and element is still connected
    if (this.trigger === "hover" && this.isConnected) {
      const shouldOpen = event.type === "mouseenter";
      // Only update if state actually changes (prevent unnecessary transitions)
      if (this.open !== shouldOpen) {
        this.open = shouldOpen;
      }
    }
  }

  needsReverse() {
    // Called after 'await showWithTransition()' - animation already finished
    // Layout is stable, no rAF needed
    if (!this.contentElement || this.contentElement.clientWidth === 0) {
      return;
    }

    // Batch all layout reads first
    const clientWidth = this.contentElement.clientWidth;
    const offsetLeft = this.contentElement.offsetLeft;
    const windowWidth = window.innerWidth;

    // Calculate
    const totalWidth = offsetLeft + clientWidth * 2;

    // Then write
    if (totalWidth > windowWidth) {
      this.contentElement.classList.add("needs-reverse");
    } else {
      // Remove class if no longer needed (handle window resize)
      this.contentElement.classList.remove("needs-reverse");
    }
  }
}
customElements.define("details-dropdown", DetailsDropdown, { extends: "details" });
lockDropdownCount.set(DetailsDropdown, 0);

const lockMegaCount = new WeakMap();
let megaMenuZIndexCounter = 1;

/**
 * @component details-mega
 * @capability Full-width mega-menu variant of details-dropdown — slides the panel down/up with a translateY transition, stacks z-index so a newly opened menu covers a closing one, ref-counts the "mega-menu-open"/"mega-menu-closing" body classes, and auto-opens on theme-editor block select.
 * @when Header mega menus: multi-column promo panels spanning the page width under the header nav. For a small anchored dropdown use details-dropdown instead.
 * @contract <details is="details-mega" [trigger="hover"]> with first child <summary> and last child the full-width panel (same contract as details-dropdown); animation targets the panel's child element; body state via mega-menu-open / mega-menu-closing classes and --mega-menu-close-delay.
 * @keywords mega menu, megamenu, full width dropdown, header menu panel, multi-column menu, nav panel, slide down menu
 */
class DetailsMega extends DetailsDropdown {
  // Timer to prevent closing the menu when a nested block is selected
  #shopifyBlockSelectTimer = null;

  constructor() {
    super();

    if (Shopify.designMode) {
      this.addEventListener("shopify:block:select", () => {
        if (this.open) {
          clearTimeout(this.#shopifyBlockSelectTimer);
          this.#shopifyBlockSelectTimer = null;
          return;
        }

        this.open = true;
      });

      this.addEventListener("shopify:block:deselect", () => {
        clearTimeout(this.#shopifyBlockSelectTimer);
        this.#shopifyBlockSelectTimer = setTimeout(() => {
          this.open = false;
        }, 100);
      });
    }
  }

  get additionalBodyClass() {
    return "mega-menu-open";
  }

  #incrementMegaCount() {
    lockMegaCount.set(DetailsMega, (lockMegaCount.get(DetailsMega) || 0) + 1);
  }

  #decrementMegaCount() {
    const count = Math.max((lockMegaCount.get(DetailsMega) || 0) - 1, 0);
    lockMegaCount.set(DetailsMega, count);
    return count;
  }

  async showWithTransition() {
    this.#incrementMegaCount();
    document.body.classList.remove("mega-menu-closing");
    document.body.classList.add(this.additionalBodyClass);

    // Set higher z-index for opening menu to ensure it appears above closing ones
    megaMenuZIndexCounter += 1;
    this.contentElement.style.zIndex = megaMenuZIndexCounter.toString();

    const reducedMotion = prefersReducedMotion();
    return animate(
      this.childEl,
      { visibility: "visible", transform: ["translateY(-100%)", "translateY(0)"] },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.7, 0, 0.2, 1] }
    ).finished;
  }

  async hideWithTransition() {
    const reducedMotion = prefersReducedMotion();
    const animationDuration = reducedMotion ? 0 : 0.6;

    document.documentElement.style.setProperty("--mega-menu-close-delay", reducedMotion ? "0s" : "0.6s");

    // CSS variables apply immediately, single rAF is sufficient for class addition
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        document.body.classList.add("mega-menu-closing");
        resolve();
      });
    });

    // Set lower z-index immediately so opening menu appears above
    this.contentElement.style.zIndex = "0";

    // Decrement count and only remove class if no other mega menus are open
    this.#decrementMegaCount();

    // Use helper with callback to check count (prevents race condition)
    removeScrollLockClass(document.body, this.additionalBodyClass, () => {
      // Only remove if no other mega menus are open
      return lockMegaCount.get(DetailsMega) === 0;
    });

    const animation = animate(
      this.childEl,
      { visibility: "hidden", transform: "translateY(-100%)" },
      { duration: animationDuration, easing: [0.7, 0, 0.2, 1] }
    );
    await animation.finished;
    // Remove closing class after animation completes
    document.body.classList.remove("mega-menu-closing");
  }
}
customElements.define("details-mega", DetailsMega, { extends: "details" });
lockMegaCount.set(DetailsMega, 0);
