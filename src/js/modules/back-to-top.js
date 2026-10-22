import { Component } from "@theme/component";
import { getLenis } from "@theme/utilities";

/**
 * @capability Floating "scroll back to top" button — toggles a .show class once the page is scrolled past 400px (Lenis-aware) and smooth-scrolls to top on click.
 * @when Any fixed/floating return-to-top affordance. Pair with src/scss/global/_component-back-to-top.scss for the fixed positioning + show/hide styles.
 * @contract <back-to-top> custom element; a child button wired with on:click="/backToTop"; visibility styled via the .show class on the host.
 * @keywords back to top, scroll to top, return to top, scroll up button, floating button, page top, smooth scroll
 */
class BackToTop extends Component {
  #lenis = null;

  constructor() {
    super();

    this.toggleVisibilityHandler = this.#toggleVisibility.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();

    this.#lenis = getLenis();

    if (this.#lenis) {
      this.#lenis.on("scroll", this.toggleVisibilityHandler);
    } else {
      window.addEventListener("scroll", this.toggleVisibilityHandler);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.#lenis) {
      this.#lenis.off("scroll", this.toggleVisibilityHandler);
    } else {
      window.removeEventListener("scroll", this.toggleVisibilityHandler);
    }
  }

  backToTop(event) {
    event?.preventDefault();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  #toggleVisibility() {
    const scrollY = this.#lenis ? this.#lenis.scroll : window.scrollY;
    const shouldVisible = scrollY > 400;

    if (this._wasVisible !== shouldVisible) {
      this._wasVisible = shouldVisible;
      this.classList.toggle("show", shouldVisible);
    }
  }
}

customElements.define("back-to-top", BackToTop);
