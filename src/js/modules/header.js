import { Component } from "@theme/component";
import { acquireThemeScrollLock, releaseThemeScrollLock } from "@theme/dialog";
import { ResizeNotifier, getLenis } from "@theme/utilities";

class BasicHeader extends HTMLElement {
  #resizeNotifier = null;
  #shopifyAbortController = null;

  constructor() {
    super();
  }

  get headerSection() {
    return this.closest(".shopify-section");
  }

  connectedCallback() {
    this.#init();

    this.#resizeNotifier = new ResizeNotifier(this.#setHeight.bind(this));
    this.#resizeNotifier.observe(this);

    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
    this.#resizeNotifier?.disconnect();
    this.#resizeNotifier = null;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = null;
  }

  #handleShopifySectionEvent = () => {
    this.#init();
  };

  #registerDesignModeEvents() {
    if (!Shopify.designMode) return;

    const section = this.headerSection;
    if (!section) return;

    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    ["load", "unload", "reorder"].forEach((eventName) => {
      section.addEventListener(`shopify:section:${eventName}`, this.#handleShopifySectionEvent, { signal });
    });
  }

  #init() {
    this.#setHeight();
  }

  #setHeight() {
    // Defer ALL layout reads to next frame to avoid force reflow on page load
    requestAnimationFrame(() => {
      if (!this.isConnected) return;

      // Batch reads and writes together in the same frame
      const offsetHeight = Math.round(this.offsetHeight);
      document.documentElement.style.setProperty("--header-height", `${offsetHeight}px`);
    });
  }
}
customElements.define("basic-header", BasicHeader, { extends: "header" });

class StickyHeader extends BasicHeader {
  // Private fields for cleanup
  #boundHandleScroll = null;
  #resizeObserver = null;

  constructor() {
    super();

    this.classes = {
      pinned: "header-pinned",
      headerScrolled: "header-scrolled",
      headerSticky: "header-sticky",
    };

    this.currentScrollTop = 0;
    this.scrollThreshold = 200;
    this.scrollDirection = "none";
    this.scrollDistance = 0;
    this.lenis = null; // Lenis instance for smooth scrolling
    this.hasScrolledPastThreshold = false; // Track if user has scrolled past threshold
    this._isPinned = false;
    this._isScrolled = false;
  }

  get isAlwaysSticky() {
    return this.dataset.stickyType === "always";
  }

  connectedCallback() {
    super.connectedCallback();

    this.#cacheInitialHeaderPosition();
    this.#initStickyHeader();
    this.#checkInitialScrollState();

    // Re-cache header position on resize (header height might change)
    if (!this.#resizeObserver) {
      this.#resizeObserver = new ResizeObserver(() => {
        this.#cacheInitialHeaderPosition();
      });
      this.#resizeObserver.observe(this.headerSection);
    }
  }

  disconnectedCallback() {
    if (this.#boundHandleScroll) {
      if (this.lenis) {
        // Remove Lenis scroll listener
        this.lenis.off("scroll", this.#boundHandleScroll);
      } else {
        // Remove native scroll listener
        window.removeEventListener("scroll", this.#boundHandleScroll);
      }
      this.#boundHandleScroll = null;
    }

    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }

    super.disconnectedCallback?.();
  }

  #cacheInitialHeaderPosition() {
    // Defer layout measurements to next frame to avoid force reflow on page load
    requestAnimationFrame(() => {
      if (!this.isConnected) return;

      // Use layout offsets (offsetTop/offsetHeight) instead of getBoundingClientRect().top.
      // rect.top is viewport-relative: when the page is loaded already scrolled down, the sticky
      // header is pinned at top:0 so rect.top ≈ 0 while scrollY is large, which corrupts
      // initialHeaderTop/stickThreshold. offsetTop is unaffected by the sticky "stuck" state and
      // by scroll, so measurement stays correct regardless of the load scroll position.
      let naturalTop = 0;
      for (let el = this.headerSection; el; el = el.offsetParent) {
        naturalTop += el.offsetTop;
      }

      this.initialHeaderTop = naturalTop;
      this.initialHeaderHeight = this.offsetHeight;

      // Calculate scroll threshold: if header has offset from top (e.g., top: 3rem),
      // stick when scroll reaches that offset. Otherwise, stick when scroll passes header bottom.
      // Only trust the rendered rect while we're at the very top of the page; once scrolled, the
      // sticky/absolute shift makes rect.top unreliable, so fall back to the header bottom.
      const scrollY = this.lenis ? this.lenis.scroll : window.scrollY;
      const headerOffsetFromTop = scrollY <= 0 ? this.getBoundingClientRect().top : 0;

      if (headerOffsetFromTop > 0) {
        this.stickThreshold = headerOffsetFromTop;
      } else {
        this.stickThreshold = this.initialHeaderTop + this.initialHeaderHeight;
      }

      // Ensure stickThreshold is valid
      if (this.stickThreshold <= 0 || !this.initialHeaderHeight) {
        this.stickThreshold = Math.max(this.initialHeaderHeight || 0, 1);
      }
    });
  }

  #initStickyHeader() {
    this.headerSection.classList.add(this.classes.headerSticky);
    this.headerSection.dataset.stickyType = this.dataset.stickyType;
    this.#boundHandleScroll = this.#handleScroll.bind(this);

    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    if (this.lenis) {
      // Listen to Lenis scroll events (shared instance with other sections)
      this.lenis.on("scroll", this.#boundHandleScroll);
    } else {
      // Fallback to native scroll if Lenis not available yet
      window.addEventListener("scroll", this.#boundHandleScroll, { passive: true });
    }
  }

  #checkInitialScrollState() {
    requestAnimationFrame(() => {
      const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;

      if (!this.stickThreshold || this.stickThreshold <= 0) {
        this.#cacheInitialHeaderPosition();
      }

      const shouldStick = scrollTop >= this.stickThreshold;

      if (shouldStick) {
        this.hasScrolledPastThreshold = true;
        if (!this._isScrolled) {
          this._isScrolled = true;
          this.headerSection.classList.add(this.classes.headerScrolled);
        }
        if (!this._isPinned) {
          this._isPinned = true;
          document.body.classList.add(this.classes.pinned);
        }
      } else {
        this.hasScrolledPastThreshold = false;
        if (this._isScrolled) {
          this._isScrolled = false;
          this.headerSection.classList.remove(this.classes.headerScrolled);
        }
        if (this._isPinned) {
          this._isPinned = false;
          document.body.classList.remove(this.classes.pinned);
        }
      }

      this.currentScrollTop = scrollTop;
    });
  }

  #handleScroll() {
    if (!this.lenis) {
      const retryLenis = getLenis();
      if (retryLenis) {
        this.lenis = retryLenis;
        window.removeEventListener("scroll", this.#boundHandleScroll);
        this.lenis.on("scroll", this.#boundHandleScroll);
      }
    }

    const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;

    if (!this.stickThreshold || this.stickThreshold <= 0) {
      this.#cacheInitialHeaderPosition();
    }

    const shouldStick = scrollTop >= this.stickThreshold;
    const headerBoundsBottom = this.initialHeaderTop + (this.initialHeaderHeight || 0);

    this.#updateScrollMetrics(scrollTop);

    if (shouldStick) {
      this.#handleScrolledPastHeader(scrollTop, headerBoundsBottom);
    } else if (this.isAlwaysSticky && this.hasScrolledPastThreshold) {
      if (scrollTop < 1) {
        this.#handleScrolledBeforeHeader();
      }
    } else {
      this.#handleScrolledBeforeHeader();
    }

    this.currentScrollTop = scrollTop;
  }

  #updateScrollMetrics(scrollTop) {
    const newDirection = scrollTop > this.currentScrollTop ? "down" : "up";

    if (newDirection !== this.scrollDirection) {
      this.scrollDistance = 0;
      this.scrollDirection = newDirection;
    } else {
      this.scrollDistance += Math.abs(scrollTop - this.currentScrollTop);
    }
  }

  #handleScrolledPastHeader(scrollTop, headerBoundsBottom) {
    this.hasScrolledPastThreshold = true;

    if (!this._isScrolled) {
      this._isScrolled = true;
      this.headerSection.classList.add(this.classes.headerScrolled);
    }

    if (this.isAlwaysSticky) {
      if (!this._isPinned) {
        this._isPinned = true;
        document.body.classList.add(this.classes.pinned);
      }
    } else {
      const isScrollingUp = this.scrollDirection === "up";
      const isNearHeader = scrollTop < headerBoundsBottom + 100;
      const hasScrolledEnough = this.scrollDistance >= this.scrollThreshold;

      if (isScrollingUp || isNearHeader) {
        if (!this._isPinned) {
          this._isPinned = true;
          document.body.classList.add(this.classes.pinned);
        }
      } else if (hasScrolledEnough) {
        if (this._isPinned) {
          this._isPinned = false;
          document.body.classList.remove(this.classes.pinned);
        }
      }
    }
  }

  #handleScrolledBeforeHeader() {
    if (this.isAlwaysSticky && this.hasScrolledPastThreshold) {
      const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;
      if (scrollTop < 1) {
        this.hasScrolledPastThreshold = false;
        if (this._isScrolled) {
          this._isScrolled = false;
          this.headerSection.classList.remove(this.classes.headerScrolled);
        }
        if (this._isPinned) {
          this._isPinned = false;
          document.body.classList.remove(this.classes.pinned);
        }
      }
    } else {
      this.hasScrolledPastThreshold = false;
      if (this._isScrolled) {
        this._isScrolled = false;
        this.headerSection.classList.remove(this.classes.headerScrolled);
      }
      if (this._isPinned) {
        this._isPinned = false;
        document.body.classList.remove(this.classes.pinned);
      }
    }
  }
}
customElements.define("sticky-header", StickyHeader, { extends: "header" });

/**
 * Wraps `shopify-account` and injects account shadow styles from the Liquid template ref.
 *
 * @extends Component
 */
class HeaderAccount extends Component {
  requiredRefs = ["account"];

  /** @type {MutationObserver | null} */
  #shadowTreeObserver = null;

  /** @type {Map<HTMLDialogElement, { observer: MutationObserver; state: { countedOpen: boolean } }>} */
  #dialogBindings = new Map();

  connectedCallback() {
    super.connectedCallback();
    void this.#init();
  }

  disconnectedCallback() {
    this.#teardownShopifyAccountScrollLock();
    super.disconnectedCallback();
  }

  /**
   * Forwards a click on the header's "Account" label (Show icon labels) to the control
   * Shopify renders in the open shadow root — the label sits outside `<shopify-account>`, so
   * the signed-in avatar does not replace it.
   */
  openAccount() {
    const { account } = this.refs;
    const control = account?.shadowRoot?.querySelector("button");
    (control ?? account)?.click();
  }

  async #init() {
    const { account } = this.refs;

    if (!(account instanceof HTMLElement)) return;

    const shadow = await this.#waitForShadow(account);
    if (!shadow) return;

    this.#injectAccountShadowStyles(shadow);
    this.#setupShopifyAccountScrollLock(shadow);
  }

  /**
   * @param {HTMLElement} account
   * @returns {Promise<ShadowRoot | null>}
   */
  async #waitForShadow(account) {
    const maxAttempts = 40;
    for (let i = 0; i < maxAttempts; i++) {
      const root = account.shadowRoot;
      if (root) return root;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return account.shadowRoot;
  }

  /**
   * @returns {string}
   */
  #getAccountShadowStylesText() {
    const { accountShadowStyles: template } = this.refs;
    if (!(template instanceof HTMLTemplateElement)) return "";

    const source = template.content.querySelector("style");
    return source?.textContent?.trim() ?? "";
  }

  /**
   * @param {ShadowRoot} shadow
   */
  #injectAccountShadowStyles(shadow) {
    if (shadow.querySelector("#custom-account-styles")) return;

    const css = this.#getAccountShadowStylesText();
    if (!css) return;

    const style = document.createElement("style");
    style.id = "custom-account-styles";
    style.textContent = css;

    shadow.prepend(style);
  }

  /**
   * @param {ShadowRoot} shadow
   */
  #setupShopifyAccountScrollLock(shadow) {
    this.#teardownShopifyAccountScrollLock();

    const scanDialogs = () => {
      shadow.querySelectorAll("dialog").forEach((el) => {
        if (el instanceof HTMLDialogElement) this.#bindAccountDialog(el);
      });
    };

    scanDialogs();

    this.#shadowTreeObserver = new MutationObserver(scanDialogs);
    this.#shadowTreeObserver.observe(shadow, { childList: true, subtree: true });
  }

  /**
   * @param {HTMLDialogElement} dialog
   */
  #bindAccountDialog(dialog) {
    if (this.#dialogBindings.has(dialog)) return;

    const state = { countedOpen: false };

    const sync = () => {
      const isOpen = dialog.open;
      if (isOpen === state.countedOpen) return;
      if (isOpen) {
        acquireThemeScrollLock();
      } else {
        releaseThemeScrollLock();
      }
      state.countedOpen = isOpen;
    };

    if (dialog.open) {
      acquireThemeScrollLock();
      state.countedOpen = true;
    }

    const observer = new MutationObserver(sync);
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });

    this.#dialogBindings.set(dialog, { observer, state });
  }

  #teardownShopifyAccountScrollLock() {
    this.#shadowTreeObserver?.disconnect();
    this.#shadowTreeObserver = null;

    for (const [, entry] of this.#dialogBindings) {
      entry.observer.disconnect();
      if (entry.state.countedOpen) {
        releaseThemeScrollLock();
      }
    }
    this.#dialogBindings.clear();
  }
}
customElements.define("header-account", HeaderAccount);
