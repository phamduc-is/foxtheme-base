# Motion

Everything that moves in this theme goes through one system. This is the map.

The machine-readable half is `.motion-manifest.json` (generated; run
`yarn motion:manifest`). Agents read that. This file is for people.

---

## The shape of it

```
Tokens      snippets/css-variables.liquid      duration / easing / distance
Registry    src/js/modules/motion-presets.js   the KINDS, as data
Runtime     motion-component · motion-group · motion-controller
Bindings    snippets/motion-attributes.liquid  settings → markup
```

Everything below the registry reads it. **No component holds animation values of
its own** — if you find yourself typing `0.6s` or `translateY(25px)` into a
component, that is the mistake this system exists to prevent.

---

## Using it

### One element

```liquid
<motion-component data-motion="fade-up">…</motion-component>
```

### A list — always prefer this for repeated items

```liquid
<div is="motion-group" data-motion="fade-up" class="my-grid">
  <div class="cell">…card…</div>
  <div class="cell">…card…</div>
</div>
```

`is="motion-group"` goes **on the existing grid or carousel row**. It is a
customized built-in, so it adds no wrapper and no box. Each direct child is a
cell; the element actually animated is the cell's first element child.

Do **not** put a `<motion-component>` around every card. One group is one
animation-budget slot and one animation for the whole list; N wrappers spend N
of each on the same cascade.

### From a setting

Never hand-write the attributes. Render the snippet — it also owns the
`settings.animations_enabled` guard that is easy to forget:

```liquid
<div {% render 'motion-attributes', type: block.settings.animation_type, delay: block.settings.animation_delay %}>
```

### Attributes

| Attribute               | Meaning                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `data-motion`           | Preset name. Nothing animates without it.                                                                            |
| `data-motion-delay`     | ms before this element starts                                                                                        |
| `data-motion-stagger`   | group only; step between cells. `0` = together                                                                       |
| `data-motion-trigger`   | `inview` (default) · `load` · `manual`                                                                               |
| `data-motion-repeat`    | re-arm when it scrolls out of view                                                                                   |
| `data-instantly`        | do not wait for inner images                                                                                         |
| `data-motion-hold`      | prestaged like any other, but nothing starts it: wait for a host's `replay()` (the slideshow does this per slide)    |
| `data-motion-off`       | opt this element out                                                                                                 |
| `data-motion-disabled`  | on an ancestor: opt out the subtree                                                                                  |
| `data-motion-essential` | exempt from the reduced-motion floor. Marquee and spinners only.                                                     |
| `data-motion-from`      | written by the RUNTIME, never by you. Names the preset whose start state the stylesheet should hold this element at. |

---

## Driving it from JS

In-view is one trigger. For everything else — a modal opening, a filter
returning, a morphed section — use the API:

```js
FoxTheme.motion.replayWithin(dialog); // everything at or inside it
FoxTheme.motion.replay(el);
FoxTheme.motion.reveal(el); // final state, no animation
FoxTheme.motion.reset(el);
FoxTheme.motion.disable(el); // opts out AND reveals
FoxTheme.motion.isEnabled();
```

`replay()` puts the element back to its start state and runs it again. The two
elements differ in **when**, and the difference is deliberate:

- **`motion-group` runs immediately**, visible or not. Its callers are swaps the
  visitor just asked for — a tab, a filter — and those must not queue behind the
  animation budget.
- **`motion-component` re-arms its in-view trigger** instead: on screen it starts
  at once, scrolled past it stages and waits rather than playing to nobody.
  Measured: off-screen it stays at the start state, and scrolling to it ends
  fully visible — it is never stranded.

`reveal()` is the always-safe exit: if you are unsure what state motion left
something in, call it and the content is visible.

**Carousels drive their own slides.** `carousel.js` calls
`replayWithin(activeSlide)` on `slideChangeTransitionStart`, because in-view
cannot do this job: IntersectionObserver reports geometry, and a carousel using
`effect: fade` stacks every slide in the same box and hides the inactive ones
with **opacity**. Left to the observer, every slide's entrance ran at page load
while its slide was invisible — measured at 97/197/297ms — so the visitor only
ever saw the first one, and `loop` made it look intermittent by relocating slide
nodes and reconnecting the components inside them.

This only reaches motion **inside** a slide. A list carousel puts its
`motion-group` on the `.swiper-wrapper`, which is the slides' parent rather than
a slide, so arrows do not re-animate a product grid — verified on both shapes.

### A group inside a scroll-snap row

Below the Swiper breakpoint that same `.swiper-wrapper` is often the
`.swipe__inner` of a CSS scroll-snap row, and a snap area is the cell's
**transformed** border box. So a prestage transform moves the snap positions:
the container re-snaps to the staged offset and then chases the animation frame
by frame, with `scroll-behavior: smooth` turning each correction into its own
scroll. Measured on `flex-carousel` at 390px with `slide-in-end`: the row sat at
`scrollLeft: 15` for as long as the section stayed below the fold, and during
the entrance the FIRST card travelled 0.9px of its 15px, because the snap kept
pinning the card it was snapped to.

You do not have to do anything about this — while its prestage transform is
live the group carries `data-motion-staged`, and `_component-swipe.scss` stands
the row's snapping down for exactly that window. Worth knowing about because it
decides where a group belongs: a group that animates the cell's **first child**
(the default resolution) never touches a snap area, since that child is inside
the snap child. Only `data-motion-cells` pointing at the snap children
themselves — what `flex-carousel` needs, because its blocks render their own
slide roots — creates the conflict. Prefer the default when the markup allows.

Elements emit `ThemeEvents.motionStart` / `motionEnd` (bubbling, with the preset
name and whether it animated), so you can sequence off motion instead of
guessing at timings.

---

## Debugging

```js
console.table(FoxTheme.motion.inspect());
```

One row per motion element: `preset`, `trigger`, `aboveTheFold`, the **resolved**
`staggerMs` (what the group will actually use, not the attribute the merchant
set), `ran`, `minOpacity`, `hiddenNow` and `onScreen`.

`hiddenNow && onScreen` is the row that should never exist — something the
visitor is looking at that motion left invisible. Scan that column first.

`transformDefeated` is the other column that should never be true: the element
is staged, its preset moves, and the transform on it is still the identity —
which only happens when a stylesheet rule outranks the start state. See "An
animated element may not carry a static `transform`". It reads `null` for an
element that is not staged at that moment, so run it while the entrance is
pending; a group with `trigger="manual"` sits staged indefinitely, and for
anything else, `FoxTheme.motion.reset(el)` puts it back on the start state.

`staggerMs` is the resolved step a group will cascade on. A group above the fold
plays the same stagger and duration as anywhere else — nothing is compressed at
first paint any more — so a `staggerMs` that differs from the list token comes
from the group's own `data-motion-stagger` (or `sequence: false`, which is 0).

```js
FoxTheme.motion.aboveTheFold(); // the elements the coordinator flagged
```

Elements carry `data-motion-above-fold` in the DOM as well, so the Elements
panel shows it without running anything. `FoxTheme.motionCoordinator.getStats()`
gives the budget's side: queued, active, preparing, completed. `active` counts
animations **currently running**; `preparing` counts elements in view that are
waiting for their images, which is outside the budget on purpose.

---

## Adding a preset

One entry in `src/js/modules/motion-presets.js`:

```js
"fade-down": {
  label: "Fade down",
  intent: "For content that belongs above what pushed it — a dropdown, a notice.",
  cost: "low",
  duration: "reveal",
  from: { opacity: 0, y: -1 },
},
```

- `x` / `y` are **multiples of `--motion-distance`**, not lengths.
- `x` is a **logical** axis — negative is the inline start edge, and it is
  multiplied by `--flip-x-factor`, so RTL flips without a second preset.
- Only `opacity`, `x`, `y`, `scale` are allowed. Anything else would animate off
  the compositor, and `registerMotionPreset` throws.
- A variant is its own entry with `extends`, never a tweak at a call site:

```js
"fade-down--swap": { extends: "fade-down", duration: "swap" },
```

Then `yarn motion:build` (regenerates the prestage CSS) and
`yarn motion:manifest`. `yarn check-motion-prestage` fails if you forget.

### From a child fork

Do not edit the core registry — it conflicts on every sync. Register instead:

```js
FoxTheme.motion.registerPreset("brand-slide", {
  staged: "self",
  duration: "reveal",
  from: { x: -1 },
});
```

Put that call **somewhere under `src/js`** (a module of the fork's own is the
usual home). `yarn check-motion-presets` scans that tree for
`registerMotionPreset` / `registerPreset` and treats the names it finds as real,
so a literal `data-motion="brand-slide"` passes. Register anywhere else — an
inline `<script>` in a snippet, say — and the check cannot see it: the name
works at runtime and still fails CI.

**A fork preset has no generated CSS, and two independent paths need it.**
`motion-prestage.liquid` is generated in Node from the core registry, so a name
registered in the browser can never be in it. The two paths are:

| path         | selector the generated CSS uses                                  |
| ------------ | ---------------------------------------------------------------- |
| first paint  | `motion-component:not([data-initialized])[data-motion="<name>"]` |
| every replay | `[data-motion-from="<name>"]`                                    |

They fail **separately**, which is how a fork preset looks like it works and is
still broken. Measured on a fork preset carrying no CSS of its own: on first
paint **nothing happened at all** — no rule matched, so there was no start state
and the entrance ran from the final position to the final position — while on
replay `stagedPresetName()` borrowed a core rule and it animated normally.

So `{ extends: "fade-up", duration: "swap" }` — a variant that only retimes its
parent — is **dead on first paint** and fine on replay. Reach for that shape only
where the element is always revealed by a replay (a tab panel, a filtered grid, a
morphed section), never for something that animates as the page first paints.

**To ship a preset that works on both paths, declare `staged: "self"` and write
both rules yourself:**

```css
[data-motion-armed] motion-component:not([data-initialized])[data-motion="brand-slide"],
[data-motion-armed] [data-motion-from="brand-slide"] {
  transform: translateX(calc(var(--motion-distance) * -1 * var(--flip-x-factor, 1)));
}
```

`staged: "self"` is the promise that those rules exist: it makes
`stagedPresetName()` return the name as authored instead of borrowing an
ancestor's. Without it the runtime stages the preset under the nearest
CSS-backed ancestor, or `DEFAULT_PRESET`.

**A fork preset using `mobile` owes a mobile rule too.** The generator emits the
small-screen overrides by walking the core registry, so it never sees a
fork-registered preset — and on a phone the first-paint rule still keys on your
own `data-motion="<name>"`, which is the DESKTOP start state you shipped. Mirror
what the generator does for core: inside `@media (max-width: 767.98px)`, reset
`transform: none` and apply the alternative's start state.

Measured with it missing, on a slide whose `mobile` is `fade-in`: the element is
held at the desktop offset (translateX -15px) for the whole entrance while only
opacity animates, and the offset then disappears in ONE step when
`data-initialized` lands and the first-paint selector stops matching — a 15px
jump at the end of an entrance that was supposed to be a plain fade. It is not
stranded, which is exactly what makes it easy to miss. With the mobile rule
shipped, transform never leaves `none` and the fade is clean.

The replay path needs nothing extra, because the runtime resolves the viewport
first and writes the alternative's name into `data-motion-from`, landing on its
rule.

**`from` merges by KEY along the `extends` chain**, so overriding one axis keeps
the rest of the parent's start state. To drop an inherited property deliberately,
set it to `null` — `opacity: null` is how a variant of a fading preset stops
fading.

**A preset that animates no opacity, but would be staged onto one that does, is
rejected at registration.** That pairing measured as 1.5s of fully invisible
movement ending in a snap: the borrowed rule holds the element at `opacity: 0`
while the animation — which never touches opacity — runs to completion
underneath. Nothing threw and no check caught it. Either give `from` an
`opacity`, or take `staged: "self"` and ship the rules.

Mind the cascade. `[data-motion-armed] [data-motion-from="…"]` is 0-2-0, exactly
the specificity of the override above, so source order decides — the fork's rule
has to load AFTER the prestage block in `critical-css.liquid`, which a
section-scoped stylesheet does and a rule folded into `theme.css` may not.

Gate it on `data-motion-armed` like every generated rule, or content stays
hidden when the runtime never boots.

---

## The tokens

| Token                                 | Default                      | For                                                            |
| ------------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `--motion-ui-fast`                    | 0.25s                        | micro feedback — a swatch, an icon                             |
| `--motion-ui`                         | 0.35s                        | default UI response — hover, colour, border                    |
| `--motion-overlay`                    | 0.5s                         | dialogs, backdrops                                             |
| `--motion-swap`                       | 0.6s                         | content the visitor asked for — a filter, a replayed slide     |
| `--motion-reveal`                     | 1.5s                         | content appearing on its own — on scroll AND at first paint    |
| `--motion-media-reveal`               | 1.3s                         | a hero / slide / banner image settling (zoom-out)              |
| `--motion-ease`                       | ease-in-out                  | UI response                                                    |
| `--motion-ease-out`                   | cubic-bezier(.3,1,.3,1)      | anything that MOVES in the UI; the image fade-in               |
| `--motion-ease-entrance`              | cubic-bezier(.16,1,.3,1)     | entrances — movement AND opacity (entranceMotion)              |
| `--motion-ease-entrance-fade`         | unset (= the entrance curve) | a separate curve for an entrance's fade, if ever needed        |
| `--motion-fade-ratio`                 | 1                            | share of the movement's duration the fade takes                |
| `--motion-ease-fade`                  | linear                       | a crossfade: two stacked layers trading opacity                |
| `--motion-ease-overlay`               | cubic-bezier(.7,0,.2,1)      | dialogs                                                        |
| `--motion-ease-media`                 | linear(…) → lands at 60%     | the long media hover zoom (bezier fallback without linear())   |
| `--motion-distance`                   | 3.2rem                       | entrance travel, capped at 90% of the element's height         |
| `--motion-list-distance`              | 5rem (3rem < md)             | a list cell's travel                                           |
| `--motion-list-duration`              | 0.5s (0.3s < md)             | a list cell's entrance                                         |
| `--motion-list-ease`                  | ease                         | a list cell's movement and fade                                |
| `--motion-stagger`                    | 0.1s (0.05s < md)            | step between the cells on screen                               |
| `--motion-swap-mode`                  | sequence                     | tab swap: `sequence` or `crossfade`                            |
| `--motion-tab-duration`               | 0.15s                        | each half of a sequenced tab swap                              |
| `--motion-tab-distance`               | 2rem                         | how far a tab panel moves out / in (along the preset's axis)   |
| `--motion-tab-ease`                   | ease                         | both halves of a sequenced tab swap                            |
| `--motion-exit`                       | 0.12s                        | the outgoing fade of a crossfaded tab swap                     |
| `--motion-zoom-in-scale` / `-opacity` | 0.95 / 0                     | zoom-in's start state                                          |
| `--motion-zoom-out-scale`             | 1.3                          | zoom-out's start state                                         |
| `--motion-image-reveal` / `-scale`    | 0.5s / 1                     | the CSS image fade-in (`image-zoom-reveal`); scale 1 = no zoom |

Names describe **what the motion is for**, not how long it takes. That is the
axis a fork needs: retune every hover without touching a single reveal. Every
token is read from the animated element, so any of them can be scoped to a
section or a component.

**The duration is the kind's own, wherever it plays.** A reveal is a reveal at
first paint, on scroll and on replay alike — the first thing a visitor sees
arrives with the same gesture as everything after it. Above the fold only skips
the media wait. A host that is answering a click can still ask for swap speed
explicitly (`replay({ speed: "swap" })`).

**A list keeps its own rhythm.** A `motion-group` always plays the list tokens —
quicker and further than a single reveal, one cell after another. Only the cells
on screen cascade; the ones below the fold follow together once that cascade has
played.

**An entrance can run split by word.** Effect and split are two settings: a
text block's `animation_type` picks the preset, its `animation_split` (_Split
text_: none / by word) picks whether it plays on the block or on each word, and
`text-markup` renders the split case as `<motion-text data-motion="<preset>">`.
Each word plays the preset's direction, not its distance (multiples of
`--motion-distance` are sized for a block): a vertical preset rises 90% of the
word's height out of its own clipping box, a slide-in travels
`--motion-split-distance` (0.5em) with the clip off, a fade-in only fades, and a
zoom fades. Words follow one another, one `--motion-heading-stagger` after the last, over
`--motion-heading-duration` — with the step shrunk so the last word starts within
`--motion-heading-span` (600ms), so a paragraph lands as quickly as a heading.
On scroll, a text no taller than half the viewport (any ordinary heading)
cascades as one; a taller text is paced by its lines: when it enters, only the
words already on screen cascade, and a line still below the fold waits until it
is scrolled to, then cascades after the block's own delay like the first (a
host's replay — a slide, a tab — runs every word at once). The first word waits
for the block's own Delay setting and nothing else: no
section adds a hidden delay of its own, so 0 in the editor is 0 on the page, in
either mode. Two things that used to rule it out now work with it:

- **Gradient text** is a background clipped to the owner's glyphs, and a word
  with a transform is painted outside that clip — mid-flight it was invisible.
  While the words move, each one carries the owner's gradient itself, sized to
  the owner's box and offset to its own place in it; the owner takes it back
  once they land.
- **An `<em>` highlight** sweeps in as its OWN words land: on each run the
  host (`<motion-text>`, or a `<motion-component>` around the whole block)
  answers `landingAt(em, fraction)`, and the shape starts when the highlighted
  words are `--motion-highlight-start` (0.4) through their entrance — not after
  the whole text has finished, and never over words still hidden. It follows
  every run: collapsed while the words leave, gone when they are staged again.

Section presets split their headings by word (`fade-up` + `words`); it is a per-block choice, so a
small heading elsewhere can keep a plain fade. Carousels call
`FoxTheme.motion.swapWithin(previousSlide, slide)` (through
`CarouselComponent.swapSlideMotion()`): the outgoing headings leave upwards word
by word, and the incoming ones wait for them (500ms plus the longest outgoing
cascade, `cascadeMs`) before they rise.

**A slideshow changes slide in sequence.** Its fade takes the whole outgoing
slide, text included, within the slide speed — an exit running alongside it is
never seen. So `slideshow.js` holds every non-drag change (arrows, dots,
autoplay, keyboard): the active slide's played text leaves first —
`<motion-text>` through `exit({ durationMs, easing })`, any other non-media
`motion-component` moving on in the direction it came — over
`--motion-slide-exit` on `--motion-slide-exit-ease`, then the slide changes and
the incoming slide plays as usual. A drag goes through at once. An `<em>`
highlight follows its words on every run: collapsed while they leave, swept in
again once they land.

**Grids and presets.** Product grids (featured collection, collection list,
recommendations, the collection and search pages) cascade their cards in by
default. Section presets leave text, buttons and labels without an entrance of
their own: the headings (split by word), the media and the lists carry the motion.

**A tab swap is a sequence.** The outgoing panel leaves by `--motion-tab-distance`
while it fades, carrying on in the direction the section's entrance preset travels
(up for fade-up, out the far side for slide-in-start/end, past full size for
zoom-in, in place for fade-in); then the incoming one enters the same way, both on
`--motion-tab-duration` / `--motion-tab-ease`, and any list inside it cascades in
at the same time. `--motion-swap-mode: crossfade` restores the overlapped swap.

---

## Rules that are not negotiable

**An entrance's fade rides its movement.** Opacity and transform run on the same
curve for the same duration (`--motion-fade-ratio: 1`), so the element becomes
visible as it rises and the eye follows the settle. A linear fade under a
decelerating rise left most of the travel happening while the element was still
too faint to see it.

**A crossfade stays linear.** Where two stacked layers trade opacity and nothing
moves, `--motion-ease-fade` (linear) keeps the blend midpoint in place, so the
swap never dips or flashes.

**Opacity transitions use a token.** `yarn check-motion-easing` rejects an
inline curve on opacity (including through one hop of a local variable): which
curve is right is the token layer's decision, made once.

**Only `transform` and `opacity`.** Enforced for presets by the registry.

**A budget may drop an animation; it may never hide content.** When
`motionCoordinator` has no slot it reveals the element **immediately** — it does
not queue it. Everything it could queue has just entered the viewport and is
being held at `opacity: 0` by the prestage, so waiting means keeping visible
content invisible to save GPU. If you write anything that can decline to
animate, it must reveal instead, and it must do so at once.

**A slot is the animation, not the wait.** `onActivate` must return a promise
that settles when the animation _ends_, so `active` means "running". Anything
that has to happen first — waiting for images — goes in `prepare`, which runs
before the budget is consulted: waiting on the network costs no GPU and must not
occupy a slot a real animation could use. And bound any such wait;
`motion-component` gives it 1s before playing regardless.

**Prestage is armed by JS.** `snippets/motion-boot.liquid` sets
`data-motion-armed` in `<head>` and takes it back if the runtime never reports
in. Never write a prestage rule that is not gated on it — hiding content is only
safe while something is guaranteed to un-hide it.

Each half of the runtime reports for itself, because each gates a different
rule and they fail independently: `motion-component.js` sets
`data-motion-booted` (paired with `data-motion-armed`), `motion-group.js` sets
`data-motion-groups-booted` (paired with `data-motion-builtins`). The check runs
on a script `error`, on `window.load`, and behind a 20s backstop — whichever
comes first. Not on `DOMContentLoaded`: WebKit has been seen running module
scripts after it, which would disarm the prestage while the runtime was still
on its way.

**The start state lives in CSS only.** The runtime never computes where an
animation begins; it puts the element on a generated rule with
`data-motion-from` and animates to the end state, reading its own start from the
DOM. That is why `--motion-distance` can be scoped to a section or a list, in
any unit CSS understands — `calc()`, `em`, `vh` — and why an element left
carrying `data-motion-from` is invisible: the rule holds it at `opacity: 0` and
only the runtime takes it off.

**An animated element may not carry a static `transform`.** It follows from the
rule above, and it is the one way that rule bites. An element has exactly one
`transform`, so a stylesheet rule that sets one on a cell competes with the
start state for the same property — and any selector with more specificity than
`[data-motion-armed] [data-motion-from='…']` (0-2-0) simply wins. The failure is
silent in a way worth naming: `opacity: 0` still comes from the prestage rule,
so the element still fades, the entrance just travels **zero** distance. Nothing
throws, and every `yarn check-*` stays green.

Measured on `flex-carousel`, whose cells are the slide roots: a house rule,
`.flex-carousel .swiper-backface-hidden .swiper-slide-custom { transform:
translateZ(0) }` (0-3-0), flattened `slide-in-end` to a bare fade — but only on
desktop, because Swiper sets that class on init and is torn down below the
breakpoint. If an entrance moves on one viewport and not the other, that
asymmetry is the fingerprint: something initialises there and brings a
transform with it.

`FoxTheme.motion.inspect()` reports this as `transformDefeated`. Before this
system the runtime wrote the start state inline, which outranked every
stylesheet, so a conflicting rule could sit there for years doing nothing
visible. Expect to find more of them.

**An interruption must cancel the animation, not just its continuation.**
`@theme/animation` is a vendored wrapper around the browser's own Web Animations
API, not a second engine — measured, an animation it creates appears in
`element.getAnimations()` as the same `Animation` class `element.animate()`
returns, with a native `KeyframeEffect`. Which means it obeys the same cascade
rule: **a running animation outranks inline styles.** Invalidating a run token
stops the continuation; the animation keeps painting, straight over whatever
start state the next run writes. Keep the handle and `cancel()` it.

Everything animates through Motion — including `TabsComponent`, which used to
call WAAPI by hand and was the one place with different cancel semantics. That
split is what let this bug hide.

One trap: the object `animate()` returns is the library's wrapper, not the
native `Animation`, and it reports only its own keys. `'cancel' in controls` is
**false** while `controls.cancel` is a function — feature-detect with `typeof`,
or simply call it.

**`motion-component` leaves its end state inline, on purpose. Do not put a
`position: fixed` or `position: absolute` element inside one.** When it finishes,
the commit leaves `opacity: 1; transform: translateY(0px)` (or `scale(1)`) on the
element for good — measured, 8 of 8 elements that had run on the home page. A
transform other than `none` makes that element the **containing block** for every
`fixed` and `absolute` descendant, and a stacking context on top of that.
Measured on a 1440×900 page: a `position: fixed` overlay meant to be fullscreen
renders **1316×208 inside the card** instead of 1480×940 at the origin, and an
`absolute` badge sits 40px right and 60px low. `motion-group` clears its inline
styles for exactly this reason; `motion-component` does not, and that difference
is a deliberate trade — see the LCP table under "Above the fold". If you need a
positioned descendant, give the nearest wrapper INSIDE the component its own
`position: relative`, so the layout does not depend on which preset the merchant
picked (`fade-in` carries no transform at all, and neither does reduced motion).

**Test the trajectory, not the end state.** A motion test must sample over
`requestAnimationFrame` and assert the value passed through the middle. An
end-state assertion cannot tell "animated correctly" from "jumped", and a
12-replay stress test passed for a while against a bug where nothing animated
at all.

---

## Policies applied automatically

**Above the fold.** Decided **per element**, on the first intersection entry it
ever receives. The observer delivers that entry as soon as the element is
observed, and it reports whether the element was on screen at that moment — so
the answer costs zero `getBoundingClientRect()` calls. An element that keeps
coming into view later is not re-evaluated; only its first entry counts.

It buys one thing: a component **skips waiting for its images** — a blank hero
for a second is worse than an image landing a moment late. It no longer changes
any duration: the first thing on screen arrives with the same gesture as
everything after it (a shortened first paint read as a different, hurried
animation from the rest of the page). A group plays the list rhythm either way.

This describes the **first paint only**. `replay()` and `updatedCallback()`
clear the flag on both kinds, so a slide the visitor clicked to, a tab they
opened, a filter they applied or a morphed section plays the merchant's own
settings.

**What it actually buys is perception, not LCP.** The rule used to be justified
by "an element at `opacity: 0` cannot be counted as contentful paint, so finish
it sooner". Measured in Chrome 151 — same page, same 400ms start, only the
duration varying — that does not hold:

| entrance                            | inline end state  | element becomes LCP |
| ----------------------------------- | ----------------- | ------------------- |
| none (prestage simply dropped)      | –                 | 436ms               |
| opacity only, 0.3s                  | cleared           | 732ms               |
| opacity only, 0.75s                 | cleared           | 1176ms              |
| opacity + transform (fade-up), 0.6s | **left in place** | **never**           |
| opacity + transform, 0.6s           | cleared           | 1036ms              |
| opacity + transform, 1.5s           | cleared           | 1928ms              |

An element is not an LCP candidate while an opacity animation is attached to it,
and with a transform animation running alongside — fade-up, the default — it
never becomes one again, because the committed inline end state means nothing
repaints it afterwards. `motion-group` clears those styles when it finishes;
`motion-component` does not. So today the duration is worth what the visitor
sees and **nothing to the metric**.

**Making `motion-component` clear them was considered and rejected — do not
"fix" it without reading this.** Clearing would buy the measured ~890ms of real
LCP and would remove the leftover transform whose consequences are listed under
"Rules that are not negotiable". It was turned down because the cost is certain
and the benefit is insurance: on a page whose largest above-the-fold element sits
inside a `motion-component`, the reported LCP moves from a smaller earlier
element to the end of that entrance, and a merchant's **Animation delay** setting
starts counting against Core Web Vitals directly (0.8s of delay on a hero =
0.8s of LCP). Against that, the leftover transform costs nothing today: swept
across the home and collection pages after forcing every component to run, **0 of
156 nodes** move when the inline styles are dropped, and there are no `fixed`
descendants inside any of them. Revisit if that sweep ever stops returning zero.

There is one widening, and it only ever widens: while the initial render is
still in progress (before `load`), an element that comes into view is upgraded
to above-the-fold even if its first entry said otherwise. That covers the case
where an element registers before the layout around it has settled — a carousel
above it still initialising, an image without a resolved height.

Both halves exist because the rule used to be "arrived in the observer's first
BATCH", which made the answer depend on which frame an element happened to
register in. With a slideshow at the top of the page that is not stable: the
same URL produced **0, then 1, then 9** flagged elements across three reloads,
crediting the slideshow on one load and a section below it on another. Per
element plus the load window is stable — three consecutive reloads now flag the
same 8 elements, all in the slideshow, matching exactly the 8 that are genuinely
on screen.

That determinism matters more than the tuning it controls. A policy that
silently changes what it does on every reload cannot be reasoned about, and a
merchant cannot file a bug against it.

Both the flag and its consequences are inspectable — see **Debugging** below.

A group cascades **only the cells on screen**, one `--motion-stagger` apart;
the cells below the fold animate together once that cascade has played. A group
is one animation for the whole list and starts when the **group** enters the
viewport, so an uncapped cascade over a 48-card grid scheduled its last card
seconds out and a visitor scrolling on met cells still waiting their turn. Only
cascading what is visible keeps the rhythm for what the visitor watches and
settles the rest right behind it — no budget, no step divided down.

**Small screens** (below 768px): only the list tokens come down —
`--motion-list-distance`, `--motion-list-duration` and `--motion-stagger`. A
reveal keeps its full duration and distance on every viewport. The runtime reads
the same tokens the prestage CSS does, so the two cannot disagree.

Kinds are swapped out automatically only when that cannot make the start state
harsher. An earlier version stepped every `cost: "high"` preset down to a plain
fade on mobile; measured, that made the hero start at `opacity: 0` rather than
simply being there, because zoom-out carries no opacity at all. The rule now
only fires for a preset that is expensive _and_ already fades: zoom-in (which
grows from transparent) becomes fade-in on a phone, zoom-out keeps its zoom.

A preset may still choose its own small-screen kind with `mobile`, which is an
authoring decision — "slide on desktop, fade on a phone" — and outranks that
automatic step-down:

```js
"brand-slide": { staged: "self", from: { x: -1 }, mobile: "fade-in" },
```

`registerMotionPreset()` rejects an alternative that is not registered, or that
is the preset itself. It does **not** reject one that fades where this preset
does not: the harshness rule belongs to the AUTOMATIC step-down, and `mobile` is
the author overriding it on purpose. The cost is still real, just yours to weigh
— an element that animates opacity is never a largest-contentful-paint
candidate, so a phone fade belongs on a panel beside the hero, not on the hero
image itself. For a
preset in the **core** registry the generated CSS follows with no extra work,
because the generator picks which mobile rules to emit by calling
`motionPresetForViewport()` — the same function the runtime uses.

The stagger gets **quicker, not switched off**. A mobile list is not always a
stacked grid — with `enable_swipe_on_mobile` the same cells become a horizontal
row with two or three visible at once, and the cascade is the whole point there.

**Reduced motion.** `_motion-reduced.scss` clamps every transition and animation
theme-wide, and `data-motion-essential` exempts the handful of things where the
animation IS the content (marquee, spinners).

What the floor clamps is **duration**. Never re-state a duration per component —
that is what it is for. But a duration clamp cannot express everything, and five
components legitimately still carry a `reduce` block:

- a **custom property** another layer reads (`--dialog-duration`,
  `--tooltip-sheet-duration`) — the floor sets `transition-duration`, it cannot
  reach inside a variable a component or a script computes with;
- an **end state**, where the honest reduced-motion answer is not "the same
  movement, faster" but "no movement" (`transform: scale(1) !important` on a
  tooltip).

So: reach for a component block only when the floor provably cannot express it,
and say which of those two cases it is in a comment.

---

## Commands

|                              |                                               |
| ---------------------------- | --------------------------------------------- |
| `yarn motion:build`          | regenerate the prestage CSS from the registry |
| `yarn motion:manifest`       | regenerate `.motion-manifest.json`            |
| `yarn check-motion-prestage` | prestage CSS matches the registry             |
| `yarn check-motion-presets`  | every `data-motion="…"` names a real preset   |
| `yarn check-motion-easing`   | opacity transitions use an easing token       |
