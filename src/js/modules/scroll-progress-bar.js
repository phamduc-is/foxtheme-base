import { mediaQueryMobile } from "@theme/utilities";

/**
 * @capability Mobile-only horizontal scroll progress indicator — fills a bar to reflect how far a target scroll container has been scrolled sideways (RTL-aware, ResizeObserver-refreshed, auto-hides when nothing overflows or on desktop).
 * @when A carousel/scroll row on mobile that needs a position indicator instead of dots or arrows — product grids that become scroll rows, chip rows, media strips. Reuse instead of computing scrollLeft percentages by hand.
 * @contract <scroll-progress-bar target="<id of the scrollable element>"> containing a .progress-bar child whose width is set in %; only active under the mobile media query.
 * @keywords scroll progress, scrollbar indicator, carousel progress, horizontal scroll position, progress bar, scroll indicator, mobile carousel, swipe progress
 */
class ScrollProgressBar extends HTMLElement {
  constructor() {
    super();
    this.mediaQuery = null;
    this.resizeObserver = null;
    this.scrollHandler = null;
    this.progressBar = null;
    this.targetPadding = 0;
    this.initialProgress = 0;
    this.mediaQueryHandler = null;
  }

  get totalWidth() {
    return this.target ? this.target.scrollWidth : 0;
  }

  get target() {
    return document.getElementById(this.getAttribute("target"));
  }

  connectedCallback() {
    this.mediaQuery = mediaQueryMobile;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.mediaQuery.matches) {
        this.init();
      }
    });

    this.mediaQueryHandler = (event) => {
      if (event.matches) {
        this.init();
      } else {
        this.disable();
      }
    };

    this.mediaQuery.addEventListener("change", this.mediaQueryHandler);

    if (!this.mediaQuery.matches) {
      this.disable();
      return;
    }

    this.init();
  }

  init() {
    if (!this.target) {
      console.error("Target element not found");
      return;
    }

    this.progressBar = this.querySelector(".progress-bar");
    if (!this.progressBar) {
      console.error("Progress bar element not found");
      return;
    }

    const targetStyle = window.getComputedStyle(this.target);
    this.targetPadding = parseFloat(targetStyle.paddingLeft) + parseFloat(targetStyle.paddingRight);

    this.resizeObserver.observe(this.target);

    const viewportWidth = this.target.clientWidth - this.targetPadding;
    if (this.totalWidth <= viewportWidth) {
      this.disable();
      return;
    }

    this.initialProgress = 0;
    this.calculateInitialProgress();

    this.scrollHandler = () => {
      requestAnimationFrame(() => this.updateProgress());
    };
    this.target.addEventListener("scroll", this.scrollHandler);

    this.style.display = "block";
    this.updateProgress();
  }

  disable() {
    if (this.scrollHandler && this.target) {
      this.target.removeEventListener("scroll", this.scrollHandler);
    }

    this.style.display = "none";

    if (this.progressBar) {
      this.progressBar.style.width = "0%";
    }

    if (this.target) {
      this.resizeObserver.unobserve(this.target);
    }
  }

  disconnectedCallback() {
    if (this.mediaQuery && this.mediaQueryHandler) {
      this.mediaQuery.removeEventListener("change", this.mediaQueryHandler);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.disable();
  }

  calculateInitialProgress() {
    if (!this.target || this.totalWidth === 0) {
      this.initialProgress = 0;
      return;
    }

    const viewportWidth = this.target.clientWidth - this.targetPadding;
    this.initialProgress = (viewportWidth / this.totalWidth) * 100;
    this.updateProgress();
  }

  updateProgress() {
    if (!this.target || !this.progressBar) {
      return;
    }

    const isRTL = document.documentElement.dir === "rtl" || document.body.dir === "rtl";
    const factor = isRTL ? -1 : 1;
    const viewportWidth = this.target.clientWidth - this.targetPadding;
    const scrolled = factor * this.target.scrollLeft;
    const maxScroll = this.totalWidth - viewportWidth;

    if (maxScroll <= 0) {
      return;
    }

    const scrollProgress = (scrolled / maxScroll) * (100 - this.initialProgress);
    const totalProgress = this.initialProgress + scrollProgress;
    const clampedProgress = Math.min(100, Math.max(this.initialProgress, totalProgress));

    this.progressBar.style.width = `${clampedProgress}%`;
  }
}

if (!customElements.get("scroll-progress-bar")) {
  customElements.define("scroll-progress-bar", ScrollProgressBar);
}
