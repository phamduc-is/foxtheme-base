import { MOBILE_DESKTOP_BREAKPOINT } from "@theme/carousel";
import { FlexCarousel } from "@theme/flex-carousel";
import { throttle } from "@theme/utilities";

/**
 * Centered carousel with a manual loop (clone slides + loopFix). Swiper's built-in `loop: true`
 * does not match this layout (centeredSlides + destroyBelow, nav at edges).
 *
 * ## Config contract (`ref="config"` JSON in Liquid)
 * - **`loop: false`** (required) — manual cloning conflicts with Swiper's native loop.
 * - **`centeredSlides`** — when true, initial index targets the first real slide after clones.
 * - **`destroyBelow` / `destroyAbove`** (optional) — same semantics as `CarouselComponent`; when unset, loop is disabled for viewports narrower than `MOBILE_DESKTOP_BREAKPOINT` (from `@theme/carousel`).
 * - **`slidesPerView`, `slidesPerGroup`, `loopAdditionalSlides`, `breakpoints`** — affect clone count in `#createLoop`.
 *
 * ## Edge shadows
 * Extends `FlexCarousel`, so an `.edge__shadows` wrapper in the markup gets the
 * gradient fade for free. The manual loop changes the strip behind Swiper's back,
 * so `#syncEdgeShadows` re-drives that state whenever the loop is built, dropped,
 * or the instance is destroyed — see its doc for the three cases.
 *
 * ## Manual QA
 * - Many slides: drag to edges, prev/next; no stuck nav after loop jump.
 * - Resize across `destroyBelow` / mobile default: duplicates removed when loop off.
 * - Theme editor: reorder blocks / morph — no duplicate Swiper handlers or stacked `updateSlidesClasses` patches.
 * - `.edge__shadows` present: both fades lit while looping; real begin/end fades when the loop is off but Swiper is alive; no fade at all once Swiper is destroyed.
 */
/**
 * @capability Centered carousel with an infinite loop built by manually cloning slides (loopFix) — for centeredSlides layouts where Swiper's native loop:true breaks (nav at edges, destroyBelow); disables the loop below a viewport threshold and removes clones. Inherits flex-carousel's .edge__shadows edge-fade handling and keeps it correct across loop build/teardown.
 * @when A slider whose ACTIVE slide sits centered with neighbours peeking at both edges and must loop seamlessly — hero/product spotlights, centered testimonial or lookbook carousels. For a normal left-aligned carousel use carousel-slider.
 * @contract <carousel-centered-slider> — same markup as carousel-slider (ref="container", slides, JSON config via <script ref="config">); config MUST set loop:false, honours centeredSlides, destroyBelow/destroyAbove, slidesPerView/slidesPerGroup/loopAdditionalSlides. Add an .edge__shadows wrapper (optionally ref="thumbnails" for the thumbnail swiper) to get the edge fade.
 * @keywords centered slider, centered slides, infinite loop, seamless loop, clone slides, peek slides, spotlight carousel, center mode, looped carousel, edge fade, edge shadows
 */
export class CarouselCenteredSlider extends FlexCarousel {
  /** @type {(() => void) | null} */
  #loopViewportCleanup = null;
  /** @type {ReturnType<typeof throttle> | null} */
  #viewportThrottle = null;
  /** @type {AbortController | null} */
  #carouselReadyAbort = null;

  /** @type {Swiper | null} */
  #handlersSwiper = null;
  /** @type {(() => void) | null} */
  #boundSlideChangeTransitionEnd = null;
  /** @type {(() => void) | null} */
  #boundSliderMove = null;
  /** @type {((...args: unknown[]) => void) | null} */
  #originalUpdateSlidesClasses = null;
  /** @type {(() => void) | null} */
  #paginationFixCleanup = null;
  /** @type {(() => void) | null} */
  #navGateCleanup = null;

  connectedCallback() {
    super.connectedCallback();
    this.#carouselReadyAbort?.abort();
    this.#carouselReadyAbort = new AbortController();
    this.addEventListener(
      "carousel:ready",
      () => {
        this.#init();
      },
      { signal: this.#carouselReadyAbort.signal }
    );
  }

  updatedCallback() {
    super.updatedCallback?.();

    // Listeners fire in registration order, and on a morph ours is the
    // connect-time one — registered BEFORE the fresh `carousel:ready` listener
    // `FlexCarousel.updatedCallback` just added. So `#syncEdgeShadows` would run
    // first and `FlexCarousel.#init` would then overwrite it with the raw
    // `swiper.isBeginning` (still true — the initial `slideTo` is one rAF away),
    // dropping the left fade for a frame. Re-sync from a listener registered
    // last, restoring the connect-time order the doc block below assumes.
    // Deliberately NOT a second `#init()`: that would run the whole loop/
    // pagination setup twice per morph.
    this.addEventListener("carousel:ready", () => this.#syncEdgeShadows(), {
      once: true,
      signal: this.#carouselReadyAbort?.signal,
    });
  }

  disconnectedCallback() {
    this.#carouselReadyAbort?.abort();
    this.#carouselReadyAbort = null;

    if (this.#loopViewportCleanup) {
      this.#loopViewportCleanup();
      this.#loopViewportCleanup = null;
    }

    this.#detachLoopHandlers();
    super.disconnectedCallback();
  }

  #shouldDisableLoop() {
    const options = this.finalOptions || this.lastResolvedOptions;
    if (!options) return false;

    const w = window.innerWidth || 0;
    const below = Number(options.destroyBelow);
    const above = Number(options.destroyAbove);

    if (!Number.isNaN(below) && w < below) return true;
    if (!Number.isNaN(above) && w > above) return true;

    if (Number.isNaN(below) && Number.isNaN(above)) {
      return w < MOBILE_DESKTOP_BREAKPOINT;
    }

    return false;
  }

  /**
   * Slide index to show first real slide after manual loop prep (respects centeredSlides).
   * @param {import("@theme/swiper").Swiper} swiper
   * @returns {number}
   */
  #getInitialLoopSlideIndex(swiper) {
    const centeredSlides = swiper.params.centeredSlides || false;
    let initialIndex = this.loopedSlides;
    if (centeredSlides) {
      const originalSlides = swiper.slides.filter((slide) => !slide.classList.contains("swiper-slide-duplicate"));
      if (originalSlides.length > 0) {
        const firstOriginalIndex = swiper.getSlideIndex(originalSlides[0]);
        if (firstOriginalIndex >= 0) {
          initialIndex = firstOriginalIndex;
        }
      }
    }
    return initialIndex;
  }

  #detachLoopHandlers() {
    const swiper = this.#handlersSwiper;
    if (!swiper) return;

    if (this.#boundSlideChangeTransitionEnd) {
      swiper.off("slideChangeTransitionEnd", this.#boundSlideChangeTransitionEnd);
      this.#boundSlideChangeTransitionEnd = null;
    }
    if (this.#boundSliderMove) {
      swiper.off("sliderMove", this.#boundSliderMove);
      this.#boundSliderMove = null;
    }
    if (this.#originalUpdateSlidesClasses) {
      swiper.updateSlidesClasses = this.#originalUpdateSlidesClasses;
      this.#originalUpdateSlidesClasses = null;
    }
    // Each teardown runs off its OWN flag alone — never off a probe of live
    // Swiper state. A viewport cross past `destroyBelow` can tear the instance
    // down before we get here, so a guard like "is `swiper.pagination` still
    // there?" would leave a stale flag behind and make the next attach
    // early-return, silently unpatched. (The `!swiper` return above is not such
    // a probe: `#handlersSwiper` is set only alongside these flags, and cleared
    // only here.)
    this.#paginationFixCleanup?.();
    this.#paginationFixCleanup = null;
    this.#navGateCleanup?.();
    this.#navGateCleanup = null;

    this.#handlersSwiper = null;
  }

  /**
   * Keep navigation from outrunning the manual loop's repositioning.
   *
   * `#loopFix` teleports off a clone only on `slideChangeTransitionEnd`, so a
   * move started before the previous one settled never gets repositioned: the
   * carousel walks along the clone strip until it runs out of the `loopedSlides`
   * runway, and Swiper clamps at the last slide with an empty gap at the edge.
   * Swiper guards its own loop against exactly this (`slideNext`/`slidePrev` bail
   * on `animating && params.loop && params.loopPreventsSliding`) but that guard
   * is dead here — this component REQUIRES `params.loop === false` for its manual
   * clones (see class doc) — so rebuild it. `preventInteractionOnTransition`
   * covers the drag/flick path; Swiper reads it at every move entry point
   * (`onTouchStart`, `translateTo`, `slideTo` in swiper-core), all after init, so
   * setting it here still takes effect. Because `slideTo` is one of them and
   * `internal: true` does NOT exempt a caller, `#loopFix` has to lift the flag
   * around its own teleport.
   *
   * Gated, at most ONE unrepositioned move is ever in flight, so the runway only
   * has to cover a single step — `loopedSlides >= floor(slidesPerView / 2) + 1`,
   * which `#createLoop` already satisfies whenever the loop is on. No extra
   * clones needed.
   *
   * These patches only REJECT a request, never move the strip, so they cannot
   * disturb an in-flight transition. Bullet clicks need no gate of their own:
   * they target an absolute index inside the real block, always safe — one
   * landing mid-transition is dropped by `preventInteractionOnTransition`, which
   * is Swiper's normal behaviour for that param and costs at most one ignored
   * click.
   * @param {import("@theme/swiper").Swiper} swiper
   */
  #attachNavigationGate(swiper) {
    if (this.#navGateCleanup) return;

    const originalNext = swiper.slideNext.bind(swiper);
    const originalPrev = swiper.slidePrev.bind(swiper);
    const previousPreventInteraction = swiper.params.preventInteractionOnTransition ?? false;

    swiper.slideNext = (...args) => (swiper.animating ? false : originalNext(...args));
    swiper.slidePrev = (...args) => (swiper.animating ? false : originalPrev(...args));
    swiper.params.preventInteractionOnTransition = true;

    this.#navGateCleanup = () => {
      swiper.slideNext = originalNext;
      swiper.slidePrev = originalPrev;
      if (swiper.params) swiper.params.preventInteractionOnTransition = previousPreventInteraction;
    };
  }

  /**
   * Swiper's Pagination module counts bullets and the active bullet from
   * `snapGrid`/`snapIndex` whenever `params.loop` is false — which it must be
   * here (manual clones, see class doc). Both would then include our cloned
   * slides. `swiper.realIndex` already resolves correctly off
   * `data-swiper-slide-index` regardless of `params.loop` (Swiper core), so fake
   * a real-count-only snapGrid/snapIndex for the duration of Pagination's own
   * render/update calls, then restore.
   *
   * Patching `pagination.render`/`.update` only affects callers that go through
   * those PROPERTIES. Swiper's own Pagination module reacts to
   * `snapIndexChange`/`snapGridLengthChange` with listeners closed over its
   * internal functions, so every native slide change re-runs the unpatched logic
   * and overwrites the fix. Re-sync on those same events — our listeners
   * register after Swiper's (Pagination attaches at init, long before
   * `carousel:ready`), so our corrected call is the last write. `lock unlock` is
   * a third such entry point: `watchOverflow` can flip lock state from the
   * `checkOverflow` inside `updateSlides()`, which would otherwise leave the
   * active bullet on its clone-inclusive index until the next `snapIndexChange`.
   * Only the active bullet needs it — the bullet COUNT comes from the faked
   * `snapGrid`, which lock state cannot change, so re-rendering here would
   * replace every bullet node and restart their transitions for nothing.
   *
   * Clickable bullets need the same correction on the navigation side: Swiper's
   * handler sees `params.loop === false` and calls `slideTo(bulletIndex)` against
   * the FULL slide array, landing `loopedSlides` positions off. Intercept in the
   * capture phase — its handler is bound to the pagination container, so stopping
   * propagation there suppresses it — and slide to the real slide carrying
   * `data-swiper-slide-index === N`.
   *
   * Two cases the fake count knowingly does not cover, neither reachable from any
   * current config: with `dynamicBullets`, Pagination advances its own
   * `dynamicBulletIndex` by `snapIndex - previousSnapIndex`, and we fake only the
   * former, so the window would drift; and with `slidesPerGroup > 1` the fake
   * yields one bullet per slide rather than Swiper's looped
   * `ceil(count / slidesPerGroup)` — that one is deliberate, since it is what the
   * click mapping below assumes.
   * @param {import("@theme/swiper").Swiper} swiper
   */
  #attachPaginationFix(swiper) {
    if (this.#paginationFixCleanup) return;

    const pagination = swiper.pagination;
    const paginationEl = pagination?.el;
    if (!pagination || !paginationEl) return;

    const isClone = (slide) => slide.classList.contains("swiper-slide-duplicate");
    const realSlideIndex = (slide) => parseInt(slide.getAttribute("data-swiper-slide-index") || "", 10);

    /** Run one of Pagination's own methods against real-slide-only counts. */
    const withRealCounts =
      (fn) =>
      (...args) => {
        const { snapGrid, snapIndex } = swiper;
        swiper.snapGrid = new Array(swiper.slides.filter((slide) => !isClone(slide)).length).fill(0);
        swiper.snapIndex = swiper.realIndex;
        try {
          fn(...args);
        } finally {
          // A throw escaping Pagination would otherwise strand the faked
          // all-zero `snapGrid` on the instance, breaking every later position
          // calculation — and `#paginationFixCleanup` restores methods, not state.
          swiper.snapGrid = snapGrid;
          swiper.snapIndex = snapIndex;
        }
      };

    const originalRender = pagination.render?.bind(pagination);
    const originalUpdate = pagination.update?.bind(pagination);
    if (originalRender) pagination.render = withRealCounts(originalRender);
    if (originalUpdate) pagination.update = withRealCounts(originalUpdate);

    const syncActive = () => pagination.update?.();
    const syncAll = () => {
      pagination.render?.();
      pagination.update?.();
    };
    swiper.on("snapIndexChange", syncActive);
    swiper.on("snapGridLengthChange", syncAll);
    swiper.on("lock unlock", syncActive);

    // Swiper builds this selector through `classesToSelector`, which escapes and
    // splits a multi-class `bulletClass`; matching by `classList` instead keeps a
    // custom `bulletClass` from throwing a SyntaxError out of every bullet click.
    const bulletClasses = String(swiper.params.pagination?.bulletClass || "")
      .split(" ")
      .filter(Boolean);
    const isBullet = (el) => bulletClasses.every((cls) => el.classList.contains(cls));
    /** The clicked bullet, or null — Pagination renders bullets as direct children. */
    const bulletOf = (target) => {
      let node = target instanceof Element ? target : null;
      while (node && node.parentElement !== paginationEl) node = node.parentElement;
      return node && isBullet(node) ? node : null;
    };

    const onBulletClick = (event) => {
      const bullet = bulletOf(event.target);
      if (!bullet) return;

      // Suppress Swiper's handler as soon as we recognise the bullet, not once we
      // have resolved a target: letting a click fall through is exactly the
      // `slideTo` against the full slide array that this patch exists to prevent.
      event.stopPropagation();
      event.preventDefault();

      const bulletIndex = Array.from(paginationEl.children).filter(isBullet).indexOf(bullet);
      const targetSlide = swiper.slides.find((slide) => !isClone(slide) && realSlideIndex(slide) === bulletIndex);
      if (!targetSlide) return;

      const targetIndex = swiper.getSlideIndex(targetSlide);
      if (targetIndex >= 0) swiper.slideTo(targetIndex);
    };
    if (bulletClasses.length) {
      paginationEl.addEventListener("click", onBulletClick, {
        capture: true,
        signal: this.#carouselReadyAbort?.signal,
      });
    }

    this.#paginationFixCleanup = () => {
      if (originalRender) pagination.render = originalRender;
      if (originalUpdate) pagination.update = originalUpdate;
      swiper.off("snapIndexChange", syncActive);
      swiper.off("snapGridLengthChange", syncAll);
      swiper.off("lock unlock", syncActive);
      paginationEl.removeEventListener("click", onBulletClick, true);
    };

    syncAll();
  }

  /**
   * @param {import("@theme/swiper").Swiper} swiper
   */
  #attachLoopHandlers(swiper) {
    if (!swiper || swiper.destroyed) return;

    this.#detachLoopHandlers();

    this.#handlersSwiper = swiper;

    this.#boundSlideChangeTransitionEnd = () => {
      this.#loopFix();
    };
    this.#boundSliderMove = () => {
      this.#loopFixDuringDrag();
    };

    swiper.on("slideChangeTransitionEnd", this.#boundSlideChangeTransitionEnd);
    swiper.on("sliderMove", this.#boundSliderMove);

    this.#originalUpdateSlidesClasses = swiper.updateSlidesClasses.bind(swiper);
    swiper.updateSlidesClasses = () => {
      this.#originalUpdateSlidesClasses?.();
      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;
    };

    this.#attachNavigationGate(swiper);
    this.#attachPaginationFix(swiper);
  }

  #init() {
    const swiper = this.swiperInstance;
    if (!swiper) return;

    this.#detachLoopHandlers();

    if (swiper.params?.loop) {
      swiper.params.loop = false;
    }

    if (this.#shouldDisableLoop()) {
      this.#destroyLoop();
    } else {
      this.#createLoop();
    }

    this.#setupLoopResponsive();

    if (!this.#shouldDisableLoop()) {
      requestAnimationFrame(() => {
        if (!swiper || swiper.destroyed) return;
        swiper.slideTo(this.#getInitialLoopSlideIndex(swiper), 0, false);
      });
      this.#attachLoopHandlers(swiper);
    }

    this.#syncEdgeShadows();
  }

  /**
   * Re-drive the inherited `.edge__shadows` state, which Swiper's own
   * `reachBeginning`/`reachEnd`/`fromEdge` events cannot keep correct here:
   *
   * - **Loop on** — `isBeginning`/`isEnd` are computed over the FULL strip
   *   (clones included) and never go true, and those events therefore never
   *   fire, so whatever `FlexCarousel` wrote at init (before `#createLoop` ran,
   *   while the active slide was still index 0 → `is--beginning`) would freeze.
   *   Both edges always have more content when looping, so light both.
   * - **Loop off, Swiper alive** (no `destroyBelow`, e.g. a 1-up mobile layout) —
   *   the edges are real; let `FlexCarousel` read them from the instance.
   * - **Swiper destroyed** (past `destroyBelow`, row falls back to a plain CSS
   *   scroll) — drop `is--active` entirely, otherwise the fade stays painted at
   *   its last desktop state over a row this component no longer drives.
   *
   * This has to be the LAST write of the three state classes, which holds on
   * connect only because `FlexCarousel` registers its `carousel:ready` listener
   * inside `super.connectedCallback()` — before ours. A morph inverts that, which
   * is why `updatedCallback` re-registers a sync that runs last.
   */
  #syncEdgeShadows() {
    const swiper = this.swiperInstance;

    if (!swiper || swiper.destroyed) {
      this.refreshEdgeShadows({ active: false });
      return;
    }

    this.refreshEdgeShadows({ looping: !this.#shouldDisableLoop() });
  }

  #setupLoopResponsive() {
    if (this.#loopViewportCleanup) {
      this.#loopViewportCleanup();
      this.#loopViewportCleanup = null;
    }

    this.#viewportThrottle?.cancel?.();
    this.#viewportThrottle = null;

    let wasLoopDisabled = this.#shouldDisableLoop();

    const handleCarouselReady = () => {
      wasLoopDisabled = this.#shouldDisableLoop();
      this.#syncEdgeShadows();
    };
    this.addEventListener("carousel:ready", handleCarouselReady);

    const runViewportLoopSync = () => {
      const shouldDisableLoop = this.#shouldDisableLoop();
      const swiper = this.swiperInstance;

      // Re-sync the edge fade on EVERY viewport event, before the change-detection
      // early return: whether the Swiper instance still exists is decided by
      // `CarouselComponent`'s own `destroyBelow` handling, independently of this
      // `wasLoopDisabled` bookkeeping — and `handleCarouselReady` can update that
      // flag first, so a real teardown can arrive with nothing left to detect.
      this.#syncEdgeShadows();

      if (shouldDisableLoop === wasLoopDisabled) return;

      wasLoopDisabled = shouldDisableLoop;

      requestAnimationFrame(() => {
        if (!swiper || swiper.destroyed) {
          const container = this.refs?.container;
          if (container && shouldDisableLoop) {
            const duplicates = Array.from(container.querySelectorAll(".swiper-slide-duplicate"));
            duplicates.forEach((el) => {
              el.parentNode?.removeChild(el);
            });
          }
          this.#syncEdgeShadows();
          return;
        }

        if (shouldDisableLoop) {
          this.#detachLoopHandlers();
          this.#destroyLoop();
        } else {
          this.#createLoop();
          requestAnimationFrame(() => {
            if (!swiper || swiper.destroyed) return;
            swiper.slideTo(this.#getInitialLoopSlideIndex(swiper), 0, false);
          });
          this.#attachLoopHandlers(swiper);
        }

        this.#syncEdgeShadows();
      });
    };

    const throttledSync = throttle(runViewportLoopSync, 100);
    this.#viewportThrottle = throttledSync;

    /** @type {{ mql: MediaQueryList; listener: () => void }[]} */
    const registrations = [];

    const addMql = (query) => {
      const mql = window.matchMedia(query);
      const listener = () => throttledSync();
      mql.addEventListener("change", listener);
      registrations.push({ mql, listener });
    };

    const options = this.finalOptions || this.lastResolvedOptions || {};
    const below = Number(options.destroyBelow);
    const above = Number(options.destroyAbove);

    if (typeof window.matchMedia === "function") {
      if (!Number.isNaN(below)) {
        const maxW = Math.max(0, Math.floor(below) - 1);
        addMql(`(max-width: ${maxW}px)`);
      }
      if (!Number.isNaN(above)) {
        const minW = Math.floor(above) + 1;
        addMql(`(min-width: ${minW}px)`);
      }
      if (Number.isNaN(below) && Number.isNaN(above)) {
        addMql(`(max-width: ${MOBILE_DESKTOP_BREAKPOINT - 1}px)`);
      }
    }

    const onWindowResize = () => throttledSync();
    if (registrations.length === 0) {
      window.addEventListener("resize", onWindowResize);
    }

    requestAnimationFrame(() => runViewportLoopSync());

    this.#loopViewportCleanup = () => {
      throttledSync.cancel();
      this.#viewportThrottle = null;
      registrations.forEach(({ mql, listener }) => mql.removeEventListener("change", listener));
      window.removeEventListener("resize", onWindowResize);
      this.removeEventListener("carousel:ready", handleCarouselReady);
    };
  }

  #destroyLoop() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) {
      const container = this.refs?.container;
      if (container) {
        const duplicates = Array.from(container.querySelectorAll(".swiper-slide-duplicate"));
        duplicates.forEach((el) => {
          el.parentNode?.removeChild(el);
        });
      }
      return;
    }

    const { slidesEl } = swiper;
    const duplicates = Array.from(slidesEl.querySelectorAll(".swiper-slide-duplicate"));
    duplicates.forEach((el) => {
      el.parentNode?.removeChild(el);
    });

    swiper.recalcSlides();
    swiper.updateSlides();
  }

  #createLoop() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.params?.loop) {
      return;
    }

    const { slidesEl, params } = swiper;

    const toRemove = Array.from(slidesEl.querySelectorAll(".swiper-slide-duplicate"));
    toRemove.forEach((el) => {
      el.parentNode?.removeChild(el);
    });

    const originalSlides = Array.from(slidesEl.querySelectorAll(`.${params.slideClass}`)).filter(
      (slide) => !slide.classList.contains("swiper-slide-duplicate")
    );

    if (originalSlides.length === 0) return;

    originalSlides.forEach((slide, index) => {
      slide.setAttribute("data-swiper-slide-index", String(index));
    });

    const slidesPerView = params.slidesPerView || 1;
    const slidesPerGroup = params.slidesPerGroup || 1;
    const loopAdditionalSlides = params.loopAdditionalSlides || 0;

    let loopedSlides = slidesPerGroup;
    if (loopedSlides % slidesPerGroup !== 0) {
      loopedSlides += slidesPerGroup - (loopedSlides % slidesPerGroup);
    }
    loopedSlides += loopAdditionalSlides;

    if (loopedSlides < slidesPerView) {
      loopedSlides = Math.ceil(slidesPerView / slidesPerGroup) * slidesPerGroup;
      loopedSlides += loopAdditionalSlides;
    }

    if (loopedSlides > originalSlides.length && params.loopedSlidesLimit !== false) {
      loopedSlides = originalSlides.length;
    }

    loopedSlides = Math.max(1, loopedSlides);

    this.loopedSlides = loopedSlides;

    const prependSlides = [];
    const appendSlides = [];
    const cols = originalSlides.length;

    for (let i = 0; i < loopedSlides; i += 1) {
      const appendIndex = i % cols;
      appendSlides.push(originalSlides[appendIndex]);
      const prependIndex = (cols - 1 - (i % cols) + cols) % cols;
      prependSlides.unshift(originalSlides[prependIndex]);
    }

    for (let i = 0; i < appendSlides.length; i += 1) {
      const clone = appendSlides[i].cloneNode(true);
      if (clone) {
        clone.classList.add("swiper-slide-duplicate");
        clone.setAttribute("data-swiper-slide-index", appendSlides[i].getAttribute("data-swiper-slide-index") || "");
        slidesEl.appendChild(clone);
      }
    }

    for (let i = prependSlides.length - 1; i >= 0; i -= 1) {
      const clone = prependSlides[i].cloneNode(true);
      if (clone) {
        clone.classList.add("swiper-slide-duplicate");
        clone.setAttribute("data-swiper-slide-index", prependSlides[i].getAttribute("data-swiper-slide-index") || "");
        slidesEl.prepend(clone);
      }
    }

    swiper.recalcSlides();
    swiper.updateSlides();
  }

  #loopFixDuringDrag() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;

    const { slides, params, slidesGrid, snapGrid } = swiper;
    const activeIndex = swiper.activeIndex;
    const currentSlide = slides[activeIndex];

    if (!currentSlide) return;

    const isDuplicate = currentSlide.classList.contains("swiper-slide-duplicate");
    if (!isDuplicate) {
      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;
      return;
    }

    const realIndex = parseInt(currentSlide.getAttribute("data-swiper-slide-index") || "", 10);
    if (Number.isNaN(realIndex)) return;

    const originalSlides = slides.filter((slide) => !slide.classList.contains("swiper-slide-duplicate"));
    const originalCount = originalSlides.length;

    if (originalCount === 0) return;

    const targetOriginalSlide = originalSlides.find(
      (slide) => parseInt(slide.getAttribute("data-swiper-slide-index") || "", 10) === realIndex
    );

    if (!targetOriginalSlide) return;

    const targetIndex = swiper.getSlideIndex(targetOriginalSlide);
    if (targetIndex < 0 || targetIndex === activeIndex) return;

    const centeredSlides = params.centeredSlides || false;
    const grid = centeredSlides && snapGrid ? snapGrid : slidesGrid;

    const currentSlideTranslate = grid[activeIndex] || 0;
    const targetSlideTranslate = grid[targetIndex] || 0;
    const diff = targetSlideTranslate - currentSlideTranslate;

    if (swiper.touchEventsData) {
      swiper.touchEventsData.startTranslate = swiper.touchEventsData.startTranslate - diff;
      swiper.touchEventsData.currentTranslate = swiper.touchEventsData.currentTranslate - diff;
      swiper.setTranslate(swiper.translate - diff);
    }

    swiper.updateActiveIndex(targetIndex);
    swiper.updateSlidesClasses();

    swiper.allowSlidePrev = true;
    swiper.allowSlideNext = true;
  }

  #loopFix() {
    const swiper = this.swiperInstance;
    if (!swiper || swiper.destroyed) return;

    const { slides, params, slidesGrid, snapGrid } = swiper;
    const activeIndex = swiper.activeIndex;
    const currentSlide = slides[activeIndex];

    if (!currentSlide) return;

    const isDuplicate = currentSlide.classList.contains("swiper-slide-duplicate");
    if (!isDuplicate) {
      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;
      return;
    }

    const realIndex = parseInt(currentSlide.getAttribute("data-swiper-slide-index") || "", 10);
    if (Number.isNaN(realIndex)) return;

    const originalSlides = slides.filter((slide) => !slide.classList.contains("swiper-slide-duplicate"));
    const originalCount = originalSlides.length;

    if (originalCount === 0) return;

    const targetOriginalSlide = originalSlides.find(
      (slide) => parseInt(slide.getAttribute("data-swiper-slide-index") || "", 10) === realIndex
    );

    if (!targetOriginalSlide) return;

    const targetIndex = swiper.getSlideIndex(targetOriginalSlide);
    if (targetIndex < 0 || targetIndex === activeIndex) return;

    const centeredSlides = params.centeredSlides || false;
    const grid = centeredSlides && snapGrid ? snapGrid : slidesGrid;

    const currentSlideTranslate = grid[activeIndex] || 0;
    const targetSlideTranslate = grid[targetIndex] || 0;
    const diff = targetSlideTranslate - currentSlideTranslate;

    if (swiper.touchEventsData) {
      swiper.touchEventsData.startTranslate = swiper.touchEventsData.startTranslate - diff;
      swiper.touchEventsData.currentTranslate = swiper.touchEventsData.currentTranslate - diff;
    }

    swiper.setTransition(0);

    requestAnimationFrame(() => {
      if (swiper.destroyed) return;
      // The teleport must never be one of the moves `#attachNavigationGate`
      // rejects: `slideTo` reads `preventInteractionOnTransition` and `internal:
      // true` does not exempt it. `animating` is normally false by now (Swiper
      // clears it in `transitionEnd`, before emitting `slideChangeTransitionEnd`)
      // but a click landing in that gap sets it again — and a silently dropped
      // teleport walks the strip one more clone off, the exact failure the gate
      // exists to prevent.
      const { preventInteractionOnTransition } = swiper.params;
      swiper.params.preventInteractionOnTransition = false;
      try {
        swiper.slideTo(targetIndex, 0, false, true);
      } finally {
        // `slideTo` is not a leaf: at speed 0 it runs synchronously through the
        // `updateSlidesClasses` this component patches plus three transition
        // emits, each reaching arbitrary theme listeners. A throw escaping any of
        // them would otherwise strand `false` for the instance's lifetime —
        // disabling the drag half of the very gate this restores — and skip the
        // two `allowSlide*` resets, freezing navigation entirely.
        swiper.params.preventInteractionOnTransition = preventInteractionOnTransition;
        swiper.allowSlidePrev = true;
        swiper.allowSlideNext = true;
      }

      requestAnimationFrame(() => {
        if (swiper.destroyed) return;
        swiper.setTransition(params.speed || 300);
      });
    });
  }
}

if (!customElements.get("carousel-centered-slider")) {
  customElements.define("carousel-centered-slider", CarouselCenteredSlider);
}
