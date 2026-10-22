/**
 * Motion Coordinator - Simple & Performant
 * Reduces N IntersectionObservers to 1 shared observer
 * Applies smart limits to prevent performance issues
 */

/**
 * @capability Shared IntersectionObserver plus a budget gate for scroll-triggered animations — one observer for all data-motion elements, with concurrency caps (25 running globally, 12 zoom) so many sections animating at once cannot jank the page; over budget an element is revealed at once rather than made to wait; remembers completed elements so animations run once.
 * @when Any scroll-into-view animation or reveal effect — register with @theme/motion-coordinator (usually via coordinatedInView from @theme/utilities or the data-motion / motion-component pattern) instead of creating per-element IntersectionObservers or unbounded inView calls.
 * @contract import { motionCoordinator } from "@theme/motion-coordinator"; const cleanup = motionCoordinator.registerElement(el, { onActivate, onSkip, prepare, type }); onActivate MUST return a promise that settles when the animation ends — that promise IS the slot. `prepare` is an optional async step (waiting for media) run BEFORE the budget is consulted, so waiting never occupies a slot. Call cleanup on disconnect; clearCompleted(el) allows replay. Singleton, also exposed as window.FoxTheme.motionCoordinator for debugging (getStats()).
 * @keywords motion coordinator, scroll animation, animate on scroll, reveal, fade in, in view, IntersectionObserver, data-motion, animation budget, zoom animation, coordinatedInView
 */
import { ThemeEvents } from "@theme/events";
import { getMotionPreset } from "@theme/motion-presets";

// The page-transition curtain, while it is opaque, hides every entrance that
// plays under it. Measured on the demo home page: the hero's five entrances
// started at curtain opacity 1.00 and had finished by the time it reached 0.05
// — the visitor saw a blank screen, then the finished layout. Entrances are
// therefore held until the curtain STARTS to fade — not until it has gone:
// released at the end, the visitor watched the curtain thin out over an empty
// page (everything under it still prestaged at opacity 0) and only then saw
// the content arrive. Released at the start, content fades in as the curtain
// fades out. The start is page:loaded from page-transition.js (0.3s fade) or,
// failing that, the CSS backstop's animationstart at 2s; the timeout only
// exists so that a page where neither fires cannot hold its content at
// opacity 0 for good.
const CURTAIN_SAFETY_MS = 3000;

class MotionCoordinator {
  constructor() {
    this.observer = null;
    this.queue = new Map(); // element -> { prepare, onActivate, onSkip, type, preparing }
    this.active = new Set(); // Currently animating elements

    // A SECOND observation per element, on a stand-in that is never displaced.
    //
    // Measured: IntersectionObserver clips its target against every ancestor's
    // overflow, so an element whose START STATE puts it outside its own clipping
    // ancestor reports intersectionRect 0x0 forever — even with that ancestor
    // filling the screen. `overflow: clip` behaves exactly like `hidden` here.
    // Such an element is structurally invisible to this observer: in-view can
    // never fire, and the only escape was data-motion-trigger="load", which
    // fires immediately and so is wrong for any section below the fold. A
    // merchant moving a section down the page was enough to lose the entrance.
    //
    // The element's PARENT is never the transformed node, so its box is the
    // element's true layout position. Observing it costs one more observe() and
    // no layout read — this file deliberately never forces layout.
    //
    // proxy node -> Set of animated elements (siblings can share one parent).
    this.proxies = new Map();

    // Elements whose proxy has entered the viewport while the element's own
    // layout box has not. See #gateOpen: the proxy is a stand-in for the
    // element's POSITION, and it is only an honest one when the two boxes
    // roughly coincide. These wait here until their own box reaches the fold.
    this.gated = new Set();
    this.gateScrollHandler = null;
    this.gateRaf = null;

    // Has the initial render finished? Until it has, anything that comes into
    // view counts as above the fold — see handleIntersections. Guarded for a
    // document that is already complete when this module evaluates.
    this.loadSettled = typeof document !== "undefined" && document.readyState === "complete";
    if (!this.loadSettled && typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("load", () => (this.loadSettled = true), { once: true });
    }

    // WeakSet, not Set: a plain Set kept every element it had ever animated
    // alive for the life of the page, so each section morph leaked its old DOM.
    this.completed = new WeakSet();
    this.completedCount = 0;

    // Configuration
    //
    // These are a BACKSTOP for a page that brings an unusual number of
    // entrances into view at once — a deep link landing mid-page, a
    // back-navigation restoring scroll. Measured on the reference demo home
    // page, scrolled top to bottom: the peak was 6 registrations animating
    // simultaneously. So 25 is not a limit anyone meets in normal use, and it
    // is deliberately not tuned down: exceeding it costs a visitor an
    // animation, and that is only worth spending against real jank.
    //
    // There is no per-SECTION cap any more. It was scoped by
    // `closest("section, [class*='section']")`, which matches `.section__wrapper`,
    // `.section-grid`, `.sections--*` and any other class that happens to
    // contain the word — so the "section" it measured was a different size at
    // every call site (for a list inside a tabs section it was the
    // tabs-component; for a block elsewhere it was the whole <section>). A cap
    // enforced against a different ruler each time is not a fair distribution,
    // and with the reveal-instead-of-defer rule below it only decided which
    // block in a section silently loses its entrance.
    this.config = {
      maxActiveAnimations: 25, // Max concurrently RUNNING animations
      maxZoomAnimations: 12, // Max zoom animations (most expensive — real raster cost)
      // Trigger on ANY intersection, and lean on rootMargin for "how early".
      //
      // This used to be 0.15, read as "15% visible". It is not: intersectionRatio
      // is the visible area over the element's OWN total area, so an element
      // larger than the viewport can never reach a high ratio at all. Measured on
      // a mobile carousel row (`.swipe__inner` is `grid-auto-flow: column`, so its
      // box is as wide as all its columns): box 2427x367 against a 390px viewport
      // caps the ratio at 390/2427 = 0.161 — eleven thousandths above the old
      // threshold. The first callback did not arrive until 87% of the row's height
      // was on screen, and the next one already reported isIntersecting: false
      // again at 83%. The cards sat at opacity 0 until the section was almost
      // fully scrolled through.
      //
      // Worse than late: for any element TALLER than the viewport the required
      // fraction is unreachable, so it would never animate and never be revealed.
      //
      // A ratio of the element's own area cannot express "the visitor can see
      // this". rootMargin can, because it is measured against the viewport.
      threshold: 0,
      // Was "50px", which GROWS the root — so an entrance began while the
      // element was still 50px BELOW the fold and the first part of the
      // movement was spent off screen. Measured on an 891px viewport: the
      // trigger line sat at 941, under the bottom edge. `0` puts it exactly on
      // the edge, so the entrance starts as the element appears.
      //
      // A NEGATIVE bottom margin would push the line deeper still — the usual
      // "start when it is 15% in" trick — and is deliberately NOT used here. It
      // SHRINKS the root, and an element that can never reach the shrunken box
      // produces no entry at all: measured, a 60px element flush with the page
      // bottom sat at top 831 against a 757 line and never fired once. Nothing
      // in this file reveals an element the observer never mentions, so that
      // element would hold opacity 0 for good.
      //
      // GSAP solves the same problem from the other side: it computes a trigger
      // POSITION and clamps it into [0, maxScroll]. A number can be clamped; a
      // filter applied before you are told anything cannot. That model needs a
      // layout snapshot and a refresh pass to keep it true, and this file has
      // neither — it never forces layout, which is why IO carries it.
      rootMargin: "0px",
    };
  }

  /**
   * Initialize shared IntersectionObserver
   */
  init() {
    if (this.observer) return;

    this.observer = new IntersectionObserver((entries) => this.handleIntersections(entries), {
      threshold: this.config.threshold,
      rootMargin: this.config.rootMargin,
    });
  }

  /**
   * Register element for coordinated animation
   * @param {Element} element - The element to animate
   * @param {Object} options - { onActivate: callback, prepare: async callback, type: 'zoom-out' }
   * @returns {Function} Cleanup function
   */
  registerElement(element, options) {
    if (!this.observer) this.init();

    // Skip if already completed
    if (this.completed.has(element)) {
      return () => {}; // noop cleanup
    }

    // Store in queue
    const data = {
      // Anything that has to happen once the element is in view but BEFORE it
      // can animate — in practice, waiting for its images. It runs outside the
      // budget on purpose: waiting on the network costs no GPU, so it must not
      // occupy a slot that a real animation could use. It used to live inside
      // onActivate, which meant one element waiting on an image held a slot for
      // as long as that took.
      prepare: options.prepare,
      onActivate: options.onActivate,
      // Called instead of onActivate when the budget is full. Its contract is
      // "show the element, do not animate it" — the budget is allowed to drop
      // an ANIMATION, never a piece of CONTENT.
      onSkip: options.onSkip,
      // repeat: stay observed after running, and re-arm when the element leaves
      // the viewport, so scrolling back plays it again. onExit puts it back in
      // its start state; without that the "replay" would animate from finished.
      repeat: Boolean(options.repeat),
      onExit: options.onExit,
      hasRun: false,
      // prepare() is in flight — the next intersection entry must not start a
      // second run of the same element behind its back.
      preparing: false,
      // Set on this element's first intersection entry; see handleIntersections.
      seenFirstEntry: false,
      type: options.type || element.dataset?.motion || "unknown",
      // Which node's entry actually started this run, so the exit path below
      // listens to the same one. A clipped element's own entries are false
      // forever; letting those re-arm a `repeat` registration would reset it on
      // every scroll tick.
      driver: null,
      // The element's own last reported state. `undefined` until its first
      // entry — which is why handleIntersections resolves the whole batch
      // before acting on any of it.
      selfIntersecting: undefined,
    };
    this.queue.set(element, data);

    // Observe with shared observer
    this.observer.observe(element);

    const proxy = this.#proxyFor(element);
    if (proxy) {
      data.proxy = proxy;
      let owners = this.proxies.get(proxy);
      if (!owners) {
        owners = new Set();
        this.proxies.set(proxy, owners);
        this.observer.observe(proxy);
      }
      owners.add(element);
    }

    // Return cleanup function (like original inView)
    return () => this.unregister(element);
  }

  /**
   * The stand-in to observe alongside `element`, or null when there is nothing
   * useful to watch. The parent is the natural choice: it is never the node a
   * motion component transforms, so it keeps the element's true layout box.
   *
   * @param {Element} element
   * @returns {Element|null}
   */
  #proxyFor(element) {
    const parent = element.parentElement;
    if (!parent) return null;
    // Observing these says only "the page exists" — they are always intersecting.
    if (parent === document.body || parent === document.documentElement) return null;
    return parent;
  }

  /**
   * Drop this element's claim on its proxy, and stop observing the proxy once
   * nothing is left that needs it.
   *
   * @param {Element} element
   * @param {Object} [data]
   */
  #releaseProxy(element, data = this.queue.get(element)) {
    const proxy = data?.proxy;
    if (!proxy) return;
    const owners = this.proxies.get(proxy);
    if (!owners) return;
    owners.delete(element);
    if (owners.size === 0) {
      this.proxies.delete(proxy);
      this.observer?.unobserve(proxy);
    }
  }

  /**
   * Where this element's own box sits, with its ENTRANCE TRANSFORM taken back
   * out — i.e. where it will be once the animation has finished.
   *
   * `getBoundingClientRect` is the right source: an ancestor's `overflow`
   * clips what the element PAINTS and what IntersectionObserver reports, but
   * not its rect. A transform does move the rect, and the prestage exists to
   * park this element outside its clip, so its own translation is the one
   * thing that has to come back off. An ANCESTOR's transform is left in: that
   * genuinely moves where the element is.
   *
   * @param {Element} element
   * @returns {number|null} viewport-relative top, or null if it cannot be read
   */
  #layoutTop(element) {
    if (typeof getComputedStyle !== "function") return null;
    const rect = element.getBoundingClientRect?.();
    if (!rect) return null;
    const transform = getComputedStyle(element).transform;
    if (!transform || transform === "none") return rect.top;
    if (typeof DOMMatrixReadOnly !== "function") return null;
    try {
      return rect.top - new DOMMatrixReadOnly(transform).f;
    } catch {
      return null;
    }
  }

  /**
   * May the proxy speak for this element YET?
   *
   * The proxy rule shipped without this check, and the signal it keys on is
   * ambiguous: an element reports `isIntersecting: false` both when it is
   * clipped out of sight and when it is simply still below the fold, and the
   * coordinator cannot tell those apart. Where the proxy is snug around the
   * element the two mean the same thing and activating is right. Where it is
   * not — measured on a shop-the-look panel: a 256px card pinned to the bottom
   * of a 699px parent — the entrance fired 413px of scrolling before the card
   * itself reached the viewport, and had finished before it appeared.
   *
   * Deliberately ONE-SIDED: "has its top reached the fold", not "does it
   * intersect". An element the visitor jumped straight past (an anchor link,
   * a restored scroll position) is already above the viewport and must still
   * be allowed through — a two-sided test would hold it at opacity 0 for good.
   * Every unreadable case returns true for the same reason: nothing in this
   * file reveals an element it has decided to hold back.
   *
   * @param {Element} element
   * @returns {boolean}
   */
  #gateOpen(element) {
    const top = this.#layoutTop(element);
    if (top === null) return true;
    const viewport = typeof window !== "undefined" ? window.innerHeight : 0;
    if (!viewport) return true;
    return top < viewport;
  }

  /**
   * Hold an element until its own box arrives.
   *
   * IntersectionObserver cannot do this part: it reports threshold CROSSINGS,
   * so once the proxy is inside the viewport it says nothing further no matter
   * how much deeper it scrolls, and a gate with no second chance is a trap. A
   * negative `rootMargin` cannot do it either — see the note in `config`,
   * where shrinking the root was measured to silence an element permanently.
   *
   * So the held elements are re-checked on scroll, with one shared passive
   * listener that exists only while something is actually waiting.
   *
   * @param {Element} element
   */
  #gate(element) {
    this.gated.add(element);
    if (this.gateScrollHandler || typeof window === "undefined" || !window.addEventListener) return;
    this.gateScrollHandler = () => {
      if (this.gateRaf !== null) return;
      const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => cb();
      this.gateRaf = raf(() => {
        this.gateRaf = null;
        this.#recheckGated();
      });
    };
    window.addEventListener("scroll", this.gateScrollHandler, { passive: true });
  }

  /**
   * Stop holding an element, and drop the listener once nothing is left.
   * @param {Element} element
   */
  #ungate(element) {
    if (!this.gated.delete(element) || this.gated.size > 0) return;
    if (this.gateScrollHandler && typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("scroll", this.gateScrollHandler);
    }
    this.gateScrollHandler = null;
  }

  /** Release every held element whose own box has now reached the fold. */
  #recheckGated() {
    for (const element of [...this.gated]) {
      const data = this.queue.get(element);
      if (!data) {
        this.#ungate(element);
        continue;
      }
      if (!this.#gateOpen(element)) continue;
      this.#ungate(element);
      if (data.hasRun || data.preparing || this.active.has(element)) continue;
      data.driver = "proxy";
      this.start(element, data);
    }
  }

  /**
   * Unregister element
   * @param {Element} element
   */
  unregister(element) {
    this.#releaseProxy(element);
    this.#ungate(element);
    if (this.observer) {
      this.observer.unobserve(element);
    }
    this.queue.delete(element);
    this.active.delete(element);
  }

  /**
   * Clear element from completed set (for replay functionality)
   * @param {Element} element
   */
  clearCompleted(element) {
    if (this.completed.delete(element)) this.completedCount -= 1;
  }

  /**
   * Handle intersection changes
   * @param {IntersectionObserverEntry[]} entries
   */
  handleIntersections(entries) {
    // TWO passes, on purpose. An element and its proxy are observed together,
    // so their entries arrive in the SAME batch — and a batch's order is not
    // specified. Deciding while walking it would make "the proxy may only speak
    // when the element cannot" depend on which entry the browser happened to
    // list first, which is exactly the kind of rule that works until it does
    // not. Pass one records what each element said about ITSELF; pass two acts.
    for (const entry of entries) {
      const own = this.queue.get(entry.target);
      if (own) own.selfIntersecting = entry.isIntersecting;
    }

    for (const entry of entries) {
      const owners = this.proxies.get(entry.target);
      if (owners) {
        for (const element of owners) this.#handleEntry(element, entry, true);
        continue;
      }
      this.#handleEntry(entry.target, entry, false);
    }
  }

  /**
   * One intersection entry, resolved to the element it speaks for.
   *
   * @param {Element} element - the animated element
   * @param {IntersectionObserverEntry} entry
   * @param {boolean} viaProxy - this entry belongs to the stand-in, not to the
   *   element itself
   */
  #handleEntry(element, entry, viaProxy) {
    const data = this.queue.get(element);
    if (!data) return;

    // Above the fold is decided PER ELEMENT, on the first entry it ever
    // receives — which the observer delivers as soon as the element is
    // observed, and which reports whether it was on screen at that moment.
    // Still free: the answer comes out of the entry, not a layout read.
    //
    // It used to mean "arrived in the observer's first BATCH", which made the
    // answer depend on which frame an element happened to register in. With a
    // carousel at the top of the page that is not stable — Swiper initialises
    // asynchronously and moves the layout underneath, so registration order
    // shifts between loads. Measured on this home page: the same URL produced
    // 0, then 1, then 9 flagged elements across three reloads, sometimes
    // crediting the slideshow and sometimes a section below it. A policy that
    // silently changes what it does on every reload cannot be reasoned about,
    // and a merchant cannot report a bug against it.
    //
    // This has to run BEFORE the not-intersecting return below: an element
    // that starts off screen must be recorded as such, or its later entries
    // would each look like a first one.
    if (!viaProxy && !data.seenFirstEntry) {
      data.seenFirstEntry = true;
      data.aboveTheFold = entry.isIntersecting;
    } else if (!viaProxy && !data.aboveTheFold && entry.isIntersecting && !this.loadSettled) {
      // Still the initial render. An element can register before the layout
      // around it has settled — a carousel above it is still initialising, an
      // image has not resolved its height — and report "not intersecting" for
      // something the visitor is in fact looking at. Measured: the slideshow's
      // own elements came out 5-of-8 on one load and 8-of-8 on the next, so
      // some of its lines took the slow 1.5s reveal while their neighbours
      // took the 0.6s swap, differently each time.
      //
      // Upgrading during load closes that, and it can only ever upgrade:
      // nothing that starts flagged loses the flag, so the answer is stable
      // once `load` has fired.
      data.aboveTheFold = true;
    }

    if (!entry.isIntersecting) {
      // Left the viewport. Only a repeat registration cares: put it back in
      // its start state so the next entry animates rather than snapping.
      //
      // Gated on the driver: a CLIPPED element reports false forever, so
      // without this its own entries would re-arm a repeat registration on
      // every scroll tick, resetting an animation nobody asked to replay.
      if (data.repeat && data.hasRun && data.driver === (viaProxy ? "proxy" : "self") && !this.active.has(element)) {
        data.hasRun = false;
        try {
          data.onExit?.();
        } catch (error) {
          console.error("[MotionCoordinator] Exit error:", error);
        }
      }
      return;
    }

    // The stand-in speaks ONLY for an element that cannot speak for itself.
    // `undefined` means the element's own entry is not in this batch, which
    // is not the same as "it is hidden" — wait for it rather than guess.
    if (viaProxy && data.selfIntersecting !== false) return;

    if (data.hasRun || data.preparing || this.active.has(element)) return;

    // The proxy has arrived, but it is a stand-in for POSITION and only an
    // honest one when it is snug around the element. Hold it until its own box
    // reaches the fold; #gate re-checks on scroll, because the observer will
    // not mention this proxy again while it scrolls deeper.
    if (viaProxy && !this.#gateOpen(element)) {
      this.#gate(element);
      return;
    }
    if (viaProxy) this.#ungate(element);

    data.driver = viaProxy ? "proxy" : "self";
    this.start(element, data);
  }

  /**
   * A promise that settles once the page-transition curtain has started to
   * fade, or null when there is nothing to wait for (setting off, fade already
   * under way or done — which is every registration after the first paint,
   * including replays). Memoised: one listener for the whole page, not one per
   * element.
   *
   * @returns {Promise<void> | null}
   */
  #curtainLifting() {
    if (this.curtain !== undefined) return this.curtain;
    const overlay = document.querySelector("page-transition");
    if (!overlay || overlay.hidden || overlay.hasAttribute("data-lifting")) {
      this.curtain = null;
      return null;
    }
    this.curtain = new Promise((resolve) => {
      document.addEventListener(ThemeEvents.pageLoaded, () => resolve(), { once: true });
      overlay.addEventListener("animationstart", () => resolve(), { once: true });
      setTimeout(resolve, CURTAIN_SAFETY_MS);
    }).then(() => {
      this.curtain = null;
    });
    return this.curtain;
  }

  /**
   * One element has come into view: let it get ready, then either animate it or
   * show it. Async because `prepare` is — and deliberately so: the wait happens
   * BEFORE the budget is consulted, so an element waiting on its images never
   * holds a slot.
   *
   * @param {Element} element
   * @param {Object} data - the element's queue entry
   */
  async start(element, data) {
    if (data.prepare) {
      data.preparing = true;
      try {
        await data.prepare({ aboveTheFold: Boolean(data.aboveTheFold) });
      } catch (error) {
        console.error("[MotionCoordinator] Prepare error:", error);
      }
      data.preparing = false;

      // The wait was asynchronous, so the world may have moved: the element can
      // have been unregistered (disconnected, morphed away) or already started
      // by another path.
      if (this.queue.get(element) !== data || data.hasRun || this.active.has(element)) return;
    }

    // AFTER prepare, so the media wait overlaps the curtain instead of
    // following it.
    const curtain = this.#curtainLifting();
    if (curtain) {
      // Same in-flight flag `prepare` uses, so a second intersection entry
      // during the wait cannot start this element twice.
      data.preparing = true;
      await curtain;
      data.preparing = false;
      if (this.queue.get(element) !== data || data.hasRun || this.active.has(element)) return;
    }

    if (this.canActivate(data.type)) {
      this.activate(element, data.onActivate);
      return;
    }

    // Over budget — show it NOW, do not queue it.
    //
    // This used to defer: hold the element and reveal it 1200ms later if no
    // slot had come. But everything the coordinator can defer has just entered
    // the VIEWPORT and is being held at opacity 0 by the prestage, so deferring
    // means keeping visible content invisible to save GPU — a trade that is
    // never right, and the opposite of the rule this file states twice. The
    // failure mode is now "this block appears instead of fading in", which is a
    // degradation rather than a hole in the page.
    this.skip(element, data);
  }

  /**
   * Decline to animate this element and just show it.
   * @param {Element} element
   * @param {Object} [data] - the element's queue entry
   */
  skip(element, data = this.queue.get(element)) {
    if (!data) return;

    if (data.repeat) {
      // A repeat registration stays observed: it lost this pass, not its
      // registration, and scrolling back should let it try again.
      data.hasRun = true;
    } else {
      this.#releaseProxy(element, data);
      this.queue.delete(element);
      if (this.observer) this.observer.unobserve(element);
      this.completed.add(element);
      this.completedCount += 1;
    }

    try {
      data.onSkip?.();
    } catch (error) {
      console.error("[MotionCoordinator] Reveal error:", error);
    }
  }

  /**
   * Check if can activate more animations
   * @param {string} type - Animation type
   * @returns {boolean}
   */
  canActivate(type) {
    // Check global limit (applies to ALL animation types)
    if (this.active.size >= this.config.maxActiveAnimations) {
      return false;
    }

    // Check zoom-specific limit (zoom is most expensive)
    // By cost, not by name: a fork's own expensive preset is capped too.
    const isCostly = (/** @type {string} */ name) => getMotionPreset(name)?.cost === "high";
    if (isCostly(type)) {
      const activeZooms = Array.from(this.active).filter((el) => {
        const data = this.queue.get(el);
        return data && isCostly(data.type);
      });

      if (activeZooms.length >= this.config.maxZoomAnimations) {
        return false;
      }
    }

    return true;
  }

  /**
   * Activate animation for element.
   *
   * The slot is held for exactly as long as the callback's promise takes, so
   * `onActivate` MUST resolve when the animation ENDS — not when it starts.
   * That is what makes `active.size` mean "animations currently running", the
   * only reading under which the caps above measure what they claim to. A
   * caller that fires and forgets is not budgeted at all: measured on the
   * reference demo home page, 6 registrations were animating while this set
   * held 0.
   *
   * @param {Element} element
   * @param {Function} callback
   */
  async activate(element, callback) {
    const data = this.queue.get(element);

    // Add to active set
    this.active.add(element);

    // A repeat registration keeps its observation: it needs the exit entry to
    // know when to re-arm. Everything else is done after one run.
    if (!data?.repeat) {
      this.#releaseProxy(element, data);
      this.observer.unobserve(element);
    }

    try {
      // Execute animation callback
      await callback({ aboveTheFold: Boolean(data?.aboveTheFold) });
    } catch (error) {
      console.error("[MotionCoordinator] Animation error:", error);
    } finally {
      this.active.delete(element);

      if (data?.repeat) {
        data.hasRun = true;
      } else {
        this.queue.delete(element);
        this.completed.add(element);
        this.completedCount += 1;
      }
    }
  }

  /**
   * Get statistics for debugging
   * @returns {Object}
   */
  getStats() {
    const activeByType = {};
    for (const el of this.active) {
      const data = this.queue.get(el);
      const type = data?.type || "unknown";
      activeByType[type] = (activeByType[type] || 0) + 1;
    }

    return {
      queued: this.queue.size,
      active: this.active.size,
      completed: this.completedCount,
      preparing: Array.from(this.queue.values()).filter((data) => data.preparing).length,
      activeByType,
      limits: {
        maxActive: this.config.maxActiveAnimations,
        maxZoom: this.config.maxZoomAnimations,
      },
      observer: this.observer ? "initialized" : "not initialized",
    };
  }

  /**
   * Destroy coordinator and cleanup
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.gated.clear();
    this.gateScrollHandler = null;
    this.gateRaf = null;
    this.queue.clear();
    this.proxies.clear();
    this.active.clear();
    this.completed = new WeakSet();
    this.completedCount = 0;
  }
}

// Export singleton instance
export const motionCoordinator = new MotionCoordinator();

// Expose to window for debugging
if (typeof window !== "undefined") {
  window.FoxTheme = window.FoxTheme || {};
  window.FoxTheme.motionCoordinator = motionCoordinator;
}
