/**
 * @capability The theme's motion vocabulary as DATA — every entrance kind (fade-in, fade-up, slide-in-start/end, zoom-in/out and their swap-speed variants) with its parameters, its intent and its cost, in one enumerable registry that the runtime animates from, the build generates prestage CSS from, and a fork extends without editing this file.
 * @when Adding, tuning or choosing an entrance animation. Never hardcode opacity/transform values in a component — look the kind up here, or register a new one with FoxTheme.motion.registerPreset(). A kind's parameters live here and nowhere else, so "the same fade-up" cannot drift between two call sites.
 * @contract Zero imports by design — scripts/build-motion-prestage.mjs imports this in Node. getMotionPreset(name) resolves `extends` chains; motionEndState(preset) returns the END values the runtime animates to (the START state is the stylesheet's job — motionCssFrom(preset) emits it as CSS declarations using var() tokens, and the runtime puts an element on that rule with data-motion-from). A preset may only declare opacity, x, y and scale.
 * @keywords motion presets, animation registry, fade-in, fade-up, slide-in, zoom, entrance kinds, motion vocabulary, register preset, extend animation
 */

/**
 * @typedef {Object} MotionPreset
 * @property {string} [extends] - Inherit every field from another preset, then override
 * @property {string} [label] - Merchant-facing name
 * @property {string} [intent] - When to reach for this one. Read by the design agent.
 * @property {"low"|"high"} [cost] - Rendering cost; `high` is budgeted more tightly
 * @property {string} [duration] - Duration token suffix: `--motion-<duration>`
 * @property {string} [deprecated] - Name of the preset that replaces this one
 * @property {"self"} [staged] - This preset ships its OWN prestage CSS, so stage it
 *   under its own name instead of borrowing an ancestor's rule. The fork that sets
 *   this promises a rule for BOTH selectors — see docs/motion.md.
 * @property {string} [mobile] - The kind to run BELOW the md breakpoint instead of
 *   this one. An authoring choice — "slide on desktop, fade on a phone" — and not
 *   the protective step-down below it, which fires on cost. It MAY name a kind that
 *   fades where this one does not — that is what the property is for — but a fading
 *   element is never a largest-contentful-paint candidate, so weigh the swap against
 *   what the element actually is.
 * @property {{opacity?: number|null, x?: number, y?: number, scale?: number}} [from]
 *   The START state. `x`/`y` are MULTIPLES of --motion-distance, not lengths, so
 *   one token retunes every kind at once. `x` is a LOGICAL axis: negative means
 *   the inline start edge, and it is multiplied by --flip-x-factor so RTL flips
 *   without a second preset.
 *
 *   Merged by KEY along the `extends` chain, not replaced wholesale: overriding
 *   one axis keeps the rest of the parent's start state. To drop an inherited
 *   property deliberately, set it to `null` — `opacity: null` is how a variant of
 *   a fading preset stops fading.
 * @property {{opacity?: string, scale?: string}} [vars] - A CSS custom property per
 *   `from` value; the generated start state reads `var(<token>, <from value>)`
 */

/** @type {Record<string, MotionPreset>} */
const CORE_PRESETS = {
  "fade-in": {
    label: "Fade in",
    intent:
      "Appears in place. The safe choice where movement would fight a fixed layout, or inside something already moving.",
    cost: "low",
    duration: "reveal",
    from: { opacity: 0 },
  },
  "fade-up": {
    label: "Fade up",
    intent:
      "The default reveal. Content rises slightly as it appears, which reads as arriving rather than switching on.",
    cost: "low",
    duration: "reveal",
    from: { opacity: 0, y: 1 },
  },
  "fade-down": {
    label: "Fade down",
    intent:
      "Arrives from above. For a vertical list, where rising into place pushes against the reading order — and for anything that belongs over what it covers, a dropdown or a notice.",
    cost: "low",
    duration: "reveal",
    from: { opacity: 0, y: -1 },
  },
  "slide-in-start": {
    label: "Slide in from start",
    intent: "Enters from the inline start edge. Flips automatically in RTL.",
    cost: "low",
    duration: "reveal",
    from: { opacity: 0, x: -1 },
  },
  "slide-in-end": {
    label: "Slide in from end",
    intent: "Enters from the inline end edge. Flips automatically in RTL.",
    cost: "low",
    duration: "reveal",
    from: { opacity: 0, x: 1 },
  },
  "zoom-in": {
    label: "Zoom in",
    intent: "Grows into place. Expensive on a large image, so the budget caps these more tightly than a fade.",
    cost: "high",
    duration: "reveal",
    // Both values are the fallbacks of --motion-zoom-in-scale / -opacity: the
    // start state is a token, so it can be re-tuned without a registry entry.
    // It fades as it grows — the theme ships --motion-zoom-in-opacity: 0 — and
    // the registry says so, because the mobile step-down reads the registry:
    // declared as non-fading it kept its full cost on phones while rendering
    // as a fade. A theme that sets the token to 1 (no fade) should also give
    // the kind a `mobile` of its own if it wants it kept on phones.
    from: { scale: 0.8, opacity: 0 },
    vars: { scale: "--motion-zoom-in-scale", opacity: "--motion-zoom-in-opacity" },
  },
  "zoom-out": {
    label: "Zoom out",
    intent:
      "Settles down into place from oversized — the hero, slide and banner image. Runs on the media duration. Same cost as zoom-in.",
    cost: "high",
    duration: "media-reveal",
    from: { scale: 1.15 },
    vars: { scale: "--motion-zoom-out-scale" },
  },

  // Swap-speed variants. `extends` is how a variant is spelled: the base
  // parameters stay single-sourced, so a faster fade-up cannot quietly become a
  // second, drifting definition of fade-up.
  "fade-in--swap": {
    extends: "fade-in",
    label: "Fade in (quick)",
    intent: "Fade in at the speed of something the visitor just asked for — a tab, a filter result.",
    duration: "swap",
  },
  "fade-up--swap": {
    extends: "fade-up",
    label: "Fade up (quick)",
    intent: "Fade up at swap speed. What a tab panel's list uses.",
    duration: "swap",
  },

  // Physical names kept working. They now resolve to the LOGICAL direction,
  // which is the point: in an RTL store `slide-in-left` used to enter from the
  // wrong side, because it hardcoded translateX and ignored --flip-x-factor.
  "slide-in-left": { extends: "slide-in-start", deprecated: "slide-in-start" },
  "slide-in-right": { extends: "slide-in-end", deprecated: "slide-in-end" },
};

/** @type {Map<string, MotionPreset>} */
const registry = new Map(Object.entries(CORE_PRESETS));

/** Properties a preset is allowed to animate — compositor only. */
export const ALLOWED_FROM_PROPERTIES = ["opacity", "x", "y", "scale"];

export const DEFAULT_PRESET = "fade-up";

/**
 * Add or replace a preset. This is the fork extension point: a child theme ships
 * its own module that calls this, instead of editing the core registry and
 * conflicting on every sync.
 *
 * @param {string} name
 * @param {MotionPreset} definition
 */
export function registerMotionPreset(name, definition) {
  if (!name || typeof name !== "string") throw new Error("registerMotionPreset: name required");

  for (const [key, value] of Object.entries(definition.from ?? {})) {
    if (!ALLOWED_FROM_PROPERTIES.includes(key)) {
      throw new Error(
        `registerMotionPreset("${name}"): "${key}" is not animatable here. ` +
          `Only ${ALLOWED_FROM_PROPERTIES.join(", ")} — anything else would animate off the compositor.`
      );
    }
    // `null` is the one non-number allowed: it means "drop what the `extends`
    // chain handed down". `opacity: null` is how a variant of a fading preset
    // stops fading. Every reader already treats it as absent — motionCssFrom and
    // motionEndState both test `!= null` or truthiness — so nothing downstream
    // needs to know about it.
    if (value === null) continue;

    // x and y become multipliers inside a calc(), so a string or a NaN would be
    // emitted straight into the stylesheet and silently kill the declaration.
    if (typeof value !== "number" || !Number.isFinite(value)) {
      // Not JSON.stringify: it renders NaN as `null`, and `null` is now a legal
      // value meaning "drop the inherited property" — so the one message a NaN
      // can produce would have pointed at the one thing that was allowed.
      throw new Error(
        `registerMotionPreset("${name}"): "${key}" must be a finite number, got ${
          typeof value === "string" ? JSON.stringify(value) : String(value)
        }.`
      );
    }
  }

  registry.set(name, definition);

  // Resolution needs the entry present, so validate AFTER the set and roll back
  // on failure — a half-registered preset is worse than none.
  //
  // The trap this closes, measured: a preset whose start state carries no
  // opacity gets staged onto the nearest CSS-backed ancestor, and every core
  // preset except zoom-out fades. The stylesheet then holds the element at
  // `opacity: 0` while the animation — which never animates opacity — runs to
  // completion underneath. Measured at 1532ms of fully invisible movement,
  // ending in a snap to visible. Nothing threw, and no check caught it.
  const resolved = getMotionPreset(name);

  if (resolved?.mobile) {
    const alternative = getMotionPreset(resolved.mobile);
    const reject = (why) => {
      registry.delete(name);
      throw new Error(`registerMotionPreset("${name}"): mobile: "${resolved.mobile}" ${why}`);
    };

    // Register the alternative first. Resolving it lazily would turn a typo into
    // a silent fall-through on phones only — the viewport least likely to be the
    // one the author is looking at.
    if (!alternative) reject("is not a registered preset. Register it first.");
    if (resolved.mobile === name) reject("is this preset itself.");

    // Deliberately NOT rejected: an alternative that fades where this preset does
    // not. This used to mirror the step-down below — by analogy, never from its own
    // measurement. The measured regression was in the AUTOMATIC path, where
    // degrading a zoom to fade-in made a hero IMAGE start at opacity 0; that path
    // protects authors who said nothing, and it stays exactly as it was.
    //
    // `mobile` is the author saying something, and explicit outranks automatic here
    // for the same reason it does in motionPresetForViewport(). Mirroring the ban
    // made the one authoring choice this property exists FOR — "slide on desktop,
    // fade on a phone", the worked example in docs/motion.md — impossible to
    // express, so the documentation described a preset the code refused to accept.
    //
    // The cost is real and is now the author's to weigh rather than the registry's
    // to forbid: an element that animates opacity is never a largest-contentful-paint
    // candidate. A panel or a card beside the hero image is a different question
    // from the hero image itself.
  }

  if (resolved && resolved.from?.opacity == null) {
    const stagedName = stagedPresetName(name);
    if (stagedName !== name && getMotionPreset(stagedName)?.from?.opacity != null) {
      registry.delete(name);
      throw new Error(
        `registerMotionPreset("${name}"): this preset does not animate opacity, but it would be ` +
          `staged onto "${stagedName}", whose start state sets opacity: 0 — so it would stay ` +
          `invisible for its whole run and then snap in. Either add an "opacity" entry to "from", ` +
          `or ship your own prestage CSS and declare staged: "self". See docs/motion.md.`
      );
    }
  }
}

/**
 * Resolve a preset by name, following `extends`.
 *
 * @param {string} name
 * @returns {(MotionPreset & {name: string}) | null}
 */
export function getMotionPreset(name) {
  const chain = [];
  let current = name;

  while (current && registry.has(current)) {
    const preset = /** @type {MotionPreset} */ (registry.get(current));
    chain.unshift(preset);
    if (chain.length > 10) break; // a cycle in the data should not hang the page
    current = preset.extends;
  }

  if (!chain.length) return null;

  const resolved = Object.assign({ name }, ...chain, { extends: undefined });

  // `from` merges by KEY, while every other field is replaced wholesale. A plain
  // Object.assign swaps the whole object, so `{ extends: "slide-in-start",
  // from: { x: -2 } }` silently dropped the parent's `opacity: 0` — the child
  // then animated no opacity at all while the stylesheet still held it at 0,
  // which measured as 1.5s of invisible content ending in a pop.
  const fromParts = chain.map((preset) => preset.from).filter(Boolean);
  if (fromParts.length) resolved.from = Object.assign({}, ...fromParts);

  return resolved;
}

/** Below this width the expensive presets step down. Matches the `md` breakpoint. */
export const MOBILE_MAX_WIDTH = 767.98;

/** What an expensive preset becomes on a small screen. */
export const MOBILE_FALLBACK_PRESET = "fade-in";

/**
 * The preset actually used at this viewport.
 *
 * Almost everything keeps its kind on a small screen and only borrows the
 * smaller, faster tokens the media query sets. The one step-down left is for a
 * preset that is both expensive AND already fades — see the guard below for why
 * it cannot be any broader than that.
 *
 * Pure, so the CSS generator applies exactly the same rule as the runtime.
 *
 * @param {string} name
 * @param {boolean} isMobile
 * @returns {string}
 */
export function motionPresetForViewport(name, isMobile) {
  if (!isMobile) return name;
  const preset = getMotionPreset(name);

  // An explicit `mobile` outranks the cost-based step-down below: it is what the
  // author asked for, while the step-down is a protection applied to authors who
  // said nothing. One hop only — a chain here would be a second, quieter way to
  // express `extends`, and the generator resolves this exact call to decide which
  // rules to emit.
  if (preset?.mobile) return preset.mobile;

  if (preset?.cost !== "high") return name;

  // A step-down may make an entrance cheaper. It may NOT make its start state
  // harsher — and swapping a transform-only preset for a fade does exactly
  // that. zoom-out carries no opacity, so the element is visible for every
  // frame of it; degrading zoom-out to fade-in on a phone measured as the hero
  // image starting at opacity 0 instead of simply being there. That is a worse
  // largest-contentful-paint on the one device where it matters most, arrived
  // at while trying to protect it.
  //
  // So the step-down only applies to a preset that already fades: zoom-in,
  // which grows from transparent, steps down to a fade on a phone; zoom-out,
  // which never fades, keeps its zoom. "Fades" means the registry's start
  // opacity is below 1.
  return preset.from?.opacity != null && preset.from.opacity < 1 ? MOBILE_FALLBACK_PRESET : name;
}

/** Every registered preset, resolved. Enumerable for pickers, docs and agents. */
export function listMotionPresets() {
  return Array.from(registry.keys(), (name) => getMotionPreset(name)).filter(Boolean);
}

/** The identity transform matching a preset's start state, so the tween has a target. */
export function motionTransformTo(preset) {
  const from = preset.from ?? {};
  const parts = [];

  if (from.x) parts.push("translateX(0)");
  if (from.y) parts.push("translateY(0)");
  if (from.scale != null) parts.push("scale(1)");

  return parts.join(" ");
}

/**
 * Names that the generated prestage stylesheet actually has a rule for.
 *
 * Captured at module load, BEFORE any fork can call registerMotionPreset(): the
 * stylesheet is generated in Node by scripts/build-motion-prestage.mjs, which
 * sees only what is in this file. A preset a fork registers at runtime is real
 * to the registry and invisible to the CSS.
 */
const CSS_BACKED_PRESETS = new Set(Object.keys(CORE_PRESETS));

/**
 * The preset name to hand the stylesheet via `data-motion-from`.
 *
 * A fork-registered preset has no rule of its own, and staging with a name
 * nothing matches is worse than staging with the wrong one: the element gets no
 * start state at all, so the entrance runs from its final position to its final
 * position and the merchant sees nothing happen. Walking the `extends` chain
 * finds the nearest name that IS backed by CSS.
 *
 * That walk only rescues a REPLAY. The first-paint rule keys on `data-motion`,
 * which carries the name as authored, and no fork name is ever in the generated
 * stylesheet — so the variant idiom this file used to advertise as lossless
 * (`{ extends: "fade-up", duration: "swap" }`) was measured doing nothing at all
 * on first paint, while animating normally on replay. Anything that has to run
 * at first paint needs `staged: "self"` and its own rules.
 *
 * A fork that wants a genuinely new start state ships the matching rules itself
 * and declares `staged: "self"`, which makes this function return the name as
 * authored. That fork owes BOTH selectors, because the two paths fail
 * independently: `[data-motion="<name>"]` covers first paint, and
 * `[data-motion-from="<name>"]` covers every replay. Measured, a fork preset with
 * neither simply never animated on first paint, and was held invisible for a
 * full reveal on replay. See docs/motion.md.
 *
 * @param {string} name
 * @returns {string} A name that has a prestage rule — core's, or the fork's own
 */
export function stagedPresetName(name) {
  // Read `staged` off the entry ITSELF rather than the resolved preset: it is a
  // claim about one name's own CSS, and inheriting it would stage a child under
  // a name whose rule describes the parent's start state, not the child's.
  if (registry.get(name)?.staged === "self") return name;

  const seen = new Set();
  let current = name;

  while (current && !seen.has(current)) {
    if (CSS_BACKED_PRESETS.has(current)) return current;
    seen.add(current);
    current = registry.get(current)?.extends;
  }

  return DEFAULT_PRESET;
}

/**
 * WHERE an animation of this preset ends, and therefore WHICH properties it
 * animates. Everything about where it STARTS lives in the stylesheet.
 *
 * The runtime used to build the start state here too, from a `--motion-distance`
 * it resolved itself — a second, independent resolution of a value the engine
 * had already computed for the prestage rule. Any unit or any scope the two
 * resolved differently was a jump on the first frame, and the runtime silently
 * ignored a token scoped to a section while the CSS honoured it. Now one side
 * owns it: the element is put on the prestage rule via `data-motion-from`, and
 * the animation simply runs to the values below, reading its own start from the
 * DOM. `calc()`, `em`, `vh` and anything else CSS can express all work, because
 * nothing here parses them.
 *
 * @param {MotionPreset} preset
 * @returns {Record<string, any>} Final value per animated property
 */
export function motionEndState(preset) {
  /** @type {Record<string, any>} */
  const to = {};

  if (preset.from?.opacity != null) to.opacity = 1;

  const transformTo = motionTransformTo(preset);
  if (transformTo) to.transform = transformTo;

  return to;
}

/**
 * Which curve token a preset's MOVEMENT runs on. The zooms read
 * --motion-ease-zoom (unset by default, so entranceMotion() falls back to the
 * entrance curve): an image settling from 1.15 is a different gesture from text
 * rising 25px, and a theme may want the media curve for it.
 *
 * @param {MotionPreset} [preset]
 * @returns {string}
 */
export function motionEasingToken(preset) {
  return preset?.from?.scale != null ? "--motion-ease-zoom" : "--motion-ease-entrance";
}

/**
 * The same start state as CSS declarations, for the generated prestage.
 * Uses var() rather than resolved values so the tokens stay live — including
 * --flip-x-factor, which is what makes the prestage RTL-correct too.
 *
 * @param {MotionPreset} preset
 * @returns {string[]} e.g. ["opacity: 0;", "transform: translateY(var(--motion-distance));"]
 */
export function motionCssFrom(preset) {
  const from = preset.from ?? {};
  const declarations = [];
  const parts = [];
  // A preset may name a token per property (`vars`); the registry value is then
  // the token's fallback, so the shipped start state is unchanged until a theme
  // sets it.
  const value = (property) =>
    preset.vars?.[property] ? `var(${preset.vars[property]}, ${from[property]})` : from[property];

  if (from.opacity != null) declarations.push(`opacity: ${value("opacity")};`);

  // A multiplier of exactly 1 is left out of the expression — it changes
  // nothing and every shipped preset uses ±1, so the generated file stays as
  // readable as it was before multipliers were honoured.
  const factor = (multiplier) => (multiplier === 1 ? "" : ` * ${multiplier}`);

  if (from.x) {
    // The flip factor has to stay inside the CSS rather than be resolved here:
    // one stylesheet serves both directions, and [dir="rtl"] sets it to -1.
    parts.push(`translateX(calc(var(--motion-distance)${factor(from.x)} * var(--flip-x-factor, 1)))`);
  }
  if (from.y) {
    // No flip on the block axis. Capped at 90% of the element's own height (a
    // translate percentage is the element's), so a short element — a label, a
    // single line — never travels further than it is tall.
    const scaled = factor(from.y);
    const distance = "min(var(--motion-distance), 90%)";
    parts.push(scaled ? `translateY(calc(${distance}${scaled}))` : `translateY(${distance})`);
  }
  if (from.scale != null) parts.push(`scale(${value("scale")})`);

  if (parts.length) declarations.push(`transform: ${parts.join(" ")};`);

  return declarations;
}

// Fork extension point, reachable without a module import.
if (typeof window !== "undefined") {
  window.FoxTheme = window.FoxTheme || {};
  window.FoxTheme.motion = window.FoxTheme.motion || {};
  window.FoxTheme.motion.registerPreset = registerMotionPreset;
  window.FoxTheme.motion.getPreset = getMotionPreset;
  window.FoxTheme.motion.listPresets = listMotionPresets;
}
