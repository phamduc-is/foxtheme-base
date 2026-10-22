import { Component } from "@theme/component";
import { animate } from "@theme/animation";
import { ThemeEvents } from "@theme/events";
import {
  prefersReducedMotion,
  coordinatedInView,
  entranceMotion,
  isMotionMobile,
  MOTION_DURATION_FALLBACK_MS,
} from "@theme/utilities";
import {
  getMotionPreset,
  motionEasingToken,
  motionEndState,
  motionPresetForViewport,
  stagedPresetName,
  DEFAULT_PRESET,
} from "@theme/motion-presets";
import { motionCoordinator } from "@theme/motion-coordinator";

/**
 * Longest an entrance will wait for the element's own images before playing
 * anyway. See #waitForMediaSmart for why it is one bound and why it is short.
 */
const MEDIA_WAIT_MAX_MS = 1000;

/**
 * @capability Declarative scroll-reveal wrapper for ONE element — plays a named entrance from the motion registry when the element enters the viewport, coordinated through motionCoordinator; waits for inner media, re-animates after section morph, honours prefers-reduced-motion, and reveals itself rather than staying hidden if the animation budget is full.
 * @when ANY "animate on scroll" / reveal effect on section or block content — wrap the content instead of writing IntersectionObserver + keyframes by hand. For a LIST whose items should arrive in sequence use motion-group, which costs one budget slot instead of N. See the animation-motion skill.
 * @contract <motion-component data-motion="<preset>"> where <preset> is any name in src/js/modules/motion-presets.js — the element holds NO animation values of its own. Optional data-motion-delay (ms), data-instantly (skip media wait), data-motion-hold (prestage only — the host calls release() for its first run at load, replay() for later on-demand runs), data-motion-off. Prestage comes from the generated snippets/motion-prestage.liquid, gated on <html data-motion-armed>: at first paint the rule matches on the tag plus data-motion, and a replay re-enters it via data-motion-from="<preset>". The element never computes a start state itself. State tracked via data-initialized.
 * @keywords animate on scroll, scroll reveal, fade in, fade up, slide in, zoom in, entrance animation, in-view animation, motion effect, AOS
 */
export class MotionComponent extends Component {
  #inViewStop = null;
  #pendingBindId = null;

  /**
   * Which run is current. Motion RESOLVES `finished` when an animation is
   * replaced or cancelled (measured — it does not reject), so without this an
   * interrupted run's continuation still fires: it stamps data-initialized and
   * resets will-change while the run that superseded it is mid-flight.
   */
  #runId = 0;

  /** Set by the coordinator when this element was on screen at first paint. */
  #aboveTheFold = false;

  /**
   * A speed a host asked for on replay() ("swap" from a tab switch), used by the
   * next run only. Without it a block that owns its tab entrance played at
   * reveal speed — 1.5s on desktop — inside a swap the panel and its groups
   * played at swap speed.
   *
   * @type {"swap" | "reveal" | null}
   */
  #speed = null;

  /**
   * The in-flight animation, so an interruption can actually stop it. Motion's
   * `finished` promise is not enough: it resolves on cancel rather than
   * rejecting, and an animation nobody cancelled keeps painting over whatever
   * start state the next run writes.
   *
   * @type {{ cancel: () => void, finished: Promise<unknown> } | null}
   */
  #controls = null;

  /** @type {number | null} performance.now() when the running entrance started. */
  #enteredAt = null;

  /** @type {number} That entrance's duration, in seconds — a replay's speed is gone once it starts. */
  #enteredDuration = 0;

  /**
   * Was this on screen at first paint? It skips the media wait (the duration is
   * the same as anywhere else), so when an entrance looks wrong this is usually the first thing
   * worth knowing — and it used to be private, which made it invisible in
   * exactly the moment you needed it.
   */
  get aboveTheFold() {
    return this.#aboveTheFold;
  }

  /**
   * Mirrored onto the element so it shows up in the Elements panel, not only
   * through a getter you have to know exists.
   *
   * @param {boolean} value
   */
  #setAboveTheFold(value) {
    this.#aboveTheFold = value;
    this.toggleAttribute("data-motion-above-fold", value);
  }

  connectedCallback() {
    super.connectedCallback();
    if (prefersReducedMotion() || this.#isDisabled()) {
      // Stamp it, do not just bail. The whole prestage stylesheet lives inside
      // `@media (prefers-reduced-motion: no-preference)`, so with reduce ON
      // nothing is hidden and this element is simply visible — but the moment a
      // visitor turns reduce OFF, that query starts matching and
      // `motion-component:not([data-initialized])[data-motion]` takes hold on an
      // element that bailed here and bound no observer. Content gone until a
      // reload. `data-initialized` is the flag that says "this one is done"; an
      // element that will never animate qualifies.
      this.setAttribute("data-initialized", "true");
      return;
    }
    // Clear from completed when morph reuses nodes (element gets disconnected then reconnected)
    motionCoordinator.clearCompleted(this);

    switch (this.trigger) {
      case "manual":
        // Prestaged by CSS and waiting for a host to call replay().
        break;
      case "load":
        requestAnimationFrame(() => this.isConnected && this.#enter());
        break;
      default:
        // Defer bind to avoid race with updatedCallback (which may also be called for reordered elements)
        // Prestage handled by the generated motion-prestage.liquid for new elements
        this.#deferBind(false);
    }
  }

  updatedCallback() {
    super.updatedCallback();
    if (prefersReducedMotion() || this.#isDisabled()) return;
    // A morph is not first paint — see replay().
    this.#setAboveTheFold(false);
    // Reset animation state to allow re-animation after morph
    this.removeAttribute("data-initialized");
    this.#unbindInView();
    motionCoordinator.clearCompleted(this);
    this.#prestage();
    // Defer bind - this cancels any pending bind from connectedCallback
    this.#deferBind(true);
  }

  disconnectedCallback() {
    this.#runId += 1; // same reason as replay(): stop the in-flight continuation
    this.#cancelControls();
    this.#cancelPendingBind();
    this.#unbindInView();
    super.disconnectedCallback();
  }

  /**
   * Defer bind with double rAF to ensure layout is stable.
   * Cancels any previous pending bind to avoid race conditions.
   * @param {boolean} forceImmediate - If true, check viewport and trigger immediately if visible
   */
  #deferBind(forceImmediate) {
    this.#cancelPendingBind();

    // Double rAF ensures layout is complete after morph
    this.#pendingBindId = requestAnimationFrame(() => {
      this.#pendingBindId = requestAnimationFrame(() => {
        this.#pendingBindId = null;
        if (!this.isConnected) return;
        this.#bindInView(forceImmediate);
      });
    });
  }

  #cancelPendingBind() {
    if (this.#pendingBindId) {
      cancelAnimationFrame(this.#pendingBindId);
      this.#pendingBindId = null;
    }
  }

  get type() {
    return this.dataset.motion || DEFAULT_PRESET;
  }

  get delay() {
    return this.hasAttribute("data-motion-delay") ? parseInt(this.getAttribute("data-motion-delay")) / 1000 : 0;
  }

  /**
   * When something inside this element has been carried `fraction` of the way
   * through the running entrance, as a performance.now() time — or null when
   * no entrance is running. Lets content that draws its own entrance (an <em>
   * highlight) start as this one lands rather than after it has finished.
   *
   * @param {Element} _element - inside this one; the whole element moves as one
   * @param {number} fraction - 0..1 of the entrance duration
   * @returns {number | null}
   */
  landingAt(_element, fraction) {
    if (this.#enteredAt === null) return null;
    return this.#enteredAt + (this.delay + this.#enteredDuration * fraction) * 1000;
  }

  get isHold() {
    return this.hasAttribute("data-motion-hold");
  }

  get isInstant() {
    return this.hasAttribute("data-instantly");
  }

  /** What starts this element: "inview" (default), "load", or "manual". */
  get trigger() {
    const value = this.dataset.motionTrigger;
    return value === "manual" || value === "load" ? value : "inview";
  }

  /** Re-arm when it scrolls out of view, so coming back plays it again. */
  get repeat() {
    return this.hasAttribute("data-motion-repeat");
  }

  get media() {
    return Array.from(this.querySelectorAll("img, iframe, svg"));
  }

  /**
   * The entrance vocabulary, read from :root rather than hardcoded here, so a
   * scroll reveal, a motion-group's staggered list and a tab panel swap all
   * move the same distance on the same curves. `reveal` is the slow duration —
   * this is content appearing on its own as the visitor scrolls, not a swap
   * they just asked for. See entranceMotion() and the "Entrance motion" block
   * in css-variables.liquid.
   */
  get motion() {
    // A preset names its own duration token, so a swap-speed variant of the
    // same kind costs nothing but a registry entry. On a small screen the
    // expensive kinds step down first — same rule the generated prestage CSS
    // applies, from the same function.
    const name = motionPresetForViewport(this.type, isMotionMobile());
    const preset = getMotionPreset(name) ?? getMotionPreset(DEFAULT_PRESET);
    // Above the fold plays the same duration as anywhere else: the first thing
    // a visitor sees arrives with the same gesture as everything after it.
    const durationKey = this.#speed ?? preset.duration ?? "reveal";
    const token = `--motion-${durationKey}`;
    const fallback = MOTION_DURATION_FALLBACK_MS[durationKey] ?? 1500;
    const { durationMs, fadeDurationMs, easing, fadeEasing } = entranceMotion(
      token,
      fallback,
      this,
      motionEasingToken(preset)
    );

    // No `distance` and no `flip`: both only ever fed the start state, which the
    // stylesheet now owns outright. The flip in particular was a second reading
    // of --flip-x-factor for a value the generated CSS already applies inside
    // its own calc(), so an RTL store resolved it twice from two places.
    return {
      preset,
      duration: durationMs / 1000,
      fadeDuration: fadeDurationMs / 1000,
      easing,
      fadeEasing,
    };
  }

  /**
   * Where this element's animation ends, and which properties it touches. Where
   * it starts is the stylesheet's business — see motionEndState().
   */
  get #endState() {
    return motionEndState(this.motion.preset);
  }

  #prestage() {
    this.#enteredAt = null;
    if (this.isHold) return;

    // Hand the element to the generated prestage rule rather than rebuilding
    // the start state here. At first paint that rule already matched on the tag
    // and `data-motion`; this attribute is what puts a REPLAY on the very same
    // rule, where the old code wrote its own copy of the values from
    // `--motion-distance` instead. Two resolutions of one number is a jump on
    // frame one wherever they disagree — and they disagree for any unit or any
    // scope the two contexts do not resolve identically.
    //
    // Anything a previous run committed inline outranks a stylesheet rule, so
    // it goes first.
    this.style.opacity = "";
    this.style.transform = "";
    this.setAttribute("data-motion-from", stagedPresetName(this.motion.preset.name));

    // Nothing is animating in the start state, so no compositor layer should be
    // held for it. #enter() sets the hint back before it animates. Without this,
    // a reset() that interrupts a run — a repeat element scrolling out, a host
    // staging its own sequence — leaves the element promoted to its own layer
    // while it sits invisible, and nothing ever takes that back.
    this.style.willChange = "";
  }

  async #enter() {
    if (this.isHold) return;

    const run = ++this.#runId;

    const { duration, fadeDuration, easing, fadeEasing } = this.motion;
    // A replay's speed is for that one run.
    this.#speed = null;
    const to = this.#endState;

    // Safari: promote to GPU layer before animation for smooth playback. Only
    // the properties this preset actually animates.
    this.style.willChange = Object.keys(to)
      .map((property) => (property === "opacity" ? "opacity" : "transform"))
      .join(", ");

    this.#enteredAt = performance.now();
    this.#enteredDuration = duration;
    this.#emit(ThemeEvents.motionStart);

    // Opacity runs on its own curve and its own clock — see entranceMotion().
    // Motion merges a per-property option object over the base options.
    //
    // The handle is KEPT. Bumping #runId stops this method's continuation, but
    // it cannot stop the animation itself: a running WAAPI animation outranks
    // inline styles, so a replay() that re-prestaged to opacity 0 was painted
    // straight over by the run it was replacing. Measured on the slideshow —
    // clicking to the next slide 600ms after load found its text at 0.78/0.64/
    // 0.51, still climbing from the load-time run, and the "replay" only carried
    // it the last fifth of the way. That reads as no animation at all.
    this.#controls = animate(this, to, {
      duration,
      delay: this.delay,
      easing,
      allowWebkitAcceleration: true,
      opacity: { easing: fadeEasing, duration: fadeDuration },
    });

    await this.#controls.finished;

    // Superseded by a newer run (replay, or a morph rebinding this element):
    // that run owns the styles now.
    if (run !== this.#runId) return;

    // Both halves of the staging have to go. `data-initialized` stops the
    // first-paint rule matching; `data-motion-from` is a separate selector and
    // would hold the element at its start state on its own.
    this.removeAttribute("data-motion-from");
    this.setAttribute("data-initialized", "true");
    this.style.willChange = "auto";
    this.#emit(ThemeEvents.motionEnd, { animated: true });
  }

  /**
   * The animation budget said no. Show the element immediately — a budget may
   * drop an animation, it may never swallow content. Every route into a start
   * state has to be undone: the first-paint rule (via data-initialized), the
   * staging attribute #prestage() wrote, and anything a cancelled run left
   * committed inline.
   */
  revealNow() {
    this.#runId += 1; // any in-flight continuation is now stale
    this.removeAttribute("data-motion-from");
    this.style.opacity = "";
    this.style.transform = "";
    this.style.willChange = "";
    this.setAttribute("data-initialized", "true");
    this.#emit(ThemeEvents.motionEnd, { animated: false });
  }

  /** Back to the start state without playing. */
  reset() {
    if (prefersReducedMotion() || this.#isDisabled()) return;

    this.#runId += 1;
    this.#cancelControls();
    this.#cancelPendingBind();
    this.removeAttribute("data-initialized");
    this.#prestage();
  }

  /**
   * Stop the in-flight animation. Separate from bumping #runId: that stops the
   * continuation, this stops the painting.
   */
  #cancelControls() {
    this.#controls?.cancel();
    this.#controls = null;
  }

  /** @param {string} name @param {Record<string, any>} [detail] */
  #emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: { preset: this.type, ...detail } }));
  }

  #bindInView(forceImmediate = false) {
    // Cleanup previous observer if exists
    this.#unbindInView();

    if (forceImmediate) {
      // Bypass coordinator for immediate playback (e.g., slider replay)
      // Check if in viewport and trigger immediately
      const rect = this.getBoundingClientRect();
      const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
      const isAboveViewport = rect.bottom <= 0; // Element has been scrolled past

      // Trigger for in-viewport OR already-scrolled-past elements
      if (isInViewport || isAboveViewport) {
        // Trigger animation immediately
        (async () => {
          if (!this.isInstant && this.media.length) {
            await this.#waitForMediaSmart(this.media);
          }
          if (!this.isConnected) return;
          this.#enter();
        })();
        return;
      }
    }

    // Use coordinatedInView for better performance (1 shared observer vs N observers)
    this.#inViewStop = coordinatedInView(
      this,
      // The slot IS this promise, so it has to last exactly as long as the
      // animation does — `#enter()` resolves when the animation ends. Firing it
      // without awaiting made every entrance invisible to the budget: measured
      // on the reference demo home page, 6 registrations animating while the
      // coordinator's active set held 0, so its caps governed nothing here and
      // the only thing they could ever throttle was a motion-group.
      () => {
        if (!this.isConnected) return;
        return this.#enter();
      },
      {
        // Waiting for images happens BEFORE the budget is consulted. It used to
        // sit inside the activation callback, which meant an element waiting on
        // a slow image occupied a budget slot for the whole wait — the cap
        // spent on something that costs no GPU at all, while real animations
        // queued behind it.
        prepare: async ({ aboveTheFold } = {}) => {
          // Above the fold this element stops waiting for its images, so the
          // first thing the visitor looks at starts arriving at once rather than
          // after its media resolves. The image landing a moment later is
          // normal; a blank hero for a second is not.
          //
          // This is a PERCEPTION argument, not a metric one. It used to claim it
          // was protecting LCP, which measurement does not support: an element
          // whose entrance animates opacity is not an LCP candidate while that
          // animation is attached, and with a transform animation alongside it —
          // fade-up, the default — it never becomes one again, because the inline
          // end state committed onto it means nothing repaints it afterwards.
          // Measured in Chrome 151: same page, same start, hero recorded at 1036ms
          // with those inline styles cleared and NEVER with them left in place. So
          // shortening the duration is worth what the visitor sees, and currently
          // nothing at all to the number — which is also why the first paint now
          // plays the full duration. See docs/motion.md.
          this.#setAboveTheFold(Boolean(aboveTheFold));

          // One query, not two: `this.media` re-runs querySelectorAll on every read.
          const media = this.isInstant || this.#aboveTheFold ? [] : this.media;
          if (media.length) {
            // Smart media waiting: event-based for ResponsiveImage, fallback for others
            await this.#waitForMediaSmart(media);
          }
        },
        onSkip: () => this.revealNow(),
        repeat: this.repeat,
        onExit: () => this.reset(),
      }
    );
  }

  /**
   * Smart waiting for media elements
   * Uses event-based approach for ResponsiveImage, fallback to polling for others
   * @param {Element[]} mediaElements
   * @returns {Promise<void>}
   */
  async #waitForMediaSmart(mediaElements) {
    const promises = mediaElements.map((el) => {
      // Handle ResponsiveImage with event-based approach
      if (el instanceof HTMLImageElement && el.getAttribute("is") === "responsive-image") {
        // Check if already ready
        if (el.isReady || (el.complete && el.naturalWidth > 0)) {
          return Promise.resolve();
        }

        // Use ready promise if available (preferred)
        if (el.ready instanceof Promise) {
          return el.ready;
        }

        // Fallback: listen for image:ready event. No per-listener timeout — the
        // whole wait is bounded once, below.
        return new Promise((resolve) => {
          el.addEventListener("image:ready", () => resolve(), { once: true });

          // Also listen for native load event as fallback
          if (!el.complete) {
            el.addEventListener("load", () => resolve(), { once: true });
          }
        });
      }

      // Standard handling for other images
      if (el instanceof HTMLImageElement) {
        if (el.complete && el.naturalWidth > 0) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          el.addEventListener("load", resolve, { once: true });
          el.addEventListener("error", resolve, { once: true });
        });
      }

      // Best-effort for other media types
      return Promise.resolve();
    });

    // ONE bound over the whole wait, not one per listener.
    //
    // Two of the three branches above had no timeout at all — `el.ready` and the
    // plain <img> load/error pair are both "however long the network takes" —
    // so the 5s cap only ever applied to the fallback listener. Whatever the
    // branch, the thing being timed is the same: how long this element is
    // allowed to sit at opacity 0, on screen, waiting for a picture.
    //
    // 1s, down from 5s. Past that the entrance is worth more than the
    // synchronisation: the image has its own arrival animation
    // (`.image-zoom-reveal`, `_component-media.scss`) that plays when it lands,
    // so an entrance that goes ahead without it degrades into two nice
    // animations slightly out of step — where waiting degrades into a blank
    // block held on screen for up to five seconds on a slow connection.
    await Promise.race([
      Promise.allSettled(promises),
      new Promise((resolve) => setTimeout(resolve, MEDIA_WAIT_MAX_MS)),
    ]);
  }

  #unbindInView() {
    if (this.#inViewStop) {
      this.#inViewStop();
      this.#inViewStop = null;
    }
  }

  /**
   * A held element's FIRST run, at load. `data-motion-hold` keeps an element
   * prestaged until its host knows it is the one on screen (a slideshow's
   * active slide); when it does, this hands the element to the normal
   * first-paint path rather than replay(): the coordinator's first
   * intersection entry marks it above the fold, so it skips the media wait,
   * runs at swap speed and is held for the page-transition curtain like every
   * other entrance on the page. replay() is the other verb — a slide the
   * visitor moved to — which waits for its media, runs at reveal speed and
   * bypasses the coordinator; used at load it left the hero at the zoom-out
   * start state (scale 1.15), fully visible once the curtain had gone, for
   * ~950ms of image loading and then a 1.5s zoom, on every cache-cold load.
   */
  release() {
    if (!this.isHold) return;
    this.removeAttribute("data-motion-hold");
    if (prefersReducedMotion() || this.#isDisabled()) return;
    // connectedCallback registered this element while it was held, so its
    // activation was a no-op that the coordinator remembers as done — clear
    // it, or the registration below is skipped as a repeat.
    motionCoordinator.clearCompleted(this);
    this.#deferBind(false);
  }

  /**
   * @param {{ speed?: "swap" | "reveal" }} [options] - `swap` when the host is a
   *   visitor-triggered swap (a tab) that plays everything else at swap speed;
   *   omitted, the preset's own duration plays (a slideshow's next slide).
   */
  replay({ speed } = {}) {
    if (prefersReducedMotion() || this.#isDisabled()) return;
    this.#speed = speed ?? null;

    // Invalidate the in-flight run BEFORE anything else. Motion resolves
    // `finished` on cancel/replace, and that continuation runs as a microtask —
    // ahead of the rAF that starts the new run — so without this it would stamp
    // data-initialized and reset will-change on top of the run replacing it.
    this.#runId += 1;

    // ...and stop the animation itself, not just its continuation. Without this
    // the outgoing run keeps writing opacity over the start state written below.
    this.#cancelControls();

    // Whatever the first paint needed, it has had it. A replay is a slide the
    // visitor clicked to, a tab they opened, a filter they applied — they are
    // already here, so the merchant's duration is what should play, not the
    // shortened one this element was given at load. motion-group has cleared it
    // here since it was written; this did not, so a slideshow at the top of the
    // page kept swap speed on EVERY next/prev for the life of the page while
    // the identical slideshow further down ran at reveal speed.
    this.#setAboveTheFold(false);

    // Cleanup existing registration
    this.#unbindInView();

    // Clear from coordinator's completed set to allow re-animation
    motionCoordinator.clearCompleted(this);

    // Reset animation state
    this.removeAttribute("data-motion-hold");
    this.removeAttribute("data-initialized");

    // Prestage animation (WRITE phase — sets transform/opacity)
    this.#prestage();

    // Defer bind to next paint to avoid forced layout.
    // #prestage() writes inline styles; calling #bindInView(true) immediately
    // would read getBoundingClientRect() in the same frame → forced full-page layout.
    // #deferBind uses double RAF so the browser can flush layout between write & read.
    this.#deferBind(true);
  }

  #isDisabled() {
    return (
      // Not armed means motion-boot's watchdog fired (or the page never armed
      // at all). Nothing is hidden in that state, so animating would mean
      // hiding content first — the flash this whole mechanism exists to avoid.
      !document.documentElement.hasAttribute("data-motion-armed") ||
      this.hasAttribute("data-motion-off") ||
      this.closest("[data-motion-disabled]") !== null
    );
  }
}

customElements.define("motion-component", MotionComponent);

// Report in, so motion-boot's watchdog knows the runtime arrived and leaves the
// prestage armed.
document.documentElement.setAttribute("data-motion-booted", "");
