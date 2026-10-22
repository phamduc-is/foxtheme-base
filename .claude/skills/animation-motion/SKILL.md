---
name: animation-motion
description: Use when adding, choosing or debugging motion — entrance/scroll animations, staggered lists, replaying motion after a modal or filter, the motion presets and tokens, prefers-reduced-motion, or the FoxTheme.motion API. For "animate on scroll", "reveal/fade-in", "stagger the cards", "motion effect", "animation feels wrong".
---

# Motion

**The full reference is `docs/motion.md`. The enumerable vocabulary is
`.motion-manifest.json` (generated — `yarn motion:manifest`).** This skill is
the decision guide: what to reach for, and the traps that have actually bitten.

Do not hand-list the presets here. Read the manifest — it carries every kind
with its `intent`, its `cost`, its duration token and its mobile fallback, and
it cannot drift from the code.

---

## Choosing

| The thing you are animating             | Reach for                                                              |
| --------------------------------------- | ---------------------------------------------------------------------- |
| One element — heading, image, block     | `<motion-component data-motion="…">`                                   |
| Any text entrance played word by word   | `animation_split: "words"` next to `animation_type` (`text-markup`)    |
| A repeated list — cards, slides, rows   | `<div is="motion-group" data-motion="…">` on the EXISTING grid/row     |
| Content a modal or filter just produced | the same, plus `FoxTheme.motion.replayWithin(container)`               |
| A setting-driven animation in Liquid    | `{% render 'motion-attributes', type: …, delay: … %}`                  |
| Hover, focus, open/close                | a plain CSS transition on the `--motion-ui*` tokens — NOT the registry |

**Never wrap each card in its own `motion-component`.** One group is one
animation-budget slot and one animation for the whole list; per-card wrappers
spend N of each on the same cascade.

**Never type a duration, distance or curve into a component.** Presets own those.
If no preset fits, add one to `src/js/modules/motion-presets.js` — that is a
one-line entry, and `extends` is how a variant is spelled so the base parameters
stay single-sourced.

---

## Hard rules

- **Opacity follows what it belongs to, through a token.** An entrance's fade
  rides its movement — same curve, same duration (`entranceMotion()`,
  `--motion-fade-ratio: 1`). A crossfade of two stacked layers stays on
  `--motion-ease-fade` (linear) so the blend never dips. Never write a curve
  inline on opacity — `yarn check-motion-easing` enforces the token.
- **Lists and tab swaps have their own clocks.** A `motion-group` plays
  `--motion-list-*` (only the on-screen cells cascade); a tab swap is a sequence
  on `--motion-tab-*`. Do not hand-time either.
- **Only `transform` and `opacity`.** The registry rejects anything else.
- **A budget may drop an animation; it may never hide content.** Anything that
  can decline to animate must reveal instead — and reveal _at once_, never after
  a wait. Everything the coordinator can decline has already entered the
  viewport, so queueing it means holding visible content invisible.
- **A slot is the animation, not the wait.** `onActivate` must RETURN the
  animation's promise, so `active` counts what is running. Put anything that has
  to happen first — waiting on media — in `prepare`, which runs before the budget
  is consulted, and bound it.
- **Prestage only under `[data-motion-armed]`.** `motion-boot.liquid` sets it and
  withdraws it if the runtime never boots. An ungated prestage rule is a way for
  a failed script to erase the page.
- **Never re-state a DURATION per component under `prefers-reduced-motion`.**
  `_motion-reduced.scss` is the global floor and already clamps every transition
  and animation; use `data-motion-essential` when the animation IS the content
  (marquee, spinners). A component block is still right for the two things a
  duration clamp cannot reach — a custom property another layer reads
  (`--dialog-duration`), and an end state that should simply not happen
  (`transform: scale(1)`). Say which case it is in a comment.
- **After changing the registry**: `yarn motion:build` and `yarn motion:manifest`.
  `yarn check-motion-prestage` fails if you forget.

---

## Traps that have actually happened

**Motion is WAAPI, and a running animation outranks inline styles.** The
library is a wrapper, not a second engine: measured, an animation it creates
shows up in `element.getAnimations()` as the same `Animation` class that
`element.animate()` returns. So an interruption must `cancel()` the animation —
invalidating a run token stops the continuation but not the painting, and the
old run will happily paint over the start state the new one just wrote. Keep
the handle `animate()` returns; do not `await ...finished` and throw it away.

**`'cancel' in controls` is `false` — while `controls.cancel` is a function.**
Motion's controls object only reports its own keys (`animations`, `duration`,
`options`), so feature-detecting with `in` silently skips the cancel. Check
`typeof controls.cancel === "function"`, or just call it.

**Motion's `finished` RESOLVES on cancel — it does not reject.** So a
`try/catch` around it is dead code, and an interrupted run's continuation still
executes. Because that continuation is a microtask, it runs _before_ the next
frame and wipes the prestage a `replay()` just wrote, leaving the new run
animating from the finished state — i.e. not animating at all. Invalidate a run
token at every **interruption point** (`replay`, `disconnectedCallback`, reveal),
not at the start of the new run: at interruption time the new run has not begun,
so a token bumped there still matches.

**Test the trajectory, not the end state.** Sample over `requestAnimationFrame`
and assert the value passed through the middle:

```js
samples.some((s) => s.opacity > 0.1 && s.opacity < 0.9);
```

A 12-replay stress test passed for a while against the bug above, because it
only checked that nothing was left invisible.

**`display: none` beats your exit animation.** A "hide the inactive ones" loop
that runs in the same tick as an exit fade means the fade plays behind
`display: none` — the swap becomes a blank pause instead of a transition. Hide
the element when its animation ends, not when the switch starts.

**JS does not re-derive the prestage — CSS owns it outright.** The runtime puts
an element on a generated rule by writing `data-motion-from="<preset>"` and then
animates only to the END state, reading its own start from the DOM. Do not
rebuild a start state in JS: two independent resolutions of one value is a jump
on the first frame, and it silently ignores a `--motion-distance` scoped to a
section, which the stylesheet honours. Mobile step-downs and RTL flips are where
this used to drift; both are now expressed once, in `motionCssFrom()`.

**A static `transform` on an animated element kills the travel, silently.** The
start state comes from a stylesheet rule now, an element has exactly one
`transform`, and any selector more specific than `[data-motion-armed]
[data-motion-from='…']` (0-2-0) wins that property. The prestage's `opacity: 0`
still lands, so the element still fades — only the movement is gone, with
nothing thrown and every `yarn check-*` green. Before the CSS-owned start state
the runtime wrote the transform inline, where it outranked every stylesheet, so
conflicting rules could sit in the theme for years costing nothing.

Measured on `flex-carousel`: `.flex-carousel .swiper-backface-hidden
.swiper-slide-custom { transform: translateZ(0) }` (0-3-0) flattened
`slide-in-end` to a bare fade — on desktop only, because Swiper sets that class
on init and is torn down below the breakpoint. **An entrance that moves on one
viewport and not the other is this bug's fingerprint.** Confirm it with the
`transformDefeated` column of `FoxTheme.motion.inspect()`; fix it by taking the
`transform` off the element, never by out-specifying it — `!important` would
win over the animation too and freeze the element at its start state.

**Every element you stage, you must un-stage.** An element left carrying
`data-motion-from` is held at `opacity: 0` by the stylesheet with nothing coming
to move it — content invisible, no error. Clear it on every exit: the end of a
run, a cancelled run, the budget skipping the element, a reset, a disable. And
clear the elements you actually staged, not a freshly resolved list — the two
can differ.

**`prettier --write` can break Liquid attribute emission.** Building attributes
with inline tags and whitespace control lets the formatter strip the separating
space, gluing `data-motion="fade-up"data-motion-delay="200"` — theme-check
accepts it and the browser drops it. Build the string with `append` instead.
Also: a `%}` inside a `{% liquid %}` comment closes the tag.

---

## Programmatic animation

For bespoke behaviour that no preset can express, `@theme/animation` is still
there — but register through the coordinator so the budget and the shared
observer still apply:

```js
import { animate } from "@theme/animation";
import { coordinatedInView, prefersReducedMotion, entranceMotion } from "@theme/utilities";

if (prefersReducedMotion()) return;

const { durationMs, fadeDurationMs, easing, fadeEasing } = entranceMotion("--motion-reveal", 1500);

this.#stop = coordinatedInView(this, () => this.#enter(), {
  //                                    ^ RETURN it — the promise IS the slot
  prepare: async () => this.#waitForMedia(), // outside the budget, and bounded
  onSkip: () => this.revealNow(), // budget full — SHOW it, now
});
```

Cleanup in `disconnectedCallback`: call the returned stop function, cancel any
pending rAF, and bump the run token.

Note `inView()` imported straight from `@theme/animation` creates its own
observer and is outside the budget. That is correct for **lazy initialisation**
(a 400px preload margin so content is ready before it is seen) and wrong for
**animation** — do not confuse the two: putting lazy init behind an animation
budget would let a concurrency cap delay content.
