import { Component } from "@theme/component";
import { prefersReducedMotion, entranceMotion, MOTION_DURATION_FALLBACK_MS } from "@theme/utilities";
import { motionCoordinator } from "@theme/motion-coordinator";
import { getMotionPreset } from "@theme/motion-presets";
import { animate, scroll } from "@theme/animation";

/**
 * @component parallax-component
 * @capability Scroll-linked parallax for full-bleed media — drifts the image/video inside its clipping box as the section crosses the viewport. Four modes: vertical, horizontal and zoom move the media with a compensating scale so no edge is ever exposed; fixed pins it to the viewport instead, so the section's window slides across a still image (the background-attachment: fixed look, without its iOS and LCP costs). With data-parallax-entrance it also plays the theme's zoom-out entrance NATIVELY, on the media's individual `scale` property, so no wrapping motion-component (whose transform would break `fixed`) is needed. The moving modes run on a native ViewTimeline where the browser has one, so the compositor applies the drift in the same frame as the scroll (no one-frame lag behind Lenis); Motion One's scroll() is the fallback. Inert under prefers-reduced-motion and when no intensity is set.
 * @when A hero/banner whose media should move against the page as you scroll. Wrap the media WRAPPER, not the clipping box — the box must stay still for the media to travel inside it. Not for entrance reveals (that is motion-component / data-motion) nor for the marquee's own scroll drift (marquee-component owns that).
 * @contract <parallax-component> wrapping media, with data-parallax="<0..1 intensity>", optional data-parallax-entrance (zoom-out on arrival, budgeted by motion-coordinator; stamps data-entrance-played when it runs — style the start state against its absence — and holds data-entrance-running only while the zoom is in flight, so its transition never outlives it; see _component-parallax), and optional data-parallax-direction="vertical|horizontal|zoom|fixed" (default vertical). Moves the img/video/svg/deferred-media it contains. The three moving modes need an ancestor with overflow:hidden and this script; `fixed` needs NEITHER — it is pure CSS in _component-parallax, and only requires that no ancestor carries a transform (the Liquid drops the entrance component for it). Moves the first-level img/video/svg/deferred-media it contains. Needs an ancestor (or the wrapped element) with overflow:hidden, and must pass its own height through to the media (block w-full h-full) when the host sizes children off it.
 * @keywords parallax, scroll effect, hero banner, banner motion, scroll-linked, drift, background movement, depth, zoom on scroll
 */
class ParallaxComponent extends Component {
  /** @type {(() => void) | null} Motion's scroll() teardown, re-created on every connect. */
  #scrollStop = null;

  /** @type {(() => void) | null} motion-coordinator registration for the entrance. */
  #entranceStop = null;

  /** Clears data-entrance-running once the zoom has landed. */
  #runningTimer = null;

  /** Resolves the in-flight run's promise — the coordinator's budget slot. */
  #runningResolve = null;

  connectedCallback() {
    super.connectedCallback();
    this.#start();
    this.#startEntrance();
  }

  disconnectedCallback() {
    this.#stop();
    this.#entranceStop?.();
    this.#entranceStop = null;
    this.#endRun();
    super.disconnectedCallback();
  }

  /**
   * After a Section Rendering morph that REUSED this node. connectedCallback does
   * not run again, but the server's markup carries no `data-entrance-played`, so
   * the morph strips it and the stylesheet parks the media back at its start
   * scale — with nothing left to settle it. A morph is an update, not an arrival,
   * so settle at once rather than zoom a second time. The drift restarts too: the
   * morph may have replaced the very media nodes it was animating.
   */
  updatedCallback() {
    super.updatedCallback();
    this.#stop();
    this.#start();
    if (this.hasAttribute("data-parallax-entrance") && !this.hasAttribute("data-entrance-played")) {
      this.#entranceStop?.();
      this.#entranceStop = null;
      this.#settleEntrance(0);
    }
  }

  #stop() {
    this.#scrollStop?.();
    this.#scrollStop = null;
  }

  #start() {
    // The user's own opt-out, checked before the merchant's: a section can be set
    // to parallax and still hold perfectly still for someone who asked for that.
    if (prefersReducedMotion()) return;

    const intensity = Number.parseFloat(this.dataset.parallax ?? "");
    if (!Number.isFinite(intensity) || intensity <= 0) return;

    // Tag selectors, not a ref: the media here is emitted by `image_tag` and by
    // `video-markup`, neither of which can carry a `ref` attribute. The DOM
    // contract bans CLASS selectors, which these are not.
    //
    // OUTERMOST matches only. A video's <deferred-media> is itself a match and
    // contains its poster <img> (and icon <svg>s): driving both compounded the
    // drift on the poster, so it travelled twice as far as the <video> that later
    // replaces it — inserted from a <template> after this ran, so moved by its
    // container alone — and the picture jumped at the hand-over.
    const found = Array.from(this.querySelectorAll("img, video, svg, deferred-media"));
    const media = found.filter((element) => !found.some((other) => other !== element && other.contains(element)));
    if (media.length === 0) return;

    const direction = this.dataset.parallaxDirection || "vertical";

    // `fixed` is handled entirely in CSS (_component-parallax): the media is
    // position:fixed inside a clip-path frame, so the browser pins it with no
    // main-thread work at all. Driving it from here instead is what made it
    // stutter — a scroll-event transform always lands a frame behind the
    // compositor.
    if (direction === "fixed") return;

    const { transform, origin } = ParallaxComponent.#travel(intensity, direction);

    // transform-origin is a constant, so it is set rather than animated — anchoring
    // the scaled media to the edge it travels away from is what keeps the opposite
    // edge covered for the whole run.
    for (const element of media) element.style.transformOrigin = origin;

    const edge = this.#startEdge();
    this.#scrollStop =
      this.#driveNatively(media, transform, edge) ??
      scroll(animate(media, { transform }, { easing: "linear" }), {
        target: this,
        offset: [`start ${edge}`, "end start"],
      });
  }

  /**
   * The zoom-out entrance, played by this element rather than by a wrapping
   * motion-component.
   *
   * Why not the wrapper: under `fixed` the wrapper's transform becomes the
   * containing block the pinned media is held against, so the entrance used to be
   * dropped for that mode outright. And Motion One cannot drive it here either —
   * it folds `scale` into `style.transform`, which would overwrite the drift.
   *
   * So the zoom is a CSS transition on the individual `scale` property, the same
   * shape as `.image-zoom-reveal`: the stylesheet parks the media at the preset's
   * start while this element is armed, and stamping `data-entrance-played` lets it
   * settle. `scale` composes with the drift's `transform` instead of replacing it,
   * and a transform on the pinned media ITSELF does not re-anchor it — only an
   * ancestor's does. What gets scaled (a wrapper, or the pinned media) is the
   * stylesheet's call, per mode.
   *
   * The timing and the budget are the shared ones: registered with the same
   * coordinator motion-component uses, with the same above-the-fold rule for the
   * duration token, and the preset's own duration name.
   */
  #startEntrance() {
    if (!this.hasAttribute("data-parallax-entrance")) return;
    // Under reduce the stylesheet stages nothing, so there is nothing to settle;
    // stamp it anyway so the element never reads as pending.
    if (prefersReducedMotion()) {
      this.#settleEntrance(0);
      return;
    }

    // registerElement directly, not coordinatedInView: that helper reads the type
    // off `data-motion`, which this element does not carry, and an "unknown" type
    // would slip past the zoom cap this entrance belongs under.
    this.#entranceStop = motionCoordinator.registerElement(this, {
      type: "zoom-out",
      onActivate: () => this.#settleEntrance(this.#entranceDuration()),
      // Nothing is hidden while this waits — the zoom carries no opacity, so the
      // media is on screen at its start scale the whole time. Waiting only moves
      // the start of the zoom onto a picture that has actually arrived.
      prepare: async () => {
        await ParallaxComponent.#mediaReady(this);
      },
      onSkip: () => this.#settleEntrance(0),
    });
  }

  #entranceDuration() {
    const preset = getMotionPreset("zoom-out");
    const key = preset?.duration ?? "reveal";
    return entranceMotion(`--motion-${key}`, MOTION_DURATION_FALLBACK_MS[key] ?? 1500, this).durationMs;
  }

  /**
   * Let the media settle. Resolves when the zoom is over, because the promise IS
   * the budget slot — see motion-coordinator.
   *
   * @param {number} durationMs 0 settles without a tween (over budget, reduce)
   * @returns {Promise<void>}
   */
  #settleEntrance(durationMs) {
    this.#endRun();
    this.style.setProperty("--parallax-entrance-duration", `${durationMs}ms`);
    if (durationMs > 0) this.setAttribute("data-entrance-running", "");
    this.setAttribute("data-entrance-played", "");
    if (durationMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#runningResolve = resolve;
      this.#runningTimer = setTimeout(() => this.#endRun(), durationMs + 50);
    });
  }

  /**
   * Drop the transition with the zoom. It lives only while the zoom is in flight
   * because it is a whole `transition` declaration on nodes that already have
   * their own — the image frame's backdrop fade, a video poster's hand-over fade —
   * and left in place it would replace those for the life of the page.
   */
  #endRun() {
    clearTimeout(this.#runningTimer);
    this.#runningTimer = null;
    this.removeAttribute("data-entrance-running");
    // ALWAYS settle the promise, however the run ended. It is the budget slot, and
    // clearing the timer that would have resolved it — a disconnect mid-zoom, or a
    // second settle superseding the first — would otherwise hold that slot forever.
    this.#runningResolve?.();
    this.#runningResolve = null;
  }

  /**
   * Images loaded, and an autoplaying video's first frame decoded — capped at 1s,
   * the same bound motion-component puts on its own media wait. The video is
   * inserted from a <template> by deferred-media only once it starts loading, so
   * it is watched for rather than queried once.
   *
   * @param {Element} root
   * @returns {Promise<void>}
   */
  static #mediaReady(root) {
    const waits = [];

    for (const img of root.querySelectorAll("img")) {
      if (img.complete && img.naturalWidth > 0) continue;
      waits.push(
        new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        })
      );
    }

    let observer = null;
    const player = root.querySelector("deferred-media[data-autoplay]");
    if (player) {
      waits.push(
        new Promise((resolve) => {
          const check = () => {
            const video = player.querySelector("video");
            if (!video) return false;
            if (video.readyState >= 2) {
              resolve();
              return true;
            }
            video.addEventListener("loadeddata", () => resolve(), { once: true });
            return true;
          };
          if (check()) return;
          observer = new MutationObserver(() => {
            if (check()) observer?.disconnect();
          });
          observer.observe(player, { childList: true, subtree: true });
        })
      );
    }

    return Promise.race([Promise.all(waits), new Promise((resolve) => setTimeout(resolve, 1000))]).finally(() =>
      observer?.disconnect()
    );
  }

  /**
   * Drive the drift from a native ViewTimeline, so the COMPOSITOR samples the
   * scroll position and applies the transform in the same frame.
   *
   * Motion One's `scroll()` cannot: it listens for the `scroll` event and sets the
   * animation's time on the main thread. With smooth scrolling on, Lenis moves the
   * page from its own requestAnimationFrame, and `scroll` events are dispatched
   * BEFORE rAF callbacks — so each frame the media is positioned for where the page
   * was one frame ago, then Lenis scrolls it on. The media trails the page by one
   * frame's scroll: invisible at 120Hz, a visible judder on a 60Hz screen, and
   * larger the faster the drift. `fixed` never had this — it is pure CSS for the
   * same reason.
   *
   * The range reproduces the Motion One offset exactly. `cover 0%` is the target's
   * top at the viewport's bottom ("start end"); an element whose top sits at `edge`
   * of the viewport is (1 - edge) of a viewport height past it. `cover 100%` is
   * "end start".
   *
   * Returns null where ViewTimeline is missing (Firefox) or the range is refused,
   * and the caller falls back to Motion One — the old behaviour, never worse.
   *
   * @param {Element[]} media
   * @param {string[]} transform - [from, to]
   * @param {number} edge - 0..1, see #startEdge
   * @returns {(() => void) | null}
   */
  #driveNatively(media, transform, edge) {
    if (typeof ViewTimeline !== "function") return null;
    const animations = [];
    try {
      const timeline = ParallaxComponent.#pageTimeline(this);
      if (!timeline) return null;
      // `svh`, not `vh`: #startEdge measured against innerHeight — the viewport as it is
      // at load, URL bar included on a phone — and `vh` is the LARGE viewport there.
      const rangeStart = `cover ${((1 - edge) * 100).toFixed(3)}svh`;
      for (const element of media) {
        animations.push(
          element.animate(
            { transform },
            { timeline, rangeStart, rangeEnd: "cover 100%", fill: "both", easing: "linear" }
          )
        );
      }
    } catch {
      for (const animation of animations) animation.cancel();
      return null;
    }
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }

  /**
   * A ViewTimeline that actually tracks the PAGE's scroll, or null.
   *
   * A view timeline binds to the subject's nearest ancestor SCROLL CONTAINER, and
   * `overflow: hidden` makes one — a box nobody can scroll still counts. Every host
   * of this element clips it with exactly that (`.hero-banner__media` and its two
   * siblings are `overflow-hidden`), so a timeline on this element measured a box
   * that never moves: progress stood still and the drift silently never ran, while
   * `fixed` — pure CSS — kept working.
   *
   * So ask the browser which scroller it picked (`source`), and while that is not
   * the document, re-anchor on that box instead: it clips this element and, in
   * every host that renders one, has the same box, so progress is unchanged. A
   * host that still resolves elsewhere after a few steps gets null, and the caller
   * falls back to Motion One — one frame of lag at worst, never a frozen image.
   *
   * @param {Element} start
   * @returns {ViewTimeline | null}
   */
  static #pageTimeline(start) {
    const page = document.scrollingElement || document.documentElement;
    let subject = start;
    for (let step = 0; step < 4; step += 1) {
      const timeline = new ViewTimeline({ subject, axis: "block" });
      const source = timeline.source;
      if (source === page) return timeline;
      if (!source || source === subject) return null;
      subject = source;
    }
    return null;
  }

  /**
   * Where on the viewport the drift's timeline begins: wherever this element's top
   * is when it connects, as a fraction of the viewport height, clamped to 0..1.
   *
   * The fixed "start end" spent the travel on a stretch the visitor never sees
   * when the section is ALREADY on screen at load — a hero at the top of the page
   * begins half-way through its timeline (62% for a 60vh banner), so only the rest
   * of the drift ever plays, while the compensating scale is still paid for all of
   * it. Starting from the element's own position spends the whole travel on the
   * part that is actually watched: measured on the formula, twice the drift at the
   * same scale for a full-height hero.
   *
   * Continuous rather than a threshold: an element below the fold resolves to 1,
   * which is exactly "start end", and one peeking in at the bottom still drifts
   * across the whole screen. A fraction, so a resize keeps the same proportions.
   *
   * The rect is read with the ENTRANCE scale taken back out: in the moving modes
   * this element is itself parked at its zoom-out start when it connects, scaled
   * around its centre, which would put its top 7.5% of its height too high.
   *
   * @returns {number}
   */
  #startEdge() {
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    if (!viewport) return 1;
    const rect = this.getBoundingClientRect();
    const scale = Number.parseFloat(getComputedStyle(this).scale) || 1;
    const top = rect.top + (rect.height - rect.height / scale) / 2;
    return Math.min(1, Math.max(0, top / viewport));
  }

  /**
   * Travel distance and the scale that covers for it.
   *
   * Moving a box that exactly fills its frame would expose the frame behind it, so
   * every direction that translates also scales up by enough to keep the frame
   * covered across the whole travel.
   *
   * The scale is EXACT, not a rule of thumb. The media is anchored at the edge it
   * travels away from and scaled by S, so it overhangs the opposite edge by S-1 of
   * the frame; the translate runs inside that scale, so it carries the media S*D.
   * Covered means S*D <= S-1, i.e. S >= 1/(1-D). A linear 1 + 1.35*D stood in for
   * that before and fell short from intensity 0.6 up — at 1.0 it scaled 1.61 where
   * 1.82 was needed, and the far edge of the frame opened over the last 16% of
   * the run. `COVER_SLACK` is the headroom on top: object-fit's own cropping and
   * sub-pixel rounding.
   *
   * Vertical travel tops out at 36%, not 45%: at the exact scale 45% would cost a
   * 1.82 zoom, and the hero image is fetched for 100vw, so every step of scale is
   * upscaled pixels — visibly soft. 36% holds the maximum zoom at ~1.6, where it
   * always was; the strength that cap gives up is won back by #startEdge.
   *
   * @param {number} intensity 0..1, the merchant's slider
   * @param {string} direction vertical | horizontal | zoom
   */
  static #COVER_SLACK = 1.02;

  static #travel(intensity, direction) {
    if (direction === "zoom") {
      const scale = 1 + intensity * 0.35;
      return { transform: ["translate3d(0, 0, 0) scale(1)", `translate3d(0, 0, 0) scale(${scale})`], origin: "center" };
    }

    const horizontal = direction === "horizontal";
    const distance = intensity * (horizontal ? 30 : 36);
    const scale = ParallaxComponent.#COVER_SLACK / (1 - distance / 100);
    const zero = "translate3d(0, 0, 0)";
    const travelled = horizontal ? `translate3d(${distance}%, 0, 0)` : `translate3d(0, ${distance}%, 0)`;

    return {
      transform: [`scale(${scale}) ${zero}`, `scale(${scale}) ${travelled}`],
      origin: horizontal ? "right" : "bottom",
    };
  }
}

if (!customElements.get("parallax-component")) {
  customElements.define("parallax-component", ParallaxComponent);
}
