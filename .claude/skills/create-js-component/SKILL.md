---
name: create-js-component
description: Use when creating a NEW JavaScript custom element / Web Component in src/js/modules/ (extends the Component base class; uses refs, ThemeEvents, AbortController). For "create/add a new JS component/module/custom element". To fix or refactor an existing module, use review-and-refactor instead.
---

# Create JavaScript Component

## When to use
- Creating a new file in `src/js/modules/`
- Adding a new custom element to the theme
- NOT for fixing or modifying an existing module → use `review-and-refactor`

## Every new JS module is a standalone file
Always create a separate file in `src/js/modules/` — never add new components directly into `theme.js` or `modules.js`. After building, add a `<script>` tag in `snippets/scripts.liquid`.

## Workflow

### Step 1: Create the file
`src/js/modules/{component-name}.js` — kebab-case.

### Step 2: Component template

```javascript
import { Component } from "@theme/component";
import { ThemeEvents } from "@theme/events";

/**
 * @capability One sentence: what behaviour this ships (concrete — the visual/interaction outcome).
 * @when When a builder should reuse this instead of writing new JS; name the pairing _component-*.scss if any.
 * @contract The markup the code expects: element tag, required refs/child classes/data-attrs.
 * @keywords comma, separated, behaviour, vocabulary, a builder would grep for
 * @template {import('@theme/component').Refs} [Refs = {}]
 * @extends Component<Refs>
 */
export class ComponentName extends Component {
  /** @type {AbortController} */
  #controller = new AbortController();

  connectedCallback() {
    super.connectedCallback(); // ALWAYS first
    const { signal } = this.#controller;

    this.addEventListener("click", this.#handleClick, { signal });
    // ThemeEvents: use constants, never hardcode string
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate, { signal });

    this.#init();
  }

  #init() {
    // initialization logic
  }

  #handleClick = (/** @type {MouseEvent} */ event) => {
    // handle click
  };

  #handleCartUpdate = (event) => {
    // handle cart update
  };

  updatedCallback() {
    super.updatedCallback?.(); // call super if exists
    this.#init(); // re-init after Section Rendering API update
  }

  disconnectedCallback() {
    this.#controller.abort(); // cleanup FIRST
    super.disconnectedCallback(); // then super
  }
}

if (!customElements.get("component-name")) {
  customElements.define("component-name", ComponentName);
}
```

### Step 3: Refs system

**In Liquid:**
```html
<component-name>
  <button ref="triggerButton" on:click="/handleClick">Open</button>
  <div ref="panel">Content</div>
  <div ref="items[]">Item 1</div>
  <div ref="items[]">Item 2</div>
</component-name>
```

**In JS:**
```javascript
const { triggerButton, panel, items } = this.refs;
// items is HTMLElement[]
```

Required refs (throws if missing at connect):
```javascript
requiredRefs = ["triggerButton", "panel"];
```

**A `ref` belongs to the nearest `-component` ancestor, not to the component you wrote it for.** `getClosestComponent` matches `instanceof Component` **or** any tag whose name ends in `-component`, and refs are collected only when that nearest match *is* the collecting component. So wrapping part of your markup in `<motion-component>` (or any other `*-component`) silently reassigns every `ref` inside it to the wrapper.

- Symptom: `MissingRefError: Required ref "x" not found`, or a `requiredRefs` array that is quietly short. Confirm by reading `wrapper.refs` in the console — the refs will be sitting on the wrapper.
- It is **intermittent**. Before the wrapper upgrades, the name-based match still resolves to the outer widget and everything works; the refs detach only after upgrade. One passing render is not evidence.
- Keep `ref=` elements outside animation/layout wrappers. If the markup genuinely has to nest, reach the element by **tag name or `data-*`** instead — both are allowed by the DOM contract, which bans *class* selectors, not all selectors.

### Step 4: Event binding

**Declarative (preferred for child elements):**
```html
<button on:click="/handleClick">Click</button>
<button on:click="#dialog-id/showDialog">Open dialog</button>
```
Format: `on:event="[selector/]methodName"` — a `#id` selector resolves **document-wide** (`document.querySelector` — which is why the dialog example above works without the dialog being an ancestor); any other selector resolves to the **closest matching ancestor** (`element.closest`); no selector = closest Component ancestor.

**Imperative (for ThemeEvents, document-level, external):**
```javascript
this.addEventListener(ThemeEvents.variantUpdate, this.#handle, { signal });
document.addEventListener(ThemeEvents.cartUpdate, this.#handle, { signal });
```
Always pass `{ signal }` — cleanup is automatic via `#controller.abort()`.

**Delegation gotchas (both are real bugs, not theory):**
- **`on:click="/method"` (empty selector) binds to the CLOSEST `Component` ANCESTOR — not the element the attribute sits on.** If that element is *inside* another custom element extending `Component` (e.g. a button inside `<video-card>`), the click routes to that inner element (which has no `method`) → silent no-op. Fix: **qualify** it — `on:click="my-element/method"` → delegation does `target.closest('my-element')`.
- **In a delegated handler, `event.currentTarget` is `document`, NOT the bound element.** The base uses one document-level capture listener; only `event.target` is the proxied element (or a descendant). Reading `event.currentTarget.dataset` → `document` (wrong). Fix: `const el = event.target.closest('[data-...]')`, then read from `el`.

### Step 5: Lifecycle rules (critical)

| Lifecycle | Rule |
|-----------|------|
| `connectedCallback` | `super.connectedCallback()` **FIRST**, then your code |
| `disconnectedCallback` | cleanup (abort, disconnect observers) **FIRST**, then `super.disconnectedCallback()` |
| `updatedCallback` | called by Section Rendering API after re-render; re-init state; call `super.updatedCallback?.()` |

**Reconnect-safety:** a one-time `#controller = new AbortController()` **class-field** initialiser runs ONCE at construction. If the element can be **detached and re-attached** (a slide a carousel/Swiper re-parents, a node moved into a dialog), `disconnectedCallback` aborts it and `connectedCallback` re-adds listeners bound to the **already-aborted** signal → they never fire. If your component may be re-parented, **recreate the controller at the top of `connectedCallback`** (`this.#controller = new AbortController()`) before binding. (Note: Swiper with `loop:false` on already-correct `.swiper > .swiper-wrapper > .swiper-slide` SSR markup does NOT re-parent — verify reconnect actually happens before adding this; it's often unnecessary.)

### Step 6: Available @theme imports

```javascript
// Core
import { Component } from "@theme/component";
import { ThemeEvents, VariantUpdateEvent, CartUpdateEvent, CartAddEvent } from "@theme/events";
import { requestIdleCallback, debounce, isMobileBreakpoint, getLenis, fetchConfig, formatCurrency, prefersReducedMotion, isTouch, isRTL } from "@theme/utilities";

// UI
import { DialogComponent } from "@theme/dialog";
import { CarouselComponent } from "@theme/carousel";
import { morph } from "@theme/morph";
import { inView, animate, scroll } from "@theme/animation";
import { imageCoordinator } from "@theme/image-coordinator";
import { motionCoordinator } from "@theme/motion-coordinator";

// Section Rendering — NAMED exports only (there is no default export)
import { sectionRenderer, morphSection } from "@theme/section-renderer";
```

Full list in `snippets/scripts.liquid` importmap.

### Step 7: Register in scripts.liquid

After `yarn copy:js`, add a `<script>` tag in `snippets/scripts.liquid`:

```liquid
{% comment %} Conditional (preferred — only load when needed): {% endcomment %}
{% if template.name == 'product' %}
  <script src="{{ 'component-name.js' | asset_url }}" type="module" fetchpriority="low"></script>
{% endif %}

{% comment %} Always loaded: {% endcomment %}
<script src="{{ 'component-name.js' | asset_url }}" type="module" fetchpriority="low"></script>
```

If other modules `import` this module via `@theme/`, also add to the importmap:
```liquid
"@theme/component-name": "{{ 'component-name.js' | asset_url }}",
```

### Loading / busy state — reuse theme conventions, don't reinvent

When an action triggers an async fetch (Section Rendering API, cart), put the button into the theme's standard loading state instead of building your own spinner:
- Markup ships a `loading-spinner` child inside the button (`{% render 'loading-spinner', size: 'small' %}`).
- Toggle the theme class `btn--loading` — it hides the label/icon and reveals the spinner via CSS; no manual show/hide needed.
- **Also set `disabled`** (not just the class) so a click mid-fetch can't fire with stale state, and set `aria-busy="true"` for a11y. Clear all three when the fetch resolves.

```javascript
#setLoading(loading) {
  const { submit } = this.refs;
  if (!submit) return;
  submit.classList.toggle("btn--loading", loading);
  submit.disabled = loading;                 // visual state alone is not enough
  loading ? submit.setAttribute("aria-busy", "true") : submit.removeAttribute("aria-busy");
}
```

### Carousel nav outside the carousel — guard `params.loop` yourself

Arrows that live outside a `<carousel-slider>` are invisible to Swiper's Navigation module, so your component owns their disabled state. `swiper.isBeginning` / `swiper.isEnd` are **not** safe to read on their own: they are computed from translate (`swiper-core.mjs` `updateProgress`), and the `if (params.loop)` branch there only touches `progressLoop` — it never clears them. A looping carousel still reports an end, and `translatesDiff === 0` reports **both**.

Mirror what Swiper's own Navigation module does (`modules/navigation.mjs:63-67` short-circuits on `params.loop` and force-enables both buttons):

```javascript
#updateArrows(swiper) {
  const { prev, next } = this.refs;
  const loop = Boolean(swiper.params?.loop);

  if (prev instanceof HTMLElement) prev.toggleAttribute("disabled", !loop && swiper.isBeginning);
  if (next instanceof HTMLElement) next.toggleAttribute("disabled", !loop && swiper.isEnd);
}
```

Unguarded this is worse than a cosmetic slip: the native `disabled` attribute blocks the click that would produce the next `slideChange`, and `slideChange` is usually the only thing that recomputes the state — so the arrow stays dead until something else moves the carousel.

### A user-facing pause needs your own flag — `autoplay.pause()` undoes itself

`swiper.autoplay.pause()` means "pause until the carousel next moves", not "pause". Under `waitForTransition` (Swiper's default) it registers a one-shot `transitionend` on the wrapper that calls `resume()` (`modules/autoplay.mjs:153` and `:42-50`), so the next slide change — including one the user made by tapping another item or an arrow — restarts the countdown, and `autoplay.paused` flips to `false` with it. Reading that flag back therefore cannot tell you whether the *merchant* asked for a pause.

Keep the intent yourself and re-assert it when Swiper resumes behind your back:

```javascript
#userPaused = false;

#onAutoplayResume = () => {
  if (!this.#userPaused) return;
  const swiper = this.carousel?.swiperInstance;
  if (!swiper || swiper.destroyed) return;
  swiper.autoplay?.pause();
};
```

Bind it next to your other Swiper listeners (`swiper.off(…)` then `swiper.on("autoplayResume", …)`, the same off-then-on idiom that keeps re-binding idempotent), and toggle `#userPaused` rather than reading `autoplay.paused`.

Reach for `stop()` only if you do not mind losing the countdown: it dodges the transitionend, but it resets `timeLeft`, so any progress indicator driven by `autoplayTimeLeft` snaps back to empty. Re-pausing from `autoplayResume` costs nothing by comparison — `resume()` stamps `autoplayStartTime` just before it emits, so the immediate re-`pause()` recomputes the same remaining time and the indicator holds still.

**Both of the above are the same lesson twice:** Swiper's derived state and lifecycle methods are named semantically and behave mechanically. Before building behaviour on `isBeginning`/`isEnd`, `autoplay.paused`, `activeIndex` or `translate`, open `node_modules/swiper` and read the code that produces the value — and assert the state you asked for still holds a few hundred ms after the interaction, not immediately.

### Step 8: Performance

```javascript
// Non-critical init
import { requestIdleCallback } from "@theme/utilities";
requestIdleCallback(() => { this.#expensiveInit(); });

// Lazy import
async #loadHeavyModule() {
  const { SomeModule } = await import("@theme/some-module");
  return SomeModule;
}

// Debounce expensive handlers
import { debounce } from "@theme/utilities";
#handleResize = debounce(() => { ... }, 200);
// Cancel in disconnectedCallback: this.#handleResize.cancel?.()
```

## Checklist
- [ ] File created: `src/js/modules/{name}.js`
- [ ] **`@capability` JSDoc block above the class** (`@capability` + `@keywords` required; `@when`/`@contract` strongly encouraged) — `yarn map` extracts it into PROJECT-MAP §0; a module without it is invisible to every future builder's reuse check
- [ ] Extends `Component` from `@theme/component`
- [ ] `super.connectedCallback()` called FIRST in `connectedCallback`
- [ ] `#controller = new AbortController()` declared
- [ ] All `addEventListener` calls pass `{ signal }`
- [ ] `disconnectedCallback`: cleanup FIRST, then `super.disconnectedCallback()`
- [ ] `updatedCallback` implemented if component lives in a re-renderable section
- [ ] `customElements.define` guarded with `!customElements.get(...)`
- [ ] `<script>` tag added to `scripts.liquid` (conditional if possible)
- [ ] `yarn copy:js` run after file creation
- [ ] `yarn check-js-contract` passes (no new class selectors — the DOM-access contract CI enforces)
- [ ] **Interaction wiring paired**: every `on:*` handler in the markup has its method on the target component class; every `this.refs.<name>` read has a `ref="<name>"` in markup (check the `-markup` snippet too); inline JSON configs parse — L1 audits exactly this
- [ ] `yarn map` run after adding to scripts.liquid
