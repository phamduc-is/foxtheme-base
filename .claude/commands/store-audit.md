---
description: "Phase 5 — pre-submission audit of the WHOLE theme against Shopify Theme Store requirements (shopify.dev/docs/storefronts/themes/store/requirements): mechanical checks + parallel read-only auditors (settings/schema compliance, static accessibility, mandatory-features matrix) + optional Lighthouse on a live demo URL (password-gated stores supported). Pick all parts or a subset via a menu or flags. Ends with a pass/fail table per requirement category AND the manual checklist automation can't cover (browser matrix, keyboard nav, demo content). Read-only — reports, never edits. Run before every submission and before major updates to a live theme. Not for reviewing one diff (use diff-reviewer)."
argument-hint: "[all | mechanical settings a11y features lighthouse coverage] [demo-store-url] [--password=<pw>] — no args = menu"
allowed-tools: Bash(git log:*), Bash(git status:*), Bash(yarn check-liquid:*), Bash(yarn check-missing-translate:*), Bash(yarn check-template-refs:*), Bash(yarn check-settings-schema:*), Bash(yarn check-range-steps:*), Bash(yarn check-js-contract:*), Bash(yarn check-capability-headers:*), Bash(yarn check-contrast:*), Bash(yarn check-listings:*), Bash(ls:*), Bash(npx lighthouse:*), Bash(yarn audit:coverage:*), Bash(yarn audit:url:*), mcp__chrome-devtools__new_page, mcp__chrome-devtools__navigate_page, mcp__chrome-devtools__fill, mcp__chrome-devtools__click, mcp__chrome-devtools__press_key, mcp__chrome-devtools__wait_for, mcp__chrome-devtools__evaluate_script, mcp__chrome-devtools__lighthouse_audit, mcp__chrome-devtools__close_page
---

Audit the whole theme for Theme Store readiness. **Read-only everywhere — report + propose fixes, apply nothing.**

**Ground every verdict in the official requirements.** Before fanning out, fetch https://shopify.dev/docs/storefronts/themes/store/requirements (WebFetch; ~22 numbered sections) and keep the section outline at hand — hand each auditor the excerpt it grades against. Findings live in two lanes: **blocks submission** — only when it maps to a specific requirement, cited as `req §N` on the finding — and **best practice** (WCAG beyond the §Accessibility list, UX guidelines, house rules). An auditor's "mandatory" claim without a §N citation is unverified: re-check it against the page before the report repeats it. Measured drift goes both ways: a WCAG 2.2.2 autoplay-pause control was once reported as blocking (it appears nowhere on the page), while image focal points — which sound optional — are mandatory (§Features).

## 0. Pick the parts

The audit has six parts. Parse `$ARGUMENTS`:

| Key | Part | Cost |
|---|---|---|
| `mechanical` | §1 — the nine `check-*` scripts + 3 direct probes | cheap, ~1 min, main context |
| `settings` | §2.1 — settings & editor compliance auditor | 1 subagent |
| `a11y` | §2.2 — static accessibility auditor | 1 subagent |
| `features` | §2.3 — mandatory features matrix auditor | 1 subagent |
| `lighthouse` | §3 — needs a store URL (+ `--password=` if gated); any live store, not only our demo | `yarn audit:url`, ~1 min per page × device × run |
| `coverage` | §3b — Lighthouse/axe on EVERY section + block preset, generated fixtures on the dev store (`yarn audit:coverage`) | ~30s per fixture, background |

- `all` → every part (lighthouse only if a URL is present; otherwise mark it ⏭ and say why; coverage needs `[environments.development]` in `shopify.theme.toml`).
- One or more keys → only those. A bare URL implies `lighthouse`; `--password=<pw>` is the storefront password.
- **No arguments** → ask with AskUserQuestion (multiSelect): the six parts above, `mechanical` + the three auditors pre-suggested. If `lighthouse` is picked and no URL was given, ask for the URL and whether the store has a password in a second question.

Whatever the selection, the final report (§4) always lists all six categories — unselected ones are ⏭ **skipped (not run)**, never blank, so nobody reads an absent row as a pass.

## 1. Mechanical layer (main context, cheap)
Run and record: `yarn check-liquid` (whole theme) · `yarn check-missing-translate` · `yarn check-template-refs` · `yarn check-settings-schema` · `yarn check-range-steps` · `yarn check-js-contract` · `yarn check-capability-headers` · **`yarn check-contrast:strict`** · `yarn check-listings`. The `:strict` form is deliberate and belongs only here: day to day `yarn check-contrast` reports and exits 0, because muted text can be a design decision — but accessible contrast is a Theme Store review requirement, so at submission the standard stops being ours. Treat each hit as a question for the designer, not an automatic edit. Plus direct probes:
- `layout/robots.txt.liquid` must NOT exist (Store requirement — themes must not override robots).
- All required templates present in `templates/` — JSON or Liquid (this theme ships `gift_card.liquid`; the rest are JSON: product, collection, list-collections, cart, blog, article, page, search, 404, password, customers/*).
- `config/settings_schema.json`: `theme_info` first, `theme_name`/`theme_version` present; version lockstep with the version snippet AND `package.json` (`scripts/bump-store-version.mjs` owns the trio).
- `templates/404.json` offers a way forward (§Pages: search bar or homepage link): the shipped buttons carry non-empty links — grep the template for `"link": ""`.
- `config/markets.json` must NOT exist (§Blocks); no `.scss`/`.scss.liquid` files in `assets/` (§Assets).
- `layout/theme.liquid`: `lang="{{ request.locale.iso_code }}"` on `<html>`, `content_for_header` rendered once and never parsed/modified, no hardcoded `http://` URLs (§Pages, §Consistency).
- SEO (§SEO): `canonical_url` emitted in the meta snippet, and a JSON-LD rich product snippet (`application/ld+json`) on the product page.

## 2. Fan out the selected read-only auditors — one message, parallel
Spawn the selected general-purpose subagents (READ-ONLY — Read/Grep only; no edits). Each returns concrete `file:line` findings ranked must-fix / should-fix / note, plus what's verified-good:

1. **Settings & editor compliance** (`settings`) — every setting has a `t:*` label; sentence-case setting text in `locales/en.default.schema.json`; §Settings text style: American English spellings, no ampersands in labels, Shopify terminology (home page, favicon, main menu…), declarative statements not questions; `font_picker` used for fonts with `font_modify` loading bold/italic variants; color system exposes ≥4 colors with background/foreground pairing; `link_list` settings default to `main-menu`/`footer`; favicon + logo settings exist; settings grouped Layout→Content→Appearance→Padding.
2. **Static accessibility** (`a11y`) — every `<img>`/`responsive-image` call path carries alt text; form inputs have unique ids + associated labels; visible `:focus-visible` styles in `src/scss/`; skip-to-content link in `layout/theme.liquid`; touch targets (icon buttons) ≥24px in SCSS; no `outline: none` without replacement; heading hierarchy in section markup; carousels/off-screen content stay out of the tab order (a Swiper built without its A11y module ships zero aria). Grade strictly against the page's §Accessibility list — anything beyond it (autoplay pause controls, `prefers-reduced-motion`, `<dialog>` naming) is reported as best practice, never as blocking.
3. **Mandatory features matrix (requirement §Features)** (`features`) — grep the theme for each item of the official list: predictive search + search template; faceted filtering (collection AND search); gift card template + recipient form + code/QR/Apple Wallet; **selling plans shown in the CART** (a product-form picker is NOT required — plan data only exists via apps, which inject their picker through `@app` blocks); unit price (collection/product/cart); pickup availability; related AND complementary recommendations; rich product media (video/3D); **image focal points** (`image.presentation.focal_point` honored by the shared image pipeline — mandatory); variant image shown on variant select; accelerated checkout (`payment_button`, unmodified branding); **Shop Pay Installments** (`payment_terms`); **discounts displayed in cart + order**; multi-currency/language selectors; nested menus; newsletter form; social/OG meta (`page_image`); Follow on Shop (`login_button`); **account component in desktop + mobile header**; app blocks in the main product and featured/quick-view product sections. Report each as present (file) / missing / partial, quoting the requirement wording wherever a gap is claimed.

## 3. Lighthouse pass (only when selected + a store URL was given)

Run `yarn audit:url <url> [--password=<pw>] [--desktop] [--pages=/,/products/x,/collections/y]` in the background and read `.audit-url/<host>/report.md`. It audits home + a product + a collection (auto-discovered from the home page, or the pages you name), mobile by default, **3 runs per cell and reports the median** — a single mobile run swings ±5–10 points, so never quote one. Store thresholds: **performance ≥ 60 average, accessibility ≥ 90 average** — and the store measures **both mobile and desktop** (§Performance): run the default mobile pass first (the stricter device), then repeat with `--desktop` before calling the category passed.

Pass `--theme-repo=<path>` when the theme's source is on disk (this repo for our own demo; `../shopify-hyper` etc. for a customer on another FoxTheme) — theme-owned findings then name the Liquid files that emit the asset or markup.

What to carry into §4 — the report already does the attribution, quote it rather than re-deriving it:
- **Where the performance points are lost** — per page, the points each metric forfeits today (TBT 30% · LCP 25% · CLS 25% · FCP 10% · SI 10%). A finding can only give back what its metric loses.
- **Who is responsible for what** — every failing audit bucketed into *Theme* (fixable in source, with a fix recipe + source files), *Shopify-injected* (checkout-web, portable wallets, consent, pixels runtime — name them, the theme cannot remove or reorder them), *Third-party* (apps/pixels the merchant installed — name them, with KB and main-thread ms), *Merchant* (image files, fonts, colours). Each finding carries `≈ N pt · affects LCP/TBT/…`: the larger of its marginal score gain and its share of the metric's lost points — a ceiling, findings overlap.
- The Scores table + average, per device.
- Never bill a Shopify or third-party item to the theme, and never promise the merchant a theme fix for a merchant-content item.
- **Who loaded what** — theme assets vs Shopify platform vs images vs third-party apps, and the third parties by main-thread time. On a live store the apps are usually the biggest cost; report theme-caused and app-caused separately or the merchant reads every point as the theme's.
- **LCP**: a large element render delay with a fast resource load means the LCP element arrived and was then hidden — an entrance animation or a JS-gated reveal on it (our fix), or the privacy banner painting over it (not ours; `--block-banner` shows the theme's own LCP).
- The theme name + version the store runs (from the report header): a store on an old version may already have the fix.
- **Web fonts hold the first paint** (a theme finding with a measured delta): the script re-runs each page with the theme's fonts blocked. Chrome holds the whole page's first paint for a preloaded font — Lighthouse then shows it as an "LCP element render delay", which blames the wrong thing. If this finding is present, the fix is the font preload/`font-display` in the theme, not the LCP element. `--no-font-control` skips the extra run.
- Before/after on a fix: push the fixed theme unpublished and run with `--preview-theme=<id>`; compare FP/LCP ms, not the demo's score (once first paint is early the LCP becomes a small text node and other things dominate the score).
- For a password-gated demo the session cookies are HttpOnly (`_shopify_essential`), so the script logs in itself — there is nothing to read from `document.cookie`, and no Chrome MCP step is needed. If it reports "still shows the password page", the password is wrong: stop, do not loop.

The Chrome MCP `lighthouse_audit` tool is not used here: it excludes the performance category, and it cannot write into the scratchpad.

## 3b. Coverage pass (only when selected)

§3 sees exactly the sections the demo builder used. `yarn audit:coverage` renders the rest — one generated fixture per section (`presets[0]`, first on the page so its LCP is measurable) plus host pages of theme-block presets, on a header/footer-less layout, pushed to a `wt/audit-coverage` development theme on `[environments.development]` and reached via `?view=audit-NN`. No store data is touched.

- Run it in the background: `STOREFRONT_PASSWORD=<pw> yarn audit:coverage` (omit the env when the development store has no password; `--a11y-only` halves the time; `--only=a,b` for a subset). ~30s per fixture — a full theme is 20–40 min. Run it from a worktree, not the root checkout, when the tree must stay clean: the fixtures are gitignored but still land in `templates/` and `layout/`.
- Read `.audit-coverage/report.md`: the matrix (a11y + perf per fixture), **A11y failures by rule** (the same `id` across many fixtures = one shared snippet), and **LCP element render delay > 500ms** (the LCP element painted long after it loaded — an entrance animation or JS-gated reveal on it).
- Regressions print against `.audit-coverage-baseline.json` when one exists; `--write-baseline` snapshots a run the team accepted.
- Scope it honestly in the report: presets only (the settings matrix stays L2's job, per feature), presets carry no images so media sections measure their text LCP unless the store has seeded images, and perf here is per-section cost — never quote it as a page score.

## 4. Report
One table: requirement category → ✅ pass / ❌ fail / ⚠️ partial / ⏭ not run or skipped, with per-item findings under it. Every ❌/must-fix row cites the requirement section (`req §N`) it violates; a finding that cannot cite one moves to the best-practice list. Then the **manual checklist** (never claim these are covered):
- Browser matrix: Safari (2 releases), Chrome/Firefox (3), Edge (2), Mobile Safari/Chrome/Samsung Internet + Instagram/Facebook/Pinterest webviews.
- Keyboard-only walkthrough of the purchase path (tab order, focus trapping in drawers/modals).
- Demo stores: one per preset, matching tagged industry/catalog size, authentic content (no lorem ipsum), Bogus Gateway or Shopify Payments test mode enabled.
- Merchant docs current + public contact form working (see /gen-docs).
End with a fix plan grouped by owner (code fix → which file; demo-store fix; docs fix). Do not start fixing in this turn.
