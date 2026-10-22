import {
  ResizeNotifier,
  mediaBreakpointMobile,
  mediaBreakpointSmallTablet,
  mediaBreakpointTablet,
} from "@theme/utilities";

/**
 * @capability Horizontal or vertical scroll-row driver — toggles is--active/is--beginning/is--end from scroll position and auto-scrolls the newly active child into view when its aria-selected/aria-current flips.
 * @when Any row/column that can overflow: tab bars, filter pills, chip rows, vertical trigger stacks. Pair with .edge__shadows for the edge fade. Never hand-roll overflow-x/overflow-y for these.
 * @contract <div is="swipe-component"> wrapping .swipe__element (scroll box) > .swipe__inner (the row); active child carries aria-selected or aria-current. Axis defaults to horizontal; set data-axis="y" (+ optional data-axis-mobile/data-axis-small-tablet/data-axis-tablet overrides) on .swipe__element for vertical scroll.
 * @keywords scroll row, overflow tabs, filter pills, chip row, edge fade, scroll into view, swipe, horizontal scroll, vertical scroll, axis
 */
class SwipeComponent extends HTMLDivElement {
  /** @type {AbortController | null} */
  #abortController = null;
  #resizer = null;
  #mutationObserver = null;
  #previousActiveElement = null;
  #isActive = false;
  #axis = "x";

  constructor() {
    super();

    this.swipeEl = null;
    this.swipeInner = null;

    this.scrollHandler = this.updateScrollClasses.bind(this);
    this.classes = {
      active: "is--active",
      begin: "is--beginning",
      end: "is--end",
    };
  }

  connectedCallback() {
    this.swipeEl = this.querySelector(".swipe__element");
    if (!this.swipeEl) return;

    this.swipeInner = this.swipeEl.querySelector(".swipe__inner");

    this.#abortController = new AbortController();

    this.init();

    this.swipeEl.addEventListener("scroll", this.scrollHandler, {
      passive: true,
      signal: this.#abortController.signal,
    });
    if (this.swipeEl.offsetParent !== null) {
      this.updateScrollClasses();
    }

    this.#resizer = new ResizeNotifier(() => {
      // Check if element is visible and measurable
      this.swipeEl.offsetParent !== null && this.updateScrollClasses();
    });
    this.#resizer.observe(this.swipeEl);

    if (this.#isActive) {
      this.#startObservingActiveChanges();
    }

    // Theme editor: selecting a block that sits scrolled out of view inside the row left its
    // highlight off-screen — the editor scrolls the page, never the row. `shopify:block:select`
    // is a Shopify platform event (a hardcoded string, as in carousel.js / maps.js), not a
    // ThemeEvents constant.
    if (/** @type {any} */ (window).Shopify?.designMode) {
      this.addEventListener("shopify:block:select", this.#handleBlockSelect, {
        signal: this.#abortController.signal,
      });
    }
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = null;
    this.#resizer?.disconnect();
    this.#resizer = null;
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = null;
  }

  #startObservingActiveChanges() {
    if (!this.swipeInner || this.#mutationObserver) return;

    const observedAttributes = ["aria-current", "aria-selected"];

    this.#mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Handle attribute changes on direct children
        if (mutation.type === "attributes") {
          const target = /** @type {HTMLElement} */ (mutation.target);
          const attributeName = mutation.attributeName;

          if (observedAttributes.includes(attributeName) && target.getAttribute(attributeName) === "true") {
            this.#scrollToActiveElement(target);
          }
        }

        // Handle new children being added
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.#mutationObserver.observe(node, {
                attributes: true,
                attributeFilter: observedAttributes,
              });
            }
          }
        }
      }
    });

    // Observe .swipe__inner for child list changes and observe all existing direct children
    this.#mutationObserver.observe(this.swipeInner, {
      childList: true,
    });

    // Observe all existing direct children for aria-current and aria-selected changes
    const children = Array.from(this.swipeInner.children);
    for (const child of children) {
      this.#mutationObserver.observe(child, {
        attributes: true,
        attributeFilter: observedAttributes,
      });
    }
  }

  #stopObservingActiveChanges() {
    if (this.#mutationObserver) {
      this.#mutationObserver.disconnect();
      this.#mutationObserver = null;
    }
  }

  /**
   * Scrolls the row just enough to bring the selected block — or the row item that contains
   * it — fully into view. Only while this row is the one scrolling (`#isActive`); a block in a
   * nested component, or one already in view, is left alone.
   * @param {Event} event
   */
  #handleBlockSelect = (event) => {
    const target = event.target;
    if (!this.#isActive || !this.swipeEl || !this.swipeInner) return;
    if (!(target instanceof Element) || !this.swipeInner.contains(target)) return;

    const item = Array.from(this.swipeInner.children).find((child) => child.contains(target)) ?? target;
    const isVertical = this.#axis === "y";
    const itemRect = item.getBoundingClientRect();
    const boxRect = this.swipeEl.getBoundingClientRect();
    const itemStart = isVertical ? itemRect.top : itemRect.left;
    const itemEnd = isVertical ? itemRect.bottom : itemRect.right;
    const boxStart = isVertical ? boxRect.top : boxRect.left;
    const boxEnd = isVertical ? boxRect.bottom : boxRect.right;

    let delta = 0;
    if (itemStart < boxStart) delta = itemStart - boxStart;
    else if (itemEnd > boxEnd) delta = itemEnd - boxEnd;
    if (delta === 0) return;

    this.swipeEl.scrollBy({
      [isVertical ? "top" : "left"]: delta,
      behavior: "smooth",
    });
  };

  #scrollToActiveElement(activeElement) {
    if (!this.swipeEl || !activeElement || !this.swipeInner) return;

    // Skip if the same element is already active (prevents duplicate scrolls)
    if (this.#previousActiveElement === activeElement) return;

    const isVertical = this.#axis === "y";
    const scrollRect = activeElement.getBoundingClientRect();
    const boxRect = this.swipeEl.getBoundingClientRect();
    const scrollStart = isVertical ? this.swipeEl.scrollTop : this.swipeEl.scrollLeft;
    const containerGap = 16;

    // Determine scroll direction by comparing indices
    const children = Array.from(this.swipeInner.children);
    const currentIndex = children.indexOf(activeElement);
    const previousIndex = this.#previousActiveElement ? children.indexOf(this.#previousActiveElement) : -1;

    let scrollOffset;

    if (isVertical) {
      // If scrolling down
      if (previousIndex < currentIndex) {
        scrollOffset = scrollRect.y + scrollStart - boxRect.y - containerGap;
      } else {
        // Scrolling up
        scrollOffset = scrollRect.y + scrollStart - boxRect.y - boxRect.height + scrollRect.height + containerGap;
      }
    } else {
      // If scrolling right
      if (previousIndex < currentIndex) {
        scrollOffset = scrollRect.x + scrollStart - boxRect.x - containerGap;
      } else {
        // Scrolling left
        scrollOffset = scrollRect.x + scrollStart - boxRect.x - boxRect.width + scrollRect.width + containerGap;
      }
    }

    this.#previousActiveElement = activeElement;

    this.swipeEl.scrollTo({
      [isVertical ? "top" : "left"]: scrollOffset,
      behavior: "smooth",
    });
  }

  init() {
    this.#setupAxis();

    if (this.swipeEl.classList.contains("swipe-all")) {
      this.setActive(true);
      return;
    }

    const setupResponsive = (className, mediaQuery) => {
      if (!this.swipeEl.classList.contains(className)) return;
      const mql = window.matchMedia(mediaQuery);
      const update = () => this.setActive(mql.matches);
      update();
      mql.addEventListener("change", update, { signal: this.#abortController.signal });
    };

    setupResponsive("swipe-mobile", mediaBreakpointMobile);
    setupResponsive("swipe-tablet", mediaBreakpointTablet);
  }

  /**
   * Resolves the scroll axis from data-axis (+ optional data-axis-mobile /
   * data-axis-small-tablet / data-axis-tablet overrides) on .swipe__element,
   * and keeps it in sync across breakpoint changes. Only wires up matchMedia
   * listeners when at least one axis attribute is present, so the ~15
   * existing horizontal-only usages pay no extra cost.
   */
  #setupAxis() {
    const dataset = this.swipeEl.dataset;
    if (!dataset.axis && !dataset.axisMobile && !dataset.axisSmallTablet && !dataset.axisTablet) return;

    const resolveOwnAxis = (value, fallback) => (value === "y" || value === "x" ? value : fallback);

    // Cascades from the largest breakpoint down: each one falls back to the
    // next larger breakpoint's RESOLVED axis, not straight to data-axis. So
    // data-axis="y" + data-axis-tablet="x" alone (no small-tablet/mobile
    // override) leaves small-tablet AND mobile on "x" too (inherited via
    // tablet), matching a mobile-first override model. Setting a breakpoint
    // explicitly stops the cascade there for anything smaller than it.
    const defaultAxis = resolveOwnAxis(dataset.axis, "x");
    const tabletAxis = resolveOwnAxis(dataset.axisTablet, defaultAxis);
    const smallTabletAxis = resolveOwnAxis(dataset.axisSmallTablet, tabletAxis);
    const mobileAxis = resolveOwnAxis(dataset.axisMobile, smallTabletAxis);

    const mqlMobile = window.matchMedia(mediaBreakpointMobile);
    const mqlSmallTablet = window.matchMedia(mediaBreakpointSmallTablet);
    const mqlTablet = window.matchMedia(mediaBreakpointTablet);

    const resolveAxis = () => {
      if (mqlMobile.matches) return mobileAxis;
      if (mqlSmallTablet.matches) return smallTabletAxis;
      if (mqlTablet.matches) return tabletAxis;
      return defaultAxis;
    };

    const applyAxis = () => {
      const axis = resolveAxis();
      if (axis === this.#axis) return;

      this.#axis = axis;
      this.classList.toggle("is--axis-y", axis === "y");
      this.swipeEl.classList.toggle("is--axis-y", axis === "y");

      if (this.swipeEl.offsetParent !== null) this.updateScrollClasses();
    };

    applyAxis();

    const { signal } = this.#abortController;
    mqlMobile.addEventListener("change", applyAxis, { signal });
    mqlSmallTablet.addEventListener("change", applyAxis, { signal });
    mqlTablet.addEventListener("change", applyAxis, { signal });
  }

  setActive(isActive = true) {
    this.#isActive = isActive;
    this.classList.toggle(this.classes.active, isActive);

    if (isActive) {
      this.#startObservingActiveChanges();
    } else {
      this.#stopObservingActiveChanges();
    }
  }

  updateScrollClasses() {
    const isVertical = this.#axis === "y";
    const scrollStart = isVertical ? this.swipeEl.scrollTop : this.swipeEl.scrollLeft;
    const clientSize = isVertical ? this.swipeEl.clientHeight : this.swipeEl.clientWidth;
    const scrollSize = isVertical ? this.swipeEl.scrollHeight : this.swipeEl.scrollWidth;

    const atStart = scrollStart <= 0;
    const atEnd = Math.ceil(scrollStart + clientSize) >= scrollSize;

    if (this._wasAtStart !== atStart) {
      this._wasAtStart = atStart;
      this.classList.toggle(this.classes.begin, atStart);
    }
    if (this._wasAtEnd !== atEnd) {
      this._wasAtEnd = atEnd;
      this.classList.toggle(this.classes.end, atEnd);
    }
  }
}

customElements.define("swipe-component", SwipeComponent, { extends: "div" });
