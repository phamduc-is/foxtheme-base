/**
 * Navigation Position feature for carousel.
 * Centers nav buttons vertically on a target element within the active slide.
 *
 * Config options (via "navigationPosition" in Swiper JSON):
 *   enabled  {boolean} - required
 *   selector {string}  - CSS selector for the media element to center on.
 *                        If the slide itself matches, it is used directly (no querySelector).
 *                        If omitted, the full slide height is used.
 *
 * Example — product media gallery (slide IS the media container):
 *   { "enabled": true, "selector": ".product-media" }
 *
 * Example — collection card (media is a child of the slide):
 *   { "enabled": true, "selector": ".card__media" }
 *
 * Example — use full slide height:
 *   { "enabled": true }
 */

/**
 * @param {import('../carousel.js').CarouselComponent} carousel
 * @param {Record<string, any>} options
 */
export function setupNavigationPosition(carousel, options) {
  const config = options?.navigationPosition;
  if (!config?.enabled) return;

  // Initial attempt. If the swiper container has 0 width (layout not settled),
  // offsetHeight will be 0 and we skip — the ResizeObserver below retries.
  requestAnimationFrame(() => performNavigationPositionCalculation(carousel, options));
}

// One ResizeObserver per carousel, watching whatever element is currently being measured.
//
// The init measurement is a single frame, and until this existed nothing re-ran it except a
// slide change or a Swiper `resize` — and Swiper's own observer only fires when `swiper.el`
// changes box, which a card whose media sits in a fixed-ratio frame never does. So a first
// frame that measured a not-yet-settled layout (0 height -> --nav-top removed, arrows fall
// back to the CSS 50% of the whole card) stayed wrong until the visitor changed slide.
/** @type {WeakMap<object, {observer: ResizeObserver, target: Element | null}>} */
const trackers = new WeakMap();

/**
 * Point the observer at the element the next measurement will use. Re-observing the SAME
 * element is skipped, which is what stops the observer's own callback from looping: it calls
 * the calculation, which calls this, which finds the target unchanged and returns.
 * @param {import('../carousel.js').CarouselComponent} carousel
 * @param {Record<string, any>} options
 * @param {Element} target
 */
function trackTarget(carousel, options, target) {
  if (typeof ResizeObserver === "undefined") return;

  let tracker = trackers.get(carousel);
  if (!tracker) {
    tracker = {
      target: null,
      observer: new ResizeObserver(() => performNavigationPositionCalculation(carousel, options)),
    };
    trackers.set(carousel, tracker);
  }

  if (tracker.target === target) return;
  if (tracker.target) tracker.observer.unobserve(tracker.target);
  tracker.observer.observe(target);
  tracker.target = target;
}

/**
 * Drop the observer. Called from the carousel's destroy path, since a breakpoint teardown or
 * a morph leaves the old element behind.
 * @param {import('../carousel.js').CarouselComponent} carousel
 */
export function teardownNavigationPosition(carousel) {
  const tracker = trackers.get(carousel);
  if (!tracker) return;
  tracker.observer.disconnect();
  trackers.delete(carousel);
}

/**
 * Measure the target element in the active slide and set --nav-top.
 * Safe to call multiple times (on resize, slide change).
 * @param {import('../carousel.js').CarouselComponent} carousel
 * @param {Record<string, any>} options
 */
export function performNavigationPositionCalculation(carousel, options) {
  const config = options?.navigationPosition;
  if (!config?.enabled) return;

  const swiper = carousel.swiperInstance;
  if (!swiper || swiper.destroyed) return;

  const slide = swiper.slides?.[swiper.activeIndex];
  if (!slide) return;

  const selector = config.selector;
  const target = resolveTarget(slide, selector);

  // Before the early return below: a target measuring 0 now is exactly the case the observer
  // exists for, so it has to be watched even on the frame the measurement is abandoned.
  trackTarget(carousel, options, target);

  // Measure from the CAROUSEL, not from the slide. `--nav-top` is consumed as the `top` of
  // an absolutely positioned button whose containing block is `.carousel` (the only
  // positioned ancestor), so the origin has to be the same element or the two disagree.
  //
  // Measuring from the slide happened to give the same number for a long time, because in
  // most sections the slide strip is the first thing inside the carousel. It breaks as soon
  // as anything sits above the strip inside that element — a heading row, as in the product
  // recommendations block — where the arrows then float too high by exactly that row's
  // height.
  //
  // LAYOUT for both numbers, not rects. A rect carries every transform on the way up, and the
  // two elements here do not share them: the entrance motion translates the slide row
  // (`is="motion-group"` on .swiper-wrapper) while .carousel stays put, and a selector can
  // name the <img> itself, which the zoom reveal arms at `scale(1.15)` and tweens to none
  // over 1.3s — the rect then read 15% tall and the centre landed ~7.5% low. offsetTop and
  // offsetHeight are layout, so no animation reaches them. That matters more than it sounds:
  // a settling transform fires no ResizeObserver, so a rect measured mid-animation used to
  // stick until the visitor changed slide.
  //
  // Rects stay as the fallback for the two questions layout cannot answer: an SVG target
  // (responsive-image renders `placeholder_svg_tag` as `.media__image` when a merchant image
  // is missing, and SVGElement has no offsetHeight at all — undefined, not 0), and an
  // offsetParent chain that never reaches the carousel. A rect is still 0 while layout has
  // not settled, so the not-ready path below keeps working either way.
  const carouselRect = carousel.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // Scale compensation, for those fallback reads only. Inside a dialog still playing its open
  // animation (`dialogScaleIn`, scale 0.8 → 1) every rect is shrunk by the same factor, and
  // the first measurement that sees a laid-out container — the gallery is injected while the
  // dialog is closed — lands on that very frame. Measured in the quick view: 170.8px written
  // for a 213.5px centre, arrows parked at 80% of the way until the next slide change re-ran
  // this. offsetWidth is layout, never transformed, so the ratio recovers the un-scaled
  // numbers.
  const scale = carousel.offsetWidth ? carouselRect.width / carousel.offsetWidth : 0;

  const layoutHeight = typeof target.offsetHeight === "number" ? target.offsetHeight : 0;
  const height = layoutHeight || (scale ? targetRect.height / scale : 0);
  if (!height) {
    // Not ready yet (0-width container). Remove stale value so CSS fallback applies.
    carousel.style.removeProperty("--nav-top");
    return;
  }

  // The carousel is `position: relative`, so the chain normally does reach it.
  const layoutTop = offsetTopWithin(target, carousel);
  const offsetTop =
    layoutTop === null
      ? Math.max(0, Math.round((targetRect.top - carouselRect.top) / scale))
      : Math.max(0, Math.round(layoutTop));

  carousel.style.setProperty("--nav-top", `${offsetTop + height / 2}px`);
}

/**
 * Resolve the measurement target within a slide.
 * Priority: slide itself (if it matches selector) → descendant → full slide.
 * @param {HTMLElement} slide
 * @param {string | undefined} selector
 * @returns {HTMLElement}
 */
function resolveTarget(slide, selector) {
  if (!selector) return slide;
  if (slide.matches(selector)) return slide;
  return slide.querySelector(selector) ?? slide;
}

/**
 * Distance from `ancestor`'s padding edge down to `target`, summed along the offsetParent
 * chain. Null when the chain does not pass through `ancestor` — an absolutely positioned
 * element in between can take it elsewhere — so the caller can fall back to rects.
 * @param {HTMLElement} target
 * @param {HTMLElement} ancestor
 * @returns {number | null}
 */
function offsetTopWithin(target, ancestor) {
  let top = 0;
  /** @type {HTMLElement | null} */
  let node = target instanceof HTMLElement ? target : null;

  while (node && node !== ancestor) {
    top += node.offsetTop;
    node = /** @type {HTMLElement | null} */ (node.offsetParent);
  }

  return node === ancestor ? top : null;
}
