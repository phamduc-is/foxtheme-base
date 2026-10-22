/**
 * Counter feature for carousel
 * Displays current slide / total slides
 */

/**
 * Setup counter feature
 * @param {CarouselComponent} carousel - Carousel component instance
 * @param {Record<string, any>} options - Swiper options
 */
export function setupCounter(carousel, options) {
  const instance = carousel.swiperInstance;
  if (!instance) return;

  // Respect explicit disabling: only attach when counter option is present and truthy
  if (!Object.prototype.hasOwnProperty.call(options || {}, "counter")) return;
  if (!options.counter) {
    const maybeEl = /** @type {HTMLElement | null} */ (carousel.querySelector('[ref="counter"]'));
    if (maybeEl) maybeEl.classList.add("hidden");
    return;
  }

  /** @type {HTMLElement | null} */
  let counterEl = null;
  if (options?.counter?.el instanceof HTMLElement) {
    counterEl = options.counter.el;
  } else {
    counterEl = /** @type {HTMLElement | null} */ (carousel.querySelector('[ref="counter"]'));
  }
  if (!counterEl) return;

  // Ensure visible when enabled
  counterEl.classList.remove("hidden");

  const counterFormat =
    (options?.counter && typeof options.counter.format === "string"
      ? options.counter.format
      : carousel.counterFormat) || "{current} / {total}";

  const render = () => renderCounter(carousel, counterEl, counterFormat);

  // Initial render and updates
  render();
  instance.on("slideChange", render);
  instance.on("slidesLengthChange", render);
  instance.on("update", render);
  // Update on breakpoint change (e.g., desktop → mobile) - debounce to avoid multiple calls
  // Use longer debounce to ensure Swiper has finished updating slides and snapGrid
  let breakpointRenderTimeout = null;
  instance.on("breakpoint", () => {
    if (breakpointRenderTimeout) clearTimeout(breakpointRenderTimeout);
    breakpointRenderTimeout = setTimeout(() => {
      // Wait for Swiper to finish updating slides and snapGrid
      requestAnimationFrame(() => {
        render();
        breakpointRenderTimeout = null;
      });
    }, 150);
  });
  // Update on resize (slidesPerView might change) - debounce to avoid multiple calls
  // Use longer debounce to ensure Swiper has finished updating slides and snapGrid
  let resizeRenderTimeout = null;
  instance.on("resize", () => {
    if (resizeRenderTimeout) clearTimeout(resizeRenderTimeout);
    resizeRenderTimeout = setTimeout(() => {
      // Wait for Swiper to finish updating slides and snapGrid
      requestAnimationFrame(() => {
        render();
        resizeRenderTimeout = null;
      });
    }, 150);
  });
  // Ensure counter updates when translating near the end (quick-add case)
  instance.on("setTranslate", render);
}

/**
 * Render counter text according to current/total slides.
 * @param {CarouselComponent} carousel
 * @param {HTMLElement} el
 * @param {string} format
 */
function renderCounter(carousel, el, format) {
  const instance = carousel.swiperInstance;
  if (!instance) return;

  const slides = Array.from(instance.slides || []);
  const total = slides.filter((s) => !s.classList.contains("swiper-slide-duplicate")).length;

  // Cloned/looped carousels (Swiper native loop OR carousel-centered-slider's manual
  // loop with loop:false) duplicate slides, so activeIndex / realIndex / translate all
  // point into the array *including clones* — that freezes/jumps the counter near the
  // wrap. The active slide's REAL position is its data-swiper-slide-index (set on the
  // originals and copied onto the clones), so resolve straight from it.
  const hasDuplicates = slides.some((s) => s.classList.contains("swiper-slide-duplicate"));
  if (hasDuplicates) {
    // Read the active slide by index (always defined) — NOT by the `swiper-slide-active`
    // class, which can be momentarily absent during a loop jump and would fall through to
    // the clone-unaware translate math below. Each slide (original or clone) carries its
    // real position in `data-swiper-slide-index`.
    const activeSlide = slides[instance.activeIndex];
    const realIndex = parseInt(activeSlide?.getAttribute("data-swiper-slide-index") ?? "", 10);
    if (!Number.isNaN(realIndex)) {
      el.textContent = format
        .replace("{current}", String(realIndex + 1))
        .replace("{total}", String(total || slides.length || 0));
      return;
    }
  }

  // Everything below the loop branch keys off Swiper's snapGrid — the list of positions
  // navigation can actually land on, and the same list its pagination bullets are built
  // from. Counting raw slides instead is what produced "2 / 4" on a three-column row of
  // four cards: four slides at three per view is only two snap positions, so the arrows
  // went disabled at 2 while the counter still promised 4. A counter that names a total it
  // cannot reach is wrong under any reading, so the denominator has to be the reachable
  // one.
  //
  // This also retires a long stack of translate-vs-slidesGrid heuristics that used to live
  // here for `slidesPerView: "auto"` and decimal values. They existed to guess which slide
  // a translate belonged to, which is exactly what `snapIndex` already answers; with the
  // right denominator the guessing has nothing left to correct.
  const snapGrid = instance.snapGrid || [];
  if (snapGrid.length > 0) {
    const pages = snapGrid.length;
    const page = Math.min(Math.max((instance.snapIndex ?? 0) + 1, 1), pages);
    el.textContent = format.replace("{current}", String(page)).replace("{total}", String(pages));
    return;
  }

  // No snapGrid yet (measured before layout settles) — fall back to the slide count rather
  // than rendering nothing; the `slidesUpdated`/`resize` re-render corrects it.
  const currentIndex = typeof instance.activeIndex === "number" ? instance.activeIndex : 0;
  const text = format
    .replace("{current}", String(currentIndex + 1))
    .replace("{total}", String(total || slides.length || 0));

  el.textContent = text;
}
