# FoxTheme Base

## Project Overview

SSR-first FoxTheme base theme. Liquid renders HTML, JavaScript enhances progressively. Targets Shopify Theme Store submission standards.

---

## Agent Skills — organized by theme lifecycle phase

Skills live in `.claude/skills/` and Claude **auto-selects** them by their `description` — you do not need to @-mention them. The toolkit is organized around the **theme lifecycle** (full map + per-phase details: `.claude/USAGE.md`):

```
P0 Bootstrap → P1 Break design → P2 Build → P3 Review/merge → i18n gate → P4 Demos → P5 Submit → P6 Post-launch (loops to P2)
```

| Phase | Intent | Tool |
|------|------|-------|
| **P0** | Bootstrap a NEW child theme fork (remotes, merge drivers, CHILD.md, envs) | `/init-child` |
| **P1** | Analyze a WHOLE theme design → proposed Jira task breakdown (teamlead decides) | `/break-design` |
| **P1** | **Plan/spec** ONE new section/block from a design (Figma) → brief (Think, before building) | `design-to-brief` |
| **P2** | Create a **new** section (file in `sections/`) | `create-liquid-section` |
| **P2** | Create a **new** theme block (file in `blocks/`) | `create-liquid-block` |
| **P2** | Create a **new** snippet (file in `snippets/`) | `create-liquid-snippet` |
| **P2** | Create a **new** JS component (`src/js/modules/`) | `create-js-component` |
| **P2** | Create **new** styles (SCSS partial in `src/scss/`) | `create-scss-module` |
| **P2** | **Fix / debug / refactor / edit** an existing file | `review-and-refactor` |
| **P2** | Add / rename i18n keys for what you're building | `update-locales` |
| **P2** | **Delete / remove** a section or theme block | `delete-section-block` |
| **P2** | Cart API / cart events / re-render after cart mutation | `cart-operations` |
| **P2** | Scroll animations / motion effects / staggered lists / replay after modal or filter | `animation-motion` (full reference: `docs/motion.md`) |
| **P2** | Section Rendering API / morph / `updatedCallback` | `section-rendering-api` |
| **P3** | Dev: audit your own diff before opening the PR ("review my changes"); lead: review PR branches | `diff-reviewer`, `/review-pr` |
| **P4** | Pull a finished demo store INTO `listings/<preset>/` (+ validate) | `/sync-listing`, `yarn check-listings` |
| **P5** | Whole-theme audit vs Theme Store requirements (+ Lighthouse) | `/store-audit` |
| **P5** | Generate/update merchant docs from schemas | `/gen-docs` |
| **P5** | Package for submission (clean → version → notes → zip → checklist) | `/submit-theme` |
| **P6** | Read/triage the fork's Slack bug List; update status after a fix lands | `slack-bug-list` |
| **Lane** | **Promote a generic lesson** learned in a fork UP to core (skill/agent gap, reusable gotcha) | `propose-core` |
| **Lane** | **(Maintainer)** review pending core-proposals + land accepted ones into core via a PR | `harvest-proposals` |
| **Lane** | Onboard an INDEPENDENT theme (not a fork) onto the shared toolkit | **not here** — `/foxtheme-toolkit:init-project`, from that theme's repo |

**Agents** (isolated passes, auto-selected too) — say it in natural language:
- "review my changes / audit this diff before commit" → **diff-reviewer** (read-only, no edits; the current branch's DIFF only — whole-theme pre-submission audit is `/store-audit`)
- "audit locales / find missing translations across de/es/fr/it" → **locale-auditor**
- "resolve conflicts after core sync" → **fork-sync-resolver** (or run `/sync-core <version>` for the whole flow)
- "build / test many sections in parallel" → **feature-builder** (builds ONE thing from a brief), **feature-tester** (L1: runs every check + compiles + audits every setting is wired + static interaction wiring + brief conformance), **feature-runtime-tester** (L2: renders it live + settings render-matrix incl. setting-pairs + drives interactions + measures visuals vs the brief/Figma; can seed test data via Shopify CLI) — fanned out by the batch commands below; each **auto-approves inside its own git worktree** so it runs unattended (no manual confirmations).

**Building several sections/blocks at once?** **Think** first (`design-to-brief`, 1:1 per item — never fan out something still under design discussion) → the agreed spec lands in `.briefs/<name>.md` (per-dev scratch, gitignored). Then the batch commands fan out worktree-isolated agents that run unattended: `/build-batch` (build only) · `/test-batch [--no-l2]` (verify — L1 static+build, then L2 runtime/visual/interaction by default) · `/ship-batch [--no-l2] [--max=N]` (closed build→test→fix loop) · `/revise <item> "<feedback>"` (your review notes → brief update → rebuild + re-test; never edit a worktree yourself). Review green branches with `/review-pr`, then merge/push **yourself** — agents never merge or push. Full flow, contracts, and caveats: `.claude/USAGE.md` (each command self-documents on invocation).

**After creating a section/block/snippet with new schema keys → also apply update-locales.**

**After renaming a function, changing a module's API, or updating a usage pattern in `src/js/modules/` → run `grep -r "old-name" .claude/skills/` and update any skill files that reference the old API.**

**Learned something generic while building in a fork?** Core skills/agents sync *down*; the up-channel is `.claude/core-proposals/`. Run **`propose-core`** to capture a generic lesson (a skill/agent gap, a reusable gotcha — not a store-specific design call) as a committed, apply-ready proposal; a maintainer with core push access lands accepted proposals into core with **`harvest-proposals`**. See `.claude/core-proposals/README.md`.

**Hit a bug in a CORE code file while building a feature?** (a `src/js/modules` contract file, a `mixins` partial, a shared snippet you may not edit in the child) → **`/fix-core <file> "<fix>"`**. It lands the fix in core without leaving the child (worktree off `upstream/main` → build + check → core PR), then optionally grafts the fix onto your feature branch so you're unblocked immediately. This is the **code** lane (build+test+PR); `propose-core` is the **docs/knowledge** lane (paste-and-land). First check the fix isn't avoidable additively, or a child-owned visual you can just edit locally.

---

## Shopify Liquid — MANDATORY workflow (applies to all Liquid tasks)

When writing or reviewing any Liquid code (sections, blocks, snippets):

**1. Look up docs before writing code** — for any object/filter/tag you are unsure about, consult the `shopify-liquid` skill from the **`shopify-ai-toolkit` plugin** (install per-dev via `/plugin`; see the "Setup cho dev mới" section in `.claude/USAGE.md`). Do not rely solely on training data.

**2. Write the code.**

**3. Validate before returning:**
```bash
yarn check-liquid --files <relative-path>     # one or more changed .liquid files
# or `yarn check-liquid` to check the whole theme
```
Runs `@shopify/theme-check` locally (a repo devDependency — works on every fork, no plugin required).

**4. If validation fails:** fix and re-validate (max 3 retries).

---

## Quick Usage Lookup → PROJECT-MAP.md

Before searching for "where is X used", check **PROJECT-MAP.md** (project root). It contains:

- **§0 Capability index** — every reusable behaviour (scroll row, tabs, accordion, dialog, carousel, countdown…) with what it does, when to reuse it, its markup contract, and grep-able keywords. **Check §0 BEFORE writing any new behaviour CSS/JS** — generated from `@capability` headers in the source files
- Every snippet and which files render it
- Every section and which templates include it
- Every JS custom element tag and which Liquid files use it
- Every JS module's `@theme/*` imports
- JS loading conditions from `scripts.liquid`

**PROJECT-MAP.md is generated and gitignored** (not committed) — derived from source by `yarn map`. It's regenerated automatically on `yarn install` (postinstall) and after structural changes (the create/delete skills + the Stop hook run `yarn map`). If it's missing or looks stale, run `yarn map`. Never hand-edit it.

---

## Build Commands

```bash
yarn start                # Full dev: clean + build + all watchers + theme dev -e development
                          # (on the first FREE port from 9292 up — several repos can run it at once)
yarn start:events         # The same, plus Shopify's standard events inspector panel (on 127.0.0.1:<port> only)
yarn build:css            # Compile src/scss/ → assets/*.css
yarn watch:css            # Watch SCSS
yarn copy:js              # Copy src/js/modules/ → assets/
yarn watch:js             # Watch JS modules
yarn build:js-vite        # Build src/js/library/ via Vite → assets/
yarn watch:js-vite        # Watch library JS
yarn copy:images          # Copy src/images/ → assets/
yarn zip                  # Production build + package
yarn format               # Prettier on all files
yarn lint:css             # Stylelint SCSS — CHECKS only, never edits your files
yarn lint:css:fix         # The same, with --fix. The only form that rewrites source
yarn check-missing-translate   # Find t:* keys used in schema but missing from locale files
yarn check-unused-translate    # Find locale keys not used anywhere
yarn check-template-refs       # Stale section/block types in templates JSON vs existing Liquid
yarn clean-template-refs       # Remove orphaned refs from templates (after deleting sections/blocks)
yarn motion:build              # Regenerate snippets/motion-prestage.liquid from the motion registry
yarn motion:manifest           # Regenerate .motion-manifest.json (the agent-readable motion vocabulary)
yarn check-motion-prestage     # Prestage CSS still matches src/js/modules/motion-presets.js
yarn check-motion-manifest     # .motion-manifest.json still matches the registry
yarn check-motion-presets      # Every literal data-motion="…" in Liquid names a registered preset
yarn check-motion-easing       # Opacity transitions use an easing token, never an inline curve (resolves one hop of a local var)
yarn check-capability-headers  # Fail on NEW src/js/modules/*.js or _component-*.scss without a @capability header (ratchet vs baseline)
yarn check-capability-headers:baseline # Regenerate baseline after adding headers to grandfathered files
yarn check-js-contract         # Fail on NEW class selectors in src/js/modules (ratchet vs baseline)
yarn check-js-contract:strict  # Report all violations (incl. baselined ones)
yarn check-js-contract:baseline # Regenerate baseline after refactoring violations
yarn check-selector-interp     # Fail on NEW unescaped `${…}` inside a selector string (ratchet vs baseline)
yarn check-selector-interp:strict   # Report all violations (incl. baselined ones)
yarn check-selector-interp:baseline # Regenerate baseline after refactoring violations
yarn check-settings-schema     # Validate config/settings_schema.json (JSON valid, no dup IDs, theme_info[0])
yarn check-range-steps         # Every `range` setting: (max-min)/step <= 101, divisible, default in bounds
yarn check-visible-if          # A chained `visible_if` restates the gate of the setting it depends on (conjunctions only)
yarn check-preset-values       # Every preset value for a select/radio exists in that setting's options
yarn check-render-filters      # No filter inside a `render`/`content_for` argument (theme-check misses it; it fails at UPLOAD)
yarn check-inline-assets       # Every `inline_asset_content` file stays under Shopify's 15,360-byte limit (measured by compiling the SCSS entry) — over it Shopify emits an HTML comment and the page silently loses that CSS
yarn check-image-preload       # No `preload:` on image_tag / responsive-image — a responsive Link preload is sized against the 980px default viewport and fetches the DESKTOP candidate on phones (double download, priority Low); the eager+high <img> is the requester
yarn check-doc-newline         # A value snippet (doc block + `{% liquid %}` + echo) closes its doc with `{% enddoc -%}` — `{% enddoc %}` leaks a newline the next `{%-` cannot strip, so a captured "\neager" never equals 'eager' and loading="\nlazy" is an invalid enum the browser treats as eager
yarn check-contrast            # Faded text (`color: rgb(var(--color-foreground) / N%)`) below WCAG AA 4.5:1 on any shipped scheme — ADVISORY, always exits 0 (a quiet value can be a design decision)
yarn check-contrast:strict     # The same report, but exits 1 — what /store-audit runs, where Shopify sets the standard
yarn check-contrast:baseline   # Grandfather existing faded text after adding the check
yarn check-shorthand-scheme-var # A scheme-role var inside a `border`/`background`/`outline` shorthand — one cleared role kills the whole declaration (ratchet vs baseline)
yarn check-shorthand-scheme-var:baseline # Regenerate that baseline after fixing grandfathered violations
yarn check-toolkit-refs        # .claude/ docs anti-drift: every yarn-script + file path they mention exists
yarn check-listings            # Validate listings/ (Theme Store presets): JSON, type refs, naming rules, color_schemes parity, default preset mirrors root
yarn listings:pad-schemes      # Give every preset (+ current) the same color_schemes ids — copies missing ones from the richest preset; --check only reports
yarn audit:coverage            # Lighthouse/axe EVERY section + block preset on generated fixtures (wt/audit-coverage dev theme) — what /store-audit lighthouse can't see; --a11y-only, --only=a,b, --clean, --write-baseline
yarn audit:url <https://store>  # Lighthouse a LIVE storefront (ours or a customer's): median of --runs=3, every finding attributed to theme / Shopify-injected / third-party / merchant with ≈ score points + metric (LCP/TBT/CLS/FCP), theme fixes mapped to source with --theme-repo=<path>, a fonts-blocked control run per page (files 'fonts hold first paint' on the theme with the measured delta), --preview-theme=<id> for an unpublished theme (before/after); --pages=/a,/b --desktop --password=… --a11y-only --block-banner --no-font-control
yarn test-presets [<preset>]   # Preview one listings/ preset in its OWN worktree + dev theme (never touches your tree); --no-dev, --port, --clean [<preset>|--all]
./scripts/check-additive-feature.sh # On feat/* branches: verify only NEW .liquid/.js/.scss added
yarn clean-data-json:release   # Strip store keys + credentials (api_key, AIza… values) from templates/sections/listings/settings_data and normalise list-collections.json (main on, rest off) — /sync-listing already cleans at sync time; this is the idempotent safety net before zip
yarn core:diff <version>       # (child fork) Classify Tier 1/Tier 2 files for an upstream version
yarn core:dry-merge <version>  # (child fork) Preview merge conflicts then abort
yarn core:sync <version>       # (child fork) Merge upstream tag into current sync branch
yarn theme:bump-store-version <ver>  # Patch Shopify Theme Store version in lockstep (snippet + settings_schema + package.json); refuses unless a store/* tag exists and <ver> is above it (--force bypasses)
yarn theme:store-state         # Where the theme is in its Theme Store life, from git tags: first-submission (no store/* tag: version holds through reviewer rounds) or live (every upload is a new version); --json
yarn theme:tag-submit          # After `yarn zip`, on the release branch: tag HEAD submit/<ver>-rN (one per upload, sha256 of the zip) + print what changed since the previous round / last release; never pushes
yarn theme:tag-store           # Shopify published it: tag store/<ver> on the commit of the last submit/<ver>-rN; from here the theme is live and the next upload needs a bump
```

**Parallel work + the resources it leaves behind.** Each build worktree gets its OWN Shopify
development theme, and an L2 pass launches its own headless Chrome — neither is cleaned up by
finishing the work, and both are invisible until you go looking (a headless browser has no
window; a `wt/*` theme only shows in the store's theme list). These reclaim them:

```bash
yarn wt:add <branch> [--base <ref>]  # create .worktrees/<slug> + symlink node_modules
yarn wt:dev [name] [--port N]        # preview one worktree on its own wt/* dev theme
yarn wt:clean [--dry-run] [--all]    # remove MERGED worktrees + branches; archive their briefs
yarn wt:theme                        # list the wt/* dev themes (+ whether the worktree still exists)
yarn wt:theme --delete               # …pick which ones to delete from that list
yarn chrome:agents                   # list Chrome instances an AGENT launched + who is using each
yarn chrome:agents --kill            # …pick which ones to kill (never touches your own Chrome)
```

Both `--delete` and `--kill` take targets (`<slug>` / `<pid>`), `--orphans`, or `--all`, and only
prompt where a TTY can answer — an agent or CI run gets an error, never a hidden prompt. Full
flags and rationale: `.claude/USAGE.md`.

**Deploy:**

```bash
yarn deploy:dev           # Push to development environment
yarn deploy:test          # Push to test environment
yarn deploy:intro         # Push to intro environment
```

> **Important:** `src/` files are NOT used directly by Shopify. Always rebuild after source changes.
> Liquid/JSON files in `sections/`, `blocks/`, `snippets/`, `templates/` don't need a build step.

---

## File Structure

```
blocks/         # Theme blocks (reusable, nestable Liquid files)
sections/       # Page sections (Liquid + inline schema)
snippets/       # Reusable Liquid fragments
templates/      # JSON page templates
layout/         # theme.liquid, password.liquid
config/         # Global theme settings
locales/        # i18n: en.default.json (storefront), en.default.schema.json (editor)
assets/         # Built output — do not edit directly
src/
  js/
    modules/    # ESM custom elements → yarn copy:js → assets/
    library/    # Third-party libs → yarn build:js-vite → assets/
    global/     # theme.js, modules.js
  scss/
    global/     # Compiled to assets/*.css
    modules/    # Module-specific SCSS
    mixins/     # Breakpoints, utilities
  images/       # SVGs → yarn copy:images → assets/
```

---

## Key Conventions

### Liquid

- `{% liquid %}` blocks for all logic (not scattered inline tags)
- Snippets via `{% render 'name', param: value %}` — name must be a **quoted string**
- **No filters in a `render` / `content_for` argument** — `min_value: settings.pad | default: 20` is a syntax error (`Expected end_of_string but found pipe`). `assign` the filtered value in the `{% liquid %}` block first, then pass the plain variable. theme-check does NOT catch it: it fails at theme upload, where Shopify rewrites the file server-side and silently drops the filter. Guarded by `yarn check-render-filters`
- Schema i18n: all `name`, `label`, `content`, `options[].label` use `t:*` keys
- **Section blocks** (defined in `{% schema %}` `blocks` array): rendered with `for block in section.blocks` + `case block.type`
- **Theme blocks** (files in `blocks/`): section schema has `[{ "type": "@theme" }]`, rendered with `{% content_for 'blocks' %}`
- A section uses **only one** type — never mix section blocks and theme blocks

### JavaScript

- Custom elements extend `Component` from `@theme/component`
- Import aliases: `@theme/component`, `@theme/events`, `@theme/utilities`, `@theme/image-coordinator`, `@theme/motion-coordinator`
- **DOM access contract** (enforced by `yarn check-js-contract` in CI): inside `src/js/modules/*.js`, never use class selectors (`querySelector('.foo')`). Use `ref="name"` → `this.refs.name`, `data-*` attributes, or custom element tags. Existing violations are baselined in `.js-contract-baseline.json`; the rule fails CI only on NEW class selectors. Allowed exceptions: state classes (`.is-*`, `.has-*`, `.hidden`…), Shopify platform classes (`.shopify-*`), Swiper-injected classes (`.swiper-*`).
- **Selector interpolation** (enforced by `yarn check-selector-interp` in CI): never drop a runtime value into a selector string unescaped. In attribute position wrap it — `` `[data-id="${CSS.escape(id)}"]` ``. In **class** position (`` `.${cls}` ``) escaping is the wrong fix: a multi-class value must be split, not escaped, so use `el.classList.contains(cls)` or the library's own helper (Swiper exposes `classesToSelector`). Ratcheted against `.selector-interp-baseline.json`; suppress a deliberate one with `// selector-interp-disable-next-line`.
- **Refs:** `ref="name"` attributes → `this.refs.name` (auto-maintained by base class)
- **Event binding:** `on:click="/methodName"` in HTML for child elements; `addEventListener(..., { signal })` for ThemeEvents
- **AbortController:** one per component; pass `{ signal }` to all `addEventListener` calls; call `abort()` in `disconnectedCallback`
- **Lifecycle order in `disconnectedCallback`:** cleanup (abort, disconnect observers) → then `super.disconnectedCallback()`
- **Lifecycle order in `connectedCallback`:** `super.connectedCallback()` FIRST, then your code
- ThemeEvents constants from `@theme/events` — never hardcode event name strings

### SCSS

- BEM: `block`, `block__element`, `block--modifier`
- Max specificity: 0-1-0 (single class)
- Mobile-first: base styles for mobile, `@include media-breakpoint-up(md)` for larger screens
- `@use "../mixins" as *` for breakpoints
- CSS variables for all dynamic/theme values; no hardcoded colors

### Schema Settings Order

1. Layout (container, direction, alignment)
2. Content (text, images, links)
3. Appearance (color scheme, borders)
4. Padding/Spacing

### Naming

- Files: kebab-case (`product-card.liquid`)
- Classes: BEM (`product-card__title`)
- Custom elements: kebab-case (`product-card`)
- JS classes: PascalCase (`ProductCard`)
- Private JS methods: `#methodName`

### Theme blocks (`blocks/*.liquid`)

- **Type = filename** (without `.liquid`). Renaming a block file updates every `templates/*.json` / section schema `"type"` that references it.
- Long block names: use a short readable prefix (e.g. `countdown-icon-text`, `_carousel-collection-card`). Pair with `_block-*.scss` in `src/scss/global/_blocks.scss`.

### Snippets (`snippets/*.liquid`)

- **Presentation / HTML** — suffix `-markup` (e.g. `product-card-markup.liquid`). Theme blocks should delegate to `-markup` snippets.
- **Utilities** (URL helpers, CSS variable emitters, tiny logic) — no `-markup` suffix; short clear name (e.g. `price.liquid`, `spacing-style.liquid`).

---

## Common Snippets to Reuse

- `responsive-image` — responsive images (always use this, never reimplement)
- `spacing-style` — spacing CSS variables from settings
- `border-style` — border CSS variables
- `gap-style` — gap CSS variables
- `icon` — icon rendering
- `icon-or-image` — icon or image picker
- `image-priority` — `loading`/`fetchpriority` for an image that may be above the fold: section-position heuristic, overridden by the merchant's `enable_preload_image` checkbox. Never hand-write a `section.index` ladder
- `color-schemes` — color scheme classes

---

## Common Components to Reuse

Behaviour, not markup helpers — a custom element plus the SCSS that pairs with it. Reuse these the same way you reuse snippets; hand-rolling one passes every check and still ships a worse widget.

**The full, always-current list is PROJECT-MAP.md §0 (Capability index)** — generated from `@capability` headers in `src/js/modules/*.js`, `src/js/library/*.js` (the vendored-bundle SOURCES — their same-named `src/js/modules/` copies are vite build output that drops comments; edit the library file, never the output), `src/js/global/modules.js`, and `src/scss/global/_component-*.scss`. Search it by behaviour keywords before writing any new CSS/JS behaviour. New JS modules and `_component-*.scss` partials MUST carry a `@capability` header (the create-js-component / create-scss-module skills show the format), or they stay invisible to every future builder. The worked example:

- **Horizontal scroll row** (tab bars, filter pills, chip rows) — `.edge__shadows` (`src/scss/global/_component-edge-shadows.scss`) paints a scheme-aware gradient fade on each edge and hides each side once scrolled out; `<div is="swipe-component">` (`src/js/modules/swipe-component.js`) drives its `is--active` / `is--beginning` / `is--end` state from `scrollLeft` and **auto-scrolls the newly active child into view** when its `aria-selected`/`aria-current` flips. Markup contract: `.swipe__element` (scroll box) wrapping `.swipe__inner` (the row). Used by `sections/tabs.liquid`, `sections/product-tabs.liquid`, `sections/collection-tabs.liquid`. For a Swiper-backed carousel the same three classes come from `src/js/modules/flex-carousel.js` instead — pair `.edge__shadows` with that.

---

## i18n Rules

Always update locale files when adding schema text:

- `locales/en.default.schema.json` — editor labels (names, settings, options, content headers)
- `locales/en.default.json` — storefront text rendered via `{{ 'key' | t }}`

After changes: run `yarn check-missing-translate` to verify.

---

## Theme Globals (JS)

Use these instead of hardcoding:

- `FoxTheme.routes` — cart/API URLs
- `FoxTheme.settings` — global theme settings
- `Shopify.currency` — money format
- `Shopify.designMode` — theme editor mode

---

## Code Quality Principles

### Think before coding
- State assumptions explicitly. If uncertain, ask — don't guess silently.
- If multiple interpretations exist, present them; don't pick one silently.
- If a simpler approach exists, say so. Push back when warranted.

### Make surgical changes
1. **Read before editing** — read the target file and its dependencies first (for cross-cutting changes, check PROJECT-MAP.md). Also check the file's recent history (`git log -8 -- <file>`, `git blame` on the lines you'll touch): another dev's intent lives in commit messages/comments, not in your local memory — don't undo a deliberate change.
2. **Usage & impact** — find where the file/component is used before editing.
3. **Minimal & non-speculative** — only what the goal needs; no extra refactor, no "might be useful", no abstraction for single-use code.
4. **Don't touch adjacent code** — match existing style even if you'd do it differently; don't reformat/refactor unrelated code. Mention unrelated dead code, don't delete it.
5. **Clean only your own orphans** — remove imports/vars your change made unused; leave pre-existing dead code unless asked.

*Test: every changed line should trace directly to the stated goal.*

### Verify against real criteria
- Turn the task into a checkable goal before starting (e.g. "renders in Theme Editor with no console error", "`yarn check-missing-translate` passes").
- Always state how to verify: steps + expected result. Verification here = build + relevant `yarn check-*` (`check-liquid`, `check-js-contract`, `check-missing-translate`, `check-template-refs`) + Theme Editor / browser — there are no unit tests.

---

## Working Agreements

- **Respond in Vietnamese** by default (explanations, proposals, guidance). Keep code identifiers, file names, and code comments as-is. If the user writes entirely in English and clearly expects English, reply in English.
- **Skill/doc content in English** — when creating or editing `.claude/skills/*` files, write all prose in English (translation keys, identifiers, paths stay unchanged).
- **Propose before editing** — for non-trivial changes, show the plan/diff and confirm before applying. If the user says "apply" / "go ahead" in the same message, proceed.
- **Confirm before committing** — propose staged files + commit message and ask Yes/No before `git commit`. Read-only git (`status`, `diff`, `log`) needs no confirmation. Never commit in the same turn you propose unless explicitly told to.
- **Pull before push** — before pushing a branch or opening/updating a PR, `git fetch origin` and merge `origin/main` into the branch (resolve conflicts locally, re-run relevant `yarn check-*`/build if the merge touched code) so the branch isn't stale. `main` moves fast here — pushing an outdated branch produces PR conflicts. Prefer merge over force-push on a shared/PR branch. **After the merge, run `git diff origin/main --stat` and confirm no `merge=ours` file (see `.gitattributes`) shows changes you did not make.** That driver applies to *every* merge, not just `core:sync`, and its unit is the whole file: if both sides touched one, git silently keeps yours and discards the other side's — reported as a clean `Auto-merging`, no conflict, every `yarn check-*` still green. Resolve by hand — `git checkout origin/main -- <file>`, re-apply your own hunk, amend the merge.
- **Read-only probes: use the Grep/Read/Glob tools, not bash loops with expansion.** A Bash command containing `$(…)` or shell variables always triggers the "simple_expansion" approval popup — no allowlist can (or should) bypass it, since substitution can smuggle arbitrary commands. Searching/counting across files is the Grep tool's job; if bash is genuinely needed, write flat commands without substitution.

---

## Child Fork Overrides

@.claude/CHILD.md

Child-specific conventions and any builder agents a fork has authored live in `.claude/CHILD.md` (imported above). It is **child-owned** (`merge=ours`) — `core:sync` never overwrites it, while core skills/agents/commands keep flowing down normally. Core ships it near-empty; each fork fills it, and anything there overrides the core defaults stated above.

---

## Memory & Continuity

- **Proactively record memory** after a significant change (refactor, bugfix, new module, architecture decision) whose rationale is **not derivable from git/code** — don't wait to be asked. Write a focused memory with a clear `description` so a future session recalls it. Skip what the repo already records (code structure, commit history).
- Anything important enough to survive a fresh session must reach **disk** (a memory file + a git commit) — conversation context is lost on a new session / `/clear`, but memory and CLAUDE.md are re-injected even after compaction.

### Compact Instructions
When compacting context, always preserve: decisions made and why, files changed and the nature of each change, pending TODOs / follow-ups, and anything already written to memory this session.
