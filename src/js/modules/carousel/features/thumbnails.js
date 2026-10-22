/**
 * Thumbnails feature for carousel
 * Displays thumbnail navigation for main carousel
 */

import { Swiper } from "@theme/swiper";

/**
 * Setup thumbnails feature
 * @param {import("../carousel.js").CarouselComponent} carousel - Carousel component instance
 * @param {Record<string, any>} config - Thumbnails config
 */
export function setupThumbnails(carousel, config) {
  // A carousel without a thumbnail strip is a normal configuration (a
  // one-image product, a gallery with thumbnails off), not a fault — nothing
  // to warn about. It used to console.warn here, which put a warning in the
  // console of every such product page.
  const thumbnailContainer = carousel.querySelector('[ref="thumbnails"]');
  if (!thumbnailContainer) return;

  initThumbnailSwiper(carousel, config);
  bindThumbnailEvents(carousel);

  // Before syncThumbnailsWithMain: that runs an initial slideTo, and the rail
  // should already be listening when it does.
  if (config.syncOnSwipe) {
    syncMainWithThumbnails(carousel);
  }

  syncThumbnailsWithMain(carousel);
}

/**
 * Initialize thumbnail swiper instance.
 * @param {import("../carousel.js").CarouselComponent} carousel
 * @param {Record<string, any>} config
 */
function initThumbnailSwiper(carousel, config) {
  const swiperEl = carousel.querySelector('[ref="thumbnails"] .carousel__thumbnails-swiper');
  if (!swiperEl) {
    console.warn("Thumbnail swiper element not found");
    return;
  }

  // `syncOnSwipe` is ours, not Swiper's — keep it out of the options we hand over.
  const { syncOnSwipe: _syncOnSwipe, ...swiperConfig } = config;

  const swiperOptions = {
    slidesPerView: config.slidesPerView || "auto",
    spaceBetween: config.spaceBetween ?? 8,
    watchSlidesProgress: true,
    slideToClickedSlide: true,
    centeredSlides: false,
    freeMode: false,
    ...swiperConfig,
  };

  carousel.thumbnailSwiper = new Swiper(swiperEl, swiperOptions);
}

/**
 * Bind thumbnail click events via event delegation.
 * Delegation ensures deferred thumbnails (loaded after init) also work.
 * @param {import("../carousel.js").CarouselComponent} carousel
 */
function bindThumbnailEvents(carousel) {
  const thumbnailContainer = carousel.querySelector('[ref="thumbnails"]');
  if (!thumbnailContainer) return;

  thumbnailContainer.addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-carousel-thumbnail]");
    if (!thumb) return;

    const allThumbs = Array.from(thumbnailContainer.querySelectorAll("[data-carousel-thumbnail]"));
    const index = allThumbs.indexOf(thumb);
    if (index !== -1) {
      carousel.goToSlide(index);
    }
  });
}

/**
 * Sync thumbnails with main carousel slide changes.
 * @param {import("../carousel.js").CarouselComponent} carousel
 */
function syncThumbnailsWithMain(carousel) {
  if (!carousel.swiperInstance) return;

  carousel.swiperInstance.on("slideChange", () => {
    const currentIndex = carousel.lastResolvedOptions?.loop
      ? (carousel.swiperInstance.realIndex ?? 0)
      : (carousel.swiperInstance.activeIndex ?? 0);

    updateActiveThumbnail(carousel, currentIndex);
  });

  // Set initial state
  const initialIndex = carousel.lastResolvedOptions?.loop
    ? (carousel.swiperInstance.realIndex ?? 0)
    : (carousel.swiperInstance.activeIndex ?? 0);
  updateActiveThumbnail(carousel, initialIndex);
}

/**
 * Sync the main carousel with user-driven thumbnail rail changes (opt-in via
 * `thumbnails.syncOnSwipe`). Off by default: a tall thumbnail rail is usually a
 * scroll-to-pick list, and moving the main slide as it scrolls fights that.
 *
 * Only a swipe counts. A rail prev/next button is not covered — it emits no touch
 * event, and Swiper's slideNext/Prev transition events fire for our own
 * programmatic `slideTo` too, so they cannot tell the two apart. A rail with its
 * own arrows should drive `carousel.goToSlide()` directly instead.
 *
 * Hooked on `transitionStart`, which is the rail's mirror of the main carousel's
 * `slideChange` — Swiper emits both out of the same `updateActiveIndex` pass, so
 * the two directions move together instead of the rail lagging a transition
 * behind. The alternatives do not work here: `transitionEnd` waits out the whole
 * animation, and `slideChange`/`snapIndexChange` fire on every frame of a drag
 * because `watchSlidesProgress` re-runs `updateActiveIndex` from `onTouchMove`.
 * @param {import("../carousel.js").CarouselComponent} carousel
 */
function syncMainWithThumbnails(carousel) {
  const thumbnailSwiper = carousel.thumbnailSwiper;
  if (!thumbnailSwiper) return;

  // Emitted before Swiper works out where the swipe lands, so the flag is always
  // set in time for the transitionStart that follows.
  //
  // `allowClick` is Swiper's own drag-vs-tap answer: it is cleared from onTouchMove
  // only once the finger passes the move threshold, so a tap still reads true here.
  // Taps must NOT take this path — `slideToClickedSlide` runs before the `tap` event
  // and, on a rail clamped at its end, snaps somewhere other than the thumb that was
  // tapped. bindThumbnailEvents resolves the tapped index exactly; leave it to that.
  thumbnailSwiper.on("touchEnd", () => {
    carousel.thumbnailUserDriven = !thumbnailSwiper.allowClick;
  });

  thumbnailSwiper.on("transitionStart", () => {
    // Default-deny: anything we cannot attribute to a swipe is our own move.
    if (!carousel.thumbnailUserDriven) return;
    carousel.thumbnailUserDriven = false;

    const index = resolveThumbnailIndex(thumbnailSwiper);
    if (index == null || index === getMainIndex(carousel)) return;

    carousel.goToSlide(index);
  });
}

/**
 * Resolve which slide the thumbnail rail is pointing at.
 *
 * `snapIndex` indexes `snapGrid` (snap points), `activeIndex` indexes slides. They
 * only differ when the rail is clamped at its end — where `snapIndex` is right —
 * or when snap points group several slides (`slidesPerGroup > 1`, `grid.rows`) —
 * where `snapIndex` is a group number and `activeIndex` is right.
 *
 * A looping rail counts duplicated slides in both, so neither maps onto the main
 * carousel's slides; `realIndex` does.
 * @param {any} swiper
 * @returns {number | null}
 */
function resolveThumbnailIndex(swiper) {
  if (swiper.params?.loop) {
    return typeof swiper.realIndex === "number" ? swiper.realIndex : null;
  }

  const oneSnapPerSlide = swiper.snapGrid?.length === swiper.slidesGrid?.length;
  const index = oneSnapPerSlide ? swiper.snapIndex : swiper.activeIndex;

  return typeof index === "number" ? index : null;
}

/**
 * Current slide index of the main carousel, loop-aware.
 * @param {import("../carousel.js").CarouselComponent} carousel
 * @returns {number}
 */
function getMainIndex(carousel) {
  return carousel.lastResolvedOptions?.loop
    ? (carousel.swiperInstance?.realIndex ?? 0)
    : (carousel.swiperInstance?.activeIndex ?? 0);
}

/**
 * Update active thumbnail based on current slide.
 * Queries dynamically so deferred thumbnails are always included.
 * @param {import("../carousel.js").CarouselComponent} carousel
 * @param {number} activeIndex
 */
function updateActiveThumbnail(carousel, activeIndex) {
  const thumbnailContainer = carousel.querySelector('[ref="thumbnails"]');
  if (!thumbnailContainer) return;

  const thumbs = thumbnailContainer.querySelectorAll("[data-carousel-thumbnail]");

  thumbs.forEach((thumb, index) => {
    thumb.classList.toggle("is-active", index === activeIndex);
  });

  if (carousel.thumbnailSwiper) {
    // Cleared first, and slideTo emits transitionStart synchronously, so a move we
    // initiate can never be read back as a swipe.
    carousel.thumbnailUserDriven = false;
    carousel.thumbnailSwiper.slideTo(activeIndex);
  }
}

/**
 * Destroy thumbnail swiper instance if present.
 * @param {import("../carousel.js").CarouselComponent} carousel
 */
export function destroyThumbnailSwiper(carousel) {
  if (carousel.thumbnailSwiper) {
    try {
      carousel.thumbnailSwiper.destroy(true, true);
    } catch (_e) {
      // Ignore
    }
    carousel.thumbnailSwiper = null;
    carousel.thumbnailUserDriven = false;
  }
}
