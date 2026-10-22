import { Component } from "@theme/component";
import { getFocusableElements, throttle, isMobileBreakpoint, mediaQueryMobile } from "@theme/utilities";
import { Swiper, Navigation, Pagination, Mousewheel, Autoplay, EffectFade, A11y } from "@theme/swiper";
import { setupCounter } from "@theme/carousel-features/counter";
import {
  setupNavigationPosition,
  performNavigationPositionCalculation,
  teardownNavigationPosition,
} from "@theme/carousel-features/navigation-position";
import { setupThumbnails, destroyThumbnailSwiper } from "@theme/carousel-features/thumbnails";

/** Breakpoint (px) for mobile/desktop — loop/disable logic uses viewport width strictly below this value (≤767px). */
export const MOBILE_DESKTOP_BREAKPOINT = 768;

/**
 * Swiper listens (capture) to every image `load` inside the slider and, whenever
 * `slidesPerView: "auto"` or `autoHeight` is on, answers EACH one with a full
 * `update()`: every slide re-measured under a forced layout. Images that finish
 * together arrive as one burst of load events in a single task, so a product
 * gallery with 150+ media spent 2.4–3.2 s in ONE task (trace: 322 load events →
 * 640 layouts; mobile Lighthouse TBT 3.5–5 s on the same page that scores 0 ms
 * when the burst happens to land outside the trace). Nothing in that burst needs
 * more than one re-measure, so fold the burst into at most one update per frame —
 * the cadence Swiper already uses for resize. Reassigning `swiper.onLoad` keeps
 * Swiper's own `detachEvents()` (destroy) removing the right listener.
 * @param {Swiper | null | undefined} swiper
 */
function coalesceImageLoadUpdates(swiper) {
  if (!swiper?.el || typeof swiper.onLoad !== "function") return;
  const originalOnLoad = swiper.onLoad;
  swiper.el.removeEventListener("load", originalOnLoad, { capture: true });

  // Read the target NOW: once dispatch has finished the browser clears
  // event.target for a load that was retargeted out of a shadow tree, and
  // Swiper's handler dereferences it (`e.target.closest(…)`).
  let rafId = 0;
  let lastTarget = null;
  swiper.onLoad = (event) => {
    lastTarget = event.target;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const target = lastTarget;
      lastTarget = null;
      if (swiper.destroyed || !target) return;
      originalOnLoad({ target });
    });
  };
  swiper.el.addEventListener("load", swiper.onLoad, { capture: true });
}

/**
 * @component carousel-slider
 * @capability THE declarative carousel/slider element sections use — boots a Swiper instance from JSON config, wires navigation arrows, pagination, counter, thumbnails, autoplay with progress, auto-height, breakpoint destroy/recreate (destroyBelow/destroyAbove), accessibility, and theme-editor + morph (updatedCallback) survival.
 * @when Any sliding/scrolling gallery of slides: product carousels, image sliders, testimonial sliders, logo rows with arrows. Reuse this element + config JSON — never instantiate the raw Swiper library in a section. Extend it (like flex-carousel, carousel-centered-slider) for variant behaviour. Pairs with src/scss/global/_component-carousel.scss.
 * @contract <carousel-slider> with required ref="container" (.swiper root with .swiper-wrapper > .swiper-slide children); options via data-options attribute or <script ref="config" type="application/json">; optional refs pagination, next, prev, counter, controls, thumbnails; data-section-id for editor events. Exports CarouselComponent + MOBILE_DESKTOP_BREAKPOINT via @theme/carousel.
 * @keywords carousel, slider, slideshow, swiper, slides, gallery, autoplay, navigation arrows, pagination dots, thumbnails, loop, per-view, breakpoints, testimonial slider, product slider
 */
export class CarouselComponent extends Component {
  /** @type {Swiper | null} */
  swiperInstance = null;
  /** @type {string} */
  counterFormat = "{current} / {total}";
  /** @type {Record<string, any> | null} */
  lastResolvedOptions = null;

  /**
   * Enforce a container ref for Swiper root.
   * @type {string[]}
   */
  requiredRefs = ["container"];
  /** @type {number | null} */
  autoplayDelay = null;
  /** @type {(() => void) | null} */
  resizeCleanup = null;
  /** @type {boolean} */
  #isRecreating = false;
  /** @type {Swiper | null} */
  thumbnailSwiper = null;
  /** @type {NodeListOf<HTMLElement> | null} */
  thumbnailItems = null;
  /** @type {boolean} */
  thumbnailsEnabled = false;
  /** @type {IntersectionObserver | null} */
  #accessibilityObserver = null;
  /** @type {boolean} */
  #accessibilitySetup = false;
  /** @type {boolean} */
  #isDestroyed = false;
  /** @type {string | null} */
  #currentBreakpoint = null;
  /** @type {Record<string, Function | null>} */
  #swiperEventListeners = {
    breakpoint: null,
    slideChange: null,
    slidesUpdated: null,
    slideChangeTransitionEnd: null,
    slideChangeTransitionStart: null,
    autoplayTimeLeft: null,
    resize: null,
  };
  /** @type {number | null} */
  #autoHeightUpdateTimeout = null;
  /** @type {number | null} */
  #lastAutoHeightActiveIndex = null;
  /** @type {number | null} */
  #autoHeightUpdateRafId = null;
  /** @type {boolean} */
  #isUpdatingAutoHeight = false;
  /** @type {boolean} */
  #isHandlingResize = false;
  /** @type {boolean} */
  #isHandlingBreakpointAutoHeight = false;

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  static get observedAttributes() {
    return ["data-options"];
  }

  connectedCallback() {
    super.connectedCallback();
    this.#isDestroyed = false;
    this.#accessibilitySetup = false;
    if (this.swiperInstance) {
      this.#destroySwiper();
    }

    // Tied to the element lifecycle (not Swiper's) so it survives every destroy/recreate.
    this.#setupDesignModeEvents();

    requestAnimationFrame(() => {
      this.#initSwiper();
    });
  }

  updatedCallback() {
    super.updatedCallback();
    requestAnimationFrame(() => {
      if (!this.refs?.container) return;
      if (this.swiperInstance && !this.swiperInstance.destroyed) {
        // Don't clean styles — preserve template inline styles (CSS custom properties)
        // that were restored by morph. The new Swiper instance will overwrite its own styles.
        this.#destroySwiper(true, false);
      }
      this.#initSwiper();
    });
  }

  disconnectedCallback() {
    this.#isDestroyed = true;
    this.thumbnailsEnabled = false;

    this.#cleanupSwiperEventListeners();

    if (this.#autoHeightUpdateTimeout) {
      clearTimeout(this.#autoHeightUpdateTimeout);
      this.#autoHeightUpdateTimeout = null;
    }
    if (this.#autoHeightUpdateRafId) {
      cancelAnimationFrame(this.#autoHeightUpdateRafId);
      this.#autoHeightUpdateRafId = null;
    }
    this.#lastAutoHeightActiveIndex = null;

    this.#destroySwiper();

    if (this.resizeCleanup) {
      this.resizeCleanup();
      this.resizeCleanup = null;
    }

    if (this.#accessibilityObserver) {
      this.#accessibilityObserver.disconnect();
      this.#accessibilityObserver = null;
    }
    this.#accessibilitySetup = false;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
  }

  attributeChangedCallback(name, _oldValue, _newValue) {
    if (name === "data-options") {
      this.#destroySwiper();
      requestAnimationFrame(() => {
        this.#initSwiper();
      });
    }
  }

  #initSwiper() {
    if (this.swiperInstance) return;

    const container = /** @type {HTMLElement | undefined} */ (this.refs.container);
    if (!container) return;

    this.#currentBreakpoint = isMobileBreakpoint() ? "mobile" : "desktop";

    const rawOptions = this.#resolveOptions();
    const optionsWithElements = this.#resolveElementSelectors(rawOptions);
    const finalOptions = this.#resolveModules(optionsWithElements);
    this.finalOptions = finalOptions;

    this.#setupResizeHandler(finalOptions);

    const shouldDestroy = this.#shouldDestroyForViewport(finalOptions);

    if (shouldDestroy) {
      this.#destroySwiper();
      this.#setControlsHidden(true, finalOptions);
      return;
    }

    this.#setControlsHidden(false, finalOptions);
    this.#createSwiper(finalOptions).catch((error) => {
      if (!this.#isDestroyed) {
        console.error("CarouselComponent: failed to create Swiper", error);
      }
    });
  }

  get slideClass() {
    return this.finalOptions?.slideClass || "swiper-slide";
  }

  /** Properties that Swiper adds to slides — remove these, keep the rest (template styles). */
  static #SWIPER_SLIDE_PROPERTIES = new Set([
    "width",
    "height",
    "margin",
    "margin-left",
    "margin-right",
    "margin-top",
    "margin-bottom",
    "margin-inline-start",
    "margin-inline-end",
    "margin-block-start",
    "margin-block-end",
    "transform",
    "-webkit-transform",
    "-ms-transform",
  ]);

  /**
   * Remove only Swiper-added properties from style string; preserve template styles
   * (CSS vars, -webkit-mask-image, overflow, etc.).
   */
  #extractTemplateStyles(styleAttr) {
    if (!styleAttr || typeof styleAttr !== "string") return "";
    return styleAttr
      .split(";")
      .map((decl) => decl.trim())
      .filter((decl) => {
        const colonIndex = decl.indexOf(":");
        if (colonIndex <= 0) return false;
        const prop = decl.slice(0, colonIndex).trim().toLowerCase();
        return !CarouselComponent.#SWIPER_SLIDE_PROPERTIES.has(prop);
      })
      .join("; ")
      .trim();
  }

  #destroySwiper(keepOptions = false, cleanStyles = true, preserveTemplateStyles = false) {
    this.#cleanupSwiperEventListeners();

    const hadInstance = !!this.swiperInstance;
    if (this.swiperInstance) {
      const slideElements =
        cleanStyles && preserveTemplateStyles && this.swiperInstance.slides?.length
          ? Array.from(this.swiperInstance.slides)
          : [];
      const savedSlideStyles = slideElements.map((slide) => this.#extractTemplateStyles(slide.getAttribute("style")));

      // Clear inline height set by autoHeight so grid layout can flow naturally
      const wrapper = this.swiperInstance.wrapperEl;
      if (wrapper) {
        wrapper.style.height = "";
        wrapper.closest(".swiper")?.classList.remove("swiper-autoheight");
      }
      try {
        this.swiperInstance.destroy(true, cleanStyles);
      } catch (_e) {
        // Ignore
      }

      slideElements.forEach((slide, i) => {
        if (savedSlideStyles[i]) {
          slide.setAttribute("style", savedSlideStyles[i]);
        }
      });

      this.swiperInstance = null;
    }
    destroyThumbnailSwiper(this);
    teardownNavigationPosition(this);
    this.lastResolvedOptions = null;
    if (!keepOptions) {
      this.finalOptions = null;
    }

    // The counterpart of `carousel:ready`. Destroying an instance silently leaves anything
    // a subscriber derived from it — edge-fade state classes, most notably — frozen at the
    // last value Swiper wrote, so every destroy path (breakpoint teardown via destroyBelow/
    // destroyAbove, morph, data-options change) announces itself here, the one funnel they
    // all share. Only when an instance actually existed: the method also runs as a
    // defensive no-op on elements that never initialised.
    if (hadInstance) {
      this.dispatchEvent(new CustomEvent("carousel:destroyed", { bubbles: true }));
    }
  }

  async #createSwiper(finalOptions) {
    const container = /** @type {HTMLElement | undefined} */ (this.refs.container);
    if (!container) return;

    const slides = container.querySelectorAll(`.${this.slideClass}`);
    if (slides.length === 0) {
      this.#setControlsHidden(true, finalOptions);
      return;
    }

    const swiperOptions = {
      ...finalOptions,
      preloadImages: false,
      lazy: false,
      // On by default: it is what populates `visibleSlidesIndexes`, which the
      // focus handler above and `product-bundle.js` both read to decide whether
      // a slide needs scrolling into view. With it off those reads see an empty
      // array and silently fall back to "any non-active slide". The only CSS
      // keyed to the classes it adds is Swiper's own `.swiper-slide-visible
      // .swiper-lazy-preloader`, and `lazy` is forced false above — so enabling
      // it changes no rendering.
      watchSlidesProgress: finalOptions.watchSlidesProgress ?? true,
      watchSlidesVisibility: finalOptions.watchSlidesVisibility ?? false,
      // The slide-change entrance below (replayWithin on slideChangeTransitionStart)
      // waits up to 1s for the incoming slide's media, and every slide after the
      // first ships `loading="lazy"` (image-priority by index) — so on a cold
      // cache the visitor watched the incoming image sit at its start state
      // (a zoom-out hero at scale 1.15) while it loaded, on every autoplay tick.
      // Swiper's own preload lifts `loading="lazy"` off the neighbouring slides'
      // images ahead of time, so the wait is over before the slide arrives.
      lazyPreloadPrevNext: finalOptions.lazyPreloadPrevNext ?? 1,
    };

    try {
      this.swiperInstance = new Swiper(container, swiperOptions);
      coalesceImageLoadUpdates(this.swiperInstance);

      if (this.#isDestroyed) {
        this.swiperInstance.destroy();
        return;
      }

      this.lastResolvedOptions = swiperOptions;
      setupCounter(this, swiperOptions);

      if (swiperOptions.thumbnails?.enabled) {
        this.thumbnailsEnabled = true;
        setupThumbnails(this, swiperOptions.thumbnails);
        coalesceImageLoadUpdates(this.thumbnailSwiper);
      }

      setupNavigationPosition(this, swiperOptions);
      this.#checkSlidesPerView(swiperOptions);
      this.#setupSwiperEventListeners(swiperOptions);
      this.#setupAccessibilityLazy();

      this.dispatchEvent(
        new CustomEvent("carousel:ready", {
          bubbles: false,
          detail: { swiperInstance: this.swiperInstance },
        })
      );
    } catch (error) {
      console.error("CarouselComponent: failed to initialize Swiper", error);
    }
  }

  /**
   * Sets up lazy initialization of accessibility features when carousel enters viewport.
   * This optimizes performance by deferring accessibility setup until needed.
   */
  #setupAccessibilityLazy() {
    if (this.#accessibilitySetup) return;

    // Check if IntersectionObserver is available
    if (!("IntersectionObserver" in window)) {
      // Fallback: setup immediately if IntersectionObserver is not available
      this.#setupAccessibility();
      return;
    }

    // Always use IntersectionObserver to avoid getBoundingClientRect() forced reflow.
    // The observer fires in the next frame if the element is already in viewport.
    const { container } = this.refs;
    this.#accessibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.#accessibilitySetup) {
            this.#setupAccessibility();
            if (this.#accessibilityObserver) {
              this.#accessibilityObserver.disconnect();
              this.#accessibilityObserver = null;
            }
          }
        });
      },
      {
        // Start setup slightly before entering viewport for better UX
        rootMargin: "50px",
        threshold: 0.01,
      }
    );

    this.#accessibilityObserver.observe(container);
  }

  /**
   * Sets up accessibility features for keyboard navigation.
   * When a focusable element receives focus, the carousel scrolls to the slide containing that element.
   */
  #setupAccessibility() {
    if (this.#accessibilitySetup) return;
    this.#accessibilitySetup = true;

    const { container } = this.refs;
    const focusableEls = getFocusableElements(container);
    focusableEls &&
      focusableEls.forEach((el) => {
        el.addEventListener("focusin", () => {
          if (!el.matches(":focus-visible")) return;

          const slide = el.closest(`.${this.slideClass}`);
          if (!slide || !this.swiperInstance) return;

          const index = this.swiperInstance.slides.indexOf(slide);
          if (index === -1) return;

          // Only scroll when the slide is actually off-screen. Comparing against
          // activeIndex alone jumps the carousel every time focus lands on an
          // already-visible slide — with slidesPerView > 1, tabbing through the
          // second slide's own controls yanked the strip sideways on each stop.
          // visibleSlidesIndexes needs watchSlidesProgress (defaulted on below);
          // fall back to the activeIndex test if a caller has turned it off.
          const visible = this.swiperInstance.visibleSlidesIndexes;
          const isVisible =
            Array.isArray(visible) && visible.length
              ? visible.includes(index)
              : index === this.swiperInstance.activeIndex;

          if (!isVisible) {
            this.goToSlide(index, 0, false);
          }
        });
      });
  }

  #parseOptions() {
    const attr = this.getAttribute("data-options");
    if (attr) {
      try {
        return JSON.parse(attr);
      } catch (_e) {
        console.error("CarouselComponent: invalid JSON in data-options");
      }
    }

    const script = this.querySelector('script[ref="config"][type="application/json"]');
    if (script && script.textContent) {
      try {
        return JSON.parse(script.textContent);
      } catch (_e) {
        console.error('CarouselComponent: invalid JSON in <script ref="config"> content');
      }
    }

    return {};
  }

  /**
   * The config as Swiper should receive it: parsed, breakpoints cascaded, `slidesPerGroup`
   * resolved. Every site that builds a Swiper from the config goes through here, so none of
   * them can hand Swiper a raw breakpoint or a literal `"view"`.
   *
   * @returns {Record<string, any>}
   */
  #resolveOptions() {
    return this.#resolveSlidesPerGroup(this.#cascadeBreakpoints(this.#parseOptions()));
  }

  /**
   * Makes breakpoints mobile-first: each numeric breakpoint carries every key set by the smaller
   * ones, overridden by its own.
   *
   * Swiper does not cascade them. `setBreakpoint` merges ONLY the matched breakpoint onto the
   * CURRENT params, so a key set at 768 and not repeated at 1024 reaches 1024 only when the window
   * was resized up through 768. Loaded straight at 1024 or wider, it keeps the base value instead:
   * a desktop `spaceBetween` declared once at 768 rendered with the mobile gap (product tabs,
   * product recommendations). Cascading here makes a breakpoint read the way a media query does,
   * whichever way the viewport got there.
   *
   * Plain objects (`grid`, `pagination`…) are merged key by key, as Swiper's own `extend` does;
   * anything else is replaced. Below the smallest breakpoint Swiper restores the base params
   * itself. Non-numeric keys (Swiper's `"@1.5"` ratio form) are left as they are.
   *
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  #cascadeBreakpoints(options) {
    const breakpoints = options.breakpoints && typeof options.breakpoints === "object" ? options.breakpoints : null;
    if (!breakpoints) return options;

    const isPlainObject = (value) => Object.prototype.toString.call(value) === "[object Object]";
    const merge = (target, source) => {
      const result = { ...target };
      for (const [key, value] of Object.entries(source)) {
        result[key] = isPlainObject(value) && isPlainObject(result[key]) ? merge(result[key], value) : value;
      }
      return result;
    };

    const widths = Object.keys(breakpoints)
      .filter((width) => Number.isFinite(Number(width)))
      .sort((a, b) => Number(a) - Number(b));

    const cascaded = { ...breakpoints };
    let inherited = {};
    for (const width of widths) {
      inherited = merge(inherited, isPlainObject(breakpoints[width]) ? breakpoints[width] : {});
      cascaded[width] = inherited;
    }
    return { ...options, breakpoints: cascaded };
  }

  /**
   * Resolves `slidesPerGroup` — how far one arrow click (or wheel step) moves — for the base config
   * and every breakpoint. Accepts `"view"` (a full page: as many whole slides as are visible) or a
   * number, at the base and/or on any breakpoint.
   *
   * - Mobile-first: a breakpoint without its own value inherits the nearest smaller one (or the
   *   base), the same way its `slidesPerView` does.
   * - A number is capped at the visible count. Moving further than the visible count skips slides
   *   the visitor never sees, and `slideTo(i)` (keyboard focus, editor block select) can then land
   *   on a page that does not contain slide `i`.
   * - The result is written into EVERY breakpoint. Swiper merges a breakpoint onto the CURRENT
   *   params, not the base, so a breakpoint without `slidesPerGroup` keeps whatever the previous
   *   one set — which depends on the direction the window was resized in.
   *
   * A fractional per-view (a peeking card) counts whole slides. `slidesPerView: "auto"` (slides
   * sized by their content) has no fixed count: `"view"` there becomes Swiper's own
   * `slidesPerGroupAuto`, which advances by the slides fully visible at click time, and a number
   * falls back to 1 — no count is safe when any one slide may be wider than the rest. Both keys are
   * written everywhere, so neither can leak from one breakpoint into the next.
   *
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  #resolveSlidesPerGroup(options) {
    const breakpoints = options.breakpoints && typeof options.breakpoints === "object" ? options.breakpoints : {};
    const requested = (config) => config?.slidesPerGroup;
    if (requested(options) === undefined && !Object.values(breakpoints).some((c) => requested(c) !== undefined)) {
      return options;
    }

    /**
     * @param {unknown} value - "view", a number, or a numeric string
     * @param {unknown} perView
     * @returns {{ slidesPerGroup: number, slidesPerGroupAuto: boolean }}
     */
    const groupFor = (value, perView) => {
      if (perView === "auto") return { slidesPerGroup: 1, slidesPerGroupAuto: value === "view" };
      const visible = typeof perView === "number" ? Math.max(1, Math.floor(perView)) : 1;
      if (value === "view") return { slidesPerGroup: visible, slidesPerGroupAuto: false };
      const count = Math.floor(Number(value));
      return {
        slidesPerGroup: Number.isFinite(count) ? Math.min(Math.max(count, 1), visible) : 1,
        slidesPerGroupAuto: false,
      };
    };

    let perView = options.slidesPerView ?? 1;
    let value = requested(options) ?? 1;
    const resolved = { ...options, ...groupFor(value, perView) };

    const widths = Object.keys(breakpoints)
      .filter((width) => Number.isFinite(Number(width)))
      .sort((a, b) => Number(a) - Number(b));
    if (widths.length) {
      resolved.breakpoints = { ...breakpoints };
      for (const width of widths) {
        const config = breakpoints[width] ?? {};
        perView = config.slidesPerView ?? perView;
        value = requested(config) ?? value;
        resolved.breakpoints[width] = { ...config, ...groupFor(value, perView) };
      }
    }
    return resolved;
  }

  #resolveModules(options) {
    const MODULE_MAP = {
      Navigation,
      Pagination,
      Mousewheel,
      Autoplay,
      EffectFade,
      A11y,
    };
    let moduleNames = Array.isArray(options.modules) ? options.modules : [];

    if (moduleNames.length === 0) {
      if (options.navigation) moduleNames.push("Navigation");
      if (options.pagination) moduleNames.push("Pagination");
      if (options.mousewheel) moduleNames.push("Mousewheel");
      if (options.autoplay) moduleNames.push("Autoplay");
      if (options.effect === "fade" || options.fadeEffect) moduleNames.push("EffectFade");
    }
    const modules = [];
    for (const name of moduleNames) {
      const mod = MODULE_MAP[name];
      if (mod && !modules.includes(mod)) modules.push(mod);
    }
    // A11y is not optional kit: without it Swiper renders pagination bullets as
    // mouse-only <span>s and leaves off-screen slides in the tab order — a Theme
    // Store keyboard-accessibility failure. Always shipped, whatever the config.
    if (!modules.includes(A11y)) modules.push(A11y);
    return { ...options, modules };
  }

  #resolveElementSelectors(options) {
    const resolved = { ...options };

    const resolve = (selectorOrEl) => {
      if (typeof selectorOrEl !== "string") return selectorOrEl;
      try {
        return this.querySelector(selectorOrEl);
      } catch (_e) {
        return selectorOrEl;
      }
    };

    const byRef = (name) => {
      const isMobile = isMobileBreakpoint();
      const targetBreakpoint = isMobile ? "mobile" : "desktop";
      const targetContainer = this.querySelector(`[data-controls-breakpoint="${targetBreakpoint}"]`);

      if (targetContainer) {
        const computedStyle = window.getComputedStyle(targetContainer);
        if (computedStyle.display !== "none" && computedStyle.visibility !== "hidden") {
          const el = targetContainer.querySelector(`[data-ref="${name}"]`);
          if (el) {
            el.setAttribute("ref", name);
            return /** @type {HTMLElement} */ (el);
          }
        }
      }

      const fallbackEl = this.querySelector(`[ref="${name}"]`);
      if (fallbackEl) {
        const parentContainer = fallbackEl.closest("[data-controls-breakpoint]");
        if (parentContainer) {
          const computedStyle = window.getComputedStyle(parentContainer);
          if (computedStyle.display === "none" || computedStyle.visibility === "hidden") {
            return null;
          }
        }
      }
      return /** @type {HTMLElement | null} */ (fallbackEl);
    };

    const paginationRef = byRef("pagination");
    if (resolved.pagination === true) {
      resolved.pagination = {};
    }
    if (!resolved.pagination && paginationRef) {
      resolved.pagination = { el: paginationRef, clickable: true };
    } else if (resolved.pagination && typeof resolved.pagination === "object") {
      const el = resolved.pagination.el ?? paginationRef;
      resolved.pagination = { clickable: true, ...resolved.pagination, el: resolve(el) };
    }

    if (resolved.navigation === true) {
      resolved.navigation = {};
    }
    if (resolved.navigation && typeof resolved.navigation === "object") {
      const next = resolved.navigation.nextEl ?? byRef("next");
      const prev = resolved.navigation.prevEl ?? byRef("prev");
      resolved.navigation = {
        ...resolved.navigation,
        nextEl: resolve(next),
        prevEl: resolve(prev),
      };
    } else {
      const next = byRef("next");
      const prev = byRef("prev");
      if (next || prev) {
        resolved.navigation = {
          nextEl: next ?? undefined,
          prevEl: prev ?? undefined,
        };
      }
    }

    if (resolved.scrollbar && typeof resolved.scrollbar === "object") {
      const el = resolved.scrollbar.el ?? byRef("scrollbar");
      resolved.scrollbar = { ...resolved.scrollbar, el: resolve(el) };
    }

    const counterRef = byRef("counter");
    const hasCounterOption = Object.prototype.hasOwnProperty.call(options, "counter");
    if (resolved.counter === true) {
      resolved.counter = {};
    }
    if (typeof resolved.counter === "string") {
      resolved.counter = { format: resolved.counter };
    }
    if (!hasCounterOption && counterRef) {
      resolved.counter = { el: counterRef, format: this.counterFormat };
    } else if (resolved.counter && typeof resolved.counter === "object") {
      const el = resolved.counter.el ?? counterRef;
      resolved.counter = {
        ...resolved.counter,
        el: resolve(el),
        format: typeof resolved.counter.format === "string" ? resolved.counter.format : this.counterFormat,
      };
    }

    if (resolved.navigationPosition && typeof resolved.navigationPosition === "object") {
      resolved.navigationPosition = {
        ...resolved.navigationPosition,
        enabled: resolved.navigationPosition.enabled !== false,
      };
    }

    return resolved;
  }

  #shouldDestroyForViewport(options) {
    const w = window.innerWidth || 0;
    const below = Number(options.destroyBelow);
    const above = Number(options.destroyAbove);
    const isMobile = isMobileBreakpoint();

    const useMediaQuery = (val) => val === MOBILE_DESKTOP_BREAKPOINT;
    const shouldDestroyBelow = !Number.isNaN(below) && (useMediaQuery(below) ? isMobile : w < below);
    const shouldDestroyAbove = !Number.isNaN(above) && (useMediaQuery(above) ? !isMobile : w >= above);
    return shouldDestroyBelow || shouldDestroyAbove;
  }

  #setControlsHidden(hidden, options) {
    const toggle = (el) => {
      if (!(el instanceof HTMLElement)) return;
      el.classList.toggle("hidden-control", hidden);
    };

    const hasResponsiveControls = this.querySelector("[data-controls-breakpoint]");

    if (!hasResponsiveControls) {
      const controlsEl = this.querySelector('[ref="controls"]');
      if (controlsEl instanceof HTMLElement) {
        controlsEl.classList.toggle("hidden", hidden);
      }

      const controlsWrapper = this.querySelector("[data-carousel-controls]");
      if (controlsWrapper instanceof HTMLElement) {
        controlsWrapper.classList.toggle("hidden-control", hidden);
      }
    }

    // Pagination
    const pagEl = options?.pagination?.el || this.querySelector('[ref="pagination"]');
    if (options && Object.prototype.hasOwnProperty.call(options, "pagination")) {
      toggle(pagEl);
    }

    // Navigation
    const nextEl = options?.navigation?.nextEl || this.querySelector('[ref="next"]');
    const prevEl = options?.navigation?.prevEl || this.querySelector('[ref="prev"]');
    if (options && Object.prototype.hasOwnProperty.call(options, "navigation")) {
      toggle(nextEl);
      toggle(prevEl);
    }

    const counterEl = this.querySelector('[ref="counter"]');
    if (options && Object.prototype.hasOwnProperty.call(options, "counter")) {
      const shouldHide = hidden || !options.counter;
      if (counterEl instanceof HTMLElement) {
        counterEl.classList.toggle("hidden", shouldHide);
      }
    }

    // Thumbnails
    const thumbnailContainer = this.querySelector('[ref="thumbnails"]');
    if (thumbnailContainer && options?.thumbnails?.enabled) {
      thumbnailContainer.classList.toggle("hidden", hidden);
    }
  }

  #getCurrentSlidesPerView(options) {
    const windowWidth = window.innerWidth;

    if (options.breakpoints && typeof options.breakpoints === "object") {
      const matchingBreakpoint = this.#findMatchingBreakpoint(Object.keys(options.breakpoints), windowWidth);

      if (matchingBreakpoint !== null) {
        const breakpointConfig = options.breakpoints[matchingBreakpoint];
        const perView = breakpointConfig.slidesPerView;

        if (typeof perView === "number") {
          return perView;
        } else if (perView === "auto") {
          return this.swiperInstance?.params?.slidesPerView || 1;
        }
      }
    }

    const basePerView = options.slidesPerView;
    if (typeof basePerView === "number") {
      return basePerView;
    } else if (basePerView === "auto") {
      return this.swiperInstance?.params?.slidesPerView || 1;
    }

    return 1;
  }

  #findMatchingBreakpoint(breakpointKeys, windowWidth) {
    const availableBreakpoints = breakpointKeys
      .filter((key) => !isNaN(Number(key)))
      .map((key) => Number(key))
      .sort((a, b) => a - b);

    let matchingBreakpoint = null;
    for (const bp of availableBreakpoints) {
      if (windowWidth >= bp) {
        matchingBreakpoint = bp;
      } else {
        break;
      }
    }
    return matchingBreakpoint;
  }

  #checkSlidesPerView(options) {
    if (!this.swiperInstance) return;

    const slides = this.querySelectorAll(`.${this.slideClass}`);
    if (slides.length === 0) return;

    const controlsEl = this.querySelector('[ref="controls"]');
    if (!controlsEl) return;

    let minSlidesNeeded = this.swiperInstance.params?.slidesPerView;

    if (typeof minSlidesNeeded !== "number") {
      minSlidesNeeded = this.#getCurrentSlidesPerView(options);
    }
    minSlidesNeeded = typeof minSlidesNeeded === "number" ? minSlidesNeeded : parseFloat(minSlidesNeeded) || 1;

    const shouldShowControls = slides.length > minSlidesNeeded;

    if (shouldShowControls) {
      controlsEl.classList.remove("hidden-control");
    } else {
      controlsEl.classList.add("hidden-control");
    }
  }

  /**
   * Setup Swiper event listeners for breakpoint, autoHeight, and custom pagination
   * @param {Record<string, any>} options
   */
  #setupSwiperEventListeners(options) {
    this.#cleanupSwiperEventListeners();
    if (!this.swiperInstance) return;

    // breakpoint fires SYNCHRONOUSLY during Swiper's onResize() BEFORE slidesUpdated
    this.#swiperEventListeners.breakpoint = () => {
      if (this.#isRecreating || this.#isHandlingResize) return;

      this.#checkSlidesPerView(options);

      if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.wrapperEl &&
        !this.swiperInstance.params?.autoHeight
      ) {
        if (this.#autoHeightUpdateTimeout) {
          clearTimeout(this.#autoHeightUpdateTimeout);
          this.#autoHeightUpdateTimeout = null;
        }
        if (this.#autoHeightUpdateRafId) {
          cancelAnimationFrame(this.#autoHeightUpdateRafId);
          this.#autoHeightUpdateRafId = null;
        }
        this.#isUpdatingAutoHeight = false;
        this.#isHandlingBreakpointAutoHeight = false;

        requestAnimationFrame(() => {
          if (this.swiperInstance && !this.#isDestroyed && !this.swiperInstance.params?.autoHeight) {
            this.swiperInstance.wrapperEl.style.height = "";
            this.swiperInstance.el.classList.remove("swiper-autoheight");
          }
        });
      } else if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.params?.autoHeight &&
        !this.#isUpdatingAutoHeight &&
        !this.#isHandlingBreakpointAutoHeight
      ) {
        this.#isHandlingBreakpointAutoHeight = true;
        this.#lastAutoHeightActiveIndex = null;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (
              this.swiperInstance &&
              !this.#isDestroyed &&
              this.swiperInstance.params?.autoHeight &&
              !this.#isUpdatingAutoHeight
            ) {
              this.#debouncedUpdateAutoHeight();
            }
            this.#isHandlingBreakpointAutoHeight = false;
          });
        });
      }
    };
    this.swiperInstance.on("breakpoint", this.#swiperEventListeners.breakpoint);

    // slidesUpdated fires AFTER breakpoint during Swiper's onResize()
    this.#swiperEventListeners.slidesUpdated = () => {
      if (this.#isRecreating || this.#isHandlingResize) return;

      if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.params?.autoHeight &&
        !this.swiperInstance.animating &&
        !this.#isUpdatingAutoHeight &&
        !this.#isHandlingBreakpointAutoHeight
      ) {
        this.#lastAutoHeightActiveIndex = null;
        this.#debouncedUpdateAutoHeight();
      } else if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        !this.swiperInstance.params?.autoHeight &&
        this.swiperInstance.wrapperEl
      ) {
        requestAnimationFrame(() => {
          if (this.swiperInstance && !this.#isDestroyed && !this.swiperInstance.params?.autoHeight) {
            this.swiperInstance.wrapperEl.style.height = "";
            this.swiperInstance.el.classList.remove("swiper-autoheight");
          }
        });
      }
    };
    this.swiperInstance.on("slidesUpdated", this.#swiperEventListeners.slidesUpdated);

    this.#swiperEventListeners.slideChangeTransitionEnd = () => {
      if (
        this.swiperInstance &&
        !this.#isDestroyed &&
        this.swiperInstance.params?.autoHeight &&
        !this.#isUpdatingAutoHeight
      ) {
        const currentActiveIndex = this.swiperInstance.activeIndex;
        if (this.#lastAutoHeightActiveIndex !== currentActiveIndex) {
          this.#lastAutoHeightActiveIndex = currentActiveIndex;
          this.#debouncedUpdateAutoHeight();
        }
      }

      if (options?.navigationPosition?.enabled && !this.#isDestroyed) {
        performNavigationPositionCalculation(this, options);
      }

      if (!this.#isDestroyed) {
        this.dispatchEvent(new CustomEvent("carousel:slidechangeend", { bubbles: true }));
      }
    };
    this.swiperInstance.on("slideChangeTransitionEnd", this.#swiperEventListeners.slideChangeTransitionEnd);

    // Entrances inside slides are driven from here, not by in-view.
    //
    // IntersectionObserver reports GEOMETRY. A carousel using `effect: fade`
    // stacks every slide in the same box and hides the inactive ones with
    // opacity — which the observer cannot see. Measured on the slideshow: every
    // slide's fade-up ran at page load, at 97/197/297ms, while its slide was
    // invisible; by the time the visitor advanced, the entrance had long since
    // played to nobody. `loop` made it look intermittent rather than broken,
    // because relocating a slide's node in the DOM reconnects the components
    // inside it and they animate again at an unpredictable moment.
    //
    // The carousel is the only thing that knows which slide is actually being
    // looked at, so it says when. replayWithin() ends with the content visible
    // on every path, so a missed event can delay an entrance but never strand
    // one.
    // The key has to BE the event name: #cleanupSwiperEventListeners() calls
    // swiper.off(key, handler), so a descriptive key would never be removed.
    this.#swiperEventListeners.slideChangeTransitionStart = () => {
      if (this.#isDestroyed || !this.swiperInstance) return;
      // Autoplay's progress var snaps back to full here too. It used to be a
      // SECOND handler registered under this same key further down, which broke
      // cleanup: #cleanupSwiperEventListeners() removes by key, so the later
      // assignment overwrote the stored reference to THIS handler and only the
      // autoplay one was ever removed. The entrance handler then survived every
      // destroy and a re-init added another copy, so one slide change replayed
      // the entrance once per init the carousel had lived through.
      if (this.swiperInstance.params?.autoplay) {
        this.style.setProperty("--autoplay-progress", "0");
      }
      const slide = this.swiperInstance.slides?.[this.swiperInstance.activeIndex];
      const previous = this.swiperInstance.slides?.[this.swiperInstance.previousIndex];
      if (slide) this.swapSlideMotion(previous, slide);
    };
    this.swiperInstance.on("slideChangeTransitionStart", this.#swiperEventListeners.slideChangeTransitionStart);

    if (options?.navigationPosition?.enabled) {
      this.#swiperEventListeners.resize = () => {
        if (!this.#isDestroyed) {
          requestAnimationFrame(() => {
            if (!this.#isDestroyed) performNavigationPositionCalculation(this, options);
          });
        }
      };
      this.swiperInstance.on("resize", this.#swiperEventListeners.resize);
    }

    if (this.swiperInstance.params?.autoplay) {
      this.#swiperEventListeners.autoplayTimeLeft = (_swiper, _timeLeft, progress) => {
        this.style.setProperty("--autoplay-progress", String(progress));
      };
      this.swiperInstance.on("autoplayTimeLeft", this.#swiperEventListeners.autoplayTimeLeft);
    }
  }

  /**
   * Cleanup Swiper event listeners
   */
  #cleanupSwiperEventListeners() {
    if (!this.swiperInstance) return;

    Object.entries(this.#swiperEventListeners).forEach(([event, handler]) => {
      if (handler) {
        this.swiperInstance.off(event, handler);
        this.#swiperEventListeners[event] = null;
      }
    });
  }

  #debouncedUpdateAutoHeight() {
    if (this.#isUpdatingAutoHeight) return;

    if (this.#autoHeightUpdateTimeout) {
      clearTimeout(this.#autoHeightUpdateTimeout);
      this.#autoHeightUpdateTimeout = null;
    }
    if (this.#autoHeightUpdateRafId) {
      cancelAnimationFrame(this.#autoHeightUpdateRafId);
      this.#autoHeightUpdateRafId = null;
    }

    this.#autoHeightUpdateTimeout = setTimeout(() => {
      this.#autoHeightUpdateRafId = requestAnimationFrame(() => {
        if (this.swiperInstance && !this.#isDestroyed && this.swiperInstance.params?.autoHeight) {
          this.#isUpdatingAutoHeight = true;
          try {
            this.swiperInstance.updateAutoHeight();
          } finally {
            this.#isUpdatingAutoHeight = false;
          }
        }
        this.#autoHeightUpdateTimeout = null;
        this.#autoHeightUpdateRafId = null;
      });
    }, 16);
  }

  #setupResizeHandler(options) {
    if (this.resizeCleanup) {
      this.resizeCleanup();
      this.resizeCleanup = null;
    }

    this.#currentBreakpoint = isMobileBreakpoint() ? "mobile" : "desktop";

    const runViewportCheck = async () => {
      if (this.#isDestroyed) return;
      if (this.#isHandlingResize) return;
      this.#isHandlingResize = true;

      try {
        const freshRawOptions = this.#resolveOptions();
        const freshOptionsWithElements = this.#resolveElementSelectors(freshRawOptions);
        const freshFinalOptions = this.#resolveModules(freshOptionsWithElements);

        const shouldDestroy = this.#shouldDestroyForViewport(freshFinalOptions);
        const isActive = !!this.swiperInstance;

        if (shouldDestroy && isActive) {
          this.#destroySwiper(false, true, true); // Remove Swiper styles, restore template styles
          this.#setControlsHidden(true, freshFinalOptions);
          return;
        }

        if (!shouldDestroy && !isActive) {
          this.finalOptions = freshFinalOptions;
          this.#setControlsHidden(false, freshFinalOptions);

          if (!this.#isRecreating) {
            this.#isRecreating = true;
            try {
              await this.#createSwiper(freshFinalOptions).catch((error) => {
                if (!this.#isDestroyed) {
                  console.error("CarouselComponent: failed to recreate Swiper", error);
                }
              });
            } finally {
              this.#isRecreating = false;
            }
          }
          return;
        }

        const newBreakpoint = isMobileBreakpoint() ? "mobile" : "desktop";
        const breakpointChanged = this.#currentBreakpoint !== newBreakpoint;

        if (breakpointChanged) {
          this.#currentBreakpoint = newBreakpoint;
          const hasResponsiveControls = this.querySelector("[data-controls-breakpoint]");

          if (hasResponsiveControls && this.swiperInstance && !this.#isRecreating) {
            this.#isRecreating = true;

            try {
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              this.#destroySwiper(true, true, true); // Remove Swiper styles, restore template styles
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

              if (!this.finalOptions) {
                this.#isRecreating = false;
                return;
              }

              const optionsWithElements = this.#resolveElementSelectors(this.#resolveOptions());
              const finalOptions = this.#resolveModules(optionsWithElements);
              this.finalOptions = finalOptions;
              await this.#createSwiper(finalOptions);
            } finally {
              this.#isRecreating = false;
            }
          }
        }

        if (this.swiperInstance && !this.#isRecreating) {
          this.#checkSlidesPerView(freshFinalOptions);
        }
      } finally {
        this.#isHandlingResize = false;
      }
    };

    const handleResize = throttle(runViewportCheck, 150);
    window.addEventListener("resize", handleResize);

    const hasMobileDesktopBreakpoint =
      Number(options?.destroyAbove) === MOBILE_DESKTOP_BREAKPOINT ||
      Number(options?.destroyBelow) === MOBILE_DESKTOP_BREAKPOINT;
    const handleMediaQueryChange = () => {
      if (!this.#isDestroyed) runViewportCheck();
    };
    if (hasMobileDesktopBreakpoint) {
      mediaQueryMobile.addEventListener("change", handleMediaQueryChange);
    }

    this.resizeCleanup = () => {
      window.removeEventListener("resize", handleResize);
      handleResize.cancel?.();
      if (hasMobileDesktopBreakpoint) {
        mediaQueryMobile.removeEventListener("change", handleMediaQueryChange);
      }
    };
  }

  get sectionId() {
    return this.getAttribute("data-section-id");
  }

  /**
   * Syncs the carousel to the block selected in the Theme Editor. Registered on the element
   * (via connectedCallback), so it survives Swiper destroy/recreate and catches the
   * `shopify:block:select` that Shopify re-fires right after a section re-render.
   */
  #setupDesignModeEvents() {
    if (!Shopify.designMode || !this.sectionId) return;
    if (!this.#parseOptions().shopifyBlocks) return;

    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (event) => {
        if (event.detail.sectionId != this.sectionId) return;

        const slideEl = event.target.closest(`.${this.slideClass}`);
        if (!slideEl) return;

        // Resolve the index at navigation-time: by then Swiper has set data-swiper-slide-index on loop slides.
        const goToSelectedSlide = () => {
          const isLoop = ["true", true].includes(this.swiperInstance?.params?.loop);
          const index = isLoop
            ? Number(slideEl.dataset.swiperSlideIndex)
            : Array.from(slideEl.parentElement?.children ?? []).indexOf(slideEl);
          if (Number.isNaN(index) || index < 0) return;
          this.goToSlide(index, 0);
        };

        // On re-render, block:select can fire before Swiper is recreated — defer to carousel:ready then.
        if (this.swiperInstance && !this.swiperInstance.destroyed) {
          goToSelectedSlide();
        } else {
          this.addEventListener("carousel:ready", goToSelectedSlide, { once: true, signal });
        }
      },
      { signal }
    );
  }

  /**
   * The motion half of a slide change: the incoming slide's entrances replay,
   * and — only where one slide is shown at a time — the outgoing slide's
   * word-by-word text leaves first. With several slides in view the previous
   * active slide is usually still on screen (next, then previous, in a 3-up
   * row), and an exit there would leave its text at opacity 0 until that slide
   * became the active one again. A subclass that has already played the
   * outgoing slide's exit before the change (the slideshow runs its swaps in
   * sequence) overrides this to skip that half.
   *
   * @param {HTMLElement | undefined} previous
   * @param {HTMLElement} slide
   */
  swapSlideMotion(previous, slide) {
    const motion = window.FoxTheme?.motion;
    const params = this.swiperInstance?.params;
    const oneAtATime = params?.effect === "fade" || Number(params?.slidesPerView) === 1;
    if (oneAtATime && previous && previous !== slide && motion?.swapWithin) motion.swapWithin(previous, slide);
    else motion?.replayWithin?.(slide);
  }

  /**
   * Navigates to a specific slide.
   * @param {number} index - The slide index to navigate to
   * @param {number} [speed] - Transition speed in ms. If not provided, uses Swiper's default speed
   * @param {boolean} [runCallbacks] - Whether to run transition callbacks. Defaults to true
   */
  goToSlide(index, speed, runCallbacks = true) {
    if (!this.swiperInstance || this.swiperInstance.destroyed) return;

    // Pause autoplay if running to prevent conflicts and delays
    if (this.swiperInstance.autoplay?.running) {
      this.swiperInstance.autoplay.pause();
    }

    if (this.lastResolvedOptions?.loop) {
      this.swiperInstance.slideToLoop(index, speed, runCallbacks);
    } else {
      this.swiperInstance.slideTo(index, speed, runCallbacks);
    }
  }
}

if (!customElements.get("carousel-slider")) {
  customElements.define("carousel-slider", CarouselComponent);
}

export { CarouselComponent as default };
