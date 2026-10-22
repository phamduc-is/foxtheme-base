import { Component } from "@theme/component";
import { DialogCloseEvent } from "@theme/dialog";
import { ThemeEvents, MediaStartedPlayingEvent, ModelInteractionEvent } from "@theme/events";
import {
  isSafari,
  getSafariVersion,
  entranceMotion,
  motionDurationMs,
  motionToken,
  isMotionMobile,
} from "@theme/utilities";
import {
  getMotionPreset,
  motionEndState,
  motionPresetForViewport,
  stagedPresetName,
  DEFAULT_PRESET,
} from "@theme/motion-presets";
import { animate } from "@theme/animation";
import { imageCoordinator } from "@theme/image-coordinator";

/**
 * Tab widget. Exported so a section can subclass it — override `animateIn()`
 * to change the entrance without reimplementing the panel-switching logic.
 */
/**
 * @capability Complete accessible tab widget — switches panels with a fade/slide entrance, full ARIA (roles, aria-selected/aria-controls auto-assigned), arrow/Home/End keyboard navigation, lazy panel content from <template>, and theme-editor block-select sync; exported so sections can subclass and override animateIn() only.
 * @when ANY tabbed UI: content tabs, product tabs, collection tabs. NEVER hand-roll tab switching — subclass this instead; builders reimplementing tabs lose keyboard nav, ARIA, and editor sync every time. Pair with .edge__shadows + swipe-component for an overflowing tab bar. Pairs with src/scss/global/_component-tabs.scss.
 * @contract <tabs-component data-section-id [active-index] [data-content-animation="none|stagger|<any preset in motion-presets.js>"]> with ref="tab[]" buttons (bound via on:click="/onTabClick", keydown → onKeydown) and ref="panel[]" in matching order; lazy panels carry data-lazy-loading="true" + a <template>, and while their content is first laid out they carry data-tabs-preparing (measurable but not painted — never style against it, it is a transient flag); the swap is a SEQUENCE by default (--motion-swap-mode): the outgoing panel leaves in the direction the section's entrance preset travels (up for fade-up, out the far side for a slide, in place for fade-in) by --motion-tab-distance while it fades, then the incoming one enters from there on the same --motion-tab-duration / --motion-tab-ease, and any motion-group in it cascades in at the same time; with --motion-swap-mode: crossfade the incoming panel enters over the outgoing one's --motion-exit fade instead, and for that fade the outgoing panel is lifted to position:absolute and its parent gets an inline position:relative (marked data-tabs-positioned), both reverted after — do not fight either from CSS; a display:contents panel has no box to fade or lift, so it is cut in the frame the incoming one appears; the entrance uses the shared --motion-* entrance tokens, and "stagger" hands off to a <div is="motion-group"> inside the panel; a <motion-component> or <motion-text> inside the panel (a block's own entrance) likewise owns it in either mode — the panel stays still and the block replays on every swap, even with the section's entrance set to "none"; active tab gets data-active + aria-selected.
 * @component tabs-component
 * @keywords tabs, tab bar, tab panel, tabbed content, switch panels, segmented control, aria tabs, keyboard navigation, lazy tab content, toggle views
 */
export class TabsComponent extends Component {
  /** @type {string[]} */
  requiredRefs = ["tab", "panel"];

  /** @type {number} */
  _activeIndex = 0;

  /**
   * The in-flight entrance per panel, so an interruption can stop it. Holding
   * the handle is not optional: a running animation outranks inline styles, so
   * a swap that does not cancel its predecessor gets painted over by it.
   *
   * @type {WeakMap<Element, { cancel: () => void, finished: Promise<unknown> }>}
   */
  #animations = new WeakMap();

  /** @type {number} */
  #previousIndex = 0;

  /**
   * Which switch is current. The swap is asynchronous now — the outgoing panel
   * fades before the incoming one enters — so a visitor clicking through tabs
   * faster than 120ms would otherwise have an old exit reveal a panel that is
   * no longer the active one.
   */
  #switchId = 0;

  /** @type {HTMLElement | null} The panel whose exit animation is still running. */
  #exitingPanel = null;

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  connectedCallback() {
    super.connectedCallback();
    this.#registerDesignModeEvents();

    const initial = Number(this.getAttribute("active-index"));
    if (!Number.isNaN(initial)) this._activeIndex = this.#clampIndex(initial);

    this.#ensureIdsAndAria();
    this.#syncSelected(false);
  }

  disconnectedCallback() {
    // Clean up Theme Editor bindings
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  #registerDesignModeEvents() {
    // Only in Theme Editor and when explicitly opted-in
    if (!(window.Shopify && Shopify.designMode)) return;

    // Recreate controller to drop old listeners if any
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (e.detail.sectionId != this.sectionId) return;

        const { target } = e;
        const panel = target.closest('[ref="panel[]"]');
        const index = panel.dataset.index;
        this.selectTab(index, true);
      },
      { signal }
    );
  }

  onTabClick(event) {
    event.preventDefault();

    const target = /** @type {HTMLElement} */ (event.target);
    if (!target) return;

    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    const index = tabs.indexOf(target);
    if (index === -1) return;

    this.selectTab(index, true);
  }

  onKeydown(event) {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    if (!tabs?.length) return;

    const currentIndex = tabs.indexOf(/** @type {HTMLElement} */ (event.target));
    if (currentIndex === -1) return;

    let next;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = currentIndex + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = currentIndex - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.selectTab(next, true);
  }

  selectTab(index, focus = false) {
    const next = this.#clampIndex(index);
    if (next === this._activeIndex) return;

    this.#previousIndex = this._activeIndex;
    this._activeIndex = next;
    this.setAttribute("active-index", String(next));
    this.#syncSelected(focus);
  }

  /**
   * Move a lazy panel's `<template>` content into the panel itself.
   *
   * @param {HTMLElement} panel
   * @returns {Promise<void>} Settles once fresh content has had two frames to
   *   lay out. Nothing to load settles immediately.
   */
  #loadPanelContent(panel) {
    if (panel.dataset.lazyLoading !== "true") return Promise.resolve();
    if (panel.dataset.loaded === "true") return Promise.resolve();

    const template = panel.querySelector("template");
    if (!template) {
      panel.dataset.loaded = "true";
      return Promise.resolve();
    }

    // Give the panel a real BOX before the content lands in it.
    //
    // This used to append into a panel that was still `hidden`, i.e.
    // `display: none`, and everything inside then initialised against a
    // zero-width container. Measured on a tabs section whose panels hold a
    // carousel: Swiper computed `slidesPerView` against width 0, so each slide
    // fell back to full width and the panel came out 1518px tall instead of
    // 438. The panel was un-hidden in that state, painted twice, and only
    // Swiper's own ResizeObserver put it right on the third frame — which is
    // the flash a visitor sees the FIRST time they open a tab, and never
    // again, because nothing re-initialises afterwards.
    //
    // `height: 0` + `overflow: hidden` keeps the panel's WIDTH — the dimension
    // every measuring component actually reads — while costing no vertical
    // space, so the outgoing panel's fade is not disturbed. Deliberately not a
    // class or an absolutely-positioned rule: this must not depend on a
    // stylesheet a fork is free to rewrite, and absolute positioning would need
    // a positioned ancestor that `.tabs__panels` does not have.
    panel.hidden = false;
    panel.setAttribute("data-tabs-preparing", "");
    panel.style.height = "0";
    panel.style.overflow = "hidden";
    panel.style.visibility = "hidden";
    panel.style.pointerEvents = "none";

    const fragment = template.content.cloneNode(true);
    panel.appendChild(fragment);
    template.remove();

    const fallbacks = panel.querySelectorAll("noscript");
    fallbacks.forEach((fallback) => fallback.remove());

    panel.dataset.loaded = "true";

    // Two frames, not one: a custom element upgrades synchronously on insert but
    // schedules its own setup in a rAF (CarouselComponent does), so the first
    // frame is where that setup runs and the second is where its layout lands.
    // The caller waits on this ALONGSIDE the outgoing panel's fade rather than
    // after it — with `prefers-reduced-motion`, or the entrance set to "none",
    // that fade resolves in a microtask and would otherwise hand the panel over
    // before a single frame had passed.
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }

  /**
   * Lift a panel out of layout so it can be painted over the one replacing it.
   *
   * The whole reason a crossfade is affordable: the outgoing panel keeps
   * painting but stops claiming height, so the container is sized by the
   * incoming panel alone and never by both. Positioned against its own parent,
   * which is given a positioning context here rather than in a stylesheet — a
   * fork owns the tabs SCSS and this must not be something it can delete.
   *
   * @param {HTMLElement} panel
   */
  #detachFromFlow(panel) {
    const host = panel.parentElement;
    const hostStyle = host && getComputedStyle(host);
    if (hostStyle && hostStyle.position === "static") {
      host.style.position = "relative";
      host.dataset.tabsPositioned = "true";
    }
    panel.style.position = "absolute";
    // The host's OWN padding, not 0. Absolute insets resolve against the padding
    // box, so a padded host drops the lifted panel onto the padding it sat clear
    // of one frame earlier: it jumps by that much and widens by the same, mid-fade,
    // which reads as the outgoing content sliding sideways before the incoming
    // entrance. The vertical tabs layout is where this bites — `.tabs--vertical
    // .tabs__panels` carries `padding-inline-start: 3rem` (5rem from lg) to clear
    // its divider rule, so every swap displaced the panel 30-50px. Logical
    // properties throughout, so it stays correct under RTL.
    panel.style.insetInlineStart = hostStyle ? hostStyle.paddingInlineStart : "0";
    panel.style.insetInlineEnd = hostStyle ? hostStyle.paddingInlineEnd : "0";
    panel.style.insetBlockStart = hostStyle ? hostStyle.paddingBlockStart : "0";
    // It is on its way out and sitting ON TOP of the panel that replaced it —
    // without this, every click during the fade lands on content that is
    // already gone.
    panel.style.pointerEvents = "none";
  }

  /** @param {HTMLElement} panel */
  #reattachToFlow(panel) {
    panel.style.position = "";
    panel.style.insetInlineStart = "";
    panel.style.insetInlineEnd = "";
    panel.style.insetBlockStart = "";
    panel.style.pointerEvents = "";

    const host = panel.parentElement;
    if (host?.dataset.tabsPositioned !== "true") return;

    // Only once NOTHING is still lifted out. A visitor clicking back to a panel
    // whose own exit is still running reattaches it here while that exit is
    // mid-flight, and taking the positioning context away from under the panel
    // still floating on it would drop it onto whatever ancestor is positioned
    // next — or the viewport.
    const panels = /** @type {HTMLElement[]} */ (this.refs.panel) || [];
    if (panels.some((other) => other.style.position === "absolute")) return;

    delete host.dataset.tabsPositioned;
    host.style.position = "";
  }

  /**
   * Hand a prepared panel back to normal flow. Safe to call on any panel.
   * @param {HTMLElement} [panel]
   */
  #endPreparing(panel) {
    if (!panel?.hasAttribute("data-tabs-preparing")) return;
    panel.removeAttribute("data-tabs-preparing");
    panel.style.height = "";
    panel.style.overflow = "";
    panel.style.visibility = "";
    panel.style.pointerEvents = "";
  }

  #syncSelected(focus) {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    const panels = /** @type {HTMLElement[]} */ (this.refs.panel);
    if (!tabs?.length || !panels?.length) return;

    for (let i = 0; i < tabs.length; i++) {
      const isActive = i === this._activeIndex;

      tabs[i].setAttribute("aria-selected", String(isActive));
      tabs[i].setAttribute("tabindex", isActive ? "0" : "-1");
      tabs[i].toggleAttribute("data-active", isActive);
    }

    const activePanel = panels[this._activeIndex];
    const previousPanel = panels[this.#previousIndex];

    const contentReady = this.#loadPanelContent(activePanel);

    // If same panel, ensure it's visible and bail
    if (this.#previousIndex === this._activeIndex) {
      if (activePanel) {
        this.#cancelAnimation(activePanel);
        this.#endPreparing(activePanel);
        activePanel.hidden = false;
        activePanel.style.willChange = "";
      }
    } else {
      // The outgoing panel FADES rather than being cut. A hard cut followed by
      // the incoming fade is the flicker this whole pass has been chasing:
      // something vanishes, then something else appears, and the eye reads a
      // blink between them.
      //
      // The two now CROSS. They used to be sequential — the incoming panel
      // waited for the outgoing fade to finish — on the reasoning that
      // overlapping them would lay out both panels at once and jump the
      // container height mid-swap. That reasoning holds only while both are in
      // FLOW, and the outgoing one is lifted out of it — but not until the
      // incoming panel is ready to take the layout over, in the SAME frame.
      // Handing it over any earlier leaves the container with no in-flow child
      // at all: the incoming panel is still `height: 0` while it lays out, so
      // the section collapsed and everything below it jumped up for those two
      // frames — visible only on a tab's first open, the one case where that
      // window exists.
      //
      // Sequential had a cost the measurements make plain: from the exit
      // reaching zero to the entrance getting its first frame, nothing was on
      // screen at all. Measured on a tab swap, tracking panel opacity times
      // cell opacity: five frames under 15% ink and two at exactly 0 — a 67ms
      // white blink. Crossing them puts the floor at ~0.4 and never at zero,
      // without changing a single duration.
      const swap = ++this.#switchId;

      const showNext = () => {
        // A newer switch happened while the exit was running — it owns the
        // panels now.
        if (swap !== this.#switchId) return;
        if (!activePanel) return;

        // THE handover, and it has to be one frame: the outgoing panel gives up
        // layout and the incoming one claims it without a paint in between.
        if (previousPanel && previousPanel !== activePanel) {
          if (this.#exitingPanel === previousPanel) {
            // Still fading — float it above the panel that replaced it.
            this.#detachFromFlow(previousPanel);
          } else {
            // Nothing is fading it (reduced motion, entrance "none"), so it is
            // simply cut here rather than when the swap was requested.
            previousPanel.hidden = true;
            previousPanel.style.willChange = "";
          }
        }

        this.#cancelAnimation(activePanel);
        this.#endPreparing(activePanel);
        // It can be the panel whose own exit is still fading — the visitor
        // clicked back. It has to claim layout again immediately, or the
        // container is left with no in-flow child and collapses to nothing
        // until that exit finishes.
        this.#reattachToFlow(activePanel);
        activePanel.hidden = false;
        this.animateIn(activePanel);
      };

      // The incoming panel waits only for its own first layout — NOT for the
      // outgoing fade, which is now running underneath it on its own clock.
      // Unless the swap is a SEQUENCE (--motion-swap-mode, the default): the
      // outgoing panel drops away completely, then the incoming one rises into
      // place — one gesture, and the height change happens in the gap between
      // them rather than under a panel.
      const sequence = this.#isSequence;
      let exited = Promise.resolve();
      if (previousPanel) {
        this.#cancelAnimation(previousPanel);
        exited = this.#exitPanel(previousPanel);
      }
      (sequence ? Promise.all([contentReady, exited]) : contentReady).then(showNext);

      // Hide all other non-involved panels. NOT the one currently fading out:
      // this loop used to hide it the same tick its exit animation started, so
      // the fade ran behind `display: none` and the swap read as 120ms of
      // nothing where it used to be an instant cut. #exitPanel hides it itself
      // once the animation is actually over.
      for (let i = 0; i < panels.length; i++) {
        if (i === this._activeIndex) continue;
        const panel = panels[i];
        if (!panel || panel === this.#exitingPanel) continue;
        this.#cancelAnimation(panel);
        // A panel can still be in the prepared state here — a second switch
        // while the first was mid-flight leaves showNext() with a stale swap
        // id, so it returns without handing the panel back itself.
        this.#endPreparing(panel);
        this.#reattachToFlow(panel);
        panel.hidden = true;
        panel.style.willChange = "";
      }
    }

    if (focus) tabs[this._activeIndex]?.focus();
  }

  /**
   * Entrance animation for the panel that just became active.
   *
   * PROTECTED EXTENSION POINT — subclass and override to animate something
   * else (e.g. a section whose panels are `display: contents` generates no box
   * for `opacity`/`transform` to apply to, so the panel itself cannot be
   * animated). Everything around it — panel show/hide, lazy content, ARIA
   * sync, focus — stays inherited, so an override does NOT need to
   * reimplement `selectTab()`.
   *
   * The caller already cancels any in-flight animation on this panel before
   * calling, so an override does not need to.
   *
   * @param {HTMLElement} panel
   */
  /**
   * Which entrance the merchant picked: "none", the "stagger" sentinel, or any
   * preset name in the motion registry. This only decides the PANEL-level
   * fallback: when the panel contains a motion-group or a block-level
   * motion-component, that owns the entrance whatever the value here — see
   * animateIn().
   *
   * An unregistered name degrades to the default rather than throwing. The
   * value arrives from a merchant setting, so a fork that drops a preset should
   * lose an entrance, not a working tab.
   *
   * @returns {string}
   */
  get contentAnimation() {
    const value = this.dataset.contentAnimation;
    if (value === "none" || value === "stagger") return value;
    return getMotionPreset(value) ? value : DEFAULT_PRESET;
  }

  animateIn(panel) {
    // Respect reduced motion and provide graceful fallback
    const supportsWAAPI = typeof Element !== "undefined" && "animate" in Element.prototype;
    const prefersReduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const effect = this.contentAnimation;

    if (!supportsWAAPI || prefersReduce || effect === "none") {
      panel.hidden = false;
      // A block's own entrance is the block's, not the section's: it plays on
      // every swap even when the panel-level one is off. replay() itself honours
      // reduced motion and a disarmed page.
      this.#replayBlockMotion(panel);
      return;
    }

    this.#cancelAnimation(panel);
    panel.hidden = false;

    if (this.#isSequence) {
      this.#enterInSequence(panel);
      return;
    }

    // If the panel owns a motion-group, the GROUP owns the entrance and the
    // panel stays still. Not just for `stagger`: a 0.6s fade over the whole
    // panel on top of the group's own fade is two animations on one opacity,
    // which is how a fade turns into a flicker. The group also gets this right
    // in the other direction — it animates on scroll-into-view too, which a
    // panel-level entrance cannot, since nothing switches tabs on first load.
    const group = /** @type {any} */ (panel.querySelector('[is="motion-group"]'));
    if (typeof group?.replay === "function") {
      group.replay();
      return;
    }

    // The same rule for a block that carries its own entrance (a Text block's
    // animation_type renders a <motion-component>). Animating the panel as well
    // was two entrances at once on a tab's FIRST open — the block had never run,
    // its panel was display:none, so it revealed in the same frame: double the
    // travel, opacity multiplied — and only the panel's on every later open,
    // since a motion-component runs once. The block now owns it, every time.
    if (this.#replayBlockMotion(panel)) return;

    // The shared entrance vocabulary — same distance and curves as a scroll
    // reveal, at the faster duration a visitor-triggered swap wants. See
    // entranceMotion() and the "Entrance motion" block in css-variables.liquid.
    const { durationMs, fadeDurationMs, easing, fadeEasing } = entranceMotion("--motion-swap", 600, panel);

    // The keyframes come from the registry every scroll reveal already reads,
    // so "fade-up" here and "fade-up" on a motion-component are one definition
    // rather than two that can drift. They used to be a hand-written
    // translateY, which is why the three sections feeding this attribute could
    // offer six options while only two of them did anything.
    const presetName = motionPresetForViewport(effect, isMotionMobile());
    const preset = getMotionPreset(presetName) ?? getMotionPreset(DEFAULT_PRESET);
    const keyframes = motionEndState(preset);

    // Put the panel on the generated prestage rule and let the animation read
    // its own start from there. Building an explicit [from, to] pair here meant
    // resolving --motion-distance and --flip-x-factor a second time, in JS,
    // for a start state the stylesheet already knows how to paint.
    panel.style.opacity = "";
    panel.style.transform = "";
    panel.setAttribute("data-motion-from", stagedPresetName(presetName));

    // Only the properties this preset actually animates. A fade carries no
    // transform, and promoting a layer for one holds compositor memory that
    // nothing then uses.
    panel.style.willChange = Object.keys(keyframes)
      .map((property) => (property === "opacity" ? "opacity" : "transform"))
      .join(", ");

    // One call, two clocks. Raw WAAPI takes a single easing and a single
    // duration per animation, so this used to be two `panel.animate()` calls
    // with the cleanup hooked to whichever was longer. Motion merges a
    // per-property option object over the base, which is the same thing the
    // rest of the motion system uses — and it is the same native animation
    // underneath either way.
    const controls = animate(panel, keyframes, {
      duration: durationMs / 1000,
      easing,
      opacity: { duration: fadeDurationMs / 1000, easing: fadeEasing },
    });

    this.#animations.set(panel, controls);

    // `finished` resolves on cancel as well as on completion — which is exactly
    // what the two separate finish/cancel listeners were doing before. The
    // identity check is what makes a superseded run leave the current one's
    // will-change alone.
    controls.finished.then(() => {
      if (this.#animations.get(panel) === controls) {
        this.#animations.delete(panel);
        panel.removeAttribute("data-motion-from");
        panel.style.willChange = "";
      }
    });
  }

  /**
   * Fade a panel out, then hide it. Resolves when it is hidden — including on
   * every path that does not animate, so the caller can always just await it.
   *
   * @param {HTMLElement} panel
   * @returns {Promise<void>}
   */
  #exitPanel(panel) {
    // Still being prepared, so it was never on screen: there is nothing to fade
    // OUT, and fading it would mean showing it first. This is the panel a
    // visitor abandons by clicking a third tab while the second is still
    // loading — the one path where showNext() bails on a stale swap id and so
    // never hands the panel back itself. Without this it stays hidden carrying
    // `height: 0; visibility: hidden`, invisible to anything that later shows it
    // by any route other than this component.
    if (panel.hasAttribute("data-tabs-preparing")) {
      this.#endPreparing(panel);
      panel.hidden = true;
      panel.style.willChange = "";
      return Promise.resolve();
    }

    const supportsWAAPI = typeof Element !== "undefined" && "animate" in Element.prototype;
    const prefersReduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const duration = this.#isSequence
      ? this.#tabMotion(panel).durationMs
      : motionDurationMs("--motion-exit", 120, panel);
    // A `display: contents` panel generates no box, so neither half of the
    // crossfade reaches it: `opacity` has nothing to fade and `position:
    // absolute` has nothing to lift out of flow. Its children stay fully
    // opaque in their grid cells for the whole exit, painted over the ones
    // replacing them. Cut it instead — showNext() hides it in the frame the
    // incoming panel appears, and the subclass animates the entrance itself.
    const generatesNoBox = getComputedStyle(panel).display === "contents";

    if (!supportsWAAPI || prefersReduce || this.contentAnimation === "none" || duration <= 0 || generatesNoBox) {
      // Deliberately NOT hidden here. This method only ever changes opacity now
      // — the layout handover belongs to showNext(), which does it in the one
      // frame the incoming panel claims layout. Hiding a panel the moment the
      // swap is requested is what left the container empty while the incoming
      // one was still laying out. A panel this path abandons is picked up by
      // the hide-everything-else loop on the next sync.
      return Promise.resolve();
    }

    this.#exitingPanel = panel;

    // In a sequence the exit carries on in the direction the section's entrance
    // travels — up for fade-up, on across for a slide, growing past full size
    // for a zoom-in — by --motion-tab-distance while it fades, on the tab clock
    // and curve. A
    // crossfade only fades, on the fade curve, underneath the incoming panel.
    const controls = this.#isSequence
      ? animate(
          panel,
          { opacity: [1, 0], transform: ["none", this.#tabMotion(panel).exitOffset] },
          { duration: duration / 1000, easing: this.#tabMotion(panel).easing }
        )
      : animate(
          panel,
          { opacity: [1, 0] },
          { duration: duration / 1000, easing: motionToken("--motion-ease-fade", "linear", panel) }
        );

    // No `.catch()` here any more: a native animation REJECTS `finished` when
    // cancelled, Motion resolves it. Either way the panel must end up hidden,
    // which is why the handler was already identical on both paths.
    return controls.finished.then(() => {
      panel.style.opacity = "";
      panel.style.transform = "";
      panel.style.willChange = "";
      this.#reattachToFlow(panel);
      if (this.#exitingPanel === panel) this.#exitingPanel = null;

      // Unless the visitor came BACK to it while the fade was still running —
      // two fast clicks between the same two tabs, where this panel is the
      // ACTIVE one again by the time its own exit finishes. Hiding it here
      // would then blank the section 120ms after the swap, with no way back
      // except another click.
      //
      // Latent until the panel handover got faster: the incoming panel used to
      // wait a full exit fade of its own, so this handler had always already
      // run by then. It now waits only for the incoming content's first layout,
      // which can be a microtask, and the two orders swapped.
      if (this.refs.panel?.[this._activeIndex] !== panel) panel.hidden = true;
    });
  }

  /** `sequence` (the default) or `crossfade` — see --motion-swap-mode. */
  get #isSequence() {
    return motionToken("--motion-swap-mode", "sequence", this) !== "crossfade";
  }

  /**
   * The tab clock, read from the panel so it can be scoped.
   *
   * @param {Element} panel
   * `offset` is the section entrance's start state at tab distance: where the
   * incoming panel starts. `exitOffset` is its mirror, where the outgoing one
   * goes, so the two travel the same way — the old panel leaves through the
   * side opposite the one the new panel enters from. `x`/`y` are the preset's
   * multiples of the distance (`x` flipped for RTL), a scale mirrors around 1,
   * and a preset that does not move (fade-in) gives `none` both ways.
   *
   * @returns {{ durationMs: number, easing: string, offset: string, exitOffset: string }}
   */
  #tabMotion(panel) {
    const distance = motionToken("--motion-tab-distance", "2rem", panel);
    const effect = this.contentAnimation === "stagger" ? DEFAULT_PRESET : this.contentAnimation;
    const from = getMotionPreset(motionPresetForViewport(effect, isMotionMobile()))?.from ?? { y: 1 };
    const flip = getComputedStyle(panel).getPropertyValue("--flip-x-factor").trim() || "1";

    /** @param {1 | -1} sign */
    const offset = (sign) => {
      const parts = [];
      if (from.x) parts.push(`translateX(calc(${distance} * ${from.x * sign} * ${flip}))`);
      if (from.y) parts.push(`translateY(calc(${distance} * ${from.y * sign}))`);
      if (from.scale != null) parts.push(`scale(${sign > 0 ? from.scale : 2 - from.scale})`);
      return parts.join(" ") || "none";
    };

    return {
      durationMs: motionDurationMs("--motion-tab-duration", 150, panel),
      easing: motionToken("--motion-tab-ease", "ease", panel),
      offset: offset(1),
      exitOffset: offset(-1),
    };
  }

  /**
   * The incoming panel of a sequence comes in from #tabMotion()'s offset
   * while it fades in, and any list inside it cascades in AT THE SAME TIME on
   * its own rhythm — the panel lands quickly, the cards keep arriving after
   * it. A panel holding a block with its own entrance (a motion-component, or
   * split text) stays still and the block replays, as in the crossfade mode:
   * moving the panel as well doubled the travel and multiplied the fade on
   * the first open, and left the block still on every later one.
   *
   * @param {HTMLElement} panel
   */
  #enterInSequence(panel) {
    if (this.#replayBlockMotion(panel)) {
      panel.querySelectorAll('[is="motion-group"]').forEach((group) => /** @type {any} */ (group).replay?.());
      return;
    }

    const { durationMs, easing, offset } = this.#tabMotion(panel);
    panel.style.willChange = "opacity, transform";

    const controls = animate(
      panel,
      { opacity: [0, 1], transform: [offset, "none"] },
      { duration: durationMs / 1000, easing }
    );
    this.#animations.set(panel, controls);
    controls.finished.then(() => {
      if (this.#animations.get(panel) !== controls) return;
      this.#animations.delete(panel);
      panel.style.opacity = "";
      panel.style.transform = "";
      panel.style.willChange = "";
    });

    panel.querySelectorAll('[is="motion-group"]').forEach((group) => /** @type {any} */ (group).replay?.());
  }

  /**
   * Replay every block-level entrance inside the panel.
   *
   * @param {HTMLElement} panel
   * @returns {boolean} Whether the panel had any.
   */
  #replayBlockMotion(panel) {
    const blocks = panel.querySelectorAll("motion-component, motion-text");
    // At swap speed, like the panel and any group in it: a tab is something the
    // visitor just asked for, whoever owns its entrance.
    blocks.forEach((el) => /** @type {any} */ (el).replay?.({ speed: "swap" }));
    return blocks.length > 0;
  }

  #cancelAnimation(panel) {
    const controls = this.#animations.get(panel);
    if (controls) {
      controls.cancel();
      this.#animations.delete(panel);
    }
    // The staging attribute is dropped HERE, not only in the finished handler.
    // Cancelling resolves `finished`, but the handler's identity check reads the
    // map entry this method just deleted, so it bails without cleaning up — and
    // the caller immediately does `panel.hidden = false`. That is a visible
    // panel the stylesheet is still holding at opacity 0 with nothing coming to
    // move it. Reachable by re-selecting the active tab inside the swap window.
    panel.removeAttribute("data-motion-from");
  }

  #ensureIdsAndAria() {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    const panels = /** @type {HTMLElement[]} */ (this.refs.panel);
    if (!tabs?.length || !panels?.length) return;

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const panel = panels[i];
      if (!panel) continue;

      const tabId = tab.id || `${this.sectionId}-${this.tagName.toLowerCase()}-tab-${i}`;
      const panelId = panel.id || `${this.sectionId}-${this.tagName.toLowerCase()}-panel-${i}`;

      tab.id = tabId;
      panel.id = panelId;

      tab.setAttribute("role", "tab");
      panel.setAttribute("role", "tabpanel");

      tab.setAttribute("aria-controls", panelId);
      panel.setAttribute("aria-labelledby", tabId);
    }
  }

  #clampIndex(index) {
    const tabs = /** @type {HTMLElement[]} */ (this.refs.tab);
    if (!tabs?.length) return 0;
    const len = tabs.length;
    return ((index % len) + len) % len;
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error("Section id missing");

    return sectionId;
  }
}

if (!customElements.get("tabs-component")) {
  customElements.define("tabs-component", TabsComponent);
}

/**
 * @capability Complete accordion over native <details>/<summary> — smooth height+opacity open/close animation, optional single-open mode, optional keep-one-open guard, aria-expanded sync, auto-scroll of the clicked header into view, reduced-motion fallback, and theme-editor block-select opening.
 * @when ANY collapsible/expandable list: FAQs, filter groups, product info collapsibles, footer menus on mobile. NEVER hand-roll accordion/collapse behaviour — the height animation, single-open, and editor sync are all here. Pairs with src/scss/global/_component-accordion.scss.
 * @contract <accordion-component [data-single-open="true"] [data-at-least-one-item-open="true"] data-section-id> (class accordion__rows, display: contents, inside the .accordion root div, which owns classes/style/editor attributes and the optional motion-group) with ref="item[]" (<details>), ref="summary[]" (bound via on:click="/onSummaryClick") and ref="content[]" (.accordion__content wrapping .accordion__inner for height measurement); open item gets .is-open; timing via --accordion-duration/--accordion-easing CSS vars.
 * @component accordion-component
 * @keywords accordion, collapsible, expand collapse, faq, details summary, toggle section, single open, height animation, disclosure, collapse panel
 */
export class AccordionComponent extends Component {
  /** @type {string[]} */
  requiredRefs = ["item", "summary", "content"];

  /** @type {WeakMap<Element, Animation>} */
  #animations = new WeakMap();

  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  connectedCallback() {
    super.connectedCallback();
    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
    // Clean up Theme Editor bindings
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  #registerDesignModeEvents() {
    // Only in Theme Editor and when explicitly opted-in
    if (!(window.Shopify && Shopify.designMode)) return;

    // Recreate controller to drop old listeners if any
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (e.detail.sectionId != this.sectionId) return;

        const { target } = e;
        const item = target.closest("details");

        if (item && item.open != true) {
          const summary = item.querySelector("summary");
          const content = item.querySelector(".accordion__content");

          this.toggleOpen({ willOpen: true, item, summary, content });
        }
      },
      { signal }
    );
  }

  onSummaryClick(event) {
    event.preventDefault();

    const summary = /** @type {HTMLElement} */ (event.target);

    const summaries = /** @type {HTMLElement[] | HTMLElement | undefined} */ (this.refs.summary);
    const items = /** @type {HTMLElement[] | HTMLElement | undefined} */ (this.refs.item);
    const contents = /** @type {HTMLElement[] | HTMLElement | undefined} */ (this.refs.content);

    let idx = -1;
    if (Array.isArray(summaries)) idx = summaries.indexOf(summary);

    /** @type {HTMLElement | undefined} */
    let item;
    /** @type {HTMLElement | undefined} */
    let content;

    if (idx >= 0) {
      item = Array.isArray(items) ? items[idx] : /** @type {HTMLElement} */ (items);
      content = Array.isArray(contents) ? contents[idx] : /** @type {HTMLElement} */ (contents);
    } else {
      // Fallback an toàn nếu chưa dùng refs mảng
      item = summary.closest("details") ?? undefined;
      if (item) content = this.#getContent(item);
    }

    if (!item || !content) return;

    this.toggleOpen({
      willOpen: !item.open,
      item,
      summary,
      content,
      shouldScroll: true,
    });
  }

  toggleOpen(settings) {
    const { willOpen, item, summary, content, shouldScroll = false } = settings;

    if (willOpen) {
      item.classList.add("is-open");
      if (this.dataset.singleOpen === "true") this.#closeOthers(item);
      item.open = true;
      item.querySelector("summary")?.setAttribute("aria-expanded", "true");
      this.#animateOpen(content, shouldScroll ? () => this.#scrollIntoViewIfOut(summary) : undefined);
    } else {
      if (this.#isAtLeastOneItemOpen()) {
        const { item } = this.refs;
        let numberItemOpened = 0;

        for (const detail of item) {
          if (detail.classList.contains("is-open")) {
            numberItemOpened++;
          }
        }

        if (numberItemOpened <= 1) {
          return;
        }
      }

      item.classList.remove("is-open");
      this.#animateClose(item, content);
    }
  }

  #isAtLeastOneItemOpen() {
    return this.dataset.atLeastOneItemOpen === "true";
  }

  #closeOthers(except) {
    const items = /** @type {HTMLElement[]} */ (this.refs.item);
    for (const it of items) {
      if (it === except || !it.open) continue;
      it.classList.remove("is-open");
      const content = this.#getContent(it);
      if (content) this.#animateClose(it, content);
    }
  }

  #getContent(item) {
    const ref = /** @type {HTMLElement | HTMLElement[] | undefined} */ (this.refs.content);
    if (Array.isArray(ref)) {
      const found = ref.find((el) => item.contains(el));
      if (found) return found;
    } else if (ref instanceof HTMLElement) {
      if (item.contains(ref)) return ref;
    }

    const summary = item.querySelector("summary");
    if (!summary) return null;
    let node = summary.nextElementSibling;
    while (node && node.tagName.toLowerCase() === "summary") node = node.nextElementSibling;
    return /** @type {HTMLElement|null} */ (node);
  }

  #animateOpen(content, onFinish) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    this.#cancel(content);

    content.style.overflow = "hidden";
    content.hidden = false;

    if (reduce) {
      content.style.height = "";
      content.style.opacity = "";
      content.style.overflow = "";
      if (typeof onFinish === "function") onFinish();
      return;
    }

    // Start from collapsed state
    content.style.height = "0px";

    const duration = this.#duration();
    const easing = this.#easing();

    const start = () => {
      const inner = content.querySelector(".accordion__inner");
      const target = inner instanceof HTMLElement ? inner.scrollHeight : content.scrollHeight;
      const anim = content.animate(
        [
          { height: "0px", opacity: 0 },
          { height: `${target}px`, opacity: 1 },
        ],
        { duration, easing, fill: "forwards" }
      );

      this.#animations.set(content, anim);

      const cleanup = () => {
        if (this.#animations.get(content) === anim) {
          this.#animations.delete(content);
          // Cancel animation to clear all applied styles
          anim.cancel();
          // Clear all animation styles to allow natural height
          content.style.height = "";
          content.style.opacity = "";
          content.style.overflow = "";
          if (typeof onFinish === "function") onFinish();
        }
      };

      anim.addEventListener("finish", cleanup, { once: true });
      anim.addEventListener("cancel", cleanup, { once: true });
    };

    if (typeof requestAnimationFrame === "function") requestAnimationFrame(start);
    else start();
  }

  #animateClose(item, content) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    this.#cancel(content);

    // Measure current height (border-box) and freeze it
    const visualHeight = content.getBoundingClientRect().height || content.scrollHeight;
    const heightFrom = visualHeight;
    if (reduce) {
      item.open = false;
      return;
    }

    content.style.overflow = "hidden";
    // Freeze current layout as starting values
    content.style.height = `${heightFrom}px`;

    const duration = this.#duration();
    const easing = this.#easing();

    const start = () => {
      const anim = content.animate(
        [
          { height: `${heightFrom}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration, easing, fill: "forwards" }
      );

      this.#animations.set(content, anim);

      const cleanup = () => {
        if (this.#animations.get(content) === anim) {
          this.#animations.delete(content);
          // Cancel animation to clear all applied styles
          anim.cancel();
          item.open = false;
          item.querySelector("summary")?.setAttribute("aria-expanded", "false");
          content.style.height = "";
          content.style.opacity = "";
          content.style.overflow = "";
        }
      };

      anim.addEventListener("finish", cleanup, { once: true });
      anim.addEventListener("cancel", cleanup, { once: true });
    };

    // Ensure style application before animation starts
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(start);
    else start();
  }

  #cancel(content) {
    const a = this.#animations.get(content);
    if (a) {
      a.cancel();
      this.#animations.delete(content);
    }
  }

  #duration() {
    const d = getComputedStyle(this).getPropertyValue("--accordion-duration").trim();
    return Number(d) || 260;
  }

  #easing() {
    return getComputedStyle(this).getPropertyValue("--accordion-easing").trim() || "cubic-bezier(0.22, 1, 0.36, 1)";
  }

  // Smoothly scroll the clicked summary into view only if it's outside the viewport
  #scrollIntoViewIfOut(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 16; // breathing space
    const topVisible = rect.top >= margin;
    const bottomVisible = rect.bottom <= window.innerHeight - margin;
    if (topVisible && bottomVisible) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const targetTop = Math.max(0, window.scrollY + rect.top - margin);
    window.scrollTo({ top: targetTop, behavior: reduce ? "auto" : "smooth" });
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    return sectionId;
  }
}
if (!customElements.get("accordion-component")) {
  customElements.define("accordion-component", AccordionComponent);
}

/**
 * ResponsiveImage - Custom element for responsive lazy-loaded images
 *
 * Modes: liquid (src pre-rendered) | js (lazy hydrate)
 * Safari < 16: Force reload to fix blur from DOMParser elements
 */
// ---------------------------------------------------------------------------
// Shared IntersectionObserver for image-zoom-reveal "in-view" detection.
// One observer for all images — unobserves after first trigger (one-time reveal).
// ---------------------------------------------------------------------------
let _revealObserver = null;

/**
 * Play the zoom reveal: `.in-view` is the end state the CSS transitions to, and
 * `data-reveal-pending` (the armed start state) is cleared in the same write —
 * it has done its job, and a wrapper that has revealed should not still read
 * as pending in the DOM.
 */
function revealWrapper(wrapper) {
  wrapper.classList.add("in-view");
  wrapper.removeAttribute("data-reveal-pending");
  settleReveal(wrapper);
}

/**
 * Release the reveal's compositor surface once the zoom has landed. The
 * stylesheet holds `will-change: transform` on the image from arming until
 * `data-reveal-settled` appears (Firefox steps a scaled image to the pixel
 * grid without it); this stamps that attribute when the transform transition
 * ends. The timer is the floor for the cases that end no transition — reduced
 * motion, Animations off, a morph that re-reveals an image already at rest —
 * so a surface is never held past ~1.6s either way.
 */
function settleReveal(wrapper) {
  wrapper.removeAttribute("data-reveal-settled");
  let timer = 0;
  const done = () => {
    clearTimeout(timer);
    wrapper.removeEventListener("transitionend", onEnd);
    wrapper.setAttribute("data-reveal-settled", "");
  };
  const onEnd = (event) => {
    if (event.propertyName === "transform") done();
  };
  wrapper.addEventListener("transitionend", onEnd);
  timer = setTimeout(done, 1600);
}

function getRevealObserver() {
  if (!_revealObserver) {
    _revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            revealWrapper(entry.target);
            _revealObserver.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -50px 0px", threshold: 0.01 }
    );
  }
  return _revealObserver;
}

// Batch reveal checks: collect wrappers, flush in a single rAF to avoid
// interleaved getBoundingClientRect + classList writes when many images load at once.
let _revealQueue = [];
let _revealRafId = null;

function queueRevealCheck(wrapper) {
  _revealQueue.push(wrapper);
  if (!_revealRafId) {
    _revealRafId = requestAnimationFrame(flushRevealQueue);
  }
}

function flushRevealQueue() {
  _revealRafId = null;
  const wrappers = _revealQueue;
  _revealQueue = [];

  const viewportHeight = window.innerHeight;
  const toReveal = [];
  const toObserve = [];

  // Batch READ
  for (const wrapper of wrappers) {
    if (wrapper.classList.contains("in-view")) continue;
    const rect = wrapper.getBoundingClientRect();
    if (rect.top < viewportHeight - 50 && rect.bottom > 0) {
      toReveal.push(wrapper);
    } else {
      toObserve.push(wrapper);
    }
  }

  // Batch WRITE
  for (const wrapper of toReveal) {
    revealWrapper(wrapper);
  }

  if (toObserve.length) {
    const observer = getRevealObserver();
    for (const wrapper of toObserve) {
      observer.observe(wrapper);
    }
  }
}

/**
 * @capability Lazy-loading responsive <img> upgrade — coordinated IntersectionObserver hydration of src/srcset, sizes computed live from the wrapper's rendered width (ResizeObserver + details[open] re-measure), loading/loaded state classes for blur-up, a shared one-time "in-view" reveal for zoom effects, morph-safe restore (updatedCallback), and Safari <16 blur workarounds.
 * @when EVERY content image — always render via the responsive-image snippet (never reimplement lazy loading or sizes math); components can await img.ready before measuring. Pairs with the .media wrapper styles in src/scss/global/_component-media.scss.
 * @contract <img is="responsive-image" data-mode="liquid|js" [data-src data-srcset]> as the DIRECT child of a .media wrapper (div or picture); toggles loading/loaded (+error on wrapper) classes on both img and wrapper, sets data-reveal-pending on an .image-zoom-reveal wrapper while bytes are outstanding (arms the CSS prestage), and adds .in-view on the wrapper to play the reveal (then data-reveal-settled once its transform transition has ended, releasing the will-change hint).
 * @component responsive-image
 * @keywords responsive image, lazy load, srcset sizes, blur up, image reveal, zoom reveal, picture loading, intersection observer image, image hydration, loaded class
 */
class ResponsiveImage extends HTMLImageElement {
  #observer = null; // Cleanup function from imageCoordinator (was IntersectionObserver)
  #resizeObserver = null; // Cleanup function from imageCoordinator (was ResizeObserver)
  #detailsToggleCleanup = null; // Cleanup for details[open] re-measure (mega-menu, etc.)
  #rafId = null; // Pending rAF from #setupLazyLoad (cancel on cleanup to avoid stale callbacks)
  #readyPromise = null;
  #resolveReady = null;
  #pollId = null;
  #cachedSizesConfig = null;
  #lastSrc = null;
  #hydrated = false;
  #onSettle = null; // Liquid-mode load/error handler (removed in #cleanup)

  get ready() {
    return this.#readyPromise;
  }

  get isReady() {
    return this.classList.contains("loaded");
  }

  connectedCallback() {
    this.#init();
  }

  disconnectedCallback() {
    this.#cleanup();
  }

  /**
   * Identity of the image this element is showing. JS mode never carries `src`
   * (the snippet emits only `data-srcset`), so keying on `src` alone reported
   * "unchanged" for every morph and a swapped product image kept the old one.
   */
  #srcKey() {
    return this.src || this.dataset.src || this.dataset.srcset || "";
  }

  /**
   * The `.media` wrapper is the element's DIRECT parent (div or picture). A
   * `closest()` walk found whichever `.media` ancestor an unwrapped image sat
   * in — a 50px thumb inside a card then marked the card's media loaded and
   * measured the card's width for its own `sizes`.
   */
  #findWrapper() {
    const parent = this.parentElement;
    return parent?.classList.contains("media") ? parent : null;
  }

  updatedCallback() {
    const currentSrc = this.#srcKey();
    if (currentSrc === this.#lastSrc) {
      // Morph may have stripped JS-added attributes/classes — restore them
      this.#restoreAfterMorph();
      return;
    }
    this.#lastSrc = currentSrc;
    this.#cleanup();
    this.classList.remove("loaded", "loading");
    this.wrapper?.classList.remove("loaded", "loading", "error");
    this.#init();
  }

  /**
   * Restore state after morph when src hasn't changed.
   * morphSection copies attributes from server HTML, stripping JS-added:
   * - src, srcset, sizes (hydrated by JS in js-mode)
   * - loaded/loading/in-view classes on img and wrapper
   */
  #restoreAfterMorph() {
    // Re-query wrapper (morph may have replaced the DOM node)
    this.wrapper = this.#findWrapper();

    // JS mode: restore hydrated src/srcset/sizes if morph stripped them
    if (this.#hydrated) {
      this.#hydrateSources();
      this.#hydrateImage();

      // Restore sizes if stripped
      if (!this.sizes?.trim()) {
        this.#setSizesFromWrapper();
        if (!this.sizes?.trim()) this.#applyFallbackSizes();
      }
    }

    // Re-apply loaded state (morph strips JS-added classes)
    if (this.complete && this.naturalWidth > 0) {
      this.#markLoaded();
    } else if (this.#hydrated) {
      // src restored but image not yet cached — re-load
      this.#loadImage();
    } else if (this.wrapper) {
      // Liquid mode: restore wrapper classes
      if (this.classList.contains("loading")) {
        this.#markPending();
        this.wrapper.classList.add("loading");
      }
    }
  }

  #init() {
    this.wrapper = this.#findWrapper();
    this.#lastSrc = this.#srcKey();

    // Resolve old promise to unblock any pending waitForMediaReady() consumers
    this.#resolveReady?.();
    this.#readyPromise = new Promise((r) => (this.#resolveReady = r));

    const isLiquid = this.dataset.mode === "liquid";
    const isSafariOld = getSafariVersion()?.major < 16;

    // Check if already loaded BEFORE cleaning up classes
    // This happens when section re-renders with cached/completed images
    const wasAlreadyLoaded = this.classList.contains("loaded");
    const isComplete = this.complete && this.naturalWidth > 0;
    // A request that already FAILED before this element was upgraded (the
    // polyfill is deferred, so a 404 can settle first). `complete` is also true
    // for an image with no source at all — JS mode before hydration — hence the
    // currentSrc guard; without it every lazy image would be "broken".
    const isBroken = this.complete && this.naturalWidth === 0 && !!this.currentSrc;

    // Clean up any existing loading/loaded states
    // This prevents double classes when section re-renders
    this.classList.remove("loading", "loaded");
    this.wrapper?.classList.remove("loading", "loaded", "error");

    // If was already loaded or complete, mark as loaded and skip re-initialization
    if (wasAlreadyLoaded || isComplete) {
      // Complete AND on screen must show now — nothing may wait on JS (LCP).
      // Complete but OFF screen: nobody can see it yet, so arming the reveal
      // prestage is free and the scroll-in reveal is kept. Native `loading=lazy`
      // fetches the next screen or two before the bundle runs, so without this
      // branch everything Chrome prefetched lost its reveal. One rect read,
      // shared with #revealInView.
      const rect = this.#revealRect();
      if (rect && !ResponsiveImage.#inViewport(rect)) this.#markPending();
      this.#markLoaded(rect);
      return;
    }

    // The load/error events are gone — waiting for them would keep the image
    // in `.loading` (opacity 0) forever.
    if (isBroken) {
      this.#markError();
      return;
    }

    // JS mode: lazy load
    if (!isLiquid) {
      this.#applyFallbackSizes();
      this.#setupLazyLoad();
      return;
    }

    // Liquid mode: wait for load
    // Safari < 16: force reload by re-assigning src
    if (isSafariOld && this.src) {
      const src = this.src;
      const srcset = this.srcset;
      this.removeAttribute("src");
      if (srcset) this.removeAttribute("srcset");
      queueMicrotask(() => {
        if (!this.isConnected) return;
        if (srcset) this.srcset = srcset;
        this.src = src;
        this.#waitForLoad(true);
      });
    } else {
      this.#waitForLoad(isSafariOld);
    }
  }

  #waitForLoad(usePoll = false) {
    // Ensure clean state before adding loading
    this.classList.remove("loaded");
    this.wrapper?.classList.remove("loaded", "error");

    this.#markPending();
    this.classList.add("loading");
    this.wrapper?.classList.add("loading");

    const done = (event) => {
      this.#removeSettle();
      this.#stopPoll();
      if (event?.type === "error") this.#markError();
      else this.#markLoaded();
    };
    this.#onSettle = done;

    this.addEventListener("load", done, { once: true });
    this.addEventListener("error", done, { once: true });

    // Polling fallback for Safari < 16
    if (usePoll) {
      this.#pollId = setInterval(() => {
        if (!this.isConnected) return this.#stopPoll();
        if (this.naturalWidth > 0) done();
      }, 50);
      setTimeout(() => {
        if (this.#pollId && !this.isReady) {
          this.#stopPoll();
          this.#markLoaded();
        }
      }, 2000);
    }
  }

  #stopPoll() {
    if (this.#pollId) {
      clearInterval(this.#pollId);
      this.#pollId = null;
    }
  }

  #removeSettle() {
    if (!this.#onSettle) return;
    this.removeEventListener("load", this.#onSettle);
    this.removeEventListener("error", this.#onSettle);
    this.#onSettle = null;
  }

  /**
   * Arm the zoom-reveal prestage for THIS image, now that we know its bytes
   * have not arrived yet. The prestage used to be unconditional CSS, applied
   * at first paint and lifted only by JS — so an image whose bytes beat the
   * deferred bundle sat hidden behind the grey placeholder until modules.js
   * ran (measured: 1.4s on Fast 3G). Hiding an image that has nothing to show
   * yet is free; hiding one that is already painted is the flash this avoids.
   */
  #markPending() {
    const wrapper = this.wrapper;
    if (!wrapper || !wrapper.classList.contains("image-zoom-reveal")) return;
    wrapper.setAttribute("data-reveal-pending", "");
  }

  // ============================================================================
  // JS MODE: Lazy load with IntersectionObserver (coordinated)
  // ============================================================================

  #setupLazyLoad() {
    // Setup ResizeObserver for dynamic sizes (coordinated)
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = null;
      if (!this.isConnected) return;
      this.#setSizesFromWrapper();
      this.#observeResize();
      this.#setupDetailsRecheck();

      // Immediate hydration for elements already in viewport
      // Handles elements that enter the DOM visible (e.g. after morph/section-rendering)
      // Check actual DOM state (srcset missing) instead of the #hydrated flag
      // which persists across reinits and causes false negatives
      if (!this.srcset && this.dataset.srcset) {
        const rect = this.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0 && rect.width > 0) {
          if (typeof this.#observer === "function") {
            this.#observer(); // cleanup IO registration
            this.#observer = null;
          }
          this.#hydrateSources();
          this.#hydrateImage();
          this.#loadImage();
          return;
        }
      }
    });

    // Use shared IntersectionObserver for lazy loading
    // Replaces individual observer with coordinated approach
    this.#observer = imageCoordinator.registerLazyLoad(this, {
      onIntersect: () => {
        this.#hydrateSources();
        this.#hydrateImage();
        this.#loadImage();
      },
    });
  }

  #applyFallbackSizes() {
    // Early return if sizes already set
    if (this.sizes?.trim()) return;

    const defaultSizes = this.dataset.defaultSizes;
    if (defaultSizes?.trim()) {
      this.#applySizes(defaultSizes);
      return;
    }

    const config = this.#getSizesConfig();
    if (config.unit === "vw") {
      this.#applySizes("100vw");
      return;
    }

    const widthAttr = parseInt(this.getAttribute("width") || "0", 10);
    if (widthAttr > 0) {
      this.#applySizes(`${widthAttr}px`);
      return;
    }

    this.#applySizes("100vw");
  }

  /**
   * Write `sizes` to the <img> AND to the JS-hydrated <source>s of its
   * <picture>. When a <source> matches, the browser reads the source's own
   * `sizes` — left at "" it means 100vw, and every multiplier/DPR setting was
   * silently ignored on mobile.
   */
  #applySizes(sizes) {
    if (!sizes || sizes === this.sizes) return;
    this.sizes = sizes;
    const picture = this.closest("picture");
    if (!picture) return;
    for (const source of picture.querySelectorAll("source[data-srcset]")) {
      source.sizes = sizes;
    }
  }

  #getSizesConfig() {
    if (this.#cachedSizesConfig) return this.#cachedSizesConfig;

    this.#cachedSizesConfig = {
      unit: (this.dataset.sizesUnit || "").toLowerCase(),
      mult: parseFloat(this.dataset.sizesMult || "1"),
      targetDpr: parseFloat(this.dataset.targetDpr || "0"),
      safety: parseFloat(this.dataset.sizesSafety || "1.0"),
    };

    return this.#cachedSizesConfig;
  }

  #calculateSizes(width) {
    if (width <= 0) return null;

    const config = this.#getSizesConfig();

    if (config.unit === "vw") {
      const vw = Math.max(1, window.innerWidth || width);
      const percent = Math.max(1, Math.min(100, Math.round((width / vw) * 100)));
      return `${percent}vw`;
    }

    let factor = isNaN(config.mult) ? 1 : config.mult;
    if (!isNaN(config.targetDpr) && config.targetDpr > 0) {
      const dpr = window.devicePixelRatio || 1;
      factor = (config.targetDpr / dpr) * (isNaN(config.safety) ? 1 : config.safety);
    }
    return `${Math.ceil(width * factor)}px`;
  }

  #setSizesFromWrapper() {
    const target = this.wrapper || this;
    if (!target) return;

    const w = target.offsetWidth;
    if (w > 0) {
      this.#applySizes(this.#calculateSizes(w));
    }
  }

  #observeResize() {
    const target = this.wrapper || this;
    if (!target) return;

    // Use shared ResizeObserver (coordinated)
    // Replaces individual observer with coordinated approach
    this.#resizeObserver = imageCoordinator.registerResize(target, this, (width) => {
      this.#applySizes(this.#calculateSizes(width));
    });
  }

  /**
   * Re-measure sizes when details opens (e.g. mega-menu).
   * When content is inside closed details, initial offsetWidth can be wrong.
   */
  #setupDetailsRecheck() {
    this.#detailsToggleCleanup?.();
    this.#detailsToggleCleanup = null;

    const details = this.closest("details");
    if (!details || details.open) return;

    const onToggle = () => {
      if (!details.open) return;
      details.removeEventListener("toggle", onToggle);
      this.#detailsToggleCleanup = null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this.isConnected) this.#setSizesFromWrapper();
        });
      });
    };

    details.addEventListener("toggle", onToggle);
    this.#detailsToggleCleanup = () => {
      details.removeEventListener("toggle", onToggle);
      this.#detailsToggleCleanup = null;
    };
  }

  #hydrateSources() {
    const picture = this.closest("picture");
    if (!picture) return;
    const sources = picture.querySelectorAll("source[data-srcset]:not([srcset])");
    for (const s of sources) {
      s.srcset = s.dataset.srcset;
    }
  }

  #hydrateImage() {
    if (!this.srcset && this.dataset.srcset) {
      this.srcset = this.dataset.srcset;
    }
    if (!this.src && this.dataset.src) {
      this.src = this.dataset.src;
    }
    this.#hydrated = true;
  }

  #loadImage() {
    if (this.classList.contains("loaded")) return;

    // Already complete after hydration — a cached image is complete the moment
    // srcset is assigned. Same rule as #init: on screen shows now, off screen
    // still arms the reveal (this path skipped #markPending, so every JS-mode
    // image the browser had cached revealed nowhere — cache on, no zoom; cache
    // off, zoom — which is exactly what a DevTools "Disable cache" toggle flips).
    if (this.complete && this.naturalWidth > 0) {
      const rect = this.#revealRect();
      if (rect && !ResponsiveImage.#inViewport(rect)) this.#markPending();
      this.#handleImageReady();
      return;
    }

    // Set loading state (loaded class already absent per guard above)
    this.#markPending();
    this.classList.add("loading");
    this.wrapper?.classList.remove("error");
    this.wrapper?.classList.add("loading");

    this.addEventListener("load", this.#onLoad, { once: true });
    this.addEventListener("error", this.#onError, { once: true });
  }

  #onLoad = () => {
    this.#handleImageReady();
  };

  #onError = () => {
    this.#markError();
  };

  // ============================================================================
  // SHARED: Image ready handling
  // ============================================================================

  async #handleImageReady() {
    // Use decode() to prevent progressive JPEG artifacts
    if (typeof this.decode === "function") {
      // currentSrc: JS mode has no `src`, only the srcset candidate in use
      const isSVG = (this.currentSrc || this.src || "").includes(".svg");
      if (!isSVG) {
        try {
          const timeout = isSafari() ? 150 : 100;
          await Promise.race([this.decode(), new Promise((r) => setTimeout(r, timeout))]);
        } catch {
          // decode() may fail, continue anyway
        }
      }
    }

    this.#markLoaded();
  }

  #markLoaded(rect = null) {
    if (this.classList.contains("loaded")) return;

    this.classList.remove("loading");
    this.classList.add("loaded");
    this.wrapper?.classList.remove("loading");
    this.wrapper?.classList.add("loaded");

    // Trigger in-view check for zoom reveal
    this.#revealInView(rect);

    // Resolve ready promise
    this.#resolveReady?.();
    this.#resolveReady = null;

    // Dispatch event for consumers
    this.dispatchEvent(
      new CustomEvent("image:ready", {
        bubbles: true,
        composed: true,
        detail: { image: this },
      })
    );
  }

  /**
   * Check if wrapper needs zoom-reveal in-view tracking.
   * For JS-mode lazy images, .loaded coincides with viewport entry → add .in-view immediately.
   * For liquid-mode images that load early, defer .in-view until the element scrolls into view.
   */
  #revealInView(rect = null) {
    const wrapper = this.wrapper;
    if (!wrapper || !wrapper.classList.contains("image-zoom-reveal") || wrapper.classList.contains("in-view")) return;

    // Sync: if already in viewport, add .in-view immediately (no rAF delay)
    rect ||= wrapper.getBoundingClientRect();
    if (ResponsiveImage.#inViewport(rect)) {
      revealWrapper(wrapper);
      return;
    }

    queueRevealCheck(wrapper);
  }

  /** The wrapper's rect, read only when it is a zoom-reveal wrapper that has not revealed yet. */
  #revealRect() {
    const wrapper = this.wrapper;
    if (!wrapper || !wrapper.classList.contains("image-zoom-reveal") || wrapper.classList.contains("in-view"))
      return null;
    return wrapper.getBoundingClientRect();
  }

  /** Same threshold as flushRevealQueue, so "show now" and "reveal later" agree on the edge. */
  static #inViewport(rect) {
    return rect.top < window.innerHeight - 50 && rect.bottom > 0;
  }

  #markError() {
    this.classList.remove("loading");
    this.wrapper?.classList.remove("loading");
    this.wrapper?.classList.add("error");

    // Still resolve ready promise to unblock consumers
    this.#resolveReady?.();
    this.#resolveReady = null;
  }

  #cleanup() {
    this.#stopPoll();

    this.#detailsToggleCleanup?.();
    this.#detailsToggleCleanup = null;

    // Cancel pending rAF from #setupLazyLoad to prevent stale callbacks
    // after rapid morph sequences (e.g. quick filter → clear → filter)
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }

    // Invalidate cache so #getSizesConfig recomputes after morph (dataset may have changed)
    this.#cachedSizesConfig = null;

    // Remove pending load/error listeners to prevent stale callbacks
    // (JS mode uses stable arrow-function refs, safe to call even if not registered)
    this.removeEventListener("load", this.#onLoad);
    this.removeEventListener("error", this.#onError);
    this.#removeSettle();

    // Reset hydration flag for clean state on reinit
    this.#hydrated = false;

    // Unobserve reveal observer if wrapper was registered
    if (this.wrapper && _revealObserver) {
      _revealObserver.unobserve(this.wrapper);
    }

    // Call cleanup functions returned by imageCoordinator
    // These handle unobserving and internal cleanup
    if (typeof this.#observer === "function") {
      this.#observer(); // Call cleanup function
    }
    this.#observer = null;

    if (typeof this.#resizeObserver === "function") {
      this.#resizeObserver(); // Call cleanup function
    }
    this.#resizeObserver = null;
  }
}

if (!customElements.get("responsive-image")) {
  customElements.define("responsive-image", ResponsiveImage, { extends: "img" });
}
/**
 * @capability Deferred media player host — keeps video/YouTube/Vimeo/model-viewer inside a <template> until needed, then injects and plays it on click or on viewport entry (data-autoplay), preloads provider APIs near the viewport, pauses when scrolled out or when another media starts (media-gallery scoped + global coordination via MediaStartedPlayingEvent), and exposes play/pause/mute controls.
 * @when ANY embedded video or 3D model: product media, video sections, hover-video cards. Never wire raw <video>/<iframe> autoplay or pause-others logic yourself — put the media in a <template> under this element and call showDeferredMedia()/playMedia()/pauseMedia().
 * @contract <deferred-media [data-media-type="video|youtube|vimeo|model"] [data-autoplay]> containing a <template> whose first child is the <video>/<iframe>/<model-viewer>; optional ref="deferredMediaPlayButton", ref="toggleMediaButton" (.icon-play/.icon-pause) and volume button (.icon-mute/.icon-unmute); state via data-media-loaded/data-loading/data-autoplay-blocked; pauses on DialogCloseEvent and inside <media-gallery> when a sibling plays.
 * @component deferred-media
 * @keywords deferred media, lazy video, autoplay in viewport, youtube embed, vimeo embed, pause others, video facade, play button, media coordination, template video
 */
class DeferredMedia extends Component {
  /** @type {boolean} */
  isPlaying = false;

  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {IntersectionObserver} */
  #intersectionObserver = null;

  /** @type {boolean} */
  #isIntersecting = false;

  /** @type {Object} */
  #player = null;

  /** @type {boolean} */
  #isLoading = false;

  /** @type {boolean} */
  #isPreloaded = false;

  /** @type {string} */
  #mediaType = "";

  /** @type {string|null} */
  #originalVideoSrc = null;

  /** @type {boolean} Listeners/observer/player are live for the current connection. */
  #bound = false;

  /** @type {ReturnType<typeof setTimeout>|null} Deferred teardown, cancelled if we reconnect. */
  #teardownTimer = null;

  static get observedAttributes() {
    return ["data-media-loaded", "data-media-type", "data-autoplay"];
  }

  constructor() {
    super();
    this.#mediaType = this.getAttribute("data-media-type") || this.detectMediaType();
  }

  connectedCallback() {
    super.connectedCallback();

    // A pending teardown means we were only MOVED (see disconnectedCallback) — cancel it.
    if (this.#teardownTimer !== null) {
      clearTimeout(this.#teardownTimer);
      this.#teardownTimer = null;
    }

    // Everything below is already live from the previous connection: re-running it
    // would double every listener, and the AbortController is single-use so a second
    // pass after a real teardown would register onto a dead signal.
    if (this.#bound) return;
    this.#bound = true;

    const signal = this.#abortController.signal;

    // Find parent media-gallery
    const mediaGallery = this.#getMediaGalleryParent();

    // Listen to scoped event from parent media-gallery if exists
    if (mediaGallery) {
      mediaGallery.addEventListener(
        ThemeEvents.mediaStartedPlaying,
        (event) => {
          // Only pause if not this media itself
          if (event.detail.resource !== this) {
            this.pauseMedia();
          }
        },
        { signal }
      );
    }

    // Global coordination: pause non-autoplay standalone media on user-initiated play
    document.addEventListener(
      ThemeEvents.mediaStartedPlaying,
      (event) => {
        if (event.detail.resource === this) return;

        // Autoplay videos are controlled only by viewport (IntersectionObserver)
        if (this.hasAttribute("data-autoplay")) return;

        // Non-autoplay standalone: pause only on user-initiated play
        if (!mediaGallery && !event.detail.isAutoplay) {
          this.pauseMedia();
        }
      },
      { signal }
    );

    window.addEventListener(DialogCloseEvent.eventName, this.pauseMedia.bind(this), { signal });

    // Setup intersection observer for lazy loading
    this.#setupIntersectionObserver();

    // If content is already present (pre-rendered) ensure player is initialized
    this.#initializeFromExistingContent();

    // Handle autoplay if specified
    if (this.hasAttribute("data-autoplay")) {
      this.#handleAutoplay();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Swiper's `loop` RELOCATES a slide's node (slidesEl.append/prepend in loopFix)
    // instead of removing it, so this fires for a move, not a removal — dragging a
    // looping slideshow past the wrap point used to tear down the player of every
    // slide it shuffled. Defer the teardown one task and bail if we are back in the
    // document by then; a genuine removal never reconnects, so it still cleans up.
    if (this.#teardownTimer !== null) return;

    this.#teardownTimer = setTimeout(() => {
      this.#teardownTimer = null;
      if (this.isConnected) return;

      this.#bound = false;
      this.#abortController.abort();
      this.#cleanupIntersectionObserver();
      this.#cleanupPlayer();
    }, 0);
  }

  /**
   * Detect media type from content or attributes
   */
  detectMediaType() {
    const template = this.querySelector("template");
    if (!template) return "";

    const content = template.content.firstElementChild;
    if (!content) return "";

    if (content.tagName === "VIDEO") return "video";
    if (content.tagName === "IFRAME") {
      const src = content.src || content.dataset.src;
      if (src?.includes("youtube")) return "youtube";
      if (src?.includes("vimeo")) return "vimeo";
      return "iframe";
    }
    if (content.tagName === "MODEL-VIEWER") return "model";

    return "unknown";
  }

  /**
   * Get parent media-gallery if exists
   * @returns {HTMLElement|null}
   */
  #getMediaGalleryParent() {
    return this.closest("media-gallery");
  }

  /**
   * Pause all other media in the same gallery (direct pause to avoid race condition)
   */
  #pauseOtherMediaInGallery() {
    const mediaGallery = this.#getMediaGalleryParent();
    if (!mediaGallery) return;

    const allMedia = mediaGallery.querySelectorAll("deferred-media");
    allMedia.forEach((media) => {
      if (media !== this) {
        media.pauseMedia();
      }
    });
  }

  /**
   * Dispatch media started event for coordination
   */
  #dispatchMediaStartedEvent() {
    const mediaGallery = this.#getMediaGalleryParent();
    const isAutoplay = this.hasAttribute("data-autoplay");
    const event = new MediaStartedPlayingEvent(this, isAutoplay);

    if (mediaGallery) {
      // Dispatch to gallery (bubbles to document for global coordination)
      mediaGallery.dispatchEvent(event);
    } else {
      // Standalone: dispatch to document for global coordination
      document.dispatchEvent(event);
    }
  }

  /**
   * Setup intersection observer for lazy loading
   */
  #setupIntersectionObserver() {
    if (!("IntersectionObserver" in window)) return;

    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.#isIntersecting = entry.isIntersecting;
          const isLoaded = this.getAttribute("data-media-loaded");

          if (entry.isIntersecting) {
            if (this.hasAttribute("data-autoplay") && !this.hasAttribute("data-autoplay-blocked")) {
              if (!isLoaded) {
                this.showDeferredMedia();
              } else {
                this.playMedia();
              }
            } else if (!isLoaded) {
              // Preload APIs/resources to reduce user-perceived latency on click
              this.#preloadContent();
            }
          } else {
            // Pause when leaving the viewport (idempotent)
            this.pauseMedia();
          }
        });
      },
      {
        rootMargin: "0px",
        threshold: 0.1,
      }
    );

    this.#intersectionObserver.observe(this);
  }

  /**
   * Cleanup intersection observer
   */
  #cleanupIntersectionObserver() {
    if (this.#intersectionObserver) {
      this.#intersectionObserver.disconnect();
      this.#intersectionObserver = null;
    }
  }

  /**
   * Handle autoplay functionality
   */
  #handleAutoplay() {
    if (this.#mediaType !== "video") return;

    // Check if autoplay is allowed
    const canAutoplay = this.#checkAutoplaySupport();
    if (!canAutoplay) {
      this.setAttribute("data-autoplay-blocked", "");
      return;
    }
  }

  /**
   * Check if autoplay is supported
   */
  #checkAutoplaySupport() {
    // Check for mobile devices
    // if (window.matchMedia("(max-width: 1023px)").matches) {
    //   return false;
    // }

    // Check for reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }

    return true;
  }

  /**
   * Preload resources (APIs) without inserting media elements
   */
  async #preloadContent() {
    if (this.#isLoading || this.#isPreloaded || this.getAttribute("data-media-loaded")) return;

    this.#isLoading = true;
    this.setAttribute("data-loading", "");
    try {
      // Determine media type from template without inserting DOM
      const type = this.#mediaType || this.detectMediaType();
      switch (type) {
        case "youtube":
          await this.#loadYouTubeAPI();
          break;
        case "vimeo":
          await this.#loadVimeoAPI();
          break;
        case "model":
          if (window.Shopify?.loadFeatures) {
            await new Promise((resolve) =>
              Shopify.loadFeatures([
                {
                  name: "model-viewer-ui",
                  version: "1.0",
                  onLoad: () => resolve(),
                },
              ])
            );
          }
          break;
        default:
          // For HTML5 video we cannot preload without creating an element; skip
          break;
      }
      this.#isPreloaded = true;
    } catch (error) {
      console.error("Failed to preload resources:", error);
      this.setAttribute("data-error", "");
    } finally {
      this.removeAttribute("data-loading");
      this.#isLoading = false;
    }
  }

  /**
   * Updates the visual hint for play/pause state
   */
  updatePlayPauseHint(isPlaying) {
    const toggleMediaButton = this.refs.toggleMediaButton;

    if (toggleMediaButton instanceof HTMLElement) {
      toggleMediaButton.classList.remove("hidden");
      const playIcon = toggleMediaButton.querySelector(".icon-play");
      if (playIcon) playIcon.classList.toggle("hidden", isPlaying);
      const pauseIcon = toggleMediaButton.querySelector(".icon-pause");
      if (pauseIcon) pauseIcon.classList.toggle("hidden", !isPlaying);
    }
  }

  /**
   * Check if parent carousel is currently dragging
   * @returns {boolean}
   */
  #isCarouselDragging() {
    // Find carousel component parent
    const carousel = this.closest("carousel-slider");
    if (!carousel) return false;

    // Check if carousel has Swiper instance and is currently dragging
    const swiper = carousel.swiperInstance;
    if (!swiper || swiper.destroyed) return false;

    // Check if Swiper is currently touching/dragging
    // Swiper has touching property and touchEventsData.isTouched
    return (
      swiper.touching === true ||
      (swiper.touchEventsData && swiper.touchEventsData.isTouched === true) ||
      swiper.animating === true
    );
  }

  /**
   * Shows the deferred media content
   */
  showDeferredMedia = async () => {
    if (this.#isLoading) return;

    // Skip if carousel is currently dragging (but allow autoplay to proceed)
    // Only prevent user-initiated clicks, not autoplay behavior
    if (this.#isCarouselDragging() && !this.hasAttribute("data-autoplay")) return;

    try {
      this.setAttribute("data-loading", "");
      await this.loadContent(false);
      // When controls are disabled we rely on our own UI; ensure playback starts on click
      if (this.hasAttribute("data-disable-controls") || this.hasAttribute("data-autoplay")) {
        await this.playMedia();
      }
      this.dispatchEvent(new CustomEvent("deferred-media:play", { bubbles: true }));
    } catch (error) {
      console.error("Failed to show deferred media:", error);
      this.handleError(error);
    }
  };

  /**
   * Loads the content with enhanced error handling
   */
  async loadContent(focus = true) {
    if (this.getAttribute("data-media-loaded")) return;

    // Pause other media in gallery BEFORE loading (prevents race condition)
    this.#pauseOtherMediaInGallery();

    // Dispatch event when starting to load
    this.#dispatchMediaStartedEvent();

    const template = this.querySelector("template");
    if (!template) {
      throw new Error("No template content found");
    }

    const content = template.content.firstElementChild?.cloneNode(true);
    if (!content) {
      throw new Error("No content found in template");
    }

    this.setAttribute("data-media-loaded", "true");
    this.appendChild(content);

    if (focus && content instanceof HTMLElement) {
      if (!content.hasAttribute("tabindex") && content.tabIndex < 0) {
        content.tabIndex = -1;
      }
      content.focus();
    }

    this.refs.deferredMediaPlayButton?.classList.add("deferred-media__playing");
    this.refs.deferredMediaPlayButton?.setAttribute("tabindex", "-1");

    // Initialize player based on media type
    await this.#initializePlayer(content);

    return content;
  }

  /**
   * Initialize player based on media type
   */
  async #initializePlayer(content) {
    switch (this.#mediaType) {
      case "video":
        await this.#initializeVideoPlayer(content);
        break;
      case "youtube":
        await this.#initializeYouTubePlayer(content);
        break;
      case "vimeo":
        await this.#initializeVimeoPlayer(content);
        break;
      default:
        // Handle other media types
        break;
    }
  }

  /**
   * Initialize player if content was pre-rendered (data-media-loaded already set)
   */
  #initializeFromExistingContent() {
    if (!this.hasAttribute("data-media-loaded") || this.#player) return;

    // Find first playable element that is not inside <template>
    let content = null;
    for (const child of this.children) {
      if (child.tagName === "TEMPLATE" || child.tagName === "BUTTON") {
        continue;
      }
      if (child.tagName === "VIDEO" || child.tagName === "IFRAME" || child.tagName === "MODEL-VIEWER") {
        content = child;
        break;
      }
    }

    if (!content) return;

    // Adjust media type if needed based on element
    if (!this.#mediaType || this.#mediaType === "unknown") {
      if (content.tagName === "VIDEO") this.#mediaType = "video";
      else if (content.tagName === "IFRAME") {
        const src = /** @type {HTMLIFrameElement} */ (content).src;
        if (src?.includes("youtube")) this.#mediaType = "youtube";
        else if (src?.includes("vimeo")) this.#mediaType = "vimeo";
        else this.#mediaType = "iframe";
      } else if (content.tagName === "MODEL-VIEWER") {
        this.#mediaType = "model";
      }
    }

    // Initialize the player for this content
    void this.#initializePlayer(/** @type {any} */ (content));

    // Content is already present in DOM, ensure loading state is cleared
    this.removeAttribute("data-loading");
  }

  /**
   * Update volume button state
   * @param {HTMLVideoElement|Object} player - Video element, player object, or object with muted property
   */
  async updateVolumeButton(player) {
    const { toggleVolumeButton } = this.refs;
    if (!toggleVolumeButton) return;

    const muteIcon = toggleVolumeButton.querySelector(".icon-mute");
    const unMuteIcon = toggleVolumeButton.querySelector(".icon-unmute");

    let isMuted = false;

    // Handle different player types
    if (player instanceof HTMLVideoElement) {
      // HTML5 video
      isMuted = player.muted;
    } else if (player && typeof player === "object" && "muted" in player) {
      // Direct muted state (for optimistic updates)
      isMuted = player.muted;
    } else if (this.#mediaType === "youtube" && this.#player) {
      // YouTube player
      try {
        isMuted = await this.#player.isMuted?.();
      } catch (error) {
        console.warn("Failed to get YouTube muted state:", error);
        isMuted = false;
      }
    } else if (this.#mediaType === "vimeo" && this.#player) {
      // Vimeo player
      try {
        isMuted = await this.#player.getMuted?.();
      } catch (error) {
        console.warn("Failed to get Vimeo muted state:", error);
        isMuted = false;
      }
    }

    // Show mute icon when muted (current state)
    // Show unmute icon when not muted (current state)
    muteIcon && muteIcon.classList.toggle("hidden", !isMuted);
    unMuteIcon && unMuteIcon.classList.toggle("hidden", isMuted);
  }

  /**
   * Initialize HTML5 video player
   */
  async #initializeVideoPlayer(videoElement) {
    if (!(videoElement instanceof HTMLVideoElement)) return;

    const video = videoElement;
    const { toggleVolumeButton } = this.refs;

    if (toggleVolumeButton) {
      await this.updateVolumeButton(video);

      toggleVolumeButton.addEventListener(
        "click",
        async () => {
          video.muted = !video.muted;
          await this.updateVolumeButton(video);
        },
        {
          signal: this.#abortController.signal,
        }
      );
    }

    // Set up video event listeners
    video.addEventListener("play", () => {
      this.isPlaying = true;
      this.setAttribute("data-playing", "");
      this.updatePlayPauseHint(true);
      this.removeAttribute("data-suspended");

      // Coordinate: pause other media (handles native controls / external play triggers)
      this.#pauseOtherMediaInGallery();
      this.#dispatchMediaStartedEvent();

      setTimeout(() => {
        this.removeAttribute("data-loading");
      }, 2000); // Delay to wait video full rendered
    });

    video.addEventListener("pause", () => {
      this.isPlaying = false;
      this.removeAttribute("data-playing");
      this.updatePlayPauseHint(false);
    });

    video.addEventListener("ended", () => {
      this.isPlaying = false;
      this.removeAttribute("data-playing");
      this.updatePlayPauseHint(false);
    });

    video.addEventListener("error", (error) => {
      this.handleError(error);
    });

    // Handle autoplay restrictions with suspended state
    if (video.hasAttribute("autoplay")) {
      try {
        await video.play();
      } catch (error) {
        if (error.name === "NotAllowedError") {
          this.setAttribute("data-suspended", "");
          this.setAttribute("data-autoplay-blocked", "");
          video.controls = true;

          // Set poster from previous element if available
          const replacementImageSrc = video.previousElementSibling?.currentSrc;
          if (replacementImageSrc) {
            video.poster = replacementImageSrc;
          }
        }
      }
    }

    this.#player = video;

    // Store original src for corruption detection
    this.#originalVideoSrc = video.src || video.currentSrc;
  }

  /**
   * Initialize YouTube player
   */
  async #initializeYouTubePlayer(iframeElement) {
    if (!(iframeElement instanceof HTMLIFrameElement)) return;

    // Load YouTube API if not already loaded
    if (!window.YT || !window.YT.Player) {
      await this.#loadYouTubeAPI();
    }

    const player = new YT.Player(iframeElement, {
      events: {
        onReady: async () => {
          this.#player = player;

          // Setup volume button for YouTube - await to ensure state is initialized
          await this.#setupYouTubeVolumeButton();

          // Attempt autoplay when ready and visible
          if (
            this.hasAttribute("data-autoplay") &&
            !this.hasAttribute("data-autoplay-blocked") &&
            this.#isIntersecting
          ) {
            try {
              this.#player.playVideo?.();
            } catch (_) {
              /* noop */
            }
          }
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING) {
            this.isPlaying = true;
            this.setAttribute("data-playing", "");
            this.updatePlayPauseHint(true);
            this.removeAttribute("data-loading");

            this.#pauseOtherMediaInGallery();
            this.#dispatchMediaStartedEvent();
          } else if (event.data === YT.PlayerState.ENDED || event.data === YT.PlayerState.PAUSED) {
            this.isPlaying = false;
            this.removeAttribute("data-playing");
            this.updatePlayPauseHint(false);
          }
        },
        onError: (error) => {
          this.handleError(error);
        },
      },
    });
  }

  /**
   * Initialize Vimeo player
   */
  async #initializeVimeoPlayer(iframeElement) {
    if (!(iframeElement instanceof HTMLIFrameElement)) return;

    // Load Vimeo API if not already loaded
    if (!window.Vimeo || !window.Vimeo.Player) {
      await this.#loadVimeoAPI();
    }

    const player = new Vimeo.Player(iframeElement);

    player.on("loaded", async () => {
      this.#player = player;

      // Setup volume button for Vimeo - await to ensure state is initialized
      await this.#setupVimeoVolumeButton();

      if (this.hasAttribute("data-autoplay") && !this.hasAttribute("data-autoplay-blocked") && this.#isIntersecting) {
        try {
          await this.#player.play?.();
        } catch (_) {
          /* noop */
        }
      }
    });

    player.on("play", () => {
      this.isPlaying = true;
      this.setAttribute("data-playing", "");
      this.updatePlayPauseHint(true);
      this.removeAttribute("data-loading");

      this.#pauseOtherMediaInGallery();
      this.#dispatchMediaStartedEvent();
    });

    player.on("pause", () => {
      this.isPlaying = false;
      this.removeAttribute("data-playing");
      this.updatePlayPauseHint(false);
    });

    player.on("ended", () => {
      this.isPlaying = false;
      this.removeAttribute("data-playing");
      this.updatePlayPauseHint(false);
    });

    player.on("error", (error) => {
      this.handleError(error);
    });

    this.#player = player;
  }

  /**
   * Load YouTube API
   */
  async #loadYouTubeAPI() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }

      // Reuse a single pending promise across instances
      const pendingKey = "__ytApiPending__";
      if (window[pendingKey]) {
        window[pendingKey].then(resolve, reject);
        return;
      }

      const p = new Promise((res, rej) => {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof previous === "function") previous();
          res();
        };

        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onload = () => {
          // wait for onYouTubeIframeAPIReady to fire
        };
        script.onerror = rej;
        document.head.appendChild(script);
      });

      window[pendingKey] = p.finally(() => {
        delete window[pendingKey];
      });

      window[pendingKey].then(resolve, reject);
    });
  }

  /**
   * Load Vimeo API
   */
  async #loadVimeoAPI() {
    return new Promise((resolve, reject) => {
      if (window.Vimeo && window.Vimeo.Player) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://player.vimeo.com/api/player.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Setup volume button for YouTube player
   */
  async #setupYouTubeVolumeButton() {
    const { toggleVolumeButton } = this.refs;
    if (!toggleVolumeButton || !this.#player) return;

    // Update button state initially - await to ensure state is set
    await this.updateVolumeButton(this.#player);

    // Add click handler
    toggleVolumeButton.addEventListener(
      "click",
      async () => {
        try {
          const isMuted = await this.#player.isMuted?.();
          const newMutedState = !isMuted;

          if (isMuted) {
            this.#player.unMute?.();
          } else {
            this.#player.mute?.();
          }

          // Update button immediately with new state (optimistic update)
          // Then verify after a short delay
          await this.updateVolumeButton({ muted: newMutedState });

          // Verify state after a short delay to ensure sync
          setTimeout(async () => {
            await this.updateVolumeButton(this.#player);
          }, 150);
        } catch (error) {
          console.warn("Failed to toggle YouTube volume:", error);
        }
      },
      {
        signal: this.#abortController.signal,
      }
    );
  }

  /**
   * Setup volume button for Vimeo player
   */
  async #setupVimeoVolumeButton() {
    const { toggleVolumeButton } = this.refs;
    if (!toggleVolumeButton || !this.#player) return;

    // Update button state initially - await to ensure state is set
    await this.updateVolumeButton(this.#player);

    // Add click handler
    toggleVolumeButton.addEventListener(
      "click",
      async () => {
        try {
          const isMuted = await this.#player.getMuted?.();
          const newMutedState = !isMuted;

          await this.#player.setMuted?.(newMutedState);

          // Update button immediately with new state (optimistic update)
          // Then verify after a short delay
          await this.updateVolumeButton({ muted: newMutedState });

          // Verify state after a short delay to ensure sync
          setTimeout(async () => {
            await this.updateVolumeButton(this.#player);
          }, 150);
        } catch (error) {
          console.warn("Failed to toggle Vimeo volume:", error);
        }
      },
      {
        signal: this.#abortController.signal,
      }
    );
  }

  /**
   * Toggle play/pause state of the media
   */
  toggleMedia() {
    // Skip if carousel is currently dragging
    if (this.#isCarouselDragging()) return;

    // If content hasn't been loaded yet, load (and play if applicable)
    if (!this.getAttribute("data-media-loaded")) {
      this.showDeferredMedia();
      return;
    }

    if (this.isPlaying) {
      this.pauseMedia();
    } else {
      this.playMedia();
    }
  }

  /**
   * Check if video src has been corrupted by comparing with original
   */
  #hasVideoSrcChanged(currentSrc) {
    if (!currentSrc || !this.#originalVideoSrc) return false;

    // Simple comparison: if current src differs from original, it's potentially corrupted
    return currentSrc !== this.#originalVideoSrc;
  }

  /**
   * Check if video src is corrupted (optimized)
   */
  #isVideoSrcCorrupted(src) {
    if (!src) return false;

    try {
      const url = new URL(src);

      // Quick check: page query params = corrupted
      if (url.searchParams.has("variant") || url.searchParams.has("section_id")) {
        return true;
      }

      const path = url.pathname.toLowerCase();
      const host = url.hostname;

      // Quick check: CDN or video file extension = valid
      if (host.includes("cdn") || /\.(mp4|webm|ogg|avi|mov)/.test(path)) {
        return false;
      }

      // Quick check: page paths = corrupted
      return /\/(products|collections|pages|blogs)\//.test(path);
    } catch {
      return false;
    }
  }

  /**
   * Recover video with valid src (unified recovery method)
   */
  #recoverVideoSrc(videoElement) {
    const bestSrc = this.#getBestVideoSrc(videoElement);
    if (bestSrc && videoElement.src !== bestSrc) {
      videoElement.src = bestSrc;
      videoElement.load();
      return true;
    }
    return false;
  }

  /**
   * Get the best available video src (fallback chain)
   */
  #getBestVideoSrc(videoElement) {
    // Check if stored original src is corrupted and clear it
    if (this.#originalVideoSrc && this.#isVideoSrcCorrupted(this.#originalVideoSrc)) {
      this.#originalVideoSrc = null;
    }

    // Priority: originalVideoSrc > currentSrc > template src > remove src
    if (this.#originalVideoSrc) {
      return this.#originalVideoSrc;
    }

    // If no original src stored yet, use currentSrc if it looks valid
    if (videoElement.currentSrc && !this.#isVideoSrcCorrupted(videoElement.currentSrc)) {
      // Store this as original if we don't have one yet and it's not corrupted
      if (!this.#originalVideoSrc) {
        this.#originalVideoSrc = videoElement.currentSrc;
      }
      return videoElement.currentSrc;
    }

    // Try template as last resort
    const template = this.querySelector("template");
    if (template) {
      const templateVideo = template.content.querySelector("video");
      if (templateVideo && (templateVideo.src || templateVideo.currentSrc)) {
        const templateSrc = templateVideo.src || templateVideo.currentSrc;
        // Store this as original if we don't have one yet and it's not corrupted
        if (!this.#originalVideoSrc && !this.#isVideoSrcCorrupted(templateSrc)) {
          this.#originalVideoSrc = templateSrc;
        }
        return templateSrc;
      }
    }

    return null;
  }

  /**
   * Play media with enhanced error handling
   */
  async playMedia() {
    if (this.#isLoading) return;

    // If media not loaded yet, trigger load first
    if (!this.getAttribute("data-media-loaded")) {
      this.showDeferredMedia();
      return;
    }

    // CRITICAL: Pause other media DIRECTLY before playing (prevents race condition)
    // This is especially important when multiple media return to viewport simultaneously
    this.#pauseOtherMediaInGallery();

    // Dispatch event for other listeners (defensive)
    this.#dispatchMediaStartedEvent();

    try {
      switch (this.#mediaType) {
        case "video":
          if (this.#player instanceof HTMLVideoElement) {
            // Check if video src has changed or is corrupted and restore if needed
            const srcCorrupted =
              this.#hasVideoSrcChanged(this.#player.src) || this.#isVideoSrcCorrupted(this.#player.src);

            if (srcCorrupted) {
              if (!this.#recoverVideoSrc(this.#player)) {
                this.#player.removeAttribute("src");
              }
            }

            await this.#player.play();
          } else {
            // Try to find existing video element and reinitialize
            const existingVideo = this.querySelector("video");
            if (existingVideo) {
              // Ensure we have a valid src before proceeding
              this.#recoverVideoSrc(existingVideo);

              await this.#initializeVideoPlayer(existingVideo);
              if (this.#player) {
                await this.#player.play();
              }
            }
          }
          break;
        case "youtube":
          if (this.#player && this.#player.playVideo) {
            this.#player.playVideo();
          }
          break;
        case "vimeo":
          if (this.#player && this.#player.play) {
            await this.#player.play();
          }
          break;
        default:
          // Handle other media types
          break;
      }

      this.isPlaying = true;
      this.updatePlayPauseHint(this.isPlaying);
    } catch (error) {
      console.error("Failed to play media:", error);
      this.handleError(error);
    }
  }

  /**
   * React to attribute changes
   */
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "data-media-type") {
      this.#mediaType = this.getAttribute("data-media-type") || this.#mediaType;
    }

    if (
      name === "data-autoplay" &&
      this.isConnected &&
      this.#isIntersecting &&
      this.getAttribute("data-media-loaded") &&
      !this.hasAttribute("data-autoplay-blocked")
    ) {
      // Pause other media before playing (same as playMedia)
      this.#pauseOtherMediaInGallery();
      this.#dispatchMediaStartedEvent();
      this.playMedia();
    }
  }

  /**
   * Pause media
   */
  pauseMedia() {
    try {
      switch (this.#mediaType) {
        case "video":
          if (this.#player instanceof HTMLVideoElement) {
            this.#player.pause();
          }
          break;
        case "youtube":
          if (this.#player && this.#player.pauseVideo) {
            this.#player.pauseVideo();
          }
          break;
        case "vimeo":
          if (this.#player && this.#player.pause) {
            this.#player.pause();
          }
          break;
        default:
          // Handle other media types
          break;
      }

      this.isPlaying = false;
      this.updatePlayPauseHint(this.isPlaying);
    } catch (error) {
      console.error("Failed to pause media:", error);
    }
  }

  /**
   * Handle errors gracefully
   */
  handleError(error) {
    // Provide user-friendly error logging
    const errorType = error?.name || error?.constructor?.name || "Unknown";
    const errorMessage = error?.message || "Media playback issue";

    // Only log actual problematic errors, not expected browser behaviors
    if (this.#shouldLogError(error)) {
      console.warn(`Media ${errorType}: ${errorMessage}`, {
        mediaType: this.#mediaType,
        hasPlayer: !!this.#player,
        isPlaying: this.isPlaying,
      });
    }

    this.setAttribute("data-error", "");
    this.removeAttribute("data-loading");

    // Dispatch error event
    this.dispatchEvent(
      new CustomEvent("deferred-media:error", {
        bubbles: true,
        detail: { error },
      })
    );
  }

  /**
   * Determine if error should be logged (filter out expected errors)
   */
  #shouldLogError(error) {
    const errorName = error?.name || "";
    const errorMessage = error?.message || "";

    // Filter out expected/harmless errors
    const expectedErrors = [
      "AbortError", // Normal when switching slides quickly
      "NotAllowedError", // Expected autoplay restriction
    ];

    // Filter out DOM events that aren't actual errors
    if (error instanceof Event && error.type === "error") {
      // These are often normal browser events during slide transitions
      return false;
    }

    // Don't log expected error types
    if (expectedErrors.includes(errorName)) {
      return false;
    }

    // Don't log errors during normal operation transitions
    if (errorMessage.includes("interrupted by a new load request")) {
      return false;
    }

    return true;
  }

  /**
   * Cleanup player resources
   */
  #cleanupPlayer() {
    if (this.#player) {
      // Cleanup based on player type
      if (this.#player instanceof HTMLVideoElement) {
        this.#player.pause();

        // `video.src = ""` WRITES an empty src ATTRIBUTE, and an src attribute — even
        // an empty one — makes the browser ignore the <source> children entirely, then
        // fail resource selection outright ("The element has no supported sources").
        // Shopify's `video_tag` only ever emits <source> children, so that call was a
        // death sentence for the element. Release the buffer only where there is an
        // actual src attribute to release; otherwise pausing is enough, since a truly
        // detached element is collected anyway.
        if (this.#player.hasAttribute("src")) {
          this.#player.removeAttribute("src");
          this.#player.load();
        }
      } else if (this.#player && typeof this.#player.destroy === "function") {
        this.#player.destroy();
      }
      this.#player = null;
    }
  }

  /**
   * Get current player state
   */
  getPlayerState() {
    return {
      isPlaying: this.isPlaying,
      isLoading: this.#isLoading,
      mediaType: this.#mediaType,
      hasError: this.hasAttribute("data-error"),
      isLoaded: this.hasAttribute("data-media-loaded"),
    };
  }
}

if (!customElements.get("deferred-media")) {
  customElements.define("deferred-media", DeferredMedia);
}

/**
 * Enhanced product model component that extends DeferredMedia
 * for Shopify's 3D model viewer functionality
 */
/**
 * @capability 3D product model host — DeferredMedia specialised for Shopify's model-viewer: lazy-loads the model-viewer-ui feature, wraps its play/pause so starting the model pauses other gallery media, toggles play/pause on tap (drag-safe), and announces state via ModelInteractionEvent so carousels can lock swiping during interaction.
 * @when Product media galleries with 3D/AR models. Reuse instead of instantiating Shopify.ModelViewerUI directly — the media coordination and tap-vs-drag handling live here.
 * @contract <product-model> with the DeferredMedia contract (a <template> whose first child is <model-viewer>); reflects state as data-playing="true|false"; dispatches ModelInteractionEvent to the closest .shopify-section or dialog.
 * @component product-model
 * @keywords 3d model, model viewer, ar, product model, glb, rotate model, tap to interact, shopify model-viewer-ui, pause gallery media
 */
class ProductModel extends DeferredMedia {
  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {any} */
  modelViewerUI = null;

  /** @type {Function|null} */
  #originalModelViewerPlay = null;

  /** @type {Function|null} */
  #originalModelViewerPause = null;

  async loadContent(focus = true) {
    const content = await super.loadContent(focus);

    // Load Shopify model viewer UI
    if (window.Shopify?.loadFeatures) {
      Shopify.loadFeatures([
        {
          name: "model-viewer-ui",
          version: "1.0",
          onLoad: this.setupModelViewerUI.bind(this),
        },
      ]);
    }

    return content;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();

    // Cleanup model viewer UI
    if (this.modelViewerUI && typeof this.modelViewerUI.destroy === "function") {
      this.modelViewerUI.destroy();
      this.modelViewerUI = null;
    }

    // Clear wrapped methods to prevent calling destroyed methods
    this.#originalModelViewerPlay = null;
    this.#originalModelViewerPause = null;
  }

  pauseMedia() {
    super.pauseMedia();
    // Use original pause method to avoid infinite loop
    // Never call this.modelViewerUI.pause() directly as it's wrapped to call pauseMedia()
    if (typeof this.#originalModelViewerPause === "function" && this.modelViewerUI) {
      try {
        // Check if modelViewerUI still has pause method (not destroyed)
        if (typeof this.modelViewerUI.pause === "function") {
          this.#originalModelViewerPause();
        }
      } catch (error) {
        // If original method fails, silently handle (modelViewerUI might be destroyed)
        // Only log if it's not a common destroy-related error
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to call original pause method:", error);
        }
      }
    }
    // Only call modelViewerUI.pause() if it hasn't been wrapped yet (original method not stored)
    else if (this.modelViewerUI && typeof this.modelViewerUI.pause === "function" && !this.#originalModelViewerPause) {
      try {
        this.modelViewerUI.pause();
      } catch (error) {
        // Silently handle if modelViewerUI is destroyed
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to pause model viewer:", error);
        }
      }
    }
    this.setAttribute("data-playing", "false");

    // Dispatch model interaction event - paused
    const target = this.closest(".shopify-section, dialog") || document;
    target.dispatchEvent(new ModelInteractionEvent(this, false));
  }

  async playMedia() {
    await super.playMedia();
    // Use original play method to avoid infinite loop
    // Never call this.modelViewerUI.play() directly as it's wrapped to call playMedia()
    if (typeof this.#originalModelViewerPlay === "function" && this.modelViewerUI) {
      try {
        // Check if modelViewerUI still has play method (not destroyed)
        if (typeof this.modelViewerUI.play === "function") {
          this.#originalModelViewerPlay();
        }
      } catch (error) {
        // If original method fails, silently handle (modelViewerUI might be destroyed)
        // Only log if it's not a common destroy-related error
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to call original play method:", error);
        }
      }
    }
    // Only call modelViewerUI.play() if it hasn't been wrapped yet (original method not stored)
    else if (this.modelViewerUI && typeof this.modelViewerUI.play === "function" && !this.#originalModelViewerPlay) {
      try {
        this.modelViewerUI.play();
      } catch (error) {
        // Silently handle if modelViewerUI is destroyed
        if (!error.message?.includes("is not a function") && !error.message?.includes("destroyed")) {
          console.warn("Failed to play model viewer:", error);
        }
      }
    }
    this.setAttribute("data-playing", "true");

    // Dispatch model interaction event - playing
    const target = this.closest(".shopify-section, dialog") || document;
    target.dispatchEvent(new ModelInteractionEvent(this, true));
  }

  /**
   * Setup Shopify Model Viewer UI with enhanced error handling
   * @param {Error[]} errors
   */
  async setupModelViewerUI(errors) {
    if (errors) {
      console.error("Model viewer UI load errors:", errors);
      return;
    }

    if (!Shopify.ModelViewerUI) {
      await this.#waitForModelViewerUI();
    }

    if (!Shopify.ModelViewerUI) {
      console.warn("Shopify.ModelViewerUI not available after waiting");
      return;
    }

    const element = this.querySelector("model-viewer");
    if (!element) {
      console.warn("No model-viewer element found");
      return;
    }

    const signal = this.#abortController.signal;

    try {
      this.modelViewerUI = new Shopify.ModelViewerUI(element);
      if (!this.modelViewerUI) {
        console.warn("Failed to create ModelViewerUI instance");
        return;
      }

      // Wrap modelViewerUI.play() to ensure it goes through playMedia() method
      // This ensures other media in gallery are paused when model plays
      // Store original methods to avoid infinite loop
      if (this.modelViewerUI.play) {
        this.#originalModelViewerPlay = this.modelViewerUI.play.bind(this.modelViewerUI);
        this.modelViewerUI.play = () => {
          // Call playMedia() which will pause other media and dispatch event
          this.playMedia();
        };
      }

      // Wrap modelViewerUI.pause() to ensure it goes through pauseMedia() method
      if (this.modelViewerUI.pause) {
        this.#originalModelViewerPause = this.modelViewerUI.pause.bind(this.modelViewerUI);
        this.modelViewerUI.pause = () => {
          // Call pauseMedia() for consistency
          this.pauseMedia();
        };
      }

      // Start playback if model is ready
      this.playMedia();

      // Setup interaction handlers for tap detection
      this.#setupModelInteractions(element, signal);
    } catch (error) {
      console.error("Error setting up model viewer UI:", error);
      this.handleError(error);
    }
  }

  /**
   * Setup model viewer interaction handlers
   * @param {HTMLElement} element
   * @param {AbortSignal} signal
   */
  #setupModelInteractions(element, signal) {
    // Track pointer for drag vs tap detection
    let pointerStartX = 0;
    let pointerStartY = 0;

    element.addEventListener(
      "pointerdown",
      (/** @type {PointerEvent} */ event) => {
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
      },
      { signal }
    );

    element.addEventListener(
      "click",
      (/** @type {PointerEvent} */ event) => {
        const distanceX = Math.abs(event.clientX - pointerStartX);
        const distanceY = Math.abs(event.clientY - pointerStartY);
        const totalDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

        // Higher threshold to accommodate UI changes (was 10, now 50)
        if (totalDistance < 10) {
          const isCurrentlyPlaying = this.getAttribute("data-playing") === "true";

          if (isCurrentlyPlaying) {
            // Model is playing, so pause it
            this.pauseMedia();
          } else {
            // Model is paused, so play it
            this.playMedia();
          }
        }
        // If totalDistance >= 10, it's a drag - don't toggle
      },
      { signal }
    );
  }

  /**
   * Wait for Shopify.ModelViewerUI to be available
   * Necessary for Safari where ModelViewerUI may not be immediately available
   * @returns {Promise<void>}
   */
  async #waitForModelViewerUI() {
    const maxAttempts = 10;
    const interval = 50; // 50ms intervals

    for (let i = 0; i < maxAttempts; i++) {
      if (Shopify.ModelViewerUI) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /**
   * Get enhanced player state including model viewer info
   */
  getPlayerState() {
    const baseState = super.getPlayerState();
    return {
      ...baseState,
      hasModelViewerUI: !!this.modelViewerUI,
      modelViewerReady: !!this.modelViewerUI && !!this.querySelector("model-viewer"),
    };
  }
}

if (!customElements.get("product-model")) {
  customElements.define("product-model", ProductModel);
}
