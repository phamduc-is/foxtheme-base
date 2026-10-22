---
name: review-and-refactor
description: Use when fixing a bug, refactoring, optimizing, or EDITING an existing theme file (section, block, snippet, JS module, SCSS) without creating something new. The safe-edit workflow — read-before-edit, minimal change, convention + hard-rule checklist. For "fix/debug/refactor/edit/optimize X". For a read-only audit that only reports (no edits), use the diff-reviewer agent.
---

# Review and Refactor

## When to use
- Fixing a bug in an existing section, block, snippet, JS component, or SCSS file
- Reviewing code for correctness or convention compliance
- Refactoring: renaming, restructuring, simplifying — without adding new features
- Removing dead code, reducing specificity, cleaning up SCSS

## Workflow

### Step 1: Read before touching

Read the target file in full before proposing any change. Also read its related files:

- **Section/Block:** read its SCSS file and any `-markup` snippets it delegates to
- **Snippet:** read a caller to understand usage context
- **JS component:** read `snippets/scripts.liquid` to check load conditions and `@theme` importmap entry

**Also read the file's recent history** — another developer may have changed it for a reason that isn't obvious from the current code (and their notes aren't in your local memory). Surface their intent before editing:

```bash
git log --oneline -8 -- <file>      # recent commits touching this file (read the messages)
git log -p -5 -- <file>             # see what those commits actually changed
git blame -L <start>,<end> <file>   # who/why for the exact lines you'll touch
```

If a recent commit message or an inline comment flags something important about the part you're changing, respect it — don't undo a deliberate fix.

### Step 2: Check impact radius

Who uses this file? Check before touching:

```bash
# Snippet usage
grep -r "render 'snippet-name'" sections/ blocks/ snippets/

# Section in templates
grep -r "section-name" templates/

# JS custom element tag
grep -r "custom-element-tag" sections/ blocks/ snippets/

# SCSS class name — also check JS (class name may match a custom element)
grep -r "class-name" sections/ blocks/ snippets/ src/js/
```

Or check **PROJECT-MAP.md** — it indexes all snippet callers, section→template, JS tags, and `@theme` imports.

Changing a snippet propagates to every caller. Changing a base JS class propagates to all subclasses.

**Adding a value to an existing `select` has an impact radius too — inside the file.** The greps above find who uses the *file*; they will not find who reads the *setting*. Every `if settings.foo == '...'` branch is a reader that silently falls through for a value it has never heard of, and Liquid has no exhaustive-match warning. Before adding an option, enumerate the readers:

```bash
# every reader of the setting, not just the one you are editing
grep -rn "settings.width" blocks/ sections/ snippets/ src/js/
```

Then confirm each one either handles the new value or provably does not care. Watch especially for a **second** consumer of the same setting in the same file — a `sizes`/`srcset` computation, a `style` capture, a class name — because the primary sink is usually already correct and hides it. A reader that falls through renders *plausibly*, so no check catches it.

**Setting a property on a third-party library's options object has an impact radius inside `node_modules`.** `swiper.params.foo = true` is not a local flag: every call site in the vendor that reads `params.foo` changes behaviour — including the ones *you* call. None of the greps above can see them, so grep the vendor:

```bash
# every reader of the vendor flag you are about to set
grep -rn "preventInteractionOnTransition" node_modules/swiper/
```

That one returns three readers: `onTouchStart` (the intended gate), `translateTo`, and `slideTo` — where passing `internal: true` does **not** exempt it. So a component that sets the flag to block user input during a transition, and elsewhere repositions itself with `swiper.slideTo(...)`, has silently disabled its own reposition; the call returns `false` and the state it was restoring stays broken until the next event happens to fix it. Enumerate the readers before patching. If only one path should be gated, save and restore the flag around your own call rather than leaving it set — and make the comment name every reader you found, not the one you assumed.

**Restore it in a `finally`, not on the next line.** A bare save / call / restore looks correct and leaks the flag permanently the first time the call throws. The vendor call is not a leaf: a synchronous `swiper.slideTo(target, 0, …)` runs `updateSlidesClasses()` — which your own component may have monkey-patched — plus `beforeTransitionStart` / `transitionStart` / `transitionEnd`, each emitting to arbitrary theme listeners. One throw down there and the flag stays flipped for the lifetime of the instance, silently disabling the behaviour you patched it in to build, with nothing to heal it. Anything else the same block resets (`allowSlideNext`, an `#isSyncing` guard, a saved `snapGrid`) belongs in that `finally` too — the same throw skips those lines as well.

### Step 3: For bugs — identify root cause first

Do not jump to fixing before understanding why it breaks. Work through this:

1. **Reproduce** — what exact action triggers the bug? (page load, variant change, scroll, theme editor interaction?)
2. **Locate** — which file/function is responsible? Check console errors, check network requests if relevant.
3. **Root cause** — common causes by type:

**JS bugs:**
- Missing `updatedCallback` — component lives in a re-renderable section but doesn't reinitialize after Section Rendering API swaps HTML
- Stale refs — `this.refs.x` accessed after DOM replaced; re-fetch in `updatedCallback`
- Event listener not cleaned up — missing `{ signal }` or observer not disconnected
- Wrong lifecycle order — code runs before `super.connectedCallback()` finishes setting up refs

**Liquid bugs:**
- Boolean param missing `allow_false: true` — `false` passed but treated as `nil`
- `render` scope isolation — variable defined outside not available inside snippet
- `forloop` limit — array >50 items silently truncated without `{% paginate %}`
- **Dead setting** — a setting whose value never reaches output. Common cases: (a) `border_opacity` does nothing once a **custom** `border_color` is set, because `border-style` only applies opacity to the *scheme* border color — fold them with `{{ settings.border_color | color_modify: 'alpha', border_alpha }}`; (b) an emitted CSS var (e.g. a `custom` `type_preset`'s `--font-size`) with no class consuming it. Trace every setting from schema → Liquid → CSS/markup; if a path dead-ends, it's a bug.
- **Dead output — and the half-fix it invites.** The mirror image of a dead setting: an element that IS rendered while the feature filling it is switched off (a `carousel-controls` counter slot next to `"counter": false`). It shows up as an empty box, so it reads as "broken, needs turning on". Ask which half is wrong BEFORE fixing: does this element belong here at all? A counter alongside an option literally named "Arrows + dots" did not — every other caller pairs `combined: 'counter'` with `pagination: 'none'`, because the counter REPLACES the dots. Turning the flag on made a slot nobody had designed suddenly visible in production. Corollary: whatever sits downstream of a permanently-broken value has never actually been reviewed, so treat making it live as a new change, not as a fix.
- **Stale gate** — a branch renders when its feature is switched off, because it is gated on a setting that `visible_if` merely HIDES. Hiding a setting does not reset it, so the stored value keeps the branch alive: a block switched from Carousel to Grid still read `controls_position == 'header'` and drew arrows over a plain grid. Trace the gate to the condition the merchant actually changed, not to the nearest setting that correlates with it — and check every setting whose `visible_if` names the setting you are branching on. Fails silently: no error, no check, and the leftover element usually renders in a plausible place.

**SCSS bugs:**
- Specificity conflict — another rule with higher specificity overrides; check with browser devtools
- CSS variable not set — `var(--x)` falls back to nothing because the variable is never defined on the element
- **Vendor state class with no rule** — a library toggles a class and nothing happens, because the library's own stylesheet is not linked. Swiper is the live example: `assets/swiper.css` is built but never referenced, `snippets/critical-css.liquid` is the copy the storefront actually loads, and it is a partial transcription. So `swiper-button-lock` / `swiper-pagination-lock` (added whenever `watchOverflow` — on by default — decides every slide already fits) styled nothing, and locked arrows stayed visible and dead. Before assuming a library class works, grep `critical-css.liquid` for it; if it is missing, write the rule in the matching `_component-*.scss`. Same applies to any future vendored library whose CSS is transcribed rather than linked.
- **`hidden` plus a responsive display utility is not "hidden"** — `class="hidden md:flex"` reads as off-by-default-until-JS, and is the opposite from 768px up: `_helpers.scss` emits `.md\:flex` after `.hidden` at the same specificity (0-1-0), so the later rule wins inside its media query. Treat that pair as "hidden on mobile, shown on desktop", which is what it means. If an element must genuinely start hidden and be revealed by JS, gate it in Liquid so it is not rendered at all, or use a state class the JS owns — never rely on `hidden` being beaten back by a class that is already beating it.

4. **Fix the root cause** — not the symptom.

### Step 4: Minimal, targeted change

- Fix only the stated problem. Do not refactor surrounding code.
- Do not rename variables, add comments, or reorganize structure unless that IS the task.
- Do not add error handling or fallbacks for scenarios that cannot happen.
- Do not add features or abstractions beyond what is asked.

### Step 5: Validate

Run the relevant command after each change:

| Changed | Command |
|---------|---------|
| Liquid file edited (any) | `yarn check-liquid --files <relative-path>` — MANDATORY (CLAUDE.md Liquid workflow) |
| Schema keys (add/rename) | `yarn check-missing-translate` |
| Section/block deleted | `yarn clean-template-refs` → `yarn check-template-refs` |
| Files added or renamed | `yarn map` |
| JS module | `yarn copy:js` |
| SCSS | `yarn build:css` → `yarn lint:css` |

### Step 6: Verify the fix

State how to test after the change — do not leave this implicit:

- **JS fix:** reload page → trigger the action that caused the bug → confirm behavior; also test in theme editor (`Shopify.designMode = true`) if component is editor-interactive
- **Liquid fix:** reload the relevant page/template; if schema changed, check theme editor renders correctly
- **SCSS fix:** `yarn build:css` passes → visually confirm in browser at mobile + desktop breakpoints
- **Section Rendering API:** if the fix involves re-render, trigger a variant change or section reload to confirm `updatedCallback` runs correctly

---

## Performance review

When reviewing or refactoring a file, scan for the items below. Fix **Critical** immediately; fix **Should fix** when already touching the file.

### Critical — fix when found

| Issue | Why | Fix |
|-------|-----|-----|
| LCP image has `loading="lazy"` | Delays largest contentful paint | Remove `loading="lazy"` on hero/banner images; add `fetchpriority="high"` |
| Image missing `width`/`height` or `aspect-ratio` | Causes layout shift (CLS) | Always set dimensions or use `aspect-ratio` in CSS |
| Heavy sync work in `connectedCallback` | Blocks main thread, hurts INP | Move to `requestIdleCallback` or `#init()` called async |

### Should fix — improve when already touching the file

**JavaScript:**
- Non-critical init not wrapped in `requestIdleCallback` → wrap it
- JS module loads on every page but only needed on one template → make conditional in `scripts.liquid` (`{% if template.name == '...' %}`)
- Heavy module imported at top-level → use lazy `async import()` instead
- Resize/scroll handler missing debounce → add `debounce()` from `@theme/utilities`; cancel in `disconnectedCallback`

**CSS:**
- Section-specific stylesheet loaded globally (in `theme.css`) but only needed on one template → convert to lazy: `<link media="print" onload="this.media='all'">` at top of section file

**Liquid:**
- Large collection/array looped without `{% paginate %}` → add pagination if >50 items

---

## Hard rules

### Liquid
- Never mix section blocks and theme blocks in the same section
- `{% render %}` name must be a quoted string literal, never a variable
- `{{ block.shopify_attributes }}` must stay on root element of every block
- Boolean snippet params must use `allow_false: true` — otherwise `false` is treated as `nil`
- A file that does `assign settings = block.settings` must read any **global** theme setting (`settings.animations_enabled`, …) into another variable **before** that line — after it, `settings` is the block's own settings, the global read is nil, and the guard silently passes
- All schema `name`, `label`, `content`, `options[].label` must use `t:*` keys — no hardcoded strings
- `spacing-style` and `border-style` snippets must be applied on every **content** section/block root (overlay/headless sections — cart-drawer, quick-view, popup, search-drawer, the `section-rendering-*` endpoints — legitimately have neither)

### JavaScript
- `super.connectedCallback()` must be the FIRST call in `connectedCallback`
- `this.#controller.abort()` must be FIRST in `disconnectedCallback`, before `super.disconnectedCallback()`
- Never hardcode ThemeEvent string names — always use `ThemeEvents.*` constants
- Every `addEventListener` call must pass `{ signal }` from the component's AbortController
- `IntersectionObserver`, `MutationObserver`, `ResizeObserver` — cannot use signal; must call `.disconnect()` explicitly in `disconnectedCallback`
- Debounced handlers — call `.cancel?.()` in `disconnectedCallback` to prevent post-unmount execution
- `updatedCallback` is required when the component lives inside a section that uses Section Rendering API — re-init state, re-fetch refs if needed
- **Interaction wiring stays paired across files** — every `on:click="/method"` (and other `on:*`) in the markup must have a matching method in the component class, and every `this.refs.<name>` the JS reads must have a `ref="<name>"` in the markup (check BOTH files when editing either — the markup often lives in a `-markup` snippet). An edit that renames a method/ref on one side silently orphans the other: the button does nothing, no error thrown.
- Inline JSON configs (e.g. a carousel's config attr/script) must still parse after the edit, and their keys must match what the consuming module reads

### SCSS
- Max specificity 0-1-0. Bumping a selector? Check the whole rule.
- No hardcoded colors — always `rgb(var(--color-xxx))`
- When removing a class from `:not()`, replace with another argument to preserve specificity — do not delete `:not()` entirely
- Section divider `// ─── Name ─────────────────...` required at top of each logical group
- No `!important` unless overriding third-party or Shopify inline styles — document with a comment explaining why

---

## Checklist
- [ ] Full target file read before changes proposed
- [ ] Recent history of the file checked (`git log -8 -- <file>` / `git blame` on touched lines) — don't undo another dev's deliberate change
- [ ] Impact radius checked (PROJECT-MAP.md or grep)
- [ ] Bug: root cause identified before fixing (not just symptom)
- [ ] Change is minimal — only what the task requires
- [ ] No extra features, abstractions, or cleanup added
- [ ] JS: `updatedCallback` present if component is in a re-renderable section
- [ ] JS: observers (Intersection/Mutation/Resize) disconnected in `disconnectedCallback`
- [ ] JS: debounce handlers cancelled in `disconnectedCallback`
- [ ] Liquid: `allow_false: true` on boolean params
- [ ] Liquid: all schema text uses `t:*` keys
- [ ] Validation command run for the file type changed
- [ ] `yarn map` run if files were added or renamed
- [ ] If core JS module API changed (renamed function, changed signature, new usage pattern): `grep -r "old-name" .claude/skills/` and update any stale skill files
- [ ] Verified the fix works (stated how to test)
- [ ] Performance: no LCP image lazy-loaded, all images have dimensions
- [ ] Performance: heavy init uses `requestIdleCallback`, resize/scroll uses debounce
- [ ] Performance: JS loaded conditionally by template if not needed globally
- [ ] Performance: section-specific CSS lazy-loaded, not bundled in theme.css
