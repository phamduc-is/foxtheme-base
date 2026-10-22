import { Component } from "@theme/component";
import { setupCounter } from "@theme/carousel-features/counter";

class FeaturedCollection extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { slider } = this.refs;

    if (slider) {
      if (slider.swiperInstance) {
        this.#initSliderNavigation();
      } else {
        slider.addEventListener(
          "carousel:ready",
          () => {
            this.#initSliderNavigation();
          },
          { once: true }
        );
      }
    }
  }

  updatedCallback() {
    super.updatedCallback?.();
    const { slider } = this.refs;
    if (slider) {
      slider.addEventListener("carousel:ready", () => this.#initSliderNavigation(), { once: true });
    }
  }

  /**
   * Hand the controls to Swiper when they live in this block's title row.
   *
   * Only the title row needs it. That row sits OUTSIDE `<flex-carousel>`, so the carousel
   * cannot find the buttons by itself and this block has to wire them across. When the
   * merchant moves the controls below the carousel they render INSIDE it, and `carousel.js`
   * does the whole job — including removing `hidden` — so there is nothing left to do here.
   *
   * The refs go away in that case rather than merely being unused: `ref=` inside a nested
   * Component belongs to that component, not to this one, so `this.refs.controls` is
   * undefined and the old unguarded `controls.classList` threw on every load in the `below`
   * position. Bail on the refs, not on the setting — the DOM is the thing that actually
   * differs, and reading the setting from here would just be a second source of truth.
   */
  #initSliderNavigation() {
    const { slider, controls, next, prev } = this.refs;
    if (!controls || !next || !prev) return;
    if (!slider?.swiperInstance) return;

    controls.classList.remove("hidden");
    slider.swiperInstance.params.navigation.nextEl = next;
    slider.swiperInstance.params.navigation.prevEl = prev;
    slider.swiperInstance.navigation.init();
    slider.swiperInstance.navigation.update();

    // Same bridge again, for the slide counter. The carousel's own lookup for it is
    // `querySelector('[ref="counter"]')` scoped to itself, which cannot see a title row that
    // sits above it — but `setupCounter` takes an explicit element for exactly this case, so
    // the counter needs no markup move, only the same hand-off the arrows already get.
    const { counter } = this.refs;
    if (counter) {
      setupCounter(slider, { counter: { el: counter } });
    }
  }
}

if (!customElements.get("featured-collection")) {
  customElements.define("featured-collection", FeaturedCollection);
}
