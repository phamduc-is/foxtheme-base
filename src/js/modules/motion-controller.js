import { getMotionPreset, listMotionPresets, registerMotionPreset } from "@theme/motion-presets";

/**
 * @capability The public motion API — play, replay, reset, reveal, disable and enable any entrance from anywhere, plus replayWithin(container) and swapWithin(from, to) (outgoing headings leave word by word before the incoming ones arrive) for the cases in-view cannot cover: a modal that just opened, a filter that just swapped its results, a section the Section Rendering API just morphed.
 * @when A host needs to drive motion it does not own. Reach for FoxTheme.motion.replayWithin(el) instead of hunting for motion elements and poking at them — the components' own methods are an implementation detail, and this is the surface that stays stable.
 * @contract window.FoxTheme.motion.{play,replay,replayWithin,swapWithin,reset,reveal,disable,enable,isEnabled,aboveTheFold,inspect,presets,getPreset,registerPreset}. Every target may be an Element, a NodeList/Array, or a selector string. Animated elements emit ThemeEvents.motionStart / motionEnd, which bubble. Debugging: console.table(FoxTheme.motion.inspect()) lists every motion element with its preset, its resolved stagger, whether it was above the fold, and whether it is hidden right now, and whether a stylesheet transform is defeating its start state (transformDefeated); elements flagged above the fold also carry data-motion-above-fold in the DOM.
 * @keywords motion api, replay animation, replayWithin, modal animation, filter results animation, reset motion, reveal, disable animation, FoxTheme.motion, debug motion, inspect motion, above the fold
 */

/** Anything the controller knows how to drive. */
const MOTION_SELECTOR = 'motion-component, [is="motion-group"]';

/**
 * @param {Element|NodeList|Element[]|string|null|undefined} target
 * @returns {Element[]}
 */
function resolveTargets(target) {
  if (!target) return [];
  if (typeof target === "string") return Array.from(document.querySelectorAll(target));
  if (target instanceof Element) return [target];
  if (typeof (/** @type {any} */ (target).length) === "number") return Array.from(/** @type {any} */ (target));
  return [];
}

/** Word-by-word headings (motion-text.js) — driven by the host calls below only. */
const TEXT_SELECTOR = "motion-text";

/** @param {Element|NodeList|Element[]|string|null|undefined} container */
function textElementsWithin(container) {
  return resolveTargets(container).flatMap((element) => Array.from(element.querySelectorAll(TEXT_SELECTOR)));
}

/** Motion elements at or inside a container, including the container itself. */
function motionElementsWithin(container) {
  return resolveTargets(container).flatMap((element) => {
    const inside = Array.from(element.querySelectorAll(MOTION_SELECTOR));
    return element.matches?.(MOTION_SELECTOR) ? [element, ...inside] : inside;
  });
}

/**
 * @param {Element} element
 * @param {string} method
 * @param {...any} args
 */
function call(element, method, ...args) {
  const fn = /** @type {any} */ (element)[method];
  if (typeof fn !== "function") return false;
  fn.apply(element, args);
  return true;
}

/** Is the generated prestage rule painting at all right now? */
function prestageApplies() {
  return (
    document.documentElement.hasAttribute("data-motion-armed") &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches &&
    !document.body?.hasAttribute("data-motion-disabled")
  );
}

/** The transform values that mean "nothing is moving this element". */
const IDENTITY_TRANSFORMS = new Set([
  "none",
  "matrix(1, 0, 0, 1, 0, 0)",
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
]);

/**
 * Is a stylesheet beating the start state to the `transform` property?
 *
 * An element has exactly one transform, so a rule that sets one on an animated
 * element competes with the prestage for it — and anything more specific than
 * `[data-motion-armed] [data-motion-from='…']` (0-2-0) wins. What makes it worth
 * a column rather than a comment is how quietly it fails: the same rule's
 * `opacity: 0` still lands, so the element still fades and only the travel is
 * gone. Nothing throws and every check stays green.
 *
 * Reported per ELEMENT, from the preset that element is actually staged with —
 * a group's cells carry it in `data-motion-from`, which already accounts for
 * any viewport step-down.
 *
 * @param {Element[]} staged
 * @returns {boolean}
 */
function transformDefeated(staged) {
  return staged.some((element) => {
    if (element.closest("[data-motion-off]")) return false;
    const name = element.getAttribute("data-motion-from") ?? element.getAttribute("data-motion");
    const from = getMotionPreset(name ?? "")?.from;
    // A preset that only fades has no claim on the property, so no conflict.
    if (!from || (!from.x && !from.y && from.scale == null)) return false;
    return IDENTITY_TRANSFORMS.has(getComputedStyle(element).transform);
  });
}

export const motionController = {
  /**
   * Whether decorative motion is running at all right now. False when the
   * merchant switched animations off, when the runtime never armed, or when the
   * visitor asked for reduced motion.
   */
  isEnabled() {
    const root = document.documentElement;
    return (
      root.hasAttribute("data-motion-armed") &&
      !document.body?.hasAttribute("data-motion-disabled") &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    );
  },

  /** Run the entrance now, from the start. Identical to replay(); named for readability at call sites. */
  play(target) {
    return this.replay(target);
  },

  /**
   * Reset and run again. The trigger a host owns — in-view cannot help once the
   * element is already on screen, and the coordinator has it marked completed.
   */
  replay(target) {
    const elements = resolveTargets(target);
    for (const element of elements) call(element, "replay");
    return elements.length;
  },

  /**
   * Replay every motion element at or inside a container. This is the one most
   * hosts want: a dialog that opened, a filtered grid that re-rendered, a
   * morphed section.
   */
  replayWithin(container) {
    const elements = motionElementsWithin(container);
    for (const element of elements) call(element, "replay");
    const headings = textElementsWithin(container);
    for (const heading of headings) call(heading, "replay");
    return elements.length + headings.length;
  },

  /**
   * One slide (or panel) giving way to the next: the outgoing headings leave
   * upwards word by word, and the incoming container replays — its headings
   * held back until the outgoing ones have cleared (500ms plus the longest
   * outgoing word cascade). Everything else in the incoming container replays
   * at once, as replayWithin() does.
   */
  swapWithin(from, to) {
    const leaving = textElementsWithin(from);
    for (const heading of leaving) call(heading, "exit");

    const cascade = Math.max(0, ...leaving.map((heading) => /** @type {any} */ (heading).cascadeMs ?? 0));
    const wait = leaving.length ? 500 + cascade : 0;

    const elements = motionElementsWithin(to);
    for (const element of elements) call(element, "replay");
    const headings = textElementsWithin(to);
    for (const heading of headings) call(heading, "replay", { delay: wait });
    return elements.length + headings.length;
  },

  /** Put elements back in their start state without playing. */
  reset(target) {
    const elements = resolveTargets(target);
    for (const element of elements) call(element, "reset");
    return elements.length;
  },

  /**
   * Show elements in their final state, no animation. The always-safe exit: any
   * host that is unsure what state motion left something in can call this and
   * know the content is visible.
   */
  reveal(target) {
    const elements = resolveTargets(target);
    for (const element of elements) call(element, "revealNow");
    return elements.length;
  },

  /** Opt elements out of motion. Reveals them, since opting out must never hide anything. */
  disable(target) {
    const elements = resolveTargets(target);
    for (const element of elements) {
      element.setAttribute("data-motion-off", "");
      call(element, "revealNow");
    }
    return elements.length;
  },

  /** Opt elements back in. They are left visible until something replays them. */
  enable(target) {
    const elements = resolveTargets(target);
    for (const element of elements) element.removeAttribute("data-motion-off");
    return elements.length;
  },

  /**
   * Every motion element the coordinator flagged as on screen at first paint.
   *
   * The flag quietly changes what an element does: a component drops to the
   * swap duration and stops waiting for its images, a group compresses its
   * stagger. Both of those have looked like bugs, so the set is readable. It
   * describes the first paint only — replay() and a morph clear it — so an
   * element still carrying it after the visitor has interacted is itself a bug.
   *
   * @param {ParentNode} [root]
   * @returns {Element[]}
   */
  aboveTheFold(root = document) {
    return Array.from(root.querySelectorAll(MOTION_SELECTOR)).filter((element) =>
      element.hasAttribute("data-motion-above-fold")
    );
  },

  /**
   * One row per motion element: what it is, what it decided, and whether it is
   * currently readable. Built for `console.table(FoxTheme.motion.inspect())`.
   *
   * `hiddenNow` is the column that matters — an element that is not animating
   * and not visible is the failure this whole system is built to prevent, and
   * it is worth being able to see in one command rather than by scrolling.
   *
   * @param {ParentNode} [root]
   */
  inspect(root = document) {
    const armed = prestageApplies();
    return Array.from(root.querySelectorAll(MOTION_SELECTOR)).map((element) => {
      const isGroup = element.getAttribute("is") === "motion-group";
      // Ask the group what it animates rather than re-deriving it here. This
      // was a second copy of the resolution rule, and it started describing the
      // wrong elements the moment a group could resolve its cells any other way.
      // The fallback covers the one case where there is nothing to ask: a group
      // that never upgraded — which is exactly when someone runs this, because
      // that is the state where the whole list is stuck at opacity 0.
      const group = /** @type {any} */ (element);
      const cells = isGroup
        ? (group.targets ?? Array.from(element.children, (cell) => cell.firstElementChild ?? cell))
        : [element];
      const opacities = cells.map((cell) => Number(getComputedStyle(cell).opacity));
      // Only an element on the prestage rule right now can be measured for this.
      // A group says so per cell; a component IS the staged element, and the
      // rule stops matching it the moment it is initialized. A held one is
      // staged like any other — hold only defers who starts it.
      const staged = isGroup
        ? cells.filter((cell) => cell.hasAttribute("data-motion-from"))
        : element.hasAttribute("data-initialized")
          ? []
          : [element];
      const box = element.getBoundingClientRect();
      // An empty list would make Math.min() report Infinity, which reads as a
      // measurement rather than as "there was nothing to measure".
      const minOpacity = opacities.length ? Math.min(...opacities) : null;

      return {
        kind: isGroup ? "group" : "component",
        preset: /** @type {any} */ (element).type ?? element.getAttribute("data-motion"),
        trigger: /** @type {any} */ (element).trigger ?? "inview",
        aboveTheFold: element.hasAttribute("data-motion-above-fold"),
        // A group rewrites its stagger above the fold; showing the value it will
        // actually use is the point, not the attribute the merchant set.
        staggerMs: isGroup ? Math.round(/** @type {any} */ (element).stagger) : null,
        cells: cells.length,
        ran: element.hasAttribute("data-initialized"),
        minOpacity: minOpacity === null ? null : Number(minOpacity.toFixed(2)),
        hiddenNow: minOpacity !== null && minOpacity < 0.99 && box.width > 0 && box.height > 0,
        // null = nothing staged to measure, not "fine". See docs/motion.md.
        transformDefeated: armed && staged.length ? transformDefeated(staged) : null,
        onScreen: box.top < window.innerHeight && box.bottom > 0 && box.width > 0,
        section: element.closest("[id^=shopify-section]")?.id.replace(/^shopify-section-/, "") ?? null,
        element,
      };
    });
  },

  /** The vocabulary, enumerable — for pickers, docs and the design agent. */
  presets: listMotionPresets,
  getPreset: getMotionPreset,
  registerPreset: registerMotionPreset,
};

if (typeof window !== "undefined") {
  window.FoxTheme = window.FoxTheme || {};
  window.FoxTheme.motion = Object.assign(window.FoxTheme.motion || {}, motionController);
}
