import { CarouselComponent } from "@theme/carousel";
import { animate } from "@theme/animation";
import { getMotionPreset, motionPresetForViewport } from "@theme/motion-presets";
import { isMotionMobile, motionDurationMs, motionToken, prefersReducedMotion } from "@theme/utilities";

/** Swiper methods that change the slide; each is held while the outgoing text leaves. */
const NAVIGATION_METHODS = ["slideNext", "slidePrev", "slideTo", "slideToLoop"];

/**
 * @capability Hero slideshow on top of the Swiper CarouselComponent — per-slide it swaps the controls' color scheme, pauses/plays each slide's deferred-media video, releases the active slide's held entrances for their first run at load, runs every non-drag slide change in sequence (the outgoing slide's text leaves first on --motion-slide-exit / --motion-slide-exit-ease / --motion-slide-exit-distance, then the slide changes and the incoming entrances play), and exposes the active slide via a `selected-index` attribute.
 * @when Full-width hero/slideshow sections where each slide has its own color scheme, video, or animated content. Pairs with src/scss/global/_section-slideshow.scss. Extend/reuse this rather than re-wiring Swiper events for slide-scoped media and motion.
 * @contract <slideshow-component data-section-id data-control-type selected-index> (inherits the CarouselComponent/Swiper markup) with ref="controls" and ref="slides[]"; slides carry data-color-scheme + data-swiper-slide-index and may contain <deferred-media> and <motion-component>; sets --control-height on itself.
 * @keywords slideshow, hero slider, banner carousel, autoplay video slide, per-slide color scheme, slide change, motion replay, swiper, image slider
 */
class SlideshowComponent extends CarouselComponent {
  #resizeObserver;

  /** @type {WeakSet<object>} Swiper instances whose navigation is already sequenced. */
  #sequenced = new WeakSet();

  /** @type {Promise<void> | null} The outgoing slide's exit, while it runs. */
  #exiting = null;

  /** @type {(() => unknown) | null} The slide change waiting for that exit. */
  #pendingChange = null;

  /** @type {HTMLElement | null} The slide whose content has already left. */
  #exitedSlide = null;

  /** @type {{ el: HTMLElement, controls: { cancel: () => void } }[]} */
  #blockExits = [];

  #passThrough = false;
  #dragging = false;

  constructor() {
    super();
    this.selectedIndex = this.selectedIndex;
  }

  get sectionId() {
    return this.getAttribute("data-section-id");
  }

  get controlType() {
    return this.getAttribute("data-control-type");
  }

  static get observedAttributes() {
    return ["selected-index"];
  }

  get selectedIndex() {
    return parseInt(this.getAttribute("selected-index")) || 0;
  }

  set selectedIndex(index) {
    this.setAttribute("selected-index", `${index}`);
  }

  connectedCallback() {
    super.connectedCallback();

    // Wait for parent CarouselComponent to finish Swiper initialization
    // Check if already initialized (in case event fired before our connectedCallback)
    if (this.swiperInstance) {
      this.#initAfterSwiperReady();
    } else {
      // Listen for carousel:ready event
      this.addEventListener(
        "carousel:ready",
        () => {
          this.#initAfterSwiperReady();
        },
        { once: true }
      );
    }
  }

  #initAfterSwiperReady() {
    this.#init();
    const activeSlide = this.refs.slides?.[0] ?? this.swiperInstance?.slides?.[this.swiperInstance.activeIndex];
    if (activeSlide) this.#updateControlsScheme(activeSlide);
    if (!this.refs.controls) return;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => this.#updateControlHeight());
    this.#resizeObserver.observe(this.refs.controls);
  }

  updatedCallback() {
    this.addEventListener("carousel:ready", () => this.#initAfterSwiperReady(), { once: true });
    super.updatedCallback?.();
    if (this.swiperInstance && this.refs.controls) {
      this.#resizeObserver?.disconnect();
      this.#resizeObserver = new ResizeObserver(() => this.#updateControlHeight());
      this.#resizeObserver.observe(this.refs.controls);
      const activeSlide = this.refs.slides?.[0] ?? this.swiperInstance?.slides?.[this.swiperInstance.activeIndex];
      if (activeSlide) this.#updateControlsScheme(activeSlide);
    }
  }

  disconnectedCallback() {
    this.#resizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  #init() {
    if (typeof this.swiperInstance !== "object") return;
    const { slides, activeIndex } = this.swiperInstance;

    // First run, at load: release(), not replay(). The active slide's held
    // entrances are first-paint content — release() puts them on the
    // coordinator's first-paint path (above the fold → no media wait, swap
    // speed, held for the page-transition curtain with everything else).
    // replay() is for #handleChange: a slide the visitor moved to waits for
    // its media and runs at reveal speed. Used here it bypassed the
    // coordinator and left the hero at its zoom-out start state, visible
    // behind no curtain, for as long as the image took to load.
    if (slides[activeIndex]) {
      slides[activeIndex].querySelectorAll("motion-component[data-motion-hold]").forEach((el) => el.release());
    }

    this.swiperInstance.on("realIndexChange", this.#handleChange);
    this.#sequenceSlideChanges(this.swiperInstance);
  }

  /**
   * A slide change runs in sequence: the outgoing slide's text leaves first —
   * word-by-word text through the top of its boxes, any other entrance moving
   * on in the direction it arrived — and only then does the slide change and
   * the incoming slide's entrances play. Run together, as every other carousel
   * does, there was nothing to see: the fade takes the whole outgoing slide,
   * text included, within its 300ms, before an exit had got going.
   *
   * Every way to change slide — arrows, dots, autoplay, keyboard, goToSlide —
   * ends in one of these four Swiper methods, so they are wrapped on the
   * instance (Swiper's own internals call them through it too). A drag is let
   * through untouched: the slide is already following the finger, and making
   * it wait for an exit would read as lag — and a drag drops a request still
   * waiting on an exit, so the carousel does not move twice. So are zero-speed
   * moves (loop repositioning) and anything that does not change the slide.
   * While an exit runs, a dot (an absolute destination) replaces the waiting
   * request; another arrow or autoplay step is ignored — "next, then previous"
   * would otherwise land one slide before the start.
   *
   * @param {any} swiper
   */
  #sequenceSlideChanges(swiper) {
    if (this.#sequenced.has(swiper)) return;
    this.#sequenced.add(swiper);

    for (const method of NAVIGATION_METHODS) {
      const original = swiper[method];
      if (typeof original !== "function") continue;
      swiper[method] = (/** @type {any[]} */ ...args) => {
        const run = () => original.apply(swiper, args);
        if (this.#passThrough || this.#dragging || !this.#isSlideChange(swiper, method, args)) return run();

        if (this.#exiting) {
          if (method === "slideTo" || method === "slideToLoop") this.#pendingChange = run;
          return true;
        }
        this.#pendingChange = run;

        const leaving = this.#exitCandidates(swiper);
        if (!leaving) {
          this.#pendingChange = null;
          return run();
        }
        this.#exiting = this.#exitSlide(leaving).then(() => this.#commitChange(leaving.slide));
        return true;
      };
    }

    swiper.on("sliderMove", () => {
      this.#dragging = true;
      this.#pendingChange = null;
    });
    // touchEnd is emitted before Swiper settles the drag with its own slideTo,
    // so the flag has to outlive this task.
    swiper.on("touchEnd", () => {
      setTimeout(() => {
        this.#dragging = false;
      });
    });
    // Once the outgoing slide has faded out, its blocks go back to their
    // resting state, so nothing is left at opacity 0 for its next visit.
    swiper.on("slideChangeTransitionEnd", () => this.#releaseBlockExits());
  }

  /**
   * @param {any} swiper
   * @param {string} method
   * @param {any[]} args
   */
  #isSlideChange(swiper, method, args) {
    const [first, second, , fourth] = args;
    if (method === "slideNext" || method === "slidePrev") {
      // (speed, runCallbacks, internal). Autoplay calls these with internal
      // set, and it is a slide change like any other: only speed 0 is not.
      return first !== 0;
    }
    // (index, speed, runCallbacks, internal)
    if (second === 0 || fourth === true) return false;
    const current = method === "slideToLoop" ? swiper.realIndex : swiper.activeIndex;
    return first !== current;
  }

  /**
   * What on the active slide has a way out: word-by-word text that has
   * played, and block entrances (a text, a button) that have played. Media
   * entrances stay — the image is what the fade itself changes.
   *
   * @param {any} swiper
   * @returns {{ slide: HTMLElement, texts: any[], blocks: HTMLElement[] } | null}
   */
  #exitCandidates(swiper) {
    if (prefersReducedMotion() || !document.documentElement.hasAttribute("data-motion-armed")) return null;
    const slide = swiper.slides?.[swiper.activeIndex];
    if (!slide) return null;

    const texts = Array.from(slide.querySelectorAll("motion-text[data-initialized]"));
    const played = Array.from(slide.querySelectorAll("motion-component[data-initialized]")).filter(
      (el) => getMotionPreset(/** @type {HTMLElement} */ (el).dataset.motion ?? "")?.cost !== "high"
    );
    // The outermost one moves its contents with it; animating a nested one too
    // would move them twice.
    const blocks = /** @type {HTMLElement[]} */ (
      played.filter((el) => !played.some((other) => other !== el && other.contains(el)))
    );

    return texts.length || blocks.length ? { slide, texts, blocks } : null;
  }

  /**
   * @param {{ slide: HTMLElement, texts: any[], blocks: HTMLElement[] }} leaving
   * @returns {Promise<void>}
   */
  async #exitSlide({ texts, blocks }) {
    const durationMs = motionDurationMs("--motion-slide-exit", 400, this);
    const easing = motionToken("--motion-slide-exit-ease", "cubic-bezier(0.4, 0, 1, 1)", this);
    const distance = motionToken("--motion-slide-exit-distance", "2rem", this);
    const flip = getComputedStyle(this).getPropertyValue("--flip-x-factor").trim() || "1";

    /** @type {Promise<unknown>[]} */
    const exits = texts.map((text) => text.exit({ durationMs, easing }));

    for (const el of blocks) {
      // On in the direction it came in: a fade-up block keeps rising, a
      // slide-in keeps travelling, a fade-in only fades.
      const preset = getMotionPreset(motionPresetForViewport(el.dataset.motion ?? "", isMotionMobile()));
      const from = preset?.from ?? {};
      const parts = [];
      if (from.x) parts.push(`translateX(calc(${distance} * ${-from.x} * ${flip}))`);
      if (from.y) parts.push(`translateY(calc(${distance} * ${-from.y}))`);
      const controls = animate(
        el,
        { opacity: [1, 0], transform: ["none", parts.join(" ") || "none"] },
        { duration: durationMs / 1000, easing }
      );
      this.#blockExits.push({ el, controls });
      exits.push(controls.finished);
    }

    await Promise.all(exits.map((exit) => Promise.resolve(exit).catch(() => {})));
  }

  /** @param {HTMLElement} slide */
  #commitChange(slide) {
    this.#exiting = null;
    const change = this.#pendingChange;
    this.#pendingChange = null;

    // Nothing moved — the request was dropped (a drag took over), the
    // destination turned out to be this slide, or the carousel went away:
    // bring the content back rather than leave it gone.
    const restore = () => {
      if (this.#exitedSlide !== slide) return;
      this.#exitedSlide = null;
      // Only while it is still the slide on show. A drag that took over mid-exit
      // has already moved on, and replaying the slide it is leaving would bring
      // its content back as it goes; slideChangeTransitionEnd releases the
      // blocks, and the next visit replays it anyway.
      const active = this.swiperInstance?.slides?.[this.swiperInstance.activeIndex];
      if (active !== slide) return;
      this.#releaseBlockExits();
      window.FoxTheme?.motion?.replayWithin?.(slide);
    };

    this.#exitedSlide = slide;
    if (!change || !this.isConnected || !this.swiperInstance || this.swiperInstance.destroyed) {
      restore();
      return;
    }

    // slideToLoop does not move in the call: Swiper defers its own slideTo to
    // the next animation frame. So the pass-through has to last until then,
    // or that deferred slideTo would come back in here as a fresh request and
    // play a second exit; and "did it move" can only be asked after it. A
    // frame requested now runs after Swiper's, in the same frame. A plain
    // slideTo has already moved — slideChangeTransitionStart has consumed
    // #exitedSlide by the time this frame runs.
    this.#passThrough = true;
    try {
      change();
    } catch (error) {
      this.#passThrough = false;
      restore();
      throw error;
    }
    requestAnimationFrame(() => {
      this.#passThrough = false;
      restore();
    });
  }

  #releaseBlockExits() {
    for (const { el, controls } of this.#blockExits) {
      controls.cancel();
      el.style.opacity = "";
      el.style.transform = "";
    }
    this.#blockExits = [];
  }

  /**
   * Only the incoming slide plays, each block on its own Delay setting. After
   * a sequenced change the outgoing content has already left (see
   * #sequenceSlideChanges). After a drag it leaves with the slide under the
   * finger: the carousel's swap would hold the incoming word-by-word text back
   * for an outgoing exit, so it landed well after the slide's other blocks.
   *
   * @param {HTMLElement | undefined} previous
   * @param {HTMLElement} slide
   */
  swapSlideMotion(previous, slide) {
    this.#exitedSlide = null;
    window.FoxTheme?.motion?.replayWithin?.(slide);
  }

  #handleChange = (swiper) => {
    const { slides, realIndex, activeIndex } = swiper;
    this.selectedIndex = realIndex;

    this.#updateControlsScheme(slides[activeIndex]);
  };

  #updateControlsScheme(activeSlide) {
    if (!this.refs.controls || !activeSlide) return;
    const classesToRemove = Array.from(this.refs.controls.classList).filter((className) =>
      className.startsWith("color-")
    );
    classesToRemove.forEach((className) => this.refs.controls.classList.remove(className));
    const colorScheme = activeSlide.dataset?.colorScheme;
    if (colorScheme) this.refs.controls.classList.add(colorScheme);
  }

  #updateControlHeight() {
    // Batch read and write to avoid force reflow
    // Safe in ResizeObserver callback but also ensures proper batching
    const height = this.refs.controls.offsetHeight;
    this.style.setProperty("--control-height", `${height}px`);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "selected-index" && oldValue !== null && oldValue !== newValue) {
      const prevSlide = this.querySelectorAll(`[data-swiper-slide-index="${oldValue}"]`);
      const currentSlide = this.querySelectorAll(`[data-swiper-slide-index="${newValue}"]`);

      prevSlide.forEach((slide) => {
        const deferredMedia = slide.querySelector("deferred-media");
        if (deferredMedia) deferredMedia.pauseMedia();
      });

      // Entrances are NOT replayed here: CarouselComponent already replays the
      // incoming slide on slideChangeTransitionStart (FoxTheme.motion.replayWithin),
      // for every carousel including this one. Doing it here as well started each
      // entrance twice per slide change.
      currentSlide.forEach((slide) => {
        const deferredMedia = slide.querySelector("deferred-media");
        if (deferredMedia) deferredMedia.playMedia();
      });
    }
  }
}

if (!customElements.get("slideshow-component")) {
  customElements.define("slideshow-component", SlideshowComponent);
}
