import { inView } from "@theme/animation";
import { ThemeEvents } from "@theme/events";
import { motionToken } from "@theme/utilities";

/**
 * @capability In-view reveal for a highlighted text run — a customized built-in <em> that adds the `is-in-view` state class the first time it scrolls into view; the CSS turns that into the highlight shape sweeping in along the reading direction (left→right, right→left in RTL).
 * @when Rich text whose italic runs are styled as highlights ("Highlight style" → Solid background) and the shape should draw in on scroll instead of being there from first paint. Emitted by snippets/highlight-text.liquid only when theme animations are on; loaded globally by snippets/scripts.liquid.
 * @contract <em is="highlight-text" class="highlight-text highlight-text--solid-background highlight-text--reveal">…</em>; `.highlight-text--reveal` holds the collapsed shape until `is-in-view` is added (see _component-highlight-text.scss). Inside a <motion-text> or <motion-component> it follows that entrance instead of the viewport, on every run: added when its own words are --motion-highlight-start (0.4) of the way through their entrance (the host's landingAt(), asked on each motionStart; data-initialized as the fallback), collapsed on their clock while they leave (data-motion-exiting + the host's exitTiming), removed at once when they are staged again. Outside one it is one-shot: stops observing after the first entry.
 * @keywords highlight, highlighted text, text highlight, marker, background sweep, reveal on scroll, in view, italic, em, rich text
 */
class HighlightText extends HTMLElement {
  #inViewStop = null;

  /** @type {MutationObserver | null} */
  #followHost = null;

  /** @type {AbortController | null} */
  #abort = null;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #timer;

  /** @type {Animation | null} */
  #collapse = null;

  connectedCallback() {
    // Inside an entrance — split text or a whole block — the shape follows
    // that entrance rather than the viewport.
    const host = this.closest("motion-text, motion-component");
    if (host) {
      this.#follow(host);
      return;
    }
    this.#inViewStop = inView(this, () => this.classList.add("is-in-view"), { margin: "0px 0px -50px 0px" });
  }

  disconnectedCallback() {
    this.#inViewStop?.();
    this.#inViewStop = null;
    this.#followHost?.disconnect();
    this.#followHost = null;
    this.#abort?.abort();
    this.#abort = null;
    clearTimeout(this.#timer);
    this.#collapse?.cancel();
    this.#collapse = null;
  }

  /**
   * Inside an entrance (<motion-text>, or a <motion-component> around the whole
   * block) the shape follows that entrance, on every run — not just the first:
   * a slide the visitor comes back to replays its text, and a shape left drawn
   * from last time sat there as a bar of colour over text still arriving, or,
   * with a block entrance, never drew again at all.
   *
   * It sweeps in as ITS OWN words land: each time the host starts a run it
   * says when this run carries the words inside this <em> --motion-highlight-start
   * of the way through their entrance (landingAt), and the sweep starts then.
   * Waiting for the whole text to finish made the highlight in a longer heading
   * sit undrawn for as long as the words after it took. A run that is
   * superseded before that moment (a restage, an exit) moves landingAt, and
   * the stale timer stands down.
   *
   * It collapses on the words' own clock while they leave (data-motion-exiting,
   * exitTiming) and is gone at once when they are put back to their start.
   * data-initialized still shows it — the fallback for a run whose start this
   * element missed. When the boot watchdog gives up on the entrance (the arming
   * attribute removed) the text shows as it is, and so does the shape.
   *
   * @param {Element} host
   */
  #follow(host) {
    const root = document.documentElement;
    const armedBy = host.localName === "motion-text" ? "data-motion-text-armed" : "data-motion-armed";
    const anyHost = /** @type {any} */ (host);

    const show = () => {
      this.#collapse?.cancel();
      this.#collapse = null;
      this.classList.add("is-in-view");
    };

    const schedule = () => {
      const token = Number.parseFloat(motionToken("--motion-highlight-start", "0.4", this));
      const fraction = Number.isFinite(token) ? token : 0.4;
      const at = anyHost.landingAt?.(this, fraction);
      if (at == null) return;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(
        () => {
          if (anyHost.landingAt?.(this, fraction) === at) show();
        },
        Math.max(0, at - performance.now())
      );
    };

    const sync = () => {
      if (!root.hasAttribute(armedBy) || host.hasAttribute("data-initialized")) {
        show();
      } else if (host.hasAttribute("data-motion-exiting")) {
        clearTimeout(this.#timer);
        this.#collapseOn(anyHost.exitTiming);
      } else {
        // Not the timer: a run that has just started scheduled it in this very
        // task, before this observer heard about the restage that preceded it.
        this.#collapseNow();
      }
    };

    this.#abort = new AbortController();
    host.addEventListener(
      ThemeEvents.motionStart,
      (event) => {
        if (event.target === host) schedule();
      },
      { signal: this.#abort.signal }
    );

    this.#followHost = new MutationObserver(sync);
    this.#followHost.observe(host, {
      attributes: true,
      attributeFilter: ["data-initialized", "data-motion-exiting"],
    });
    this.#followHost.observe(root, { attributes: true, attributeFilter: [armedBy] });
    sync();
    // A run already under way when this element connected.
    schedule();
  }

  /** @param {{ durationMs: number, easing: string } | null} timing */
  #collapseOn(timing) {
    if (!this.classList.contains("is-in-view") || this.#collapse || !timing) {
      if (!timing) this.#collapseNow();
      return;
    }
    const collapse = this.animate(
      [{ backgroundSize: getComputedStyle(this).backgroundSize }, { backgroundSize: "0% 100%" }],
      { duration: timing.durationMs, easing: timing.easing, fill: "forwards" }
    );
    this.#collapse = collapse;
    collapse.finished
      .then(() => {
        if (this.#collapse !== collapse) return;
        this.#collapseNow();
      })
      .catch(() => {});
  }

  /** Back to the collapsed start, without the sweep running backwards. */
  #collapseNow() {
    this.#collapse?.cancel();
    this.#collapse = null;
    if (!this.classList.contains("is-in-view")) return;
    this.style.transition = "none";
    this.classList.remove("is-in-view");
    void this.offsetWidth;
    this.style.transition = "";
  }
}

if (!customElements.get("highlight-text")) {
  customElements.define("highlight-text", HighlightText, { extends: "em" });
}
