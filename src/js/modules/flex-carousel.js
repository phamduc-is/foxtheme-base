import { CarouselComponent } from "@theme/carousel";

/**
 * @capability Swiper-backed carousel that also drives .edge__shadows edge-fade state — toggles is--active/is--beginning/is--end from the Swiper instance's reachBeginning/reachEnd/fromEdge events (main and thumbnail swipers).
 * @when A carousel whose overflowing row needs the scheme-aware gradient fade at each edge (src/scss/global/_component-edge-shadows.scss). For a plain CSS-scroll row (tabs, pills) use swipe-component instead — same three classes, no Swiper. Building a carousel that rewrites the strip behind Swiper's back (cloning slides for a manual loop, tearing the instance down past a breakpoint)? Extend this class instead of re-deriving the state — carousel-centered-slider.js is the worked example.
 * @contract <flex-carousel> (extends carousel-slider markup: ref="container" + slides, config via data-options or <script ref="config">); one or more .edge__shadows wrappers inside, a wrapper with ref="thumbnails" binds to the thumbnail swiper. A wrapper upgraded with is="swipe-component" is never driven — that element drives itself below the mobile breakpoint. State clears itself on `carousel:destroyed` (breakpoint teardown, morph), so no CSS breakpoint muting is needed. Subclass hook: call refreshEdgeShadows({ looping, active }) after any change Swiper's own reachBeginning/reachEnd/fromEdge events cannot see; a wrapper whose swiper is missing or destroyed is skipped, never activated.
 * @keywords carousel edge fade, gradient fade, scroll shadow, overflow hint, edge shadows, swiper edges, fade at edges, carousel overflow indicator
 */
export class FlexCarousel extends CarouselComponent {
  /** @type {(() => void) | null} */
  #edgeShadowCleanup = null;
  // Persistent handlers, not `{ once: true }`: the parent destroys and recreates its Swiper
  // on breakpoint crossings (destroyBelow/destroyAbove) and on morph, and every recreation
  // fires a fresh `carousel:ready` that has to re-bind the fade — a once-listener covers
  // only the first cycle and leaves the fade dead after the first teardown. Class fields so
  // add/remove in connected/disconnectedCallback reference the same function on reconnect.
  #onCarouselReady = () => this.#init();
  #onCarouselDestroyed = () => this.refreshEdgeShadows({ active: false });

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener("carousel:ready", this.#onCarouselReady);
    this.addEventListener("carousel:destroyed", this.#onCarouselDestroyed);

    // In case Swiper initialised before our listener was attached
    if (this.swiperInstance) {
      this.#init();
    }
  }

  disconnectedCallback() {
    this.removeEventListener("carousel:ready", this.#onCarouselReady);
    this.removeEventListener("carousel:destroyed", this.#onCarouselDestroyed);
    this.#edgeShadowCleanup?.();
    this.#edgeShadowCleanup = null;
    super.disconnectedCallback?.();
  }

  #init() {
    if (!this.swiperInstance) return;

    // Re-binding on every `carousel:ready` (a morph re-registers the listener in
    // `updatedCallback`) would stack another set of Swiper handlers per
    // `.edge__shadows` element, so drop the previous bindings first.
    this.#edgeShadowCleanup?.();
    this.#edgeShadowCleanup = null;

    const EVENTS = ["reachBeginning", "reachEnd", "fromEdge"];
    const shadowsList = this.querySelectorAll(".edge__shadows");
    /** @type {(() => void)[]} */
    const unbinders = [];

    shadowsList.forEach((edgeEl) => {
      if (!this.#ownsShadow(edgeEl)) return;

      const swiper = this.#swiperFor(edgeEl);
      if (!swiper) return;

      edgeEl.classList.add("is--active");

      this.#updateShadow(edgeEl, swiper);

      EVENTS.forEach((evt) => {
        const handler = () => this.#updateShadow(edgeEl, swiper);
        swiper.on(evt, handler);
        unbinders.push(() => swiper.off(evt, handler));
      });
    });

    if (unbinders.length > 0) {
      this.#edgeShadowCleanup = () => unbinders.forEach((off) => off());
    }
  }

  /**
   * Whether this carousel is the driver of a given `.edge__shadows` wrapper. A wrapper
   * upgraded with `is="swipe-component"` (the mobile-fade wrapper) is NOT ours: swipe-component
   * writes the same three state classes from scrollLeft below the mobile breakpoint and
   * clears them above it. Both wrappers sit inside this element, so without this test the
   * fade painted twice on desktop and the two drivers fought over `is--active`.
   * @param {Element} edgeEl
   */
  #ownsShadow(edgeEl) {
    return edgeEl.getAttribute("is") !== "swipe-component";
  }

  /**
   * Re-evaluate every `.edge__shadows` wrapper now.
   *
   * The state classes are otherwise only refreshed from Swiper's
   * `reachBeginning`/`reachEnd`/`fromEdge` events, so a subclass that changes the
   * strip out from under Swiper — cloning slides for a manual loop, dropping the
   * clones again, tearing the instance down past a viewport threshold — leaves
   * whatever classes were last written frozen in place. Call this after any such
   * change.
   *
   * @param {{ looping?: boolean, active?: boolean }} [state]
   *   `looping: true` forces both edges lit: a looping strip always has more
   *   content on either side, and `isBeginning`/`isEnd` (computed over the FULL
   *   strip, clones included) never go true anyway. `active: false` clears
   *   `is--active`, hiding the fade entirely — for when the carousel no longer
   *   drives the row at all.
   */
  refreshEdgeShadows(state = {}) {
    const { looping, active } = state;

    this.querySelectorAll(".edge__shadows").forEach((edgeEl) => {
      if (!this.#ownsShadow(edgeEl)) return;

      if (active === false) {
        edgeEl.classList.remove("is--active", "is--beginning", "is--end");
        return;
      }

      // Resolve the swiper BEFORE activating, so this path obeys the same rule as
      // `#init`: a wrapper whose swiper does not exist is not driven by anything,
      // and activating it would paint both fades permanently with
      // `is--beginning`/`is--end` frozen. `destroyed` matters for its own reason —
      // `destroy(true, …)` runs `deleteProps`, so `isBeginning` reads `undefined`
      // and `classList.toggle(name, undefined)` FLIPS the class instead of
      // clearing it.
      const swiper = this.#swiperFor(edgeEl);
      if (!swiper || swiper.destroyed) return;

      edgeEl.classList.add("is--active");

      if (looping) {
        edgeEl.classList.remove("is--beginning", "is--end");
        return;
      }

      this.#updateShadow(edgeEl, swiper);
    });
  }

  /**
   * The Swiper a given `.edge__shadows` wrapper reflects. Returns null when that
   * swiper does not exist — a wrapper can be marked `ref="thumbnails"` while the
   * thumbnail swiper is disabled at this breakpoint or not yet initialised, and
   * binding to it blindly would throw.
   * @param {Element} edgeEl
   */
  #swiperFor(edgeEl) {
    return edgeEl.getAttribute("ref") === "thumbnails" ? this.thumbnailSwiper : this.swiperInstance;
  }

  #updateShadow(edgeEl, swiper) {
    edgeEl.classList.toggle("is--beginning", swiper.isBeginning);
    edgeEl.classList.toggle("is--end", swiper.isEnd);
  }
}

if (!customElements.get("flex-carousel")) {
  customElements.define("flex-carousel", FlexCarousel);
}
