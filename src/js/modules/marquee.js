import { Component } from "@theme/component";
import { prefersReducedMotion, isTouch, debounce, isRTL } from "@theme/utilities";
import { animate, scroll } from "@theme/animation";

/**
 * @component marquee-component
 * @capability Infinite horizontally scrolling marquee — lazily initializes near the viewport, clones the first item enough times to fill the width, sets a width-proportional animation duration, pauses offscreen, supports rotated strips and an optional scroll-linked parallax drift; disabled under prefers-reduced-motion.
 * @when Scrolling text ticker/announcement strips, logo walls, repeated promo phrases — any continuously looping horizontal band.
 * @contract <marquee-component> with required ref="inner" wrapping ONE item element (it gets cloned; class "animate" starts the CSS animation); optional attributes data-duration (s), data-direction="forward|backward", data-parallax (ratio), modifier class marquee--rotated; emits --block-height/--offset custom properties.
 * @keywords marquee, ticker, scrolling text, infinite scroll strip, logo wall, running line, auto-scroll banner, loop animation, parallax strip
 */
class MarqueeComponent extends Component {
  requiredRefs = ["inner"];

  #resizeObserver;
  #scrollStop = null;
  #inViewStop = null;
  #intersectionObserver = null;
  #initObserver = null;
  #initScheduled = false;
  #initialized = false;
  #previousWidth = 0;
  #previousChildWidth = 0;

  static #PAUSE_OBSERVER_MARGIN = "0px 0px 50px 0px";
  static #INIT_OBSERVER_MARGIN = "300px 0px";
  static #MIN_COPIES = 2;
  static #DURATION_MULTIPLIER = 33;
  static #DURATION_MAX_RATIO = 2.5;
  static #DEFAULT_DURATION = "20s";
  static #DEFAULT_PARALLAX = 0.55;
  static #RESIZE_DEBOUNCE = 200;

  connectedCallback() {
    super.connectedCallback();
    if (prefersReducedMotion()) return;

    this.#scheduleInit();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanup();
  }

  #scheduleInit() {
    if (this.#initScheduled) return;
    this.#initScheduled = true;

    if (typeof IntersectionObserver !== "undefined") {
      this.#initObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry?.isIntersecting) return;
          this.#initObserver?.disconnect();
          this.#initObserver = null;
          this.#init();
        },
        { rootMargin: MarqueeComponent.#INIT_OBSERVER_MARGIN }
      );
      this.#initObserver.observe(this);
    } else if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => this.#init(), { timeout: 1000 });
    } else {
      setTimeout(() => this.#init(), 100);
    }
  }

  #init() {
    if (this.#initialized) return;
    this.#initialized = true;

    const { inner } = this.refs;
    if (!inner) return;

    const item = inner.firstElementChild;
    if (!item) return;

    requestAnimationFrame(() => {
      // Batch all layout reads
      const height = this.offsetHeight;
      const isRotated = this.classList.contains("marquee--rotated");
      const childWidth = this.#getChildWidthSync(inner);
      const parentWidth = this.#getParentWidthSync();

      // Perform non-layout operations
      item.classList.add("animate");

      // Set animation duration with cached values
      this.#setAnimationDurationWithValues(childWidth, parentWidth);

      // Set height and rotate offset with cached values
      this.style.setProperty("--block-height", `${height}px`);
      if (isRotated) {
        this._setRotateOffsetWithHeight(height);
      } else {
        this.style.setProperty("--offset", "0px");
      }

      this.#adjustItemCount(false, childWidth, parentWidth, true);
      this.#previousWidth = parentWidth;
      this.#previousChildWidth = childWidth;

      if (this.parallax) {
        this.#initParallax();
        requestAnimationFrame(() => {
          this.#adjustItemCount();
        });
      } else {
        this.#initPauseObserver();
      }

      this.#setupResizeObserver();
    });
  }

  #getChildWidthSync(inner) {
    const item = inner?.firstElementChild;
    if (!item) return 1;
    const rect = item.getBoundingClientRect();
    return rect.right - rect.left;
  }

  #getParentWidthSync() {
    const rect = this.getBoundingClientRect();
    return rect.right - rect.left;
  }

  #setAnimationDurationWithValues(childWidth, parentWidth) {
    const liquidDuration = this.duration;
    if (liquidDuration && liquidDuration > 0) {
      this.style.setProperty("--duration", `${liquidDuration}s`);
      return;
    }

    if (childWidth > 0 && parentWidth > 0) {
      const ratio = Math.ceil(childWidth / parentWidth);
      const defaultSpeed = 16;
      const duration =
        (MarqueeComponent.#DURATION_MULTIPLIER - defaultSpeed) * Math.min(MarqueeComponent.#DURATION_MAX_RATIO, ratio);
      this.style.setProperty("--duration", `${duration}s`);
    } else {
      this.style.setProperty("--duration", MarqueeComponent.#DEFAULT_DURATION);
    }
  }

  #cleanup() {
    this.#initObserver?.disconnect();
    this.#initObserver = null;
    this.#resizeObserver?.disconnect();
    window.removeEventListener("resize", this.#handleResize);
    this.#intersectionObserver?.disconnect();
    this.#inViewStop?.();
    this.#scrollStop?.();
    this.#intersectionObserver = null;
    this.#inViewStop = null;
    this.#scrollStop = null;
  }

  #setAnimationDuration() {
    const liquidDuration = this.duration;
    if (liquidDuration && liquidDuration > 0) {
      this.style.setProperty("--duration", `${liquidDuration}s`);
      return;
    }

    const { inner } = this.refs;
    const childWidth = this.#getChildWidthSync(inner);
    const parentWidth = this.#getParentWidthSync();

    this.#setAnimationDurationWithValues(childWidth, parentWidth);
  }

  #adjustItemCount(
    resetAll = false,
    measuredChildWidth = null,
    measuredParentWidth = null,
    skipDurationRecalc = false
  ) {
    const { inner } = this.refs;
    if (!inner) return;

    const currentCount = inner.children.length;
    if (currentCount === 0) return;

    const originalItem = inner.firstElementChild;
    if (!originalItem) return;

    if (resetAll && currentCount > 1) {
      while (inner.children.length > 1) {
        inner.lastElementChild?.remove();
      }
    }

    const childWidth =
      typeof measuredChildWidth === "number" && measuredChildWidth > 0
        ? measuredChildWidth
        : this.#getChildWidthSync(inner);
    const parentWidth =
      typeof measuredParentWidth === "number" && measuredParentWidth > 0
        ? measuredParentWidth
        : this.#getParentWidthSync();
    const exactCount = this.#calculateNumberOfCopies(childWidth, parentWidth);
    const finalCount = inner.children.length;

    if (exactCount > finalCount) {
      const numberToAdd = exactCount - finalCount;
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < numberToAdd; i++) {
        const clone = originalItem.cloneNode(true);
        this.#disableFocusableElements(clone);
        clone.setAttribute("aria-hidden", "true");
        clone.classList.add("animate");
        fragment.appendChild(clone);
      }
      inner.appendChild(fragment);

      requestAnimationFrame(() => {
        inner.querySelectorAll("[data-marquee-items]:not(:first-child) .media").forEach((media) => {
          const img = media.querySelector("img.media__image");
          if (img && img.complete && img.naturalWidth > 0) {
            media.classList.remove("loading");
            if (img.classList.contains("loading")) {
              img.classList.remove("loading");
              img.classList.add("loaded");
            }
          }
        });
      });
    } else if (exactCount < finalCount) {
      const itemsToRemove = Math.min(finalCount - exactCount, finalCount - 1);
      this.#removeRepeatedItems(itemsToRemove);
    }

    if (!skipDurationRecalc && !this.hasAttribute("data-duration")) {
      this.#setAnimationDuration();
    }
  }

  #removeRepeatedItems(numberOfCopies) {
    const { inner } = this.refs;
    if (!inner) return;

    for (let i = 0; i < numberOfCopies; i++) {
      inner.lastElementChild?.remove();
    }
  }

  #getFocusableElements(wrapperEl) {
    const focusableSelectors = "a[href], button:enabled, [tabindex]:not([tabindex^='-'])";
    const focusableElements = wrapperEl.querySelectorAll(focusableSelectors);

    return focusableElements;
  }

  #disableFocusableElements(wrapperEl) {
    const focusableElements = this.#getFocusableElements(wrapperEl);

    focusableElements &&
      focusableElements.forEach((el) => {
        el.setAttribute("tabindex", "-1");
      });
  }

  #calculateNumberOfCopies(childWidth = null, parentWidth = null) {
    const { inner } = this.refs;
    const safeChildWidth =
      typeof childWidth === "number" && childWidth > 0 ? childWidth : this.#getChildWidthSync(inner);
    const safeParentWidth =
      typeof parentWidth === "number" && parentWidth > 0 ? parentWidth : this.#getParentWidthSync();

    if (safeChildWidth <= 0 || safeParentWidth <= 0) {
      return MarqueeComponent.#MIN_COPIES;
    }

    const baseCopies = Math.ceil(safeParentWidth / safeChildWidth);

    if (this.parallax) {
      const parallaxValue = this.#parseParallaxValue();
      const parallaxTranslate = Math.abs((parallaxValue * 100) / (1 + parallaxValue));
      const parallaxMultiplier = 1.5;
      const extraCopies = Math.ceil(parallaxTranslate / 10) + 4;
      return Math.ceil(baseCopies * parallaxMultiplier) + extraCopies;
    }

    return baseCopies + 2;
  }

  #initParallax() {
    this.#createParallaxAnimation();
    this.#initParallaxPauseObserver();
  }

  #createParallaxAnimation() {
    const parallaxValue = this.#parseParallaxValue();
    let translate = this.#calculateParallaxTranslate(parallaxValue);

    this.#scrollStop = scroll(
      animate(this.refs.inner, { transform: [`translateX(${translate}%)`, `translateX(0)`] }, { easing: "linear" }),
      {
        target: this,
        offset: ["start end", "end start"],
      }
    );
  }

  #parseParallaxValue() {
    const parallaxAttr = this.getAttribute("data-parallax");
    if (!parallaxAttr || parallaxAttr === "false") return 0;
    if (parallaxAttr === "true") return MarqueeComponent.#DEFAULT_PARALLAX;
    return parseFloat(parallaxAttr);
  }

  #calculateParallaxTranslate(parallaxValue) {
    let translate = (parallaxValue * 100) / (1 + parallaxValue);
    const isReverse = this.direction === "reverse" || this.direction === "right";

    if (!isReverse) {
      translate *= -1;
    }

    if (isRTL()) {
      translate *= -1;
    }

    return translate;
  }

  #initParallaxPauseObserver() {
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            this.#pauseParallax();
          } else {
            this.#resumeParallax();
          }
        });
      },
      {
        rootMargin: MarqueeComponent.#PAUSE_OBSERVER_MARGIN,
      }
    );
    this.#intersectionObserver.observe(this);
  }

  #pauseParallax() {
    this.classList.add("paused");
    if (this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
    }
  }

  #resumeParallax() {
    this.classList.remove("paused");
    if (!this.#scrollStop) {
      this.#createParallaxAnimation();
    }
  }

  #initPauseObserver() {
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.classList.remove("paused");
          } else {
            this.classList.add("paused");
          }
        });
      },
      {
        rootMargin: MarqueeComponent.#PAUSE_OBSERVER_MARGIN,
      }
    );
    this.#intersectionObserver.observe(this);
  }

  #setupResizeObserver() {
    // The observer was already watching this element and using only its HEIGHT,
    // so a width change it could see went nowhere: the copy count is recomputed
    // in #handleResize, which was wired to `window` alone. Anything that resized
    // the marquee without resizing the viewport — a container setting, a sibling
    // laying out, a scrollbar — left a stale number of copies until the visitor
    // happened to resize the window. Measured: dropping this element from 1440px
    // to 400px kept four copies; firing a window resize at the same 400px
    // dropped it to three.
    //
    // The first item is observed too, because it is what grows when the logos
    // inside it resolve their intrinsic size — and that never changes THIS
    // element's width, so nothing above would fire. Cloning cannot feed back:
    // clones are appended after the observed node, whose own width is unchanged.
    this.#resizeObserver = new ResizeObserver(() => {
      this.#setHeight();
      this.#handleResize();
    });
    //
    // Both are watched on the BORDER box, because that is the box the copy count
    // is computed from (`getBoundingClientRect`). The default is the content
    // box, and these items are sized by their contents, so growth that lands in
    // padding or a border leaves the content box untouched and the observer
    // silent — measured: 300px of inline padding on an auto-width item moved its
    // rect from 956px to 1556px and fired a content-box observer zero times.
    const box = { box: "border-box" };
    this.#resizeObserver.observe(this, box);
    const firstItem = this.refs.inner?.firstElementChild;
    if (firstItem) this.#resizeObserver.observe(firstItem, box);
    window.addEventListener("resize", this.#handleResize);
  }

  #handleResize = debounce(() => {
    const { inner } = this.refs;
    if (!inner) return;

    // Both widths decide the copy count, so both have to open this gate. It used
    // to compare the marquee's width alone, which meant an item that grew after
    // its images resolved could not recompute AT ALL — not even on a window
    // resize, because the width being compared had not moved. Measured: an item
    // widened from 956px to 1556px inside an unchanged 1440px marquee kept four
    // copies through a window resize, leaving one copy wider than the strip.
    const currentWidth = this.parentWidth;
    const currentChildWidth = this.#getChildWidthSync(inner);
    if (currentWidth === this.#previousWidth && currentChildWidth === this.#previousChildWidth) return;

    this.#previousWidth = currentWidth;
    this.#previousChildWidth = currentChildWidth;

    const allItemsElements = inner.querySelectorAll("[data-marquee-items]");
    allItemsElements.forEach((el) => {
      el.classList.remove("animate");
      el.style.transform = "";
    });

    if (this.parallax && this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
      inner.style.transform = "";
    }

    this.#adjustItemCount(true, null, currentWidth);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const currentItemsElements = inner.querySelectorAll("[data-marquee-items]");
        currentItemsElements.forEach((el) => {
          el.classList.add("animate");
          el.style.transform = "";
        });

        if (this.parallax) {
          this.#createParallaxAnimation();
        }
      });
    });
  }, MarqueeComponent.#RESIZE_DEBOUNCE);

  #setHeight() {
    // Called from ResizeObserver, batch reads and writes
    const height = this.offsetHeight;
    const isRotated = this.classList.contains("marquee--rotated");

    // Batch writes after all reads
    this.style.setProperty("--block-height", `${height}px`);

    if (isRotated) {
      this._setRotateOffsetWithHeight(height);
    } else {
      this.style.setProperty("--offset", "0px");
    }
  }

  _setRotateOffsetWithHeight(blockHeight) {
    let angleDeg =
      parseFloat(this.style.getPropertyValue("--angle-raw")) || parseFloat(this.style.getPropertyValue("--angle")) || 0;

    if (angleDeg === 0) {
      this.style.setProperty("--offset", "0px");
      return;
    }

    angleDeg *= isRTL() ? -1 : 1;

    const angleRad = (Math.abs(angleDeg) * Math.PI) / 180;
    const offset = blockHeight * Math.tan(angleRad);

    this.style.setProperty("--offset", `${offset}px`);
  }

  onPause() {
    this.classList.add("paused");
    if (this.parallax && this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
    }
  }

  onPlay() {
    this.classList.remove("paused");
    if (this.parallax && !this.#scrollStop) {
      this.#createParallaxAnimation();
    }
  }

  get direction() {
    return this.getAttribute("data-direction") || "forward";
  }

  get duration() {
    if (!this.hasAttribute("data-duration")) return null;
    const value = parseFloat(this.getAttribute("data-duration"));
    return isNaN(value) ? null : value;
  }

  get parallax() {
    if (isTouch()) return false;
    return this.#parseParallaxValue();
  }

  get parentWidth() {
    const rect = this.getBoundingClientRect();
    return rect.right - rect.left;
  }

  get childElementWidth() {
    const { inner } = this.refs;
    const item = inner?.firstElementChild;
    if (!item) return 1;
    const rect = item.getBoundingClientRect();
    return rect.right - rect.left;
  }
}

if (!customElements.get("marquee-component")) {
  customElements.define("marquee-component", MarqueeComponent);
}
