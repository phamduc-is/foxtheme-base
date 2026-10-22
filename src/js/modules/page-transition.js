import { animate } from "@theme/animation";
import { ThemeEvents } from "@theme/events";
import { prefersReducedMotion } from "@theme/utilities";

/**
 * @capability Full-page loading curtain — an opaque overlay painted with the page's first frame that fades itself out as soon as this module runs, broadcasting ThemeEvents.pageLoaded / pageTransitionStart / pageTransitionEnd so other components can sequence their entrances (motion-coordinator holds every entrance until pageTransitionEnd; reduced-motion never paints the curtain; a CSS backstop lifts it even if this module never arrives; bfcache restores handled). There is no exit fade: unload only broadcasts pageTransitionStart.
 * @when Themes with the page-transitions setting on; listen for ThemeEvents.pageTransitionEnd instead of DOMContentLoaded when something must start after the curtain clears. Pairs with src/scss/global/_component-page-transition.scss.
 * @contract A single <page-transition> overlay element in layout/theme.liquid; toggles body.page-loading, its own data-lifting (fade started) and hidden (fade done) attributes; body.page-transitions-enabled marks the feature active for other modules. Loaded FIRST among the module scripts in snippets/scripts.liquid — the curtain lifts when this module executes, and deferred modules execute in document order.
 * @keywords page transition, loading overlay, fade in page, page load event, entrance sequencing, preloader, navigation fade, bfcache
 */
// How long the curtain waits for the motion runtime past DOM-ready. Under the
// animations setting every entrance is prestaged by CSS from first paint —
// text at opacity 0, a zoom-out hero at scale 1.15 — until motion-component.js
// arrives and animates it. This module is the FIRST module script and has a
// small graph, so on a slow load it ran well before the motion runtime and the
// curtain revealed a page of prestaged starts (measured on the Stavo demo:
// runtime 785ms after the curtain began to lift — the hero sat zoomed for
// that long). Lifting is therefore gated on the runtime reporting in, capped:
// past the cap a prestaged page beats a blank one, and motion-boot's own
// watchdog handles a runtime that never comes.
const MOTION_RUNTIME_WAIT_MS = 1000;

class PageTransition extends HTMLElement {
  constructor() {
    super();

    window.addEventListener("beforeunload", () => {
      document.body.classList.add("page-loading");
      document.dispatchEvent(
        new CustomEvent(ThemeEvents.pageTransitionStart, {
          bubbles: true,
          detail: { direction: "out", timestamp: Date.now() },
        })
      );
    });

    // Safari 15: Module scripts may load after DOMContentLoaded has fired
    // Check readyState and run immediately if DOM is already ready
    const initOnLoad = async () => {
      await this.#motionRuntimeReady();
      document.dispatchEvent(
        new CustomEvent(ThemeEvents.pageLoaded, {
          bubbles: true,
          detail: { timestamp: Date.now() },
        })
      );
      this.hide();
    };

    if (document.readyState === "loading") {
      // DOM is still loading, wait for DOMContentLoaded
      window.addEventListener("DOMContentLoaded", initOnLoad, { once: true });
    } else {
      // DOM is already ready (interactive or complete), run immediately
      initOnLoad();
    }

    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        document.body.classList.remove("page-loading");
      }
    });
  }

  hide() {
    // Duration and curve come from --page-transition-duration / -ease on the
    // element (_component-page-transition.scss), so the JS fade and the CSS
    // backstop cannot drift apart. Both are tokens on purpose: a long lift
    // costs Speed Index (measured on the demo home page, Slow 4G, 4x CPU:
    // 1620ms with a 1s curtain vs 689ms without), so a theme that needs the
    // metric can shorten it without touching this file.
    const duration = prefersReducedMotion() ? 0 : this.#cssDuration();
    const easing = getComputedStyle(this).getPropertyValue("--page-transition-ease").trim() || "linear";
    // motion-coordinator releases the entrances it is holding when the fade
    // STARTS (ThemeEvents.pageLoaded, dispatched just before this), so they
    // cross-fade with the curtain instead of leaving a blank page behind it.
    // The attribute tells a registration that arrives mid-fade not to wait.
    this.setAttribute("data-lifting", "");
    // Hand over from the CSS backstop (see _component-page-transition.scss).
    // Two animations on one element keep the fade off the compositor — Lighthouse
    // reported it as "target has another animation which is incompatible".
    this.style.animation = "none";
    const finish = () => {
      this.hidden = true;
      document.dispatchEvent(
        new CustomEvent(ThemeEvents.pageTransitionEnd, {
          bubbles: true,
          detail: { timestamp: Date.now() },
        })
      );
    };
    animate(this, { opacity: 0 }, { duration, easing, allowWebkitAcceleration: true })
      .finished.then(finish)
      .catch(finish);
  }

  /**
   * Resolves once every armed half of the motion runtime has reported in
   * (`data-motion-booted` for motion-component, `data-motion-groups-booted` for
   * the built-in groups — see snippets/motion-boot.liquid), or after
   * MOTION_RUNTIME_WAIT_MS. Resolves at once when nothing is armed (animations
   * off, reduced motion) or the runtime is already here.
   *
   * @returns {Promise<void>}
   */
  #motionRuntimeReady() {
    const root = document.documentElement;
    const pending = () =>
      (root.hasAttribute("data-motion-armed") && !root.hasAttribute("data-motion-booted")) ||
      (root.hasAttribute("data-motion-builtins") && !root.hasAttribute("data-motion-groups-booted"));
    if (!pending()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };
      const observer = new MutationObserver(() => {
        if (!pending()) done();
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: [
          "data-motion-armed",
          "data-motion-booted",
          "data-motion-builtins",
          "data-motion-groups-booted",
        ],
      });
      const timer = setTimeout(done, MOTION_RUNTIME_WAIT_MS);
    });
  }

  /**
   * `--page-transition-duration` as seconds; accepts `0.5s` or `500ms`.
   * Falls back to the overlay token's value if the property is missing.
   *
   * @returns {number}
   */
  #cssDuration() {
    const raw = getComputedStyle(this).getPropertyValue("--page-transition-duration").trim();
    const value = parseFloat(raw);
    if (Number.isNaN(value)) return 0.5;
    return raw.endsWith("ms") ? value / 1000 : value;
  }
}

if (!customElements.get("page-transition")) {
  customElements.define("page-transition", PageTransition);
}
