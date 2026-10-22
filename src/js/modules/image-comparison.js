import { Component } from "@theme/component";
import { prefersReducedMotion, getLenis, isRTL } from "@theme/utilities";
import { inView } from "@theme/animation";

/**
 * @capability Before/after image comparison slider — dragging the handle (mouse or touch, RTL-aware, horizontal or vertical) sets the --percent CSS variable that clips the two layers; plays an intro reveal animation on first scroll into view.
 * @when Before/after showcases: retouching, product results, material/finish comparisons — any two stacked images split by a draggable divider.
 * @contract <image-comparison data-direction="horizontal|vertical"> with refs rangeButton (drag handle), rangeButtonIcon, trigger (in-view intro target); reveal position consumed via the host's --percent custom property; state classes is-dragging / is-animating / [is-visible].
 * @keywords before after, image comparison, compare slider, drag handle, split image, reveal slider, diff images, before-after divider
 */
class ImageComparison extends Component {
  constructor() {
    super();

    this.startDragHandler = this.#onStartDrag.bind(this);
    this.dragHandler = this.#onDrag.bind(this);
    this.stopDragHandler = this.#onStopDrag.bind(this);
  }

  get isHorizontal() {
    return this.dataset.direction === "horizontal";
  }

  connectedCallback() {
    super.connectedCallback();

    this.#init();

    if (!prefersReducedMotion()) {
      this.#bindInView();
    }
  }

  #bindInView() {
    const { trigger } = this.refs;

    inView(
      trigger,
      () => {
        this.#enter();
      },
      { rootMargin: "0px 0px -50px 0px" }
    );
  }

  #enter() {
    this.setAttribute("is-visible", "");
    this.classList.add("is-animating");
    setTimeout(() => {
      this.classList.remove("is-animating");
    }, 1e3);
  }

  #init() {
    const { rangeButton, rangeButtonIcon } = this.refs;

    // Set default value to prevent undefined during early drag
    this.offset = 31;

    // Defer layout measurement to avoid forced reflow
    requestAnimationFrame(() => {
      this.offset = rangeButtonIcon ? rangeButtonIcon.offsetWidth / 2 : this.offset;
    });

    rangeButton.addEventListener("touchstart", this.startDragHandler);
    rangeButton.addEventListener("mousedown", this.startDragHandler);
  }

  #onStartDrag(event) {
    event.preventDefault();
    document.documentElement.classList.add("scroll-locked");

    this.classList.add("is-dragging");

    if (event.type === "mousedown") {
      document.addEventListener("mousemove", this.dragHandler);
      document.addEventListener("mouseup", this.stopDragHandler);
    } else if (event.type === "touchstart") {
      document.addEventListener("touchmove", this.dragHandler, { passive: false });
      document.addEventListener("touchend", this.stopDragHandler);
    }
  }

  #onStopDrag() {
    this.classList.remove("is-dragging");

    document.removeEventListener("mousemove", this.dragHandler);
    document.removeEventListener("mouseup", this.stopDragHandler);

    document.removeEventListener("touchmove", this.dragHandler);
    document.removeEventListener("touchend", this.stopDragHandler);

    const lenis = getLenis();
    if (lenis) {
      lenis.start();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.documentElement.classList.remove("scroll-locked");
        });
      });
    } else {
      document.documentElement.classList.remove("scroll-locked");
    }
  }

  #onDrag(e) {
    e.preventDefault();
    const event = (e.touches && e.touches[0]) || e;
    const rect = this.getBoundingClientRect();
    let x, distance;

    if (this.isHorizontal) {
      x = event.clientX - rect.left;
      distance = this.clientWidth;

      if (isRTL()) {
        x = distance - x; // Reverse the x position for RTL
      }
    } else {
      x = event.clientY - rect.top;
      distance = this.clientHeight;
    }

    const max = distance - this.offset;
    const min = this.offset;
    const mouseX = Math.max(min, Math.min(x, max));
    const mousePercent = (mouseX * 100) / distance;
    this.style.setProperty("--percent", mousePercent + "%");
  }
}

if (!customElements.get("image-comparison")) {
  customElements.define("image-comparison", ImageComparison);
}
