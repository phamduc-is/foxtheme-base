---
description: "Phase 5 — generate/update MERCHANT-facing documentation from the theme itself: one doc page per section and public block plus one for the store-wide theme settings (what it does, every setting explained in merchant language) generated from {% schema %} + config/settings_schema.json + en.default.schema.json labels, plus an index and an FAQ skeleton. Theme Store requires current merchant docs with FAQ + contact form. Incremental: on re-run, regenerates only pages whose schema changed since the last generation commit. Writes to docs/merchant/ (committed); confirms the write plan first. Not for developer docs (.claude/ owns those)."
argument-hint: "[section/block names to regenerate — omit for changed-only, 'all' for everything]"
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(ls:*)
---

Generate merchant documentation from the theme's schemas. `$ARGUMENTS`: explicit names → just those; `all` → full regeneration; empty → only files whose schema changed since docs were last generated (detect via `git log -1 -- docs/merchant/` then `git diff <that-commit> -- sections/ blocks/ config/settings_schema.json locales/en.default.schema.json`).

Whatever the mode, every regenerated page runs the **setting-level diff** (see §2): its current schema is compared against the committed snapshot in `docs/merchant/.schema-manifest.json` — falling back to the schema at the last docs commit (`git show <commit>:sections/<name>.liquid`) when a page has no manifest entry yet — so added / changed / removed settings get marked wherever they appear. A page that is brand-new in that comparison takes the page stamp only. The shared artifacts (`_sidebar.md`, the index, `.schema-manifest.json`, `docs/doc-updates.json`, What's new) regenerate on **every** run regardless of scope; a named run touches exactly its own page plus those artifacts and nothing else.

**When to run — P3 finalize, not only P5.** Beyond the pre-submission bulk pass, this is the **last step before committing + opening a PR** for a new or changed public section/block: run `/gen-docs <name>` **by name** so its page rides the same PR. Name it explicitly because the no-arg incremental detector diffs only `sections/ blocks/ config/settings_schema.json locales/en.default.schema.json` — a **behavior-only refactor that leaves the schema unchanged is not detected**, so no-arg would skip it. This runs in the **main session** (the dev), not in a build/test/ship subagent — those work in worktrees, never write `docs/merchant/`, and never merge/push.

## 1. Source of truth
For each public section (`sections/*.liquid`, skip `_`-prefixed internals and headless `section-rendering-*` endpoints) and public block (`blocks/*.liquid`, skip `_`-prefixed):
- Parse `{% schema %}`: name, settings (id, type, label, info, options, defaults), blocks, presets.
- Resolve every `t:*` key through `locales/en.default.schema.json` — docs show the merchant-visible label, never the raw key.
- Read the Liquid enough to describe behavior a schema can't state (what toggles what, when a setting only applies with another one — `visible_if` conditions in merchant words).

Also document the **theme settings** in `config/settings_schema.json` — the store-wide settings (logo, typography, colors, cards, cart, …) every merchant meets before they touch a single section. Parse each group (skip `theme_info`), resolve its `t:*` name and every setting's label/info/options the same way, and describe each setting as you would a section's.

**A label is a claim, not a fact — verify the ones a merchant will act on.** Before writing the sentence for a setting whose name implies a visible outcome, find where the Liquid reads it. Real cases: `snippets/product-badges.liquid` renders `{{ tag }}` as the badge's text, so the New/Hot/Popular "list tags" settings choose the badge's *colour*, not its wording — and one badge is emitted *per matching tag*, so a product can show several. `snippets/swatch.liquid`'s `show_variant_image` fills the *swatch dot* with the variant photo; "Show variant images" reads like it swaps the card's product image, and it does not. Generated from the schema alone, all three come out confidently wrong.

## 2. Page shape — merchant language, not dev language
`docs/merchant/sections/<name>.md` / `docs/merchant/blocks/<name>.md`:
- What the section/block is for, one paragraph, no code words.
- **Settings table**: label · what it does · default. Group by the schema's `t:content.*` headers. Explain `visible_if` conditions as "appears when …".
- Blocks it accepts, and tips (image sizes that fit the layout, where it works best).
No Liquid identifiers, no file paths, no BEM classes in the merchant text.

The theme settings get **one page**, not one per group: a `##` per settings group in the order the theme editor shows them, a `###` per `header` inside a group. Splitting strands the groups holding one or two settings on pages of their own, and a docs site that promotes second-level headings into its own navigation (Docsify's `subMaxLevel: 2`, for one) already gives each group a nav entry. Where a group repeats the same handful of settings across many components — typography does, offering Font · Font weight · Letter spacing · Text transform for eight of them — explain those options **once**, then table the components with their defaults and which options each actually offers. Eight near-identical tables bury the only thing that differs.

### Setting-level diff — what changed inside a page

Never diff the old page text: any run may reword prose, so a text diff cries wolf. The diff base is a committed snapshot, `docs/merchant/.schema-manifest.json`, mapping every page to its settings — `{ "<page>": { "<settingId>": { "label", "group", "type", "default" } } }` — rewritten on every run. Compare the current schema against the page's manifest entry (first run for a page: the git fallback above) and mark each difference where the merchant will look for it:

- **Added** setting → a chip in the settings-table label cell: `Label <span class="doc-chip doc-chip--new">NEW</span>`
- **Changed** setting (label, default, options, or the behavior sentence had to change) → `<span class="doc-chip doc-chip--updated">UPDATED</span>` in the label cell, with the old → new value named in the section marker line under the group heading.
- **Removed** setting → it has no table row any more, so name it in the section marker: `> 🆕 **Updated 25 August 2026** — Removed: Show date. Post count default 3 → 4.`

Chips ride the marker expiry: a later run strips chips in sections whose marker date has aged out. The `doc-chip` classes are styled by the docs site's `index.html`.

### Change markers — so support can see what moved

A regenerated page looks identical to an untouched one, and support reads the published site, not the git diff. Leave a trail in three places:

1. **Page stamp**, immediately under the `#` title, kept forever:

       <!-- doc-updated: 2026-08-03 -->
       > **Last updated 3 August 2026** · [What's new](/merchant/whats-new.md)

2. **Section marker**, on the line *below* the `##`/`###` whose content changed — never inside the heading line. The anchor is derived from the heading text, so a marker in the heading rewrites `?id=badges` into `?id=badges-updated-3-aug`, breaking every deep link support has sent, and breaking it again on the next date:

       ## Badges

       <!-- doc-updated: 2026-08-03 -->
       > 🆕 **Updated 3 August 2026** — one line on what changed.

   A brand-new page takes the page stamp only; marking each of its sections is noise.

3. **Nav marker** — sidebar chips go into NEITHER `_sidebar.md` nor any heading text: a marker in a heading rewrites the Docsify anchor and breaks every deep link, and the sub-rows (e.g. the theme-settings groups) aren't in `_sidebar.md` at all — Docsify builds them from the page's `##` headings. Instead, each run writes `docs/doc-updates.json`:

       { "pages": { "/merchant/sections/blog-posts.md": {
           "date": "2026-08-25", "type": "new",
           "sections": { "content": { "date": "2026-08-25", "type": "updated" } } } } }

   A small Docsify plugin in the docs site's `index.html` reads it and decorates the matching sidebar rows — top-level pages AND heading sub-rows — with a `NEW` / `UPDATED` chip. It compares dates client-side, so sidebar chips expire on their own after 14 days even when no new run happens.

**Expiry: 14 days.** Each run, strip the `doc-updated` comment and its marker line wherever the date is older than that — the page stamp stays, only the 🆕 and the section markers expire. Long enough that someone back from a week away still sees it; short enough that the marker keeps meaning something.

Do **not** reach for a "last updated" plugin reading the file's `Last-Modified`: static hosts restamp every file on deploy, so every page reports the deploy date. The date has to be written into the content.

## 3. Index + FAQ
- `docs/merchant/README.md` — index grouped by area (header/footer, product, collection, content, utility), regenerated every run.
- `docs/merchant/whats-new.md` — a permanent changelog, newest first, one `##` heading per generation run (one run = one deploy). Append only — never rewritten, never expires. This is the page support opens; the markers above only point at it. Entries are compact lists straight from the setting-level diff, not prose — one block per page:

      ## 25 August 2026

      **Blog posts** — [open](/merchant/sections/blog-posts.md)
      - Added: [Tag active style](/merchant/sections/blog-posts.md?id=content)
      - Changed: Post count — default 3 → 4
      - Removed: Show date

  A "Worth telling merchants about" note appears only when a run uncovers a real behavior trap support should know (the badges/swatch kind) — not on every entry.
- **The nav must list every page this command generates.** Whatever file drives the docs site's navigation, regenerate it each run and include the theme settings page, the FAQ and What's new alongside the sections and blocks. A page the nav omits is reachable only by search — and when the nav is regenerated wholesale, a hand-added entry silently disappears on the next run, which is exactly how a page becomes orphaned.
- `docs/merchant/faq.md` — create the skeleton ONLY if missing (common questions: how to change fonts/colors, add a section, translate, contact support). Never overwrite an existing FAQ — it's hand-curated; instead, report if it references sections that no longer exist.

## 4. Write plan → confirm → write → report
Show which files will be created / updated / left alone, get a yes, write. End with:
- pages needing HUMAN review (behavior text is inferred from Liquid — a person verifies it reads true);
- schema text issues found while parsing (label not sentence-case, missing `info` where a setting is non-obvious) — report only; fixing schema text is a normal code change via review-and-refactor;
- reminder that the public contact form + hosting of these docs (help center) is outside the repo — this command only keeps the content current.
Propose the commit (`docs(merchant): regenerate for <scope>`) — do not run it.
