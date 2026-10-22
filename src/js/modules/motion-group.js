import { animate } from "@theme/animation";
import { ThemeEvents } from "@theme/events";
import {
  prefersReducedMotion,
  coordinatedInView,
  motionDurationMs,
  entranceMotion,
  isMotionMobile,
} from "@theme/utilities";
import { motionCoordinator } from "@theme/motion-coordinator";
import {
  getMotionPreset,
  motionEndState,
  motionPresetForViewport,
  stagedPresetName,
  DEFAULT_PRESET,
} from "@theme/motion-presets";

/**
 * @capability Staggered entrance for a LIST — fades its cells in one after another (fade-up or plain fade) instead of the list appearing at once; runs on scroll-into-view AND on demand via replay(), so the same effect covers a card grid revealing itself and a tab panel the visitor just switched to.
 * @when Any repeated row/grid whose items should arrive in sequence: product grids, collection lists, article cards, tab panels full of cards. Reach for this INSTEAD of putting a <motion-component> around every card — one group costs one animation budget slot and one animation for the whole list, where N wrappers spend N slots and N animations on the same cascade.
 * @contract <div is="motion-group" data-motion="fade-up|fade-in" [data-motion-stagger="70"] [data-motion-off]> placed ON the existing grid/row container (a customized built-in, so it adds no box and no wrapper). Each direct child is one cell; the element actually animated is the cell's first element child when it has one, else the cell. The group hides as a whole until its cells are staged (critical-css.liquid, keyed on :not([data-motion-ready])); each cell is then put on the generated per-preset prestage rule by data-motion-from="<preset>", so the start state is resolved by CSS against the cell itself. While that staging is live the GROUP carries data-motion-staged, which a scroll-snap row uses to stand its snapping down. Hosts trigger a re-run by calling replay().
 * @component motion-group
 * @keywords stagger, staggered animation, cascade, sequence, one by one, card grid animation, list entrance, fade up cards, tab panel animation, reveal grid
 */
class MotionGroup extends HTMLDivElement {
  /** @type {(() => void) | null} */
  #inViewStop = null;

  /** @type {number | null} */
  #pendingFrame = null;

  /** @type {{ cancel: () => void, finished: Promise<unknown> } | null} */
  #controls = null;

  /**
   * Which run is current. Motion RESOLVES `finished` when an animation is
   * cancelled or replaced — measured; it does not reject — so an interrupted
   * run's continuation would otherwise wake up after replay() has already
   * re-prestaged, wipe those styles in a microtask, and leave the new run
   * animating from the finished state. That reads as "the animation just did
   * not play". Every continuation checks this token before touching the DOM.
   */
  #runId = 0;

  /** Set by the coordinator when this list was on screen at first paint. */
  #aboveTheFold = false;

  /**
   * Exactly the elements this group put `data-motion-from` on.
   *
   * NOT re-derived from #targets() at cleanup time. That resolution is unstable
   * between the two moments — a `[data-motion-cell]` appearing later promotes
   * route 2 over route 3, an empty cell that gains a child resolves to the child
   * instead of the cell, and a nested group inserted in between takes ownership
   * via #owns(). Anything staged under the old resolution and absent from the
   * new one would keep the attribute, and the stylesheet holds it at opacity 0
   * with nothing left to move it.
   *
   * @type {Element[]}
   */
  #staged = [];

  /**
   * Was this list on screen at first paint? It no longer changes the timing —
   * a list arrives with the same rhythm wherever it is — but it is still the
   * first thing worth knowing when a cascade looks wrong, so it stays public
   * and mirrored onto the element.
   */
  get aboveTheFold() {
    return this.#aboveTheFold;
  }

  /**
   * Mirrored onto the element so the Elements panel shows it too.
   *
   * @param {boolean} value
   */
  #setAboveTheFold(value) {
    this.#aboveTheFold = value;
    this.toggleAttribute("data-motion-above-fold", value);
  }

  /**
   * `data-motion-ready` is the flag the group-level hide is keyed on — its
   * ABSENCE is what holds the list at opacity 0 until the cells are staged.
   * Nothing in this file ever removes it, so a removal always comes from
   * outside, and in practice that means a morph: the Section Rendering API
   * reconciles against server HTML, which never carries runtime state, so it
   * strips the flag from a group that is still on the page.
   *
   * motion-component recovers from that in updatedCallback(). This is a
   * customized built-in, not a Component, so it never gets one — and the result
   * was the whole list going invisible with nothing left to run.
   */
  static get observedAttributes() {
    return ["data-motion-ready"];
  }

  /**
   * @param {string} name
   * @param {string | null} _previous
   * @param {string | null} value
   */
  attributeChangedCallback(name, _previous, value) {
    // Only a REMOVAL, and only while we are still on the page. #reveal() putting
    // the flag back lands here too, with a non-null value, and must not recurse.
    if (name !== "data-motion-ready" || value !== null || !this.isConnected) return;

    // NOT synchronously. The callback fires in the middle of the morph: the
    // group's own attributes are reconciled before its children are, so at this
    // moment the cells are still the OLD ones. Staging them here staged nodes
    // the morph was about to replace (or patch, stripping `data-motion-from`
    // again, since server HTML never carries it), and the run that followed
    // animated the NEW cells from the state they were already in — a 1→1
    // fade, every event fired, nothing visible. Measured on a collection
    // filter: 16 cells animated, 0 of them staged.
    //
    // A microtask lands after the morph's synchronous pass and before the next
    // paint, so the cells are the new ones and nobody sees the gap: the flag
    // being absent keeps the whole group hidden until #prestage() puts it back.
    const token = ++this.#morphToken;
    queueMicrotask(() => {
      if (token !== this.#morphToken || !this.isConnected) return;
      this.#recoverFromMorph();
    });
  }

  /** Bumped per morph so only the latest deferred recovery runs. */
  #morphToken = 0;

  #recoverFromMorph() {
    if (this.#isDisabled() || !this.#targets().length) {
      this.#reveal();
      return;
    }

    // Treat it as what it is: fresh content in an element we already own. Same
    // sequence motion-component runs on a morph — forget the completed mark,
    // drop the old binding, stage the new cells, watch again.
    motionCoordinator.clearCompleted(this);
    this.#unbind();
    this.#cancelPendingFrame();
    this.#runId += 1;
    this.removeAttribute("data-initialized");
    this.#prestage();
    this.#bind();
  }

  connectedCallback() {
    // Nothing to animate, or motion is off: drop the prestage so the content is
    // simply there. This MUST run even on the disabled path — the prestage is a
    // CSS rule on this element, so bailing without revealing hides the list.
    if (this.#isDisabled() || !this.#targets().length) {
      this.#reveal();
      return;
    }

    // The cells' start state reads --motion-distance (the generated prestage
    // rules); a list travels its own, larger distance.
    this.style.setProperty("--motion-distance", "var(--motion-list-distance)");
    this.#prestage();

    switch (this.trigger) {
      case "manual":
        // Prestaged and waiting. Something will call replay() — a dialog
        // opening, a filter finishing — and until then the list stays hidden on
        // purpose, which is what "manual" means.
        break;
      case "load":
        // Reveal speed: nothing asked for this either, it just runs on load.
        requestAnimationFrame(() => this.isConnected && this.#enter());
        break;
      default:
        this.#bind();
    }
  }

  disconnectedCallback() {
    this.#runId += 1; // same reason as replay(): stop the in-flight continuation
    this.#cancelPendingFrame();
    this.#unbind();
    this.#controls?.cancel();
    this.#controls = null;
  }

  /** Preset name from the registry; unknown names fall back rather than silently doing nothing. */
  get type() {
    const requested = this.dataset.motion;
    return requested && getMotionPreset(requested) ? requested : DEFAULT_PRESET;
  }

  /** What starts this group: "inview" (default), "load", or "manual". */
  get trigger() {
    const value = this.dataset.motionTrigger;
    return value === "manual" || value === "load" ? value : "inview";
  }

  /** Re-arm when the group scrolls out of view, so coming back plays it again. */
  get repeat() {
    return this.hasAttribute("data-motion-repeat");
  }

  /**
   * Seconds before the FIRST cell starts; the stagger then counts from there.
   *
   * Same attribute a motion-component reads, so a wrapper that can animate
   * either as one element or as a list of them does not need the merchant's
   * delay setting to mean two different things — or, worse, to mean nothing in
   * one of the two modes, which is what it did before this existed.
   */
  get delay() {
    const ms = Number(this.dataset.motionDelay);
    return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
  }

  /**
   * The step between two cells, in ms: `data-motion-stagger` when the markup
   * sets one, the --motion-stagger token otherwise. It is NOT divided down to
   * fit a budget any more — the cascade only ever covers the cells on screen
   * (see #delays()), so a long grid no longer stretches the tail past what the
   * visitor can see.
   */
  get stagger() {
    const attr = Number(this.dataset.motionStagger);
    return Number.isFinite(attr) && attr >= 0 ? attr : motionDurationMs("--motion-stagger", 100, this);
  }

  /**
   * Per-cell delays, in seconds. The cells in the viewport cascade one step
   * apart; the ones outside it follow TOGETHER once that cascade has played —
   * a visitor scrolling on finds them already settled instead of queued behind
   * cells they never saw.
   *
   * @param {Element[]} targets
   * @param {number} durationMs
   * @returns {number[]}
   */
  #delays(targets, durationMs) {
    const step = this.stagger;
    const viewport = window.innerHeight;
    let onScreen = 0;
    const visible = targets.map((target) => {
      const { top, bottom } = target.getBoundingClientRect();
      const isVisible = top < viewport && bottom > 0;
      if (isVisible) onScreen += 1;
      return isVisible;
    });
    const afterCascade = onScreen ? (onScreen - 1) * step + durationMs : 0;
    let index = 0;
    return visible.map((isVisible) => (this.delay * 1000 + (isVisible ? step * index++ : afterCascade)) / 1000);
  }

  /** Direct children — one per cell. */
  get #cells() {
    return /** @type {HTMLElement[]} */ (Array.from(this.children));
  }

  /**
   * Everything this group animates, in order. Public because it is the ONLY
   * definition of that list: motion-controller's inspect() used to re-derive it
   * from `children` with its own copy of the rule below, which meant a group
   * that resolved its cells any other way had its debug row quietly describing
   * the wrong elements.
   *
   * @returns {HTMLElement[]}
   */
  get targets() {
    return this.#targets();
  }

  /**
   * What actually moves. Three ways to say it, most explicit first:
   *
   * 1. `data-motion-cells="<selector>"` — for a list whose items are not this
   *    element's own children, or whose markup comes from a shared snippet you
   *    cannot mark up.
   * 2. `data-motion-cell` on each item — the house form. Survives a class
   *    rename, and keeps selectors out of the module (see the DOM-access
   *    contract in CLAUDE.md).
   * 3. Nothing: each child's first element child, else the child itself.
   *
   * (3) is the historical default and stays the default. A grid cell is usually
   * a bare positioning div wrapping one card, and animating the CARD rather than
   * the cell matters twice over: a `.swiper-slide` cell already carries Swiper's
   * own transform, and an inline transform on the cell would fight it; and in a
   * grid the cell is the stretched grid item that a card's `height: 100%`
   * resolves against.
   *
   * Every route is filtered through #owns(): a nested group's items belong to
   * that group, not this one. Without it a panel-level group would reach past
   * an inner carousel's group and animate the same cards twice.
   */
  #targets() {
    const selector = this.dataset.motionCells;
    if (selector) {
      const found = this.#query(selector);
      if (found.length) return found;
    }

    const marked = this.#query("[data-motion-cell]");
    if (marked.length) return marked;

    return this.#cells.map((cell) => /** @type {HTMLElement} */ (cell.firstElementChild ?? cell));
  }

  /**
   * Elements matching a selector that this group — not a nested one — owns.
   * A bad selector is a merchant-facing dead end rather than a thrown error, so
   * it degrades to the default resolution instead of leaving the list hidden.
   *
   * @param {string} selector
   * @returns {HTMLElement[]}
   */
  #query(selector) {
    /** @type {Element[]} */
    let found;
    try {
      found = Array.from(this.querySelectorAll(selector));
    } catch (error) {
      console.warn("[motion-group] ignoring an unusable cell selector:", selector, error);
      return [];
    }
    return /** @type {HTMLElement[]} */ (found.filter((element) => this.#owns(element)));
  }

  /**
   * @param {Element} element
   * @returns {boolean}
   */
  #owns(element) {
    return element.parentElement?.closest('[is="motion-group"]') === this;
  }

  /**
   * WHERE this group's animation ends, and which properties it touches. Where it
   * STARTS is not computed here at all — the stylesheet owns that.
   *
   * `data-motion-from` puts each cell on the same generated rule the first-paint
   * prestage uses, so the start state is resolved once, by the engine, against
   * the cell itself. It used to be rebuilt in JS from `--motion-distance` read
   * off this group: two independent resolutions of one value, which is a jump on
   * frame one wherever the two disagree, and which ignored any token scoped
   * below the group — the CSS honoured that scope, the animation did not.
   */
  #preset() {
    const name = motionPresetForViewport(this.type, isMotionMobile());
    return getMotionPreset(name) ?? getMotionPreset(DEFAULT_PRESET);
  }

  #endState() {
    return motionEndState(this.#preset());
  }

  /** The preset name the stylesheet should stage a cell with. */
  get #stagedPreset() {
    return stagedPresetName(motionPresetForViewport(this.type, isMotionMobile()));
  }

  /**
   * Hand every target to the generated prestage rule, then release the
   * group-level hide. One write pass, no reads in between, so this never forces
   * a synchronous layout.
   */
  #prestage() {
    const to = this.#endState();
    const preset = this.#stagedPreset;
    const next = this.#targets();

    // Un-stage whatever this run is about to forget. #targets() is re-resolved
    // here, and it does not have to return what the previous run staged: a
    // `data-motion-cells` selector may be state-dependent — a blog list filters
    // with `:scope > :not([hidden]) > *`, so hiding a card drops it from the
    // resolution — and the default route moves too, when a cell that was empty
    // gains a child or a nested group takes ownership. An element dropped from
    // the set without having the attribute taken off it keeps `data-motion-from`
    // for good, and the stylesheet holds it at opacity 0 with nothing left to
    // move it. Measured: four cells stranded on a filtered blog grid. It was
    // invisible only because every route that shows such a cell again happens to
    // replay the group, which re-stages and then clears it — a coincidence of
    // flow, not a guarantee, and one more route away from a blank card.
    const keep = new Set(next);
    for (const previous of this.#staged) {
      if (!keep.has(previous)) previous.removeAttribute("data-motion-from");
    }

    this.#staged = next;

    // A transform moves the cell's SNAP AREA with its box, so a scroll-snap
    // container the cells sit in re-snaps to the staged position and then
    // chases the animation frame by frame. `_component-swipe.scss` stands the
    // snap down while this attribute is present. Set from the fact that a
    // transform was written rather than from which axis it uses: the trap is a
    // start edge that moves toward the scroll end, which `slide-in-end` does
    // with translate and `zoom-in` does with a centre-origin scale — an
    // axis test would let zoom-in through, and a fork preset could add more.
    if (to.transform) this.setAttribute("data-motion-staged", "");

    for (const target of this.#staged) {
      const style = /** @type {HTMLElement} */ (target).style;
      // Whatever the previous run committed inline outranks a stylesheet rule,
      // so it has to go before the rule can be relied on.
      style.opacity = "";
      style.transform = "";
      target.setAttribute("data-motion-from", preset);
      // No layer for a cell that is not animating. #enter() sets the hint back
      // one frame later; a reset() that interrupts a run has no such follow-up,
      // and a grid left prestaged would otherwise hold one compositor layer per
      // cell for as long as it stays hidden.
      style.willChange = "";
    }

    this.#reveal();
  }

  #reveal() {
    this.setAttribute("data-motion-ready", "true");
  }

  /**
   * One run of the list's entrance. Every trigger — scroll into view, a tab,
   * a filter — plays the same list rhythm (--motion-list-duration and
   * --motion-list-ease); only which cells cascade depends on what is on screen
   * at that moment (#delays()).
   */
  async #enter() {
    const targets = this.#targets();
    if (!targets.length) return;

    const run = ++this.#runId;

    // A list has its own rhythm, whatever started it — a scroll, a tab, a
    // filter: --motion-list-duration on --motion-list-ease, the same at first
    // paint as anywhere else.
    const { durationMs, fadeDurationMs, easing, fadeEasing } = entranceMotion(
      "--motion-list-duration",
      500,
      this,
      "--motion-list-ease"
    );
    const to = this.#endState();
    const willChange = Object.keys(to)
      .map((property) => (property === "opacity" ? "opacity" : "transform"))
      .join(", ");

    for (const target of targets) {
      /** @type {HTMLElement} */ (target).style.willChange = willChange;
    }

    this.#emit(ThemeEvents.motionStart);

    const delays = this.#delays(targets, durationMs);
    this.#controls = animate(targets, to, {
      duration: durationMs / 1000,
      easing,
      // Opacity runs on its own curve and its own clock — see entranceMotion().
      // Motion merges a per-property option object over the base options, so
      // one call carries both.
      opacity: { easing: fadeEasing, duration: fadeDurationMs / 1000 },
      delay: (index) => delays[index] ?? 0,
      allowWebkitAcceleration: true,
    });

    try {
      await this.#controls.finished;
    } catch {
      // Motion resolves rather than rejects here, but a native animation
      // REJECTS when cancelled — modules.js relies on exactly that distinction
      // one file over, so this path is not hypothetical enough to return from
      // empty-handed. Bailing without clearing would leave every cell carrying
      // `data-motion-from` with no successor run to take them off it, and the
      // group already has `data-motion-ready`, so nothing hides the hole.
      if (run === this.#runId) this.#clearInlineStyles(targets);
      return;
    }

    // A newer run started while this one was in flight: it owns the element's
    // styles now, so touching them here is exactly the bug this token exists
    // to prevent.
    if (run !== this.#runId) return;

    this.#clearInlineStyles(targets);
    this.setAttribute("data-initialized", "true");
    this.#emit(ThemeEvents.motionEnd, { animated: true });
  }

  /**
   * Undo everything a run put on the cells: the staging attribute that hands
   * them to the prestage rule, and the end state Motion commits inline when it
   * finishes. The animated end state IS the natural state, so clearing both
   * leaves the DOM as authored — and, more than tidiness, it drops the
   * `transform` that would otherwise sit on each card forever, making it a
   * containing block for any fixed-position descendant.
   *
   * `data-motion-from` MUST be dropped here rather than only at the end of a
   * successful run: this is also the path the budget takes when it has no slot,
   * and the one reset() takes. A cell left carrying it is a cell the stylesheet
   * keeps at opacity 0 with nothing coming to move it.
   *
   * @param {Element[]} [targets]
   */
  #clearInlineStyles(targets = this.#targets()) {
    // The UNION: whatever is current, plus whatever this group actually staged.
    // Either set alone can strand an element — see #staged.
    const all = new Set(targets);
    for (const element of this.#staged) all.add(element);
    this.#staged = [];
    targets = [...all];

    // Paired with the write in #prestage(): the flag tracks the staged
    // transform, so it has to be dropped everywhere that staging is —
    // the end of a run, revealNow(), and reset() (which re-stages right after).
    this.removeAttribute("data-motion-staged");

    for (const target of targets) {
      target.removeAttribute("data-motion-from");
      const style = /** @type {HTMLElement} */ (target).style;
      style.opacity = "";
      style.transform = "";
      style.willChange = "";
    }
  }

  /**
   * Show the cells immediately, no animation. Called by the budget when it has
   * no slot to give, and by FoxTheme.motion.reveal() — an animation may be
   * dropped, content may not. Public: it is the always-safe exit for any host
   * unsure what state motion left this in.
   */
  revealNow() {
    this.#runId += 1; // any in-flight continuation is now stale
    this.#clearInlineStyles();
    this.setAttribute("data-initialized", "true");
    this.#reveal();
    this.#emit(ThemeEvents.motionEnd, { animated: false });
  }

  /**
   * Back to the start state without playing. What a repeat registration does on
   * exit, and what a host calls before staging its own sequence.
   */
  reset() {
    if (this.#isDisabled() || !this.#targets().length) return;

    this.#runId += 1;
    this.#cancelPendingFrame();
    this.#controls?.cancel();
    this.#controls = null;
    this.removeAttribute("data-initialized");
    this.#prestage();
  }

  /** @param {string} name @param {Record<string, any>} [detail] */
  #emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: { preset: this.type, ...detail } }));
  }

  #bind() {
    this.#unbind();
    // ONE registration for the whole list — one budget slot and one animation
    // for every cell, instead of one of each per card.
    //
    // `return this.#enter()` is load-bearing: the returned promise IS the slot,
    // so it has to last as long as the cascade does. motion-component now does
    // the same; it used to fire and forget, which is why this was for a long
    // time the only thing the caps could actually see.
    this.#inViewStop = coordinatedInView(
      this,
      ({ aboveTheFold } = {}) => {
        this.#setAboveTheFold(Boolean(aboveTheFold));
        return this.#enter();
      },
      {
        onSkip: () => this.revealNow(),
        repeat: this.repeat,
        onExit: () => this.reset(),
      }
    );
  }

  #unbind() {
    this.#inViewStop?.();
    this.#inViewStop = null;
  }

  #cancelPendingFrame() {
    if (this.#pendingFrame !== null) {
      cancelAnimationFrame(this.#pendingFrame);
      this.#pendingFrame = null;
    }
  }

  #isDisabled() {
    return (
      prefersReducedMotion() ||
      // Not armed means motion-boot's watchdog fired, or this page never armed
      // the prestage. Either way nothing is hidden right now, so prestaging
      // here would HIDE content that is already on screen just to fade it back
      // in — the flash the arming mechanism exists to prevent.
      !document.documentElement.hasAttribute("data-motion-armed") ||
      this.hasAttribute("data-motion-off") ||
      this.closest("[data-motion-disabled]") !== null
    );
  }

  /**
   * Run the entrance again, now.
   *
   * The trigger a host owns: a tab panel becoming visible, a filter swapping
   * its results. In-view is not enough for those — the list is already on
   * screen, and the coordinator has it marked completed from its first run.
   *
   * One frame separates the prestage WRITE from the animation's own style
   * READ, which is why this does not simply call #enter() inline.
   */
  replay() {
    if (this.#isDisabled() || !this.#targets().length) {
      // #reveal() only lifts the GROUP-level hide. Cells staged by a previous
      // run are separate elements at opacity 0, and opacity on a parent does
      // not raise a child, so they have to be released explicitly.
      this.#clearInlineStyles();
      this.#reveal();
      return;
    }

    // Invalidate the in-flight run BEFORE cancelling it. cancel() resolves its
    // `finished` promise, and that continuation runs as a microtask — i.e.
    // before the rAF below. Bumping the token only inside #enter() left a
    // window where the old continuation still matched, wiped the prestage this
    // method is about to write, and left the new run animating from the
    // finished state. Measured: the second of two quick replays did not
    // animate at all.
    this.#runId += 1;

    // Whatever the first paint needed, it has had it: a replay is a tab switch,
    // a filter, a modal — the visitor is already here.
    this.#setAboveTheFold(false);

    this.#cancelPendingFrame();
    this.#unbind();
    this.#controls?.cancel();
    this.#controls = null;
    motionCoordinator.clearCompleted(this);
    this.removeAttribute("data-initialized");

    this.#prestage();
    this.#pendingFrame = requestAnimationFrame(() => {
      this.#pendingFrame = null;
      if (!this.isConnected) return;
      this.#enter();
    });
  }
}

// motion-boot already probed for customized built-in support before first paint
// and set `data-motion-builtins`, which is what lets the prestage rule hide
// groups. If the real define fails anyway, take that flag back — otherwise
// every list stays hidden waiting for a component that will never upgrade.
try {
  if (!customElements.get("motion-group")) {
    customElements.define("motion-group", MotionGroup, { extends: "div" });
  }
  // Report in for THIS half of the runtime. motion-component sets its own flag,
  // and motion-boot checks them separately on DOMContentLoaded — because this
  // file failing to load at all is invisible to that one, and the list prestage
  // it leaves behind hides every card on the page with nothing to undo it.
  document.documentElement.setAttribute("data-motion-groups-booted", "");
} catch (error) {
  document.documentElement.removeAttribute("data-motion-builtins");
  console.warn("[motion-group] customized built-in elements unavailable; lists will not animate.", error);
}
