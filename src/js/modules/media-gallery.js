import { Component } from "@theme/component";
import { ThemeEvents, VariantUpdateEvent, ModelInteractionEvent } from "@theme/events";
import { isMobileBreakpoint } from "@theme/utilities";

/**
 * A custom element that renders a media gallery.
 *
 * @typedef {object} Refs
 * @property {import('./zoom-dialog').ZoomDialog} [zoomDialogComponent] - The zoom dialog component.
 * @property {import('./slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {HTMLElement[]} [media] - The media elements.
 *
 * @extends Component<Refs>
 */
export class MediaGallery extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#controller;
    const target = this.closest(".shopify-section, dialog");

    this.handleCarouselChange();

    // carousel-slider defers Swiper init to a requestAnimationFrame, so swiperInstance
    // is null when connectedCallback runs and handleCarouselChange returns early.
    // Re-attach listeners and sync initial slide state once the carousel is ready.
    this.refs.carousel?.addEventListener(
      "carousel:ready",
      () => {
        this.handleCarouselChange();
        if (this.carousel?.swiperInstance) {
          this.#realIndexChangeHandler(this.carousel.swiperInstance);
        }
      },
      { signal }
    );

    target?.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate, { signal });
    target?.addEventListener(ThemeEvents.modelInteraction, this.#handleModelInteraction, {
      signal,
    });

    // Add listener directly on the media-gallery element
    this.addEventListener("media:switch-optimistic", this.#switchMediaOptimistic, {
      signal,
    });

    this.#setupZoomReveal();
    this.#scheduleDeferredLoad();
    this.#startThumbBrowseHeightSync();
  }

  #controller = new AbortController();

  /** @type {Promise<{ openPswp: Function }> | null} */
  #zoomDialogModule = null;

  /** @type {IntersectionObserver | null} */
  #zoomRevealObserver = null;

  /** @type {number | null} */
  #deferredLoadTimer = null;

  /** @type {ResizeObserver | null} */
  #thumbBrowseResizeObserver = null;

  /** @type {number | null} */
  #thumbBrowseLayoutRafId = null;

  /** @type {AbortController | null} */
  #carouselReadyAbort = null;

  /** Number of slides to move from <template> to DOM per animation frame */
  static DEFERRED_BATCH_SIZE = 20;

  updatedCallback() {
    super.updatedCallback?.();
    this.handleCarouselChange();
    this.#setupZoomReveal();
    this.#scheduleDeferredLoad();
    this.#startThumbBrowseHeightSync();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#stopThumbBrowseHeightSync();
    this.#controller.abort();
    this.#zoomRevealObserver?.disconnect();
    this.#zoomRevealObserver = null;

    if (this.#deferredLoadTimer) {
      clearTimeout(this.#deferredLoadTimer);
      this.#deferredLoadTimer = null;
    }
  }

  /**
   * Handles a variant update event by replacing the current media gallery with a new one.
   *
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #handleVariantUpdate = (event) => {
    const source_html = event.detail.data.html;
    const source_variant = event.detail.resource;
    const fromCache = event.detail.data.fromCache;
    const isBackgroundSync = event.detail.data.isBackgroundSync;
    const newProduct = event.detail.data.newProduct;

    // Check if hide_variants mode (media structure changes completely)
    const hideVariants = this.hasAttribute("data-hide-variants");

    // Skip replace if optimistic update already handled, UNLESS:
    // 1. hide_variants mode (DOM structure changes completely)
    // 2. newProduct (combine listing - media IDs don't match between products)
    if (!hideVariants && !newProduct && (fromCache || isBackgroundSync)) return;

    if (!source_html) return;

    const newMediaGallery = source_html.querySelector("media-gallery");

    if (!newMediaGallery) return;

    // For combine listings (newProduct), always replace even if variant has no featured_media
    // For normal variant switch, only replace if variant has featured_media
    if (!newProduct && !source_variant?.featured_media) return;

    this.replaceWith(newMediaGallery);
  };

  /**
   * Handles optimistic media switch from cache (instant update without HTML)
   *
   * @param {CustomEvent} event - The optimistic media switch event
   */
  #switchMediaOptimistic = (event) => {
    // Skip optimistic update when hide_variants mode
    // Media DOM structure changes completely, rely on background HTML fetch
    if (this.hasAttribute("data-hide-variants")) {
      return;
    }

    const variant = event.detail.variant;

    if (!variant?.featured_media?.id) {
      console.warn("⚠️ No featured media in variant");
      return;
    }

    const mediaId = variant.featured_media.id;

    // Check if we have a carousel (might be destroyed in grid mode on desktop)
    const carousel = this.carousel;
    const hasActiveCarousel = carousel?.swiperInstance && !carousel.swiperInstance.destroyed;

    if (hasActiveCarousel) {
      // CAROUSEL MODE: Use slideTo for instant switch
      // IMPORTANT: Query from Swiper's slides array, not DOM, to handle post-recreate scenarios
      let swiperSlides = Array.from(carousel.swiperInstance.slides || []);
      let targetIndex = swiperSlides.findIndex((slide) => {
        const slideEl = slide instanceof HTMLElement ? slide : null;
        return slideEl?.dataset?.mediaId === String(mediaId);
      });

      // If not found, check if slide is in deferred template and force-load
      if (targetIndex === -1 && this.querySelector("[data-deferred-slides]")) {
        this.#forceLoadAllDeferred();
        // Re-query after loading
        swiperSlides = Array.from(carousel.swiperInstance.slides || []);
        targetIndex = swiperSlides.findIndex((slide) => {
          const slideEl = slide instanceof HTMLElement ? slide : null;
          return slideEl?.dataset?.mediaId === String(mediaId);
        });
      }

      if (targetIndex !== -1 && targetIndex !== carousel.swiperInstance.activeIndex) {
        this.#revealOnSwap(swiperSlides[targetIndex]);
        carousel.swiperInstance.slideTo(targetIndex, 0, false); // instant, no animation, no callbacks

        // Update carousel thumbnails active state if they exist
        this.#updateCarouselThumbnailsActive(mediaId);
      } else if (targetIndex === -1) {
        console.warn("⚠️ Target slide not found in Swiper slides");
        // Fallback: try DOM query as last resort
        const domSlides = Array.from(
          this.querySelectorAll("[data-main-wrapper] [data-media-id]")
        );
        const fallbackIndex = domSlides.findIndex((slide) => slide.dataset.mediaId === mediaId);
        if (fallbackIndex !== -1) {
          this.#revealOnSwap(domSlides[fallbackIndex]);
          carousel.swiperInstance.update(); // Force Swiper to re-scan DOM
          carousel.swiperInstance.slideTo(fallbackIndex, 0, false);
        }
      }
    } else {
      // GRID MODE: Re-order DOM to move selected media to first position
      const mainWrapper = this.querySelector("[data-main-wrapper]");
      if (!mainWrapper) {
        console.warn("⚠️ Main wrapper not found");
        return;
      }

      let targetMedia = mainWrapper.querySelector(`[data-media-id="${mediaId}"]`);

      // If not found, check if slide is in deferred template and force-load
      if (!targetMedia && this.querySelector("[data-deferred-slides]")) {
        this.#forceLoadAllDeferred();
        targetMedia = mainWrapper.querySelector(`[data-media-id="${mediaId}"]`);
      }

      if (!targetMedia) {
        console.warn("⚠️ Target media not found");
        return;
      }

      // Move main media to first position if not already there
      let wasReordered = false;
      if (targetMedia !== mainWrapper.firstElementChild) {
        this.#revealOnSwap(targetMedia);
        mainWrapper.insertBefore(targetMedia, mainWrapper.firstElementChild);
        wasReordered = true;
      }

      // Only scroll into view if DOM was reordered or element is not in viewport
      if (wasReordered) {
        const rect = targetMedia.getBoundingClientRect();
        const isInViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;

        // Only scroll if not fully visible in viewport
        if (!isInViewport) {
          targetMedia.scrollIntoView({ behavior: "instant", block: "start" });
        }
      }
    }
  };

  /**
   * A variant switch is a SWAP, not an entrance. The zoom-out reveal belongs to the
   * scroll-in entrance (`#setupZoomReveal`), and until a slide has played it once it
   * sits at opacity 0 / scale 1.15 — so the first switch to each media faded and
   * zoomed the new image in over 0.5–1.3 s even with its bytes already there
   * (measured in the quick view: image complete at the click, opaque at +530 ms,
   * scale settled at +1.3 s), while every later switch to the same slide was instant.
   * Commit the revealed state without the tween. An image still in flight is kept
   * hidden by `.loading` and arrives through the ordinary load fade alone.
   *
   * @param {Element | null | undefined} slide
   */
  #revealOnSwap(slide) {
    if (!(slide instanceof HTMLElement)) return;
    if (!slide.hasAttribute("data-zoom-reveal") || slide.classList.contains("is-revealed")) return;

    this.#zoomRevealObserver?.unobserve(slide);
    slide.classList.add("is-revealed", "is-revealed--instant");
    // Resolve style now, while the transition is off. Without this the browser sees
    // only the net change of the frame — revealed, with its transition back on — and
    // tweens anyway.
    void slide.offsetWidth;
    requestAnimationFrame(() => slide.classList.remove("is-revealed--instant"));
  }

  /**
   * Update active state for carousel thumbnails
   * @param {string|number} mediaId
   */
  #updateCarouselThumbnailsActive = (mediaId) => {
    const carouselThumbs = this.querySelector("[data-thumb-container]");
    if (!carouselThumbs) return;

    const thumbItems = carouselThumbs.querySelectorAll("[data-media-id]");

    let foundActive = false;
    for (const thumb of thumbItems) {
      const thumbMediaId = thumb.dataset.mediaId;
      const isMatch = String(thumbMediaId) === String(mediaId);

      if (isMatch) {
        thumb.classList.add("is-active");
        foundActive = true;
      } else {
        thumb.classList.remove("is-active");
      }
    }

    if (!foundActive) {
      console.warn("⚠️ No matching carousel thumbnail found for mediaId:", mediaId);
    }
  };

  /**
   * Handle 3D model interaction - toggle carousel drag
   * @param {ModelInteractionEvent} event
   */
  #handleModelInteraction = (event) => {
    const { isInteracting } = event.detail;

    // isInteracting = true (playing) -> disable drag
    // isInteracting = false (paused) -> enable drag
    this.toggleCarouselDrag(!isInteracting);
  };

  #realIndexChangeHandler = (swiper) => {
    const { slides, activeIndex } = swiper;
    const slide = slides[activeIndex];
    if (!slide) return;
    const mediaType = slide.dataset.mediaType;
    const mediaId = slide.dataset.mediaId;
    const modelViewer = slide.querySelector("model-viewer");
    const modelViewerButton = slide.querySelector(".shopify-model-viewer-ui__button");
    const shopifyXrButton = this.querySelector("button[data-shopify-xr]");

    if (mediaType === "model") {
      if (slide.dataset?.playing === "true") {
        this.toggleCarouselDrag(false);
      } else {
        this.toggleCarouselDrag(true);
      }
      if (modelViewer?.classList.contains("shopify-model-viewer-ui__disabled")) {
        modelViewerButton?.removeAttribute("hidden");
      } else {
        modelViewerButton?.setAttribute("hidden", "");
      }
      if (shopifyXrButton) {
        shopifyXrButton.dataset.shopifyModel3dId = mediaId;
        shopifyXrButton.classList.remove("hidden");
      }
    } else {
      this.toggleCarouselDrag(true);
      shopifyXrButton?.classList.add("hidden");
    }
  };

  handleCarouselChange = () => {
    if (!this.carousel?.swiperInstance) return;
    this.carousel.swiperInstance.off("realIndexChange", this.#realIndexChangeHandler);
    this.carousel.swiperInstance.on("realIndexChange", this.#realIndexChangeHandler);
  };

  toggleCarouselDrag = (state) => {
    if (!this.carousel?.swiperInstance) return;
    this.carousel.swiperInstance.allowTouchMove = state;
  };

  /**
   * Preloads the zoom dialog module on hover for better UX.
   */
  preloadZoomDialog = () => {
    // Only preload once
    if (this.#zoomDialogModule) return;

    // Start preloading the module
    this.#zoomDialogModule = import("@theme/zoom-dialog");
  };

  /**
   * Opens the zoom dialog with loading state management.
   */
  openZoomDialog = async (event) => {
    // Find the button - could be event.target or a parent
    const trigger =
      event.target instanceof HTMLButtonElement
        ? event.target
        : /** @type {HTMLElement} */ (event.target.closest("button"));
    if (!trigger) return;

    const clickedId = trigger?.getAttribute("data-media-id") ?? null;

    // Show loading state
    this.#setZoomButtonLoading(trigger, true);

    try {
      const mediaNodes = Array.from(
        this.querySelectorAll('[data-main-wrapper] [data-media-type="image"]')
      );
      const items = mediaNodes.map((media) => {
        return {
          src: media.dataset.mediaSrc,
          width: media.dataset.mediaWidth,
          height: media.dataset.mediaHeight,
          element: media,
        };
      });

      const startIndex = Math.max(
        0,
        mediaNodes.findIndex((media) => media?.dataset.mediaId === clickedId)
      );

      // Use preloaded module if available, otherwise import
      const zoomDialogModule = this.#zoomDialogModule || import("@theme/zoom-dialog");
      this.#zoomDialogModule = zoomDialogModule; // Cache for future use

      const { openPswp } = await zoomDialogModule;
      openPswp(items, startIndex, {
        trigger,
        onChange: (pswpIndex) => {
          const swiper = this.carousel?.swiperInstance;
          if (!swiper) return;
          // Map pswpIndex to slide index in Swiper; items and mediaNodes are aligned
          swiper.slideTo(pswpIndex, 0, false);
        },
      });
    } catch (error) {
      console.error("Failed to open zoom dialog:", error);
    } finally {
      // Hide loading state
      this.#setZoomButtonLoading(trigger, false);
    }
  };

  /**
   * Sets loading state for zoom dialog button.
   *
   * @param {HTMLElement} button - The zoom dialog button
   * @param {boolean} isLoading - Whether the button is in loading state
   */
  #setZoomButtonLoading(button, isLoading) {
    const spinner = button.querySelector('[ref="zoomDialogSpinner"]');
    if (!spinner) return;

    if (isLoading) {
      button.classList.add("btn--loading");
      spinner.classList.remove("hidden");
    } else {
      button.classList.remove("btn--loading");
      spinner.classList.add("hidden");
    }
  }

  // ---------------------------------------------------------------------------
  // Deferred slide loading
  // ---------------------------------------------------------------------------

  /**
   * Vertical desktop browse: after many thumbs load, Swiper gives .swiper-wrapper a large
   * inline height — grid row min-content grows and pulls main taller. Clamp thumb to main height.
   */
  #applyThumbStripMaxHeight() {
    const thumbSwiper = this.querySelector("[data-thumbs-swiper]");
    if (!thumbSwiper) return;

    if (isMobileBreakpoint() || !this.querySelector("[data-browse-vertical]")) {
      thumbSwiper.style.removeProperty("max-height");
      return;
    }

    const mainEl = this.querySelector("[data-carousel-container]");
    if (!mainEl) return;

    const mainSwiper = this.carousel?.swiperInstance;
    let h = 0;
    if (mainSwiper && !mainSwiper.destroyed && mainSwiper.slides?.length) {
      const idx = Math.min(Math.max(mainSwiper.activeIndex ?? 0, 0), mainSwiper.slides.length - 1);
      const slide = mainSwiper.slides[idx];
      if (slide instanceof HTMLElement) {
        // offsetHeight ignores CSS transforms on ancestor elements (e.g. dialog open animation),
        // giving the correct layout height regardless of animation state.
        h = slide.offsetHeight;
      }
    }
    if (h < 1) {
      h = mainEl.offsetHeight;
    }
    if (h < 1) return;

    thumbSwiper.style.maxHeight = `${h}px`;
  }

  #stopThumbBrowseHeightSync() {
    this.#thumbBrowseResizeObserver?.disconnect();
    this.#thumbBrowseResizeObserver = null;
    if (this.#thumbBrowseLayoutRafId) {
      cancelAnimationFrame(this.#thumbBrowseLayoutRafId);
      this.#thumbBrowseLayoutRafId = null;
    }
    this.#carouselReadyAbort?.abort();
    this.#carouselReadyAbort = null;
    this.querySelector("[data-thumbs-swiper]")?.style.removeProperty("max-height");
  }

  #startThumbBrowseHeightSync() {
    this.#stopThumbBrowseHeightSync();

    if (typeof ResizeObserver === "undefined") return;
    if (!this.querySelector("[data-browse-vertical]")) return;

    const mainEl = this.querySelector("[data-carousel-container]");
    if (!mainEl) return;

    const schedule = () => {
      if (this.#thumbBrowseLayoutRafId) cancelAnimationFrame(this.#thumbBrowseLayoutRafId);
      this.#thumbBrowseLayoutRafId = requestAnimationFrame(() => {
        this.#thumbBrowseLayoutRafId = null;
        if (!this.isConnected) return;
        this.#applyThumbStripMaxHeight();
        const c = this.carousel;
        if (c?.thumbnailSwiper && !c.thumbnailSwiper.destroyed) {
          c.thumbnailSwiper.update();
        }
      });
    };

    this.#thumbBrowseResizeObserver = new ResizeObserver(schedule);
    this.#thumbBrowseResizeObserver.observe(mainEl);
    schedule();

    // Re-measure after Swiper initializes — in the Shopify editor a section
    // re-render calls updatedCallback() before the carousel re-inits Swiper,
    // so the first RAF measures an incorrect height. carousel:ready fires once
    // Swiper is ready, giving us the correct slide dimensions.
    const carouselEl = this.refs.carousel;
    if (carouselEl) {
      this.#carouselReadyAbort = new AbortController();
      const { signal } = this.#carouselReadyAbort;
      carouselEl.addEventListener("carousel:ready", schedule, { once: true, signal });
      carouselEl.addEventListener("carousel:slidechangeend", schedule, { signal });
    }
  }

  /**
   * Schedule loading of deferred slides from <template> elements.
   * Slides beyond the initial set are rendered inside inert <template> tags
   * (no custom-element lifecycle, no Swiper overhead). After the page is
   * interactive we progressively move them into the live DOM in batches.
   */
  #scheduleDeferredLoad() {
    // Cancel any pending timer (e.g. from a previous updatedCallback)
    if (this.#deferredLoadTimer) {
      clearTimeout(this.#deferredLoadTimer);
      this.#deferredLoadTimer = null;
    }

    if (!this.querySelector("[data-deferred-slides]") && !this.querySelector("[data-deferred-thumbnails]")) {
      return;
    }

    this.#deferredLoadTimer = setTimeout(() => {
      this.#deferredLoadTimer = null;
      this.#loadDeferredSlides();
    }, 1500);
  }

  /**
   * After DOM changes from deferred slides, re-measure Swipers on the next frame.
   * Main gallery uses autoHeight — Swiper's update() alone may not refresh wrapper height.
   */
  #flushDeferredCarouselLayout() {
    const carousel = this.carousel;
    if (!carousel) return;

    requestAnimationFrame(() => {
      if (carousel.swiperInstance && !carousel.swiperInstance.destroyed) {
        carousel.swiperInstance.update();
        if (carousel.swiperInstance.params?.autoHeight) {
          carousel.swiperInstance.updateAutoHeight(0);
        }
      }

      this.#applyThumbStripMaxHeight();

      if (carousel.thumbnailSwiper && !carousel.thumbnailSwiper.destroyed) {
        carousel.thumbnailSwiper.update();
      }
    });
  }

  /**
   * Progressively move deferred slides from <template> into the live DOM.
   * Processes DEFERRED_BATCH_SIZE slides per animation frame to avoid jank.
   */
  #loadDeferredSlides() {
    const slideTemplate = this.querySelector("[data-deferred-slides]");
    const thumbTemplate = this.querySelector("[data-deferred-thumbnails]");

    if (!slideTemplate && !thumbTemplate) return;

    const mainWrapper = this.querySelector("[data-main-wrapper]");
    const thumbWrapper = this.querySelector("[data-thumbs-swiper] > .swiper-wrapper");
    const batchSize = MediaGallery.DEFERRED_BATCH_SIZE;

    const loadBatch = () => {
      let hasMore = false;
      let appendedMain = false;
      let appendedThumb = false;

      // --- Main slides batch ---
      if (slideTemplate?.parentNode && mainWrapper) {
        const slides = slideTemplate.content.children;
        const count = Math.min(batchSize, slides.length);
        if (count > 0) {
          appendedMain = true;
        }
        for (let i = 0; i < count; i++) {
          mainWrapper.appendChild(slides[0]); // [0] shifts as children are moved
        }
        if (slides.length === 0) {
          slideTemplate.remove();
        } else {
          hasMore = true;
        }
      }

      // --- Thumbnail slides batch ---
      if (thumbTemplate?.parentNode && thumbWrapper) {
        const thumbs = thumbTemplate.content.children;
        const count = Math.min(batchSize, thumbs.length);
        if (count > 0) {
          appendedThumb = true;
        }
        for (let i = 0; i < count; i++) {
          thumbWrapper.appendChild(thumbs[0]);
        }
        if (thumbs.length === 0) {
          thumbTemplate.remove();
        } else {
          hasMore = true;
        }
      }

      if (hasMore) {
        if (appendedMain || appendedThumb) {
          this.#flushDeferredCarouselLayout();
        }
        requestAnimationFrame(loadBatch);
      } else {
        this.#flushDeferredCarouselLayout();
        this.#setupZoomReveal();
      }
    };

    requestAnimationFrame(loadBatch);
  }

  /**
   * Immediately load ALL deferred slides (synchronous, no batching).
   * Used when a variant change needs a slide that's still in the <template>.
   * A brief jank is acceptable because this is a user-initiated action.
   */
  #forceLoadAllDeferred() {
    const slideTemplate = this.querySelector("[data-deferred-slides]");
    const thumbTemplate = this.querySelector("[data-deferred-thumbnails]");

    if (!slideTemplate && !thumbTemplate) return;

    // Cancel scheduled progressive load — we're loading everything now
    if (this.#deferredLoadTimer) {
      clearTimeout(this.#deferredLoadTimer);
      this.#deferredLoadTimer = null;
    }

    // Move ALL main slides at once
    if (slideTemplate) {
      const mainWrapper = this.querySelector("[data-main-wrapper]");
      if (mainWrapper) {
        while (slideTemplate.content.firstChild) {
          mainWrapper.appendChild(slideTemplate.content.firstChild);
        }
      }
      slideTemplate.remove();
    }

    // Move ALL thumbnail slides at once
    if (thumbTemplate) {
      const thumbWrapper = this.querySelector("[data-thumbs-swiper] > .swiper-wrapper");
      if (thumbWrapper) {
        while (thumbTemplate.content.firstChild) {
          thumbWrapper.appendChild(thumbTemplate.content.firstChild);
        }
      }
      thumbTemplate.remove();
    }

    this.#flushDeferredCarouselLayout();
    this.#setupZoomReveal();
  }

  // ---------------------------------------------------------------------------
  // Zoom reveal (CSS-only zoom-out)
  // ---------------------------------------------------------------------------

  /**
   * CSS-only zoom-out reveal for product media.
   * Replaces per-element <motion-component> with a single shared IntersectionObserver.
   * When a .media-zoom-reveal element enters viewport and its image loads,
   * adds .is-revealed → CSS transition handles the zoom-out animation.
   */
  #setupZoomReveal() {
    this.#zoomRevealObserver?.disconnect();

    const items = this.querySelectorAll("[data-zoom-reveal]:not(.is-revealed)");
    if (!items.length) return;

    this.#zoomRevealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.#revealItem(entry.target);
            this.#zoomRevealObserver?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: "50px" }
    );

    items.forEach((item) => this.#zoomRevealObserver.observe(item));
  }

  /**
   * Reveal a single media item after its image loads (or immediately if already loaded).
   * @param {Element} element
   */
  #revealItem(element) {
    const img = element.querySelector("img");

    // If no image or already loaded, reveal immediately
    if (!img || img.complete) {
      element.classList.add("is-revealed");
      return;
    }

    const reveal = () => element.classList.add("is-revealed");
    img.addEventListener("load", reveal, { once: true });
    img.addEventListener("error", reveal, { once: true });

    // Safety timeout — don't block forever if image fails silently
    setTimeout(() => {
      if (!element.classList.contains("is-revealed")) {
        element.classList.add("is-revealed");
      }
    }, 5000);
  }

  get carousel() {
    return this.refs.carousel;
  }
}

if (!customElements.get("media-gallery")) {
  customElements.define("media-gallery", MediaGallery);
}
