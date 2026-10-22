import { Component } from "@theme/component";
import { mediaHoverFine, prefersReducedMotion } from "@theme/utilities";

/**
 * @capability Hover/focus video preview card — after a 120ms hover-intent delay it lazy-loads and plays the card's deferred-media video and hides the overlay content, pausing and restoring on leave; pointer-fine devices only, reduced-motion respected, and switched off wholesale by a [data-video-card-off] ancestor.
 * @when Any card/tile whose video should preview on hover: video grids, lookbook tiles, media cards. Pairs with src/scss/global/_block-video-card.scss. Reuse instead of wiring mouseenter → video.play() by hand.
 * @contract <video-card> containing a <deferred-media> child (uses its showDeferredMedia/playMedia/pauseMedia API and data-media-loaded attr) and an optional [data-video-card-content] overlay; toggles is-hovering on itself and is-hidden on the overlay. Any ancestor carrying [data-video-card-off] suppresses the hover binding entirely — for a host whose tiles come from nested theme blocks and so cannot choose the tag themselves.
 * @keywords hover video, video preview, autoplay on hover, video card, hover play, media tile, hover intent, focus play, pause on leave, disable hover play, data-video-card-off
 */
class VideoCard extends Component {
  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {number | null} */
  #hoverIntentTimer = null;

  connectedCallback() {
    super.connectedCallback();

    // Respect reduced motion: do not autoplay on hover/focus.
    if (prefersReducedMotion()) return;

    // An ancestor can switch hover-play off. A host that builds its tiles from
    // NESTED theme blocks cannot pick between <video-card> and a plain <div> in
    // Liquid — a nested block receives no `content_for` params, so the setting
    // that should govern the tile never reaches the file that renders it. An
    // attribute on a wrapper the host DOES own is the one gate left. Read on
    // connect only: this is a render-time decision, not a runtime toggle.
    if (this.closest("[data-video-card-off]")) return;

    // Only bind hover autoplay for pointer-fine devices.
    if (!mediaHoverFine()) return;

    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    this.addEventListener("mouseenter", this.#onEnter, { signal });
    this.addEventListener("mouseleave", this.#onLeave, { signal });
    this.addEventListener("focusin", this.#onEnter, { signal });
    this.addEventListener("focusout", this.#onFocusOut, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
    this.#abortController = null;
    this.#clearHoverIntent();
  }

  get deferredMedia() {
    return this.querySelector("deferred-media");
  }

  get content() {
    return this.querySelector("[data-video-card-content]");
  }

  #clearHoverIntent() {
    if (this.#hoverIntentTimer) {
      window.clearTimeout(this.#hoverIntentTimer);
      this.#hoverIntentTimer = null;
    }
  }

  #onEnter = () => {
    this.#clearHoverIntent();

    // Small delay avoids accidental scrubs when moving pointer across a grid.
    this.#hoverIntentTimer = window.setTimeout(() => {
      this.#setActive(true);
      void this.#play();
    }, 120);
  };

  #onLeave = () => {
    this.#clearHoverIntent();
    this.#setActive(false);
    this.#pause();
  };

  #onFocusOut = (event) => {
    const next = event.relatedTarget;
    if (next instanceof HTMLElement && this.contains(next)) return;
    this.#onLeave();
  };

  #setActive(isActive) {
    this.classList.toggle("is-hovering", isActive);
    this.content?.classList.toggle("is-hidden", isActive);
  }

  async #play() {
    const dm = this.deferredMedia;
    if (!dm) return;

    // If poster exists and media isn't loaded, load + play.
    if (!dm.hasAttribute("data-media-loaded")) {
      await dm.showDeferredMedia?.();
      return;
    }

    await dm.playMedia?.();
  }

  #pause() {
    const dm = this.deferredMedia;
    if (!dm) return;
    dm.pauseMedia?.();
  }
}

if (!customElements.get("video-card")) {
  customElements.define("video-card", VideoCard);
}


