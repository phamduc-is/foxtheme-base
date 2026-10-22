import { getLenis } from "@theme/utilities";

/**
 * @capability Sticky behaviour for a side-by-side column (filter sidebar, results grid, product details), selectable per element via data-sticky-mode. "fit" (default): a column shorter than the viewport pins at the top exactly as .sticky-element already does, a TALLER one is released to scroll with the page so its tail is always reachable and nothing pins mid-scroll. "both": the taller column instead pins its bottom edge while scrolling down and its top edge while scrolling up (Amazon-style), so the other column stays in view at the cost of a stop at each edge. "off": never sticky. Attribute-only: upgrades the existing element, adds no wrapper DOM.
 * @when Any two-column layout where either column may outgrow the viewport — collection/search filter sidebar + product grid, product media + details. A bare .sticky-element on a column taller than the viewport buries that column's tail until the other column ends; this is the fix. Reach for it instead of max-height + overflow:auto (nested scroll).
 * @contract <div is="sticky-column" data-sticky-mode="fit|both|off" class="sticky-element [sticky-element--adapt]" style="--sticky-element-top: …">. CSS owns the pinning (top offset, header-pinned adaptation, transition). "fit"/"off" only toggle an inline `position: static`; "both" additionally drives three states through inline styles on a tall column — pinned top (CSS sticky), pinned bottom (sticky with a negative inline top) and "free" between them (position: relative holding the column where it painted when the buyer reversed). Re-measures on element resize (section morphs, filter toggle, accordions) and window resize; no-op while hidden. The grid/flex parent must not stretch the item (align-self: start) or there is no room to stick.
 * @keywords sticky sidebar, sticky column, sticky filter, sticky grid, tall sidebar, fit or flow, smart sticky, sticky both directions, scroll direction sticky, sticky-element, unpin when taller than viewport
 */

/** @typedef {"top" | "bottom" | "free"} StickyMode */

/**
 * Resolves a CSS length (`3rem`, `30px`) to pixels. Anything else → 0.
 * @param {string} value
 * @returns {number}
 */
function lengthToPx(value) {
  const number = parseFloat(value);
  if (Number.isNaN(number)) return 0;
  if (value.trim().endsWith("rem")) {
    return number * parseFloat(getComputedStyle(document.documentElement).fontSize);
  }
  return number;
}

class StickyColumn extends HTMLDivElement {
  /** @type {StickyMode} */
  #mode = "top";
  /** True while a "both" column is taller than the viewport and this module owns its inline styles. */
  #managed = false;
  #lastScrollY = 0;
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /** @type {MutationObserver | null} */
  #styleObserver = null;
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {any} */
  #lenis = null;

  get #behaviour() {
    const mode = this.dataset.stickyMode;
    return mode === "both" || mode === "off" ? mode : "fit";
  }

  connectedCallback() {
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    if (this.#behaviour === "both") {
      // Deliberately NOT deferred to requestAnimationFrame: a scroll event
      // runs in the same frame's rendering steps, before paint, so a mode
      // switch decided here lands in the frame that crossed the threshold.
      // Deferred a frame, the switch paints one scroll-delta late — a snap.
      this.#lenis = getLenis();
      if (this.#lenis) {
        this.#lenis.on("scroll", this.#onScroll);
      } else {
        window.addEventListener("scroll", this.#onScroll, { passive: true, signal });
      }
    }
    window.addEventListener("resize", this.#onResize, { passive: true, signal });

    // Any height change — a filter morph, the desktop filter toggle, an
    // accordion opening — can flip the column between "fits" and "taller".
    this.#resizeObserver = new ResizeObserver(this.#onResize);
    this.#resizeObserver.observe(this);

    // A Section Rendering morph rewrites the style attribute and with it the
    // inline `position` this module owns — with no height change to wake the
    // ResizeObserver (same result count) and, in "fit" mode, no scroll tick
    // to re-assert it. Watch the attribute itself; own writes are no-ops
    // (guarded in #setPosition) so this cannot loop. "both" re-asserts on
    // every scroll tick instead — and writes `top` freely, which would
    // otherwise wake this observer against itself.
    if (this.#behaviour !== "both") {
      this.#styleObserver = new MutationObserver(this.#onResize);
      this.#styleObserver.observe(this, { attributes: true, attributeFilter: ["style"] });
    }

    this.#lastScrollY = this.#scrollY;
    this.#update("none");
  }

  disconnectedCallback() {
    this.#lenis?.off("scroll", this.#onScroll);
    this.#lenis = null;
    this.#abortController?.abort();
    this.#abortController = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#styleObserver?.disconnect();
    this.#styleObserver = null;
    this.#release();
    this.style.removeProperty("position");
  }

  /**
   * Writes only on change so the style MutationObserver never re-enters.
   * @param {string | null} value - inline position, or null to hand back to CSS
   */
  #setPosition(value) {
    const current = this.style.position || null;
    if (current === value) return;
    if (value === null) this.style.removeProperty("position");
    else this.style.setProperty("position", value);
  }

  get #scrollY() {
    return this.#lenis ? this.#lenis.scroll : window.scrollY;
  }

  /**
   * The top offset CSS pins at: the element's own `--sticky-element-top` plus
   * the header height when `.sticky-element--adapt` is adapting to a pinned
   * header (mirrors `.header-pinned .sticky-element--adapt` in _helpers).
   * @param {boolean} [pinnedOnly] - count the header only while it is pinned
   */
  #topOffset(pinnedOnly = false) {
    const styles = getComputedStyle(this);
    let offset = lengthToPx(styles.getPropertyValue("--sticky-element-top"));
    const adapts = this.classList.contains("sticky-element--adapt");
    if (adapts && (!pinnedOnly || document.body.classList.contains("header-pinned"))) {
      offset += lengthToPx(styles.getPropertyValue("--header-height"));
    }
    return offset;
  }

  #onScroll = () => {
    const scrollY = this.#scrollY;
    const direction = scrollY > this.#lastScrollY ? "down" : scrollY < this.#lastScrollY ? "up" : "none";
    this.#lastScrollY = scrollY;
    this.#update(direction);
  };

  #onResize = () => {
    // Sizes changed under the current state, so any inline offset was
    // measured against a layout that no longer exists. Hand back to plain
    // CSS sticky (one-off reposition — the layout moved anyway) and let the
    // next reversal re-derive things from the new geometry.
    if (this.#managed) this.#enter("top");
    this.#update("none");
  };

  /**
   * @param {"down" | "up" | "none"} direction
   */
  #update(direction) {
    const behaviour = this.#behaviour;

    if (behaviour === "off") {
      this.#setPosition("static");
      return;
    }

    const height = this.offsetHeight;
    const viewportHeight = window.innerHeight;

    if (behaviour === "fit") {
      // The header is counted even while unpinned: the column must still fit
      // once the buyer scrolls up and the header comes back.
      const fits = height === 0 || height + this.#topOffset() <= viewportHeight;
      this.#setPosition(fits ? null : "static");
      return;
    }

    // "both"
    const topOffset = this.#topOffset(true);

    // Fits (or hidden): CSS owns the sticky top; nothing to do.
    if (height === 0 || height + topOffset <= viewportHeight) {
      this.#release();
      return;
    }

    if (!this.#managed) {
      this.#managed = true;
      this.#mode = "top";
    }

    // `.sticky-element` transitions `top` for the header-pinned adaptation;
    // the values written here are positional and must land at once. Re-asserted
    // every tick because a Section Rendering morph rewrites the style
    // attribute — and with it the inline state behind the current mode, so
    // what is left IS plain CSS sticky.
    if (this.style.transition !== "none") this.style.setProperty("transition", "none");
    if (this.#mode !== "top" && !this.style.top) this.#enter("top");

    const rect = this.getBoundingClientRect();

    // A reversal only matters while the edge is actually pinned; while the
    // column still flows (near the containing block's start or end) CSS
    // already scrolls it with the page, and switching would just churn.
    switch (this.#mode) {
      case "top":
        // Pinned at the top with the bottom out of reach — let it scroll
        // away with the page as soon as the buyer heads down.
        if (direction === "down" && rect.top <= topOffset + 1) this.#enter("free");
        break;
      case "bottom":
        if (direction === "up" && rect.bottom >= viewportHeight - 1) this.#enter("free");
        break;
      case "free":
        if (rect.bottom <= viewportHeight) this.#enter("bottom");
        else if (rect.top >= topOffset) this.#enter("top");
        break;
    }
  }

  /**
   * @param {StickyMode} mode
   */
  #enter(mode) {
    this.#mode = mode;

    if (mode === "top") {
      this.style.removeProperty("position");
      this.style.removeProperty("top");
      return;
    }

    if (mode === "bottom") {
      this.style.removeProperty("position");
      this.style.setProperty("top", `${window.innerHeight - this.offsetHeight}px`);
      return;
    }

    // "free": hold the column where it currently paints, as an offset from
    // its natural flow position, so it scrolls with the page from here. The
    // natural position is only observable with the sticky offset removed —
    // one forced layout per direction flip, which is rare.
    const currentTop = this.getBoundingClientRect().top;
    this.style.setProperty("position", "relative");
    this.style.setProperty("top", "0px");
    const naturalTop = this.getBoundingClientRect().top;
    this.style.setProperty("top", `${Math.max(0, currentTop - naturalTop)}px`);
  }

  #release() {
    if (!this.#managed) return;
    this.#managed = false;
    this.#mode = "top";
    this.style.removeProperty("position");
    this.style.removeProperty("top");
    this.style.removeProperty("transition");
  }
}

if (!customElements.get("sticky-column")) {
  customElements.define("sticky-column", StickyColumn, { extends: "div" });
}
