# Changelog

All notable changes to FoxTheme Base will be documented here.

Format: [Semantic Versioning](https://semver.org) — `MAJOR.MINOR.PATCH`

## [2.13.4] — 2026-10-22

### Fixed

- **ci**: Release never ships a CHANGELOG cut down by a shallow clone

## [2.13.3] — 2026-10-22

### Fixed

- **core**: Cart-items.js — focus stays on the cart line after a quantity change or removal

## [2.13.2] — 2026-10-20

### Fixed

- **core**: A translation's interpolated text is escaped once, not twice

## [2.13.1] — 2026-10-20

### Fixed

- **core**: Quantity-selector.js — Enter in a cart line's quantity updates it instead of checking out

## [2.13.0] — 2026-10-19

### Added

- **core**: Header "Show icon labels" — Search, Account and Cart (N) text from lg up

### Fixed

- **core**: --scrollbar-width = 100vw − the page's width, measured before first paint

## [2.12.1] — 2026-10-16

### Fixed

- **core**: --page-gutter token so Custom containers floor on the theme's own gutter

## [2.12.0] — 2026-10-16

### Added

- **core**: Highlight style "Badge" — an italic run set as an inline badge
- **core**: Custom container wider than page width + Custom option on 17 more sections

## [2.11.0] — 2026-10-16

### Added

- **core**: Countdown separator size, and the colon centred on the digits

## [2.10.0] — 2026-10-15

### Added

- **core**: Label font size — a Typography › Labels setting (default 13px)

## [2.9.0] — 2026-10-15

### Added

- **core**: Image card badge — a starburst or circle corner badge with two text lines

## [2.8.4] — 2026-10-15

### Fixed

- **core**: Countdown — a solid number background, corner radius, mobile alignment and a subheading heading preset

## [2.8.3] — 2026-10-14

### Fixed

- **core**: Swatch — a square swatch takes its full height above 44px

## [2.8.2] — 2026-10-14

### Fixed

- **core**: Slideshow — a dragged slide plays its blocks together

## [2.8.1] — 2026-10-14

### Fixed

- **core**: Motion-text — a heading cascades as one; later lines keep the delay

## [2.8.0] — 2026-10-14

### Added

- **core**: Motion overhaul — one entrance curve, split-text entrances, sequenced tabs and slides

## [2.7.1] — 2026-10-12

### Fixed

- **core**: Src/js/global/modules.js — tabs defer to a block's own entrance

## [2.7.0] — 2026-10-09

### Added

- **core**: Image-comparison heading style (badge/text) and handle style (pill/circle)

### Fixed

- **image-comparison**: Match the Wildora mobile sizes for the text heading and circle handle

## [2.6.1] — 2026-10-09

### Fixed

- **core**: Scroll-row fade uses background-image, not the background shorthand

## [2.6.0] — 2026-10-09

### Added

- **core**: Scroll row block; swipe-component follows editor block selection

## [2.5.0] — 2026-10-08

### Added

- **core**: Text-markup — disable_line_break_mobile param

## [2.4.2] — 2026-10-08

### Fixed

- **core**: Maps — corner radius on the root too

## [2.4.1] — 2026-10-08

### Fixed

- **core**: Prefix the body template class — `template-<name>`

## [2.4.0] — 2026-10-08

### Added

- **core**: Add to cart block — Outline style

## [2.3.0] — 2026-10-08

### Added

- **core**: Custom container for custom-section + .section-grid--custom

## [2.2.1] — 2026-10-08

### Fixed

- **core**: Typography-style — custom preset with the heading font takes the heading letter-spacing

## [2.2.0] — 2026-10-07

### Added

- **core**: Public Label block, in Groups and slideshow content

## [2.1.16] — 2026-10-07

### Fixed

- **core**: _list-item — the custom icon size reaches the icon

## [2.1.15] — 2026-10-07

### Fixed

- **core**: Product information + breadcrumbs — Custom container width

## [2.1.14] — 2026-10-07

### Fixed

- **core**: Icon-box — opt-in hover border, separate hover colour

## [2.1.13] — 2026-10-07

### Fixed

- **core**: Product-quiz — option images show the loading backdrop

## [2.1.12] — 2026-10-07

### Fixed

- **core**: Product-quiz — option images reserve their ratio before load

## [2.1.11] — 2026-10-06

### Fixed

- **core**: Product-quiz — design parity across demos
- **core**: Storefront events — fix D1–D13, add page/product/search views, gift and quick order events

## [2.1.10] — 2026-10-06

### Fixed

- **core**: Product-quiz — land every screen change at the top; no heading focus ring

## [2.1.9] — 2026-10-06

### Fixed

- **core**: Product-quiz — Motrix parity + progress total stays fixed

## [2.1.8] — 2026-10-05

### Fixed

- **core**: Section-renderer — drop a rejected in-flight request so a retry refetches

## [2.1.7] — 2026-10-02

### Added

- **section**: Product-quiz
- **section**: Product-quiz — rev 7: answer tokens in question heading/subtext
- **section**: Product-quiz — header and card alignment settings
- **section**: Product-quiz — unified option cards (Media card / Text only)
- **section**: Product-quiz — richtext option titles with size preset; merged selected style
- **section**: Product-quiz — own Start button block (no link setting)

### Fixed

- **product-quiz**: L2 round 1 — native email post, card radio, retry, last question
- **section**: Product-quiz — split into Finder quiz + Recommendation quiz; rev 1 fixes
- **section**: Product-quiz — always send availability filter; L2 nits
- **section**: Product-quiz — intro/email as containers of text/button/image child blocks
- **section**: Product-quiz — rev 3: settings into question blocks, labels to locale, editor-hidden intro/email
- **section**: Product-quiz — "Your results" label for the bare results panel
- **section**: Product-quiz — rev 4: intro spacing from child blocks; small fixes
- **section**: Product-quiz — rev 5: group question settings; Heading size label
- **section**: Product-quiz — rev 6: answer-cards naming, generated cards text-only, drop sort
- **section**: Product-quiz — editor preview fetches generated cards after re-render
- **section**: Product-quiz — rev 8: question settings structure; per-question gap
- **section**: Product-quiz — clearer Skip questions info
- **section**: Product-quiz — stepper matches design (dashed connector, no current ring, body-font numbers)
- **section**: Product-quiz — stepper connector solid accent up to the current step
- **section**: Product-quiz — large image option cards cover their box
- **section**: Product-quiz — editor warnings as a question notice + hidden-card badge
- **section**: Product-quiz — generated-options editor note as an info notice
- **section**: Product-quiz — empty-quiz editor note uses the info notice
- **section**: Product-quiz — result rows as box cards with own scheme and radius
- **section**: Product-quiz — image ratio for thumbnail style; unified ratio options
- **section**: Product-quiz — selected style under style; title size per option
- **section**: Product-quiz — rich text option subtitle and question subtext
- **section**: Product-quiz — rich text question heading; icon settings per option
- **section**: Product-quiz — one option image (fill/custom); card look settings back on the question
- **section**: Product-quiz — image size select; nil-safe image visibility
- **section**: Product-quiz — image width + ratio sizing, separate from icon size
- **section**: Product-quiz — drop image ratio info
- **section**: Product-quiz — text/subtext colour for secondary text fields
- **section**: Product-quiz — card border, 1-col width, mobile image width, padding, row thumb radius, progress colour
- **section**: Product-quiz — intro accepts the in-content label
- **section**: Product-quiz — screen swap fades without the rise
- **section**: Product-quiz — option hover matches the selected look
- **section**: Product-quiz — fill text colour no longer lags the background
- **section**: Product-quiz — onboarding placeholders that follow the settings; showcase presets
- **section**: Product-quiz — preset cards on scheme-2
- **section**: Product-quiz — preset result rows on scheme-2
- **section**: Product-quiz — decorative option media hidden from the option name
- **section**: Product-quiz — use color scheme in container
- **compare-table**: Centre a table of three columns or fewer instead of stretching them
- **compare-bar**: Fold the header-to-list space into the collapsing row

## [2.1.6] — 2026-09-29

### Fixed

- **core**: _collection-title — html_tag setting so the title renders a real heading

## [2.1.5] — 2026-09-29

### Fixed

- **core**: Collection-card — each card shows its own collection on a collection template

## [2.1.4] — 2026-09-28

### Fixed

- **highlight**: A linked highlight underlines in the highlight color
- **core**: _text-plain — forward an optional fallback_text to text-markup
- **core**: Product-form — keep every add-to-cart label copy in step

## [2.1.3] — 2026-09-28

### Fixed

- **core**: _component-form.scss — blank select options readable on dark schemes in Windows

## [2.1.2] — 2026-09-24

### Added

- **text**: Highlight italic runs with a text color or solid background

### Changed

- **pagination**: The current page reads from the background palette

## [2.1.1] — 2026-09-24

### Fixed

- **compare-bar**: Widen the item slot, and make it overridable per breakpoint

## [2.1.0] — 2026-09-24

### Added

- **compare-table**: Fluid product columns, four from md and five from xl

## [2.0.0] — 2026-09-24

### Breaking

- **compare-bar**: Round the empty slots, and name the bar's data attributes for the bar — the compare BAR's data attributes are renamed so they cannot be read as
the compare TABLE's — `data-compare-item-id` → `data-compare-bar-item-id`,
`data-compare-item-placeholder` → `data-compare-bar-item-placeholder`, and the new template
is `data-compare-bar-placeholder-template`. Core's own five references are updated here; a
fork that names the old attributes in its own JS or CSS has to follow.

### Added


## [1.103.3] — 2026-09-23

### Fixed

- **search**: A search term keeps everything after an "&"
- **core**: Navigation-position — re-measure on resize, measure from layout

## [1.103.2] — 2026-09-22

### Fixed

- **carousel**: Cascade breakpoints mobile-first before Swiper sees them

## [1.103.1] — 2026-09-22

### Fixed

- **core**: Tabs — cut a display:contents panel instead of crossfading it

## [1.103.0] — 2026-09-22

### Added

- **carousel**: Every multi-card carousel pages by the visible count

## [1.102.1] — 2026-09-22

### Fixed

- **core**: Compare.scss — compare checkbox on card media reads on any photo

## [1.102.0] — 2026-09-22

### Added

- **carousel**: Product carousels page by the visible count, not one card
- **swipe**: Several rows on the mobile swipe row

### Fixed

- **carousel**: SlidesPerGroup never skips a slide, whatever the breakpoint

## [1.101.2] — 2026-09-22

### Fixed

- **button**: Hide the size setting when the style is plain

## [1.101.1] — 2026-09-22

### Fixed

- **core**: Tooltip — fade in over 150ms, not the 500ms overlay tier

## [1.101.0] — 2026-09-22

### Added

- **parallax**: Play the zoom-out entrance natively, for every mode and video

### Fixed

- **parallax**: Exact cover scale, a timeline that starts where the media is, compositor drift

## [1.100.10] — 2026-09-22

### Fixed

- **core**: Product-form — keep the variant id in sync when the add-to-cart block is hidden

## [1.100.9] — 2026-09-21

### Fixed

- **motion**: Hold a proxy-driven entrance until the element itself arrives

## [1.100.8] — 2026-09-21

### Fixed

- **motion**: Stop entrances starting before the element is visible

## [1.100.7] — 2026-09-21

### Fixed

- **motion**: Let a clipped element still see the viewport

## [1.100.6] — 2026-09-21

### Fixed

- **motion**: Let an explicit mobile: name a kind that fades

## [1.100.5] — 2026-09-18

### Fixed

- **core**: Bleed the fixed-parallax media past its frame

## [1.100.4] — 2026-09-18

### Added

- **motion**: A preset can name its own small-screen kind
- **core**: Smooth scrolling via Lenis, behind a merchant setting

### Changed

- **core**: Drop a dead Lenis option, start it deterministically, move its setting
- **core**: Sit Smooth scrolling directly under Scroll animations

### Fixed

- **core**: Stop the smooth-scroll setting from reformatting settings_schema
- **core**: Let Lenis step aside for scrollers nested inside overlays
- **core**: Restore the two lenis-prevent selectors the mirrored CSS dropped

## [1.100.3] — 2026-09-18

### Fixed

- **motion**: A fork preset could not carry its own start state
- **core**: Wrap the richtext values that Shopify rejects at upload

## [1.100.2] — 2026-09-18

### Fixed

- **hero-banner**: Size the pinned parallax media to its frame, not the viewport

## [1.100.1] — 2026-09-18

### Fixed

- **core**: Reserve the scrollbar gutter instead of compensating for it

## [1.100.0] — 2026-09-18

### Added

- **hero-banner**: Scroll parallax for the banner media, in four modes

## [1.99.12] — 2026-09-17

### Fixed

- **core**: Give a lone-icon button a way to say so without being resized

## [1.99.11] — 2026-09-17

### Fixed

- **core**: The bought-together toggle labels its faces like a button

## [1.99.10] — 2026-09-17

### Fixed

- **core**: Two more labels the scripts rewrite past their data-label

## [1.99.9] — 2026-09-17

### Fixed

- **core**: Extend the data-label hook to tabs and multi-class labels
- **core**: Cover labels whose class is built in Liquid, and keep them in sync

## [1.99.8] — 2026-09-17

### Fixed

- **core**: The fork-preset recipe pointed at a selector that can never match
- **core**: Give .btn__text a data-label hook for label-roll effects

## [1.99.7] — 2026-09-17

### Fixed

- **core**: Drop the secondary button border and its colour setting

## [1.99.6] — 2026-09-17

### Fixed

- **core**: Responsive-image — the blank-image SVG never got the hover hook

## [1.99.5] — 2026-09-16

### Fixed

- **core**: Carousel.js — autoplay handler no longer overwrites the entrance listener key

## [1.99.4] — 2026-09-15

### Fixed

- **core**: Icon-box.scss — link caret after heading never wraps alone

## [1.99.3] — 2026-09-15

### Fixed

- **size-style**: Scale a pixel width fluidly when desktop and mobile are both pixel

## [1.99.2] — 2026-09-15

### Fixed

- **core**: Compare-table — opt-in bleed + gap_start, remove button stays hoverable

## [1.99.1] — 2026-09-14

### Fixed

- **core**: Wt-theme.mjs — parse only the JSON line from theme push --json

## [1.99.0] — 2026-09-14

### Added

- **product-card**: Global title line limit setting, on the standard, bundle and FBT cards
- **product-card**: The selection card follows the global title line limit

### Fixed

- **compare**: Reserve the remove button's space on the bar item title only

## [1.98.13] — 2026-09-11

### Fixed

- **core**: Cart-count — replace the --unstyled modifier with a style param

## [1.98.12] — 2026-09-11

### Fixed

- **core**: Counter-component — re-measure the reserved width on resize

## [1.98.11] — 2026-09-10

### Fixed

- **clean-data-json**: Strip every shopify:// value again — no rewrite of the generic routes

## [1.98.10] — 2026-09-10

### Fixed

- **schema**: Every section/block preset carries a category so the picker groups it

## [1.98.9] — 2026-09-10

### Fixed

- **submit-theme**: No release-notes.md in a first-submission zip

## [1.98.8] — 2026-09-10

### Fixed

- **clean-data-json**: Rewrite the generic shopify:// routes to plain paths

## [1.98.7] — 2026-09-10

### Fixed

- **check-listings**: Share the generic shopify:// route rule with the cleaner

## [1.98.6] — 2026-09-10

### Fixed

- **clean-data-json**: Keep the store-agnostic shopify:// routes

## [1.98.5] — 2026-09-10

### Fixed

- **a11y**: Label[for] + id on the bundle, FBT, selection card and maps selects

## [1.98.4] — 2026-09-10

### Fixed

- **a11y**: Visible focus on the localization select; valid markup in the cart title

## [1.98.3] — 2026-09-10

### Fixed

- **a11y**: Unique id + label[for] on variant radios, grid controls, finder select
- **a11y**: Unique ids for localization forms and price-range inputs
- **a11y**: Gift-card recipient form — label[for] on the radios, labels for email and name

## [1.98.2] — 2026-09-10

### Added

- **blocks**: Contact form and featured collection presets declare their category

### Fixed

- **product-tabs**: The Layout header sits above the container setting it labels
- **audit-url**: Stop on a password-gated store; tolerate insight audits' keyed items
- **password**: Render shop.password_message, flush submit, skip link, named dialog

## [1.98.1] — 2026-09-10

### Fixed

- **volume-pricing**: The show-more toggle uses the shared plain button, and its icon rotates about its centre
- **media-gallery**: The active thumbnail's mat band keeps its rounded opening

## [1.98.0] — 2026-09-10

### Added

- **typography**: Richtext section headings — preset class wins over the tag inside

## [1.97.7] — 2026-09-10

### Added

- **scripts**: Submit/* and store/* tags tell reviewer rounds from releases

### Documentation

- List the store-state / tag-submit / tag-store scripts in the build commands

### Fixed

- **toolkit**: /submit-theme gates on the release branch, not only main
- **toolkit**: /submit-theme — bump lands on main, version holds through review rounds

## [1.97.6] — 2026-09-10

### Fixed

- **js**: Drop a debug console.log and a console.warn for a normal state

## [1.97.5] — 2026-09-09

### Documentation

- **toolkit**: The Claude in Chrome extension replaces chrome-attached

## [1.97.4] — 2026-09-09

### Fixed

- **motion**: The entrance movement gets a curve that ends — no sub-pixel tail for Firefox to shiver through
- **media**: Give a zooming image its own surface — Firefox steps a scaled image to the pixel grid
- **motion**: Dense linear() curves, and a 3D reveal tween for Firefox
- **scripts**: Strip credentials and normalise list-collections for the zip

## [1.97.3] — 2026-09-09

### Fixed

- **button**: A disabled .btn no longer runs the hover fill

## [1.97.2] — 2026-09-09

### Fixed

- **cart-drawer**: Reopen at the top; scroll to a line added from inside the open drawer

## [1.97.1] — 2026-09-09

### Fixed

- **button**: .btn--white hover text follows the fill, not a hardcoded white

## [1.97.0] — 2026-09-09

### Added

- **media-gallery**: Dot pagination up to 12 media, reachable as pagination_max_dots

### Fixed

- **buy-buttons**: The block's padding sat inside the block on a gift card

## [1.96.2] — 2026-09-09

### Added

- **compare**: A column skeleton in place of the loading spinner
- **compare**: Let a "Remove all" opt out of standing around when empty

### Fixed

- **compare**: The bar's collapse toggle runs as a transition
- **flex-carousel**: Tablet gap follows the settings; per-breakpoint columns
- **core**: Media load feedback — no grey-backdrop delay, fast load fade, lazy margin one viewport ahead
- **slideshow**: The active slide's first run takes the first-paint path
- **page-transition**: Hold the curtain for the motion runtime, capped at 1s
- **carousel**: Preload the neighbouring slides' lazy images; one replay per slide change
- **image-priority**: The doc block leaked a newline into every loading value

## [1.96.1] — 2026-09-09

### Fixed

- **header**: The mega-menu content no longer fades in behind its own slide
- **header**: Hold the scroll lock through a menu-to-menu handoff

## [1.96.0] — 2026-09-09

### Added

- **sections**: Expose mobile block padding on the last four sections without it
- **core**: Compare — image_border_radius on the Product information block

### Fixed

- **page-transition**: Lift the curtain early, cross-fade the entrances into it, never strand it

## [1.95.3] — 2026-09-09

### Fixed

- **product-finder**: No layout shift when the mobile panel collapses; card-sized video posters

## [1.95.2] — 2026-09-08

### Fixed

- **carousel**: One width for the pill bullet, reachable by its variable

## [1.95.1] — 2026-09-08

### Added

- **contact-form**: Mobile column gap + a realistic desktop gap ceiling

### Fixed

- **core**: Media gallery — nav centre ignores the dialog scale, a variant swap reveals without the entrance

## [1.95.0] — 2026-09-08

### Added

- **variant**: Option availability, the sticky bar and a missing combination update from the cache, not the HTML round-trip

## [1.94.1] — 2026-09-08

### Changed

- **css**: Split the filter UI out of template-collection.css into scoped-filters.css

### Fixed

- **search**: Recommendations cache by URL, not one promise for the page
- **ci**: Run the inline-asset-budget step on node:22

## [1.94.0] — 2026-09-08

### Added

- **promotion-alert**: The alert closes and stays closed for the session
- **ci**: Check-inline-assets — fail before Shopify silently drops an inlined stylesheet

## [1.93.11] — 2026-09-08

### Fixed

- **core**: Stop Link-preloading responsive images; inline the collection stylesheet

## [1.93.10] — 2026-09-08

### Fixed

- **carousel**: Coalesce Swiper's per-image load update into one per frame

## [1.93.9] — 2026-09-08

### Changed

- **search**: Product-type options load on demand instead of shipping on every page
- **search**: Recommendation products load on demand behind a skeleton
- **article-card**: The meta row stays on one line at every card width

### Fixed

- **search**: No-results copy uses natural text wrapping
- **alert**: The icon keeps its size in a flex alert content row
- **logo**: The logo width switches at the same breakpoint as the image
- **search**: The product-type filter no longer double-encodes the query term
- **search**: The product-type select still filters when predictive search is off
- **core**: Keep the LCP image Link preload under Shopify's 2048-byte header cap

## [1.93.8] — 2026-09-08

### Changed

- **css**: Tier-1 scoped split — 9 section/block partials leave theme.css

## [1.93.7] — 2026-09-07

### Fixed

- **image-priority**: The first-viewport guess only fires in the template flow

## [1.93.6] — 2026-09-07

### Fixed

- **media**: One high-priority image per product page + video posters get preload

## [1.93.5] — 2026-09-07

### Added

- **group**: A vertical group can distribute its blocks down its own height

### Fixed

- **collection**: The first card image sends a Link preload header

## [1.93.4] — 2026-09-07

### Fixed

- **hero**: The LCP image sends a Link preload header
- **image-priority**: An eager image never keeps the lazy default's LOW

## [1.93.3] — 2026-09-07

### Fixed

- **a11y**: Names for silent dialogs, buttons and stretched links
- **schema**: Settings groups follow the house order — editor-only

## [1.93.2] — 2026-09-07

### Fixed

- **carousel**: Pagination bullet hit area reaches the 24px floor

## [1.93.1] — 2026-09-07

### Fixed

- **locales**: Theme Store §14 text-style — spellings, ampersands, typos
- **locales**: De/fr terms label — ampersand out, matching the EN fix

## [1.93.0] — 2026-09-07

### Added

- **group**: Mobile gets its own vertical alignment when the row stays a row
- **cart-recommendations**: The block picks its own card style

### Fixed

- **compare**: Tighten the compare bar's vertical rhythm on desktop

## [1.92.5] — 2026-09-07

### Fixed

- **cart-recommendations**: Name the card scheme checkbox after what it does

## [1.92.4] — 2026-09-07

### Fixed

- **images**: Honor the Files-page focal point + guarantee an alt attribute
- **images**: A nil alt param no longer suppresses the attribute in liquid mode

## [1.92.3] — 2026-09-07

### Fixed

- **swiper**: Bundle the A11y module — slide and bullet semantics return

## [1.92.2] — 2026-09-07

### Fixed

- **forms**: Unique input ids when newsletter or contact-form renders twice

## [1.92.1] — 2026-09-07

### Fixed

- **store-audit**: Ground every verdict in the official requirements page

## [1.92.0] — 2026-09-07

### Added

- **product-card**: Let a caller paint the box card with its own scheme

## [1.91.0] — 2026-09-07

### Added

- **marquee**: Mobile padding, and the mobile gap sits in Mobile layout

### Changed

- **cart-drawer**: Recommendations become the _cart-recommendations block

### Fixed

- **popup**: The image corners follow the dialog radius

## [1.90.2] — 2026-09-04

### Fixed

- **variant-switch**: Price and title match their own block in the fetched page
- **currency-code**: Every JS-rendered price follows the merchant setting

## [1.90.1] — 2026-09-04

### Fixed

- **contact-form**: Preset places the three static field blocks

## [1.89.0] — 2026-09-04

### Added

- **tooling**: Theme dev picks the first free port, so repos run in parallel
- **contact-form**: Submit button group, and per-breakpoint field width
- **contact-form**: Name, email and message become static field blocks

### Changed

- **predictive-search**: Result headings get per-group hook classes, not the capitalize helper

## [1.88.12] — 2026-09-04

### Fixed

- **core**: Reversed-link — the hover text colour becomes a tunable

## [1.88.10] — 2026-09-03

### Fixed

- **core**: Shopify-account — the signed-out label inherits the button font

## [1.88.9] — 2026-09-03

### Fixed

- **tooling**: Strip and police store-resource settings by schema type, not name

## [1.88.8] — 2026-09-03

### Changed

- **form**: Textarea sizing lives on textarea.form-control, not the article template

### Fixed

- **search**: Header and drawer search inputs start empty on the search page
- **form**: Select arrow keeps its stroke weight at any arrow size
- **core**: Video-card — an ancestor can switch hover-play off

## [1.88.7] — 2026-09-03

### Added

- **contact-form**: Submit button alignment + width settings grouped under Size

### Fixed

- **core**: Mobile `adapt` ratio uses the image's natural aspect ratio
- **slideshow**: Slide fills the track and its overlay stops inheriting the section radius

## [1.88.6] — 2026-08-31

### Fixed

- **core**: Recently viewed products render a skeleton and morph the list in
- **core**: Product recommendations `list` layout gets a horizontal card skeleton

## [1.88.5] — 2026-08-30

### Fixed

- **core**: Cart drawer recommendations show a real skeleton while fetching

## [1.88.4] — 2026-08-28

### Fixed

- **core**: Cart drawer recommendations swap at once and show a card-shaped skeleton

## [1.88.3] — 2026-08-28

### Fixed

- **core**: Tabs panel keeps its place when lifted out of flow

## [1.88.2] — 2026-08-28

### Fixed

- **settings**: Button link gets its own colour-scheme heading

## [1.88.1] — 2026-08-28

### Fixed

- **motion**: Held elements get the CSS start state too

## [1.88.0] — 2026-08-28

### Added

- **accordion**: Separate mobile padding for the block wrapper

## [1.87.0] — 2026-08-28

### Added

- **core**: _product-below-media container replaces the per-block toggle

## [1.86.1] — 2026-08-28

### Fixed

- **core**: Product recommendations swap in without the layout jump

## [1.86.0] — 2026-08-27

### Added

- **icon-box**: Choose the link icon and its style
- **icon-box**: Color + size controls for the bare link icon

### Fixed

- **core**: Collection facets — underline accordion, quiet open-row line

## [1.85.0] — 2026-08-27

### Added

- **compare**: Heading settings + a Remove all button on both compare surfaces
- **main-collection**: Inline padding settings for the full-width container
- **core**: Accordion — underline style, open-row divider, row gap, honest padding

### Fixed

- **product-media-gallery**: Hide the Carousel group in Grid mode and stop vertical thumbs blanking the grid

## [1.84.6] — 2026-08-26

### Fixed

- **search-drawer**: Keep the dialog close button inside the search header

## [1.84.5] — 2026-08-26

### Fixed

- **core**: Icon-or-image — custom size survives a colour

## [1.84.4] — 2026-08-26

### Changed

- **button**: Scale the size variants from the Button height setting

## [1.84.3] — 2026-08-25

### Fixed

- **core**: Collection/search showcase params — ?layout=grid|list and ?sidebar=open|closed override the tab's state for one page, never persisted

## [1.84.2] — 2026-08-25

### Fixed

- **promotion-alert**: Top-align the icon beside the alert text
- **quick-add**: Surface add-to-cart errors in the cart instead of dropping them

## [1.84.1] — 2026-08-25

### Changed

- **compare**: Drop the :not(:hover) guard on the compare bar toggle

### Fixed

- **core**: Sticky-column — default to "fit or flow", keep both-directions behind data-sticky-mode

## [1.84.0] — 2026-08-25

### Added

- **core**: Grid block — Column separator gets its own settings group under Layout, deduplicated labels, and a "Show on mobile" toggle

## [1.83.14] — 2026-08-25

### Fixed

- **core**: Collection facets — scroll to the results, not the page top; smart sticky for sidebar + grid

## [1.83.13] — 2026-08-25

### Fixed

- **core**: Quick-view dialog gate, search pagination setting, popup scroll-trigger info
- **core**: Remove two settings a merchant can never use, and correct two misleading labels

## [1.83.12] — 2026-08-25

### Fixed

- **core**: Test-presets previews a listing in its own worktree instead of swapping the working tree

## [1.83.11] — 2026-08-25

### Fixed

- **core**: Clean-data-json empties the header's static-block children

## [1.83.10] — 2026-08-25

### Fixed

- **core**: Sync-listing skips templates/customers — theme-owned, never preset content; check-listings rejects nested template folders

## [1.83.9] — 2026-08-25

### Documentation

- **command**: Gen-docs tracks setting-level changes — manifest diff, table chips, sidebar chips via doc-updates.json, compact whats-new

## [1.83.8] — 2026-08-25

### Fixed

- **core**: Listings pipeline — clean at sync, color_schemes parity, default-preset mirror, test-presets rewrite, tolerant config parse

## [1.83.6] — 2026-08-25

### Documentation

- **core**: Rewrite JavaScript events & actions — clear actions/events split, full payload detail, drop Hyper section

## [1.83.5] — 2026-08-25

### Changed

- Accordion block padding settings and variable names

### Fixed

- Slide-content mobile width + slideshow layout
- Product card sale badge controlled by show setting
- **core**: Cart-items — error message display + quantity limit count
- **core**: Blur on a cart quantity input always reaches /cart/change
- **core**: Cart survives a bfcache restore instead of posting a dead line key
- **core**: Cart-count syncs from the server on bfcache restore

## [1.83.4] — 2026-08-24

### Fixed

- **core**: Cart-items — per-line gift wrap sync + error message display
- **core**: Morph cart sections before the /cart.js fetch so the drawer opens on fresh content

## [1.83.3] — 2026-08-24

### Fixed

- **ci**: Additive gate asks core whether a module is core-owned, not the path

## [1.83.2] — 2026-08-24

### Fixed

- **core**: Carousel absolute nav icon inherits the button color, not the outline variant's brand color
- **core**: Facet groups with an active filter render expanded after reload

## [1.83.1] — 2026-08-24

### Documentation

- **core**: JavaScript events for developers — standard storefront events first, theme events for the gaps

## [1.83.0] — 2026-08-24

### Added

- **core**: Standard storefront interaction events — product:select, collection:update, search:update

## [1.82.1] — 2026-08-24

### Fixed

- **core**: _component-swipe — stop containing the vertical overscroll

## [1.82.0] — 2026-08-24

### Added

- **core**: Standard storefront VIEW events — product, collection, cart (page + drawer)

## [1.81.0] — 2026-08-24

### Added

- **core**: Standard storefront events & actions — cart events dispatched, openCart/updateCart configured

## [1.80.0] — 2026-08-24

### Added

- **css**: Scoped per-section CSS — sections load their own stylesheet

## [1.79.0] — 2026-08-24

### Added

- **slideshow**: Height auto follows the first slide's media ratio

## [1.78.1] — 2026-08-24

### Fixed

- **a11y**: Article card media link always has an accessible name

## [1.78.0] — 2026-08-24

### Added

- **core**: Accordion gets an Animation group — type, reveal one by one, delay

## [1.77.0] — 2026-08-24

### Added

- **audit-url**: Fonts-blocked control run + --preview-theme

## [1.76.0] — 2026-08-23

### Added

- **toolkit**: Yarn audit:url — Lighthouse any live storefront, findings attributed to theme / Shopify / third-party / merchant with score impact

## [1.75.0] — 2026-08-23

### Added

- **toolkit**: Yarn audit:coverage — Lighthouse/axe every section + block preset, demo-independent

## [1.74.0] — 2026-08-22

### Added

- **core**: Icon-list gets an Animation group — type, reveal one by one, delay

## [1.73.1] — 2026-08-22

### Documentation

- **toolkit**: /store-audit — part menu + password-gated Lighthouse with CLI perf

## [1.73.0] — 2026-08-22

### Added

- **core**: Enable_preload_image on the collection and search grids — first row eager, first card high

## [1.72.2] — 2026-08-22

### Fixed

- **core**: Deferred-media survives a Swiper loop slide relocation

## [1.72.1] — 2026-08-22

### Fixed

- **core**: Motion-group re-stages AFTER the morph, so a filtered grid actually plays its entrance

## [1.72.0] — 2026-08-22

### Added

- **core**: Enable_preload_image on every above-the-fold image, via one image-priority helper
- **core**: Entrance animation setting for the collection and search result grids

### Fixed

- **core**: Motion-group fits its stagger into the budget everywhere, not only above the fold

## [1.71.1] — 2026-08-22

### Fixed

- **core**: Copy-to-clipboard falls back when the async Clipboard API is blocked

## [1.71.0] — 2026-08-22

### Added

- **product-card**: Mode params for the bundle card, a content grid for the FBT one

## [1.70.12] — 2026-08-22

### Fixed

- **core**: Cart line items carry an id so a morph never reuses another item's row
- **core**: Responsive-image — clear data-reveal-pending when the reveal plays
- **core**: Responsive-image — a cached JS-mode image off screen still arms the reveal
- **core**: Zoom-reveal prestage arms without a transition

## [1.70.11] — 2026-08-22

### Fixed

- **core**: Responsive-image — keep the scroll-in reveal for images the browser prefetched

## [1.70.10] — 2026-08-22

### Fixed

- **scripts**: Check-contrast no longer judges SVG paint as text

## [1.70.9] — 2026-08-22

### Fixed

- **core**: Image-coordinator — split lazy/resize registries, preload before the viewport
- **core**: Responsive-image — stop hiding images that beat the JS bundle
- **core**: Responsive-image snippet — above-fold images always render liquid mode

## [1.70.8] — 2026-08-22

### Fixed

- **scripts**: Check-contrast advises, it does not gate

## [1.70.7] — 2026-08-22

### Documentation

- **skill,agent**: SVG stroke calc() needs a px unit (proposal svg-stroke-unit-and-vector-effect)
- **skill,agent**: Logical properties do not flip a physically-anchored fill (proposal rtl-fill-is-anchored-physically)
- **agent,skill**: ShopifyBlocks needs data-section-id on the same element (proposal shopifyblocks-needs-data-section-id-on-the-same-element)
- **skill**: The `_` prefix is a visibility flag, and private blocks usually need presets (proposal private-blocks-and-presets)
- **skill**: Two gates that look closed and are not (proposal gates-that-look-closed)
- **skill,agent**: Swiper's derived state is mechanical, not semantic (proposal swiper-loop-does-not-clear-isbeginning-isend)

### Fixed

- **hero-banner**: Apply the section scheme when the content block inherits

## [1.70.6] — 2026-08-22

### Fixed

- **scripts**: See wrapped shorthands, and catch faded text below AA

## [1.70.5] — 2026-08-21

### Changed

- **icons**: Drop icon-discount, a duplicate of icon-tag

## [1.70.4] — 2026-08-21

### Fixed

- **core**: Guard custom_columns against a typo that zeroes a breakpoint

## [1.70.3] — 2026-08-21

### Fixed

- **quick-add**: Honour the form_id_suffix product-card-markup already passes
- **product-card**: Apply content alignment to the vertical layout only
- **featured-collection**: Stop the Grid layout rendering carousel controls

## [1.70.2] — 2026-08-21

### Fixed

- **product-card**: Pass form_id_suffix through to quick-add

## [1.70.1] — 2026-08-21

### Fixed

- **icons**: Remove the Chrome 151 non-scaling-stroke hotfix
- **product-bundle**: Drop the caret from the add-all-to-cart button

## [1.70.0] — 2026-08-20

### Added

- **icon-box**: Show the end caret in vertical layouts, aligned with the box

## [1.69.1] — 2026-08-20

### Fixed

- **product-card**: Keep one quick-add button in horizontal layout
- **compare**: Stack quick-view under the compare checkbox on the media overlay
- **blocks**: _content-label was unreachable in the block picker

## [1.69.0] — 2026-08-20

### Added

- **hero-banner**: Let the content column take a label block

## [1.68.0] — 2026-08-20

### Added

- **typography**: Reach the custom presets the first pass missed

### Fixed

- **product-bundle**: Let the desktop hotspot offsets drive its transform too

## [1.67.2] — 2026-08-20

### Fixed

- **compare**: Keep the compare UI in sync across every path that rebuilds the DOM

## [1.67.1] — 2026-08-20

### Fixed

- **tabs**: The sliding fill is a hover preview, not the selected state

## [1.67.0] — 2026-08-20

### Added

- **typography**: Give the custom type preset a text transform setting

## [1.66.0] — 2026-08-20

### Added

- **article-card-title**: Let merchants cap the title at a number of lines
- **article-card-title**: Let merchants cap the title at a number of lines

### Fixed

- **compare**: Recolor the compare-bar toggle border instead of redeclaring it
- **overlay**: Match the parent's INNER radius, not its inherited outer one

## [1.65.2] — 2026-08-20

### Fixed

- **motion**: Take the static transform off flex-carousel's slide roots

## [1.65.1] — 2026-08-20

### Fixed

- **motion-group**: Un-stage the cells a re-prestage is about to forget

## [1.65.0] — 2026-08-20

### Added

- **blog**: Add mobile + full-width padding settings to the blog section

### Fixed

- **article-card**: Drop the card-level overflow-hidden that cropped long titles
- **svg-strokes**: Stop the spinner scaling with --nss-fix, give the padlock a unit

## [1.64.17] — 2026-08-20

### Documentation

- **motion**: Finish the vocabulary sweep — the manifest and the morph skill

## [1.64.16] — 2026-08-20

### Breaking

- **motion**: Close the staging leaks and the boot regressions four reviews found — motionKeyframes() and motionTransformFrom() are removed from
@theme/motion-presets; use motionEndState(preset) for the end values, and let
the stylesheet own the start state via data-motion-from. MotionComponent's
public `motion` getter no longer exposes `distance` or `flip`, and
entranceMotion() no longer returns `distance` — all three only ever fed a start
state the runtime no longer computes.

### Changed

- **motion**: The stylesheet owns the start state; the runtime only animates to the end

### Fixed

- **motion**: Settle the prestage on DOMContentLoaded, and let each module report for itself
- **motion**: Recover a morphed group, survive a reduced-motion flip, and gate the generators in CI
- **mega-menu-sidebar**: Put the collection settings under their own header

## [1.64.15] — 2026-08-20

### Fixed

- **motion**: Resolve motion tokens against the element, not :root

## [1.64.14] — 2026-08-20

### Fixed

- **motion**: A scroll-snap row chased the group's entrance transform

## [1.64.13] — 2026-08-19

### Fixed

- **flex-carousel**: Mobile falls back to a grid when swipe is off

## [1.64.12] — 2026-08-19

### Fixed

- **tabs**: A lazy panel initialised against a zero-width box, and a blank frame between panels
- **tabs**: The crossfade emptied the container while the incoming panel laid out

## [1.64.11] — 2026-08-19

### Fixed

- **marquee**: Clip the strip to the marquee, not to the page
- **size-style**: A pixel width no longer inflates an intrinsically-sized parent

## [1.64.10] — 2026-08-19

### Fixed

- **motion**: A group ran at swap speed even when nothing asked for it

## [1.64.9] — 2026-08-19

### Added

- **cart**: Add mobile + full-width padding settings to the cart section

### Fixed

- **search**: Cap the product-type select so it cannot squeeze the input
- **compare**: Re-sync the compare UI after a bfcache restore

## [1.64.8] — 2026-08-19

### Fixed

- **product-card**: Bind card title letter-spacing/transform to its own font role
- **compare**: Make the compare dialog scroll vertically
- **marquee**: The resize observer saw the width and threw it away

## [1.64.7] — 2026-08-19

### Fixed

- **wt**: Wt:dev handed out a port without checking anyone was using it

## [1.64.6] — 2026-08-19

### Fixed

- **motion**: A budget slot is the animation, not the wait
- **checks**: The fork extension point failed the check that guards it

## [1.64.5] — 2026-08-19

### Fixed

- **wt-clean**: A never-started worktree read as merged and was removed

## [1.64.4] — 2026-08-19

### Documentation

- **skill,agent**: Block settings shadow kills global theme-setting guards
- **agent,claude-md**: Merge=ours swallows the whole file, on every merge

## [1.64.3] — 2026-08-18

### Fixed

- **checks**: --color-white is not a scheme role

## [1.64.2] — 2026-08-18

### Fixed

- **form**: Stretch the native select inside a .w-full wrapper

## [1.64.1] — 2026-08-17

### Added

- **motion**: Entrance vocabulary, list groups, and the fixes that had to come first
- **motion**: A preset registry the runtime, the CSS and a fork all read
- **motion**: A public API and declarative triggers
- **motion**: Small-screen policy, an LCP rule, and an exit
- **motion**: Let a group say what its cells are, and honour a delay
- **sections**: One animation vocabulary for the tab and carousel lists
- **settings**: Make the card image hover settable
- **carousel**: Always-white float nav buttons over media

### Changed

- **motion**: Name the motion tokens for what they are for
- **tabs**: One animation vocabulary, not two
- **motion**: One effect list behind every animation setting
- **tabs**: The panel entrance reads the motion registry

### Documentation

- **motion**: A manifest agents can read, checks that hold the rules
- **motion**: Motion is WAAPI, and that is why cancel() is not optional

### Fixed

- **motion**: One curve for fades, one floor for reduced motion
- **motion**: What testing the system found in the system
- **carousel**: A fade carousel hides slides with opacity, which in-view cannot see
- **motion**: A component could not stop its own animation, so replay painted over
- **motion**: Above-the-fold was decided per BATCH, so a carousel made it random
- **motion**: Above-the-fold outlived the first paint, so a slideshow never slowed down
- **flex-carousel**: The entrance played on the card's picture, not the card
- **motion**: The Animations setting stops reaching hover
- **product-card**: The second-image crossfade never actually ran
- **checks**: The easing rule could not see most of what it was written to check
- **compare**: Compare bar row — size the grid track, not the flex item
- **compare**: Hide the whole compare bar when inactive
- **badge**: Fall back to "On sale" when a percentage discount rounds below 1%

## [1.64.0] — 2026-08-17

### Added

- **accordion**: Make row chrome settable, and fix three quiet bugs

## [1.63.0] — 2026-08-14

### Added

- **core**: Product-card-selection-markup — variant-aware, boxable, and a box-padding fix

## [1.62.2] — 2026-08-14

### Documentation

- **skill**: Vendor state classes, dead output, and the icon-stroke architecture

### Fixed

- **icons**: Compensate Chrome 151 non-scaling-stroke HiDPI regression
- **carousel**: Hide watchOverflow-locked controls, and drop the counter 'Arrows + dots' never asked for

## [1.62.1] — 2026-08-14

### Fixed

- **core**: Header account button — sizing on shopify-account, avatar 20px, full hit area

## [1.62.0] — 2026-08-14

### Added

- **carousel**: Optional carousel_controls_mobile, and keep the arrow style a breakpoint that hides them cannot vote on

## [1.61.3] — 2026-08-14

### Fixed

- **core**: Collection-list + collection-tabs counter — turn the Swiper flag on

## [1.61.2] — 2026-08-13

### Fixed

- **core**: Selection card — variant-sync contract + choose_options label
- **core**: Product-card-fbt-markup — one quantity picker, shown or hidden

## [1.61.1] — 2026-08-13

### Fixed

- **core**: Product-card-fbt-markup — useless select, standard-card ring, adapt ratio

## [1.61.0] — 2026-08-12

### Added

- **core**: Product-card-fbt-markup — layout / style / toggle / quantity axes

## [1.60.3] — 2026-08-12

### Changed

- **core**: Carousel — unify control + overflow settings across sections
- **core**: Rename products-bundle → product-bundle

### Fixed

- **core**: Carousel edge fade — driver-owned state, drop breakpoint mutes
- **core**: Float nav centers on media; picker preview card width
- **core**: Bundle product card honours pcard_sale_badge_placement

## [1.60.2] — 2026-08-12

### Fixed

- **core**: Bundle product card — variant media, badge placement, wrapper gap

## [1.60.1] — 2026-08-12

### Fixed

- **core**: Product cards — external_video first media broke the image

## [1.60.0] — 2026-08-12

### Added

- **core**: Breadcrumbs — merchant-selectable divider

## [1.59.3] — 2026-08-12

### Fixed

- **core**: Product-finder — render args take no filters, pre-assign panel padding fallbacks

## [1.59.2] — 2026-08-12

### Fixed

- **social-sharing**: Guard the media param and URL-encode every share value
- **article-social**: Pass share_url and article.image, absolute

## [1.59.1] — 2026-08-11

### Fixed

- **core**: Carousel — only scroll to a focused slide when it is off-screen
- **core**: Select--outline — arrow follows the text to --color-foreground

## [1.59.0] — 2026-08-11

### Added

- **simple-text**: Add disable line break on mobile option

### Changed

- **image-card**: Content padding as two-axis ranges

### Fixed

- **text**: Keep the word gap when a mobile line break is removed
- **image-card**: Let content padding reach the top edge below the media

## [1.58.0] — 2026-08-11

### Added

- **core**: Export the remaining products-bundle classes

## [1.57.1] — 2026-08-11

### Documentation

- **usage**: Browser MCP servers need a lifecycle, not just a launch command

### Fixed

- **core**: Wt:theme — fail fast on a delete confirmation with no TTY
- **agent**: L2 can close the tabs it opens in the attached browser

## [1.57.0] — 2026-08-11

### Added

- **core**: Export ProductsBoughtTogether + map @theme/products-bundle

## [1.56.4] — 2026-08-10

### Fixed

- **core**: Check-liquid — re-apply .theme-check.yml ignore globs ourselves

## [1.56.3] — 2026-08-10

### Documentation

- **agent**: L2 drives the theme editor via attached Chrome (proposal l2-can-drive-the-theme-editor-via-attached-chrome)

## [1.56.2] — 2026-08-10

### Documentation

- **skill,agent**: Visible_if groups right-to-left; parens are invalid

## [1.56.1] — 2026-08-10

### Fixed

- **core**: Check-visible-if now audits config/settings_schema.json
- **core**: Wt:dev forwards flags to `shopify theme dev`

## [1.56.0] — 2026-08-10

### Added

- **core**: Overlay snippet supports a gradient, wired into all five surfaces

## [1.55.3] — 2026-08-07

### Fixed

- **core**: .gitattributes — merge=ours for the four ratchet baselines

## [1.55.2] — 2026-08-07

### Documentation

- **agent**: L2 viewport matrix uses emulate, not resize_page (proposal l2-viewport-matrix-needs-emulate-not-resize)

## [1.55.1] — 2026-08-07

### Fixed

- **core**: Close the edge-shadow review gaps in flex-carousel

## [1.55.0] — 2026-08-07

### Added

- **check**: Fail on a scheme-role var inside a shorthand (proposal escalate-empty-var-shorthand-to-a-check)

### Documentation

- **skill**: A container block that styles its cells must wrap each child (proposal layout-container-recipe-contradicts-the-wrapper-option)
- **agent**: Fixture a container by child TYPE, not child count; a harness refutes but never confirms (proposal container-fixtures-need-the-hardest-child)
- **skill**: Design intent is not a verifiable fact — ask the designer (proposal designer-intent-is-not-a-verifiable-fact)

## [1.54.3] — 2026-08-07

### Fixed

- **core**: Close nav-gate gaps in carousel-centered-slider review
- **core**: Restore the nav-gate flag in a finally, sync only the active bullet on lock

## [1.54.2] — 2026-08-07

### Documentation

- **toolkit**: A vendor-flag restore belongs in a finally

## [1.54.1] — 2026-08-07

### Added

- **core**: Drive .edge__shadows from carousel-centered-slider

### Documentation

- **toolkit**: Land the vendor-config + selector lessons from PR #174

### Fixed

- **core**: Carousel-centered-slider — correct pagination index and gate rapid nav
- **core**: Grid-markup — a malformed custom_columns pair no longer collapses a breakpoint to one column

## [1.54.0] — 2026-08-05

### Added

- **counter**: Expose the gap between the number and its content

## [1.53.0] — 2026-08-05

### Added

- **carousel**: Opt-in thumbnail-swipe → main sync via syncOnSwipe

### Fixed

- **icon-box**: Only make the card inert when it actually has a link

## [1.52.2] — 2026-08-05

### Fixed

- **video-markup**: Resolve an aspect ratio for the player_only placeholder

## [1.52.1] — 2026-08-05

### Documentation

- **skill,agent**: Gap decorations belong to the container (proposal gap-decoration-belongs-to-the-container)

## [1.52.0] — 2026-08-05

### Added

- **grid**: Column separator between columns (none/solid/dashed)

## [1.51.9] — 2026-08-04

### Documentation

- **skill,agent**: Two review-lane lessons from foxtheme-motrix

## [1.51.8] — 2026-08-04

### Fixed

- **typography**: .paragraph also resets the transform on nested headings

## [1.51.7] — 2026-08-03

### Added

- **typography**: Heading text-transform + letter-spacing, with the .paragraph reset

### Documentation

- **skill,agent**: A new select value must reach every reader (proposal 2026-08-03-select-option-must-reach-every-reader)

## [1.51.6] — 2026-08-03

### Fixed

- **core**: Collection card — pixel width, wider title presets, sizes for pixel

## [1.51.5] — 2026-08-03

### Documentation

- **agent**: Flag request.* compared to a boolean (proposal 2026-08-03-liquid-nil-equals-false)

## [1.51.4] — 2026-08-03

### Documentation

- **command**: Gen-docs covers the theme settings (proposal 2026-08-03-gen-docs-covers-theme-settings)
- **command**: Leave change markers when regenerating docs (proposal 2026-08-03-gen-docs-change-markers)

## [1.51.3] — 2026-08-03

### Documentation

- **skill,agent**: Refs are captured by any *-component wrapper (proposal 2026-08-03-motion-component-captures-refs)
- **skill,agent**: Var() fallback does not fire on an empty value (proposal 2026-08-03-var-fallback-vs-empty-value)

## [1.51.2] — 2026-07-31

### Fixed

- **core**: Swipe-component — support vertical axis + small-tablet breakpoint

## [1.51.1] — 2026-07-31

### Documentation

- **agent**: Environment claims are hypotheses, not measurements (proposal 2026-07-30-verify-subagent-environment-claims)
- **agent**: Route class-level review findings out of the disposable doc (proposal 2026-07-31-review-findings-must-outlive-the-review-doc)

## [1.51.0] — 2026-07-31

### Added

- **toolkit**: Port-toolkit + /init-project — carry the toolkit to independent themes

## [1.50.1] — 2026-07-31

### Fixed

- **ci**: Exempt scripts/ tooling from the feat/** additive check
- **agent**: L1 + reviewer gates must run check-capability-headers
- **toolkit**: Capability headers on vendored bundles belong in src/js/library sources

## [1.50.0] — 2026-07-31

### Added

- **build**: Strip comments from JS assets at zip time

## [1.49.0] — 2026-07-30

### Added

- **toolkit**: Capability index — generated reuse catalog in PROJECT-MAP §0

## [1.48.2] — 2026-07-29

### Documentation

- **skill**: Reuse-first must cover behavioural components, not just snippets

## [1.48.1] — 2026-07-29

### Fixed

- **core**: Button-markup — honour with_wrapper: false, stop double-escaping aria-label

## [1.48.0] — 2026-07-29

### Added

- **js**: Export TabsComponent and open animateIn() as an extension point

### Documentation

- **agent**: Five review-judgement lessons from a three-PR session

### Fixed

- **toolkit**: Pin @shopify/cli in the repo — scripts never meet a stale CLI again
- **block**: Pass icon_size through to button-markup in _article-card-button
- **script,snippet**: Guard src/js/global in the additive check; gate fetchpriority

## [1.47.1] — 2026-07-28

### Documentation

- **toolkit**: Unname the example file in the hook comment — check-toolkit-refs flagged scripts/x.js

### Fixed

- **toolkit**: Allowlist hook matches per-segment + reviewer vocabulary — closes compound smuggling and 4 real popups

## [1.47.0] — 2026-07-28

### Added

- **check**: Check-preset-values — enum preset values vs their options

### Fixed

- **block**: Counter preset vertical_alignment center -> middle

## [1.46.1] — 2026-07-28

### Fixed

- **build**: Build:css works in a fresh worktree and FAILS loudly on errors

## [1.46.0] — 2026-07-28

### Added

- **toolkit**: /review-pr worktree-native — real PR menu, --l1/--l2, no more main-tree checkout

### Fixed

- **toolkit**: Kill the remaining /review-pr + diff-reviewer popups

## [1.45.1] — 2026-07-28

### Documentation

- **agent,skill**: Three verification gaps found building a maps block

### Fixed

- **toolkit**: Stop assuming every branch ends in the fork

## [1.45.0] — 2026-07-28

### Added

- **block**: Maps — a Google map with a location picker

## [1.44.0] — 2026-07-28

### Added

- **core**: Layout-panel-style — add flex_wrap param

### Fixed

- **core**: Responsive-image — include the source image's native width in srcset

## [1.43.3] — 2026-07-27

### Fixed

- **toolkit**: Chrome-devtools headless by default — L2's browser stops stealing focus

## [1.43.2] — 2026-07-25

### Fixed

- **toolkit**: Chrome-devtools-mcp --isolated — per-session Chrome, ends cross-session L2 contention

## [1.43.1] — 2026-07-25

### Documentation

- **skill**: Design-to-brief gains Verify-don't-recall + an Evidence log (proposal verify-dont-recall-factual-claims)

## [1.43.0] — 2026-07-25

### Added

- **toolkit**: Slack-bug-list skill — Phase 6 bug intake from Slack Lists

## [1.42.3] — 2026-07-25

### Documentation

- **command**: Fix-core distinguishes core capability from child re-skin (proposal fix-core-capability-vs-reskin)

## [1.42.2] — 2026-07-25

### Added

- **icon-box**: Raise border_radius max 20 → 60 for pill badges

### Fixed

- **toolkit**: L2 preview hardening — six findings from one motrix run

## [1.42.1] — 2026-07-24

### Documentation

- **skill,agent**: Derive on-accent text with color_contrast, never hardcode white (proposal on-accent-text-color-contrast)

## [1.42.0] — 2026-07-24

### Added

- **icon-box**: Inline link caret + custom border color
- **wt**: One development theme per worktree, so parallel previews stop clobbering

### Fixed

- **l2**: Address each browser tab by pageId so testers can't hijack each other

## [1.41.4] — 2026-07-24

### Documentation

- **command**: Gen-docs is the P3 finalize step (run by name before PR)

### Fixed

- **fork-workflow**: CHANGELOG is core-owned (synced down); forks don't auto-release

## [1.41.3] — 2026-07-24

### Documentation

- **skill**: Create-liquid-block — nested-child, inline_richtext, metaobject rich_text gotchas
- **skill**: Create-scss-module — CSS has no ceil/floor, @supports traps
- **agent**: Fork-sync-resolver — merge-driver semantics + sections/*.json

## [1.41.2] — 2026-07-24

### Fixed

- **mega-menu**: Downcase menu titles before handle for Greek matching

## [1.41.1] — 2026-07-23

### Documentation

- **toolkit**: BLOCK-ANATOMY — _icon-box now delegates to icon-box-markup via shopify_attributes param
- **toolkit**: Create-liquid-block — same shopify_attributes param rename in the skill's bullet

## [1.41.0] — 2026-07-22

### Added

- **icon-box**: Content as nested _text-plain blocks, layout-panel-flex, card padding

## [1.40.0] — 2026-07-22

### Added

- **layout**: Add layout-panel-flex--row-mobile modifier

### Changed

- **icon**: Delegate _icon block markup to the icon-markup snippet

### Fixed

- **toolkit**: L2 seeding — auth preflight with exact remedy + store-setup definitions rule

## [1.39.4] — 2026-07-22

### Fixed

- **toolkit**: Check-listings dependency-free — CI lint step runs without yarn install

## [1.39.3] — 2026-07-22

### Fixed

- **core**: Quick-view.js — fall back to data-product-url when the card ref is missing

## [1.39.2] — 2026-07-21

### Added

- **toolkit**: Systematize around the theme lifecycle — 7-phase map + P0/P1/P4/P5 commands

### Documentation

- **skill**: Create-scss-module — dividers on an incomplete last row (proposal 2026-07-21-grid-dividers-incomplete-last-row)
- **skill**: Create-liquid-block — richtext values incl. presets need a block tag (proposal 2026-07-21-richtext-preset-block-tag)

### Fixed

- **toolkit**: Harden lifecycle commands after teamlead feedback
- **toolkit**: COMMANDS.md usage guide + /audit-toolkit findings (A+B+C)

## [1.39.1] — 2026-07-21

### Fixed

- **toolkit**: Harden after full /audit-toolkit run — 4-agent audit findings

## [1.39.0] — 2026-07-21

### Added

- **core**: Add 'Button link' colour role → themeable btn--plain

## [1.38.1] — 2026-07-21

### Changed

- **toolkit**: L1/L2 coverage — interactions, setting pairs, measured visuals, data seeding

## [1.38.0] — 2026-07-20

### Added

- **toolkit**: /audit-toolkit — packaged periodic semantic audit

### Fixed

- **toolkit**: Check-toolkit-refs — gitignored paths are legit doc references
- **toolkit**: Move briefs out of .claude/ — the self-settings gate can't be allowed away

## [1.37.4] — 2026-07-20

### Added

- **toolkit**: Anti-drift check + brief archiving

### Changed

- **toolkit**: Fix snippet docs at the root, thin SKILL↔ANATOMY duplication

### Documentation

- **skills**: Spec-table CSS + data-binding gotchas (proposal 2026-07-20-spec-table-css-liquid-gotchas)

### Fixed

- **toolkit**: Land 2026-07-20 audit — stale refs, permission syntax, agent/command drift

## [1.37.3] — 2026-07-20

### Documentation

- **usage**: Drop the last "wt:dev runs in parallel" claim

## [1.37.2] — 2026-07-20

### Fixed

- **core**: _component-dialog.scss — drop dead close-offset desktop vars

## [1.37.1] — 2026-07-20

### Fixed

- **core**: Marquee.liquid — terminate --order declaration with a semicolon

## [1.37.0] — 2026-07-17

### Added

- **command**: Add /fix-core — land a core-file fix from a child without the round-trip

## [1.36.4] — 2026-07-17

### Added

- **core-proposals**: Add fork→core up-channel mechanism

### Changed

- **worktree**: Centralize worktree creation in `yarn wt:add`

### Documentation

- **skills,agents**: Land shoppable-media-gallery lessons (proposal 2026-07-17)

### Fixed

- **hooks**: Auto-approve Skill for feature agents + close permission gaps
- **marquee**: Import isRTL and drop the always-false this.isRTL flag
- **carousel**: Position nav buttons against product card media wrapper

## [1.36.3] — 2026-07-16

### Fixed

- **revise**: Close four gaps found in an adversarial pass

## [1.36.2] — 2026-07-15

### Fixed

- **carousel**: Scope group-layout button styles and reset offsets on mobile

## [1.36.1] — 2026-07-10

### Fixed

- **revise**: Make the settings delta explicit so a revision can't leave orphans
- **carousel-counter**: Resolve current index from data-swiper-slide-index for looped/cloned slides

## [1.36.0] — 2026-07-10

### Added

- **command**: Add /revise; guard every command against empty $ARGUMENTS

### Fixed

- **permissions**: Pre-allow brief writes so /revise never prompts

## [1.35.0] — 2026-07-10

### Added

- **checks**: Add check-range-steps; auto-approve MCP for agents; fence L2 artifacts

### Documentation

- **gitignore**: Correct why worktrees live outside .claude/

### Fixed

- **gitignore**: Ignore node_modules as a symlink too

## [1.34.2] — 2026-07-09

### Changed

- **header**: Use `this` directly instead of re-querying .header

### Fixed

- **toolkit**: Register auto-approve hook in core settings; move worktrees out of .claude/
- **header**: Correct sticky threshold when page loads already scrolled

## [1.34.1] — 2026-07-08

### Changed

- **ship-batch**: Orchestrate via Agent tool, not the workflow

### Fixed

- **agents**: Forbid `cd <path> && … redirection` compounds in worktrees

## [1.34.0] — 2026-07-08

### Added

- **command**: Add /ship-batch — autonomous build→test→fix loop

### Documentation

- Document the test/ship pipeline in CLAUDE.md + USAGE.md

### Fixed

- **ship-batch**: Parse string args in workflow, invoke by scriptPath

## [1.33.0] — 2026-07-08

### Added

- **agent**: Add feature-tester (L1) + feature-runtime-tester (L2)
- **command**: Add /test-batch — L1 fan-out + optional L2 gate

## [1.32.0] — 2026-07-08

### Added

- **agent**: Feature-builder auto-approves in its worktree (no prompts)

### Fixed

- **build-batch**: Symlink node_modules into each worktree

## [1.31.0] — 2026-07-06

### Added

- **icon**: Add custom color option to icon blocks

### Documentation

- **skills**: Apply child block-building learnings to core

## [1.30.0] — 2026-07-06

### Added

- **text**: Add custom color option across text blocks

### Documentation

- **skill**: Document custom text color option in BLOCK-ANATOMY

## [1.29.0] — 2026-07-03

### Added

- **compare**: Add product metafield row + extract shared col snippets and CSS

## [1.28.2] — 2026-07-02

### Added

- **colors**: Add color_palette setting with Palette header

### Fixed

- **product-card**: Apply media width on mobile horizontal layout
- **collection-card**: Use collection placeholder for empty image

## [1.28.1] — 2026-07-01

### Added

- **group**: Mobile column order + per-column mobile alignment

### Fixed

- **slideshow**: Tighten mobile height slider + reorder content position

## [1.28.0] — 2026-06-30

### Added

- **image**: Add pixel width option alongside percent for image block
- **scss**: Full-bleed-media cover/adapt mixin + retrofit hero & collection banner
- **slideshow**: Auto/custom height + single slide block with media type

### Documentation

- **skills**: Encode hero-product-finder lessons into skills & rules

### Fixed

- **localization**: Apply button size for any non-plain style
- **carousel**: Keep design-mode block-select working across re-renders

## [1.27.2] — 2026-06-30

### Added

- **banners**: Auto/custom height + cover/adapt media for hero & collection banner

### Fixed

- **button**: Prevent icon shrink inside .btn
- **slideshow**: Scope media cover to background only, not control svgs

## [1.27.1] — 2026-06-29

### Changed

- **top-bar**: Convert section blocks to theme blocks

### Fixed

- **product-finder**: Button spacing uses margin, not padding on .btn

## [1.27.0] — 2026-06-29

### Added

- **typography**: Load component font weights as extra @font-face weights

### Changed

- **css-variables**: Group button font transform/letter-spacing with button vars

### Fixed

- **css-variables**: Use default filter for subheading font weight fallback

## [1.26.0] — 2026-06-26

### Added

- **breadcrumbs**: Add color scheme setting

### Changed

- **article-card**: Move button label/link into button block
- **article-card**: Render excerpt/button as dynamic blocks

### Fixed

- **article-blocks**: Add shopify_attributes and default related heading

## [1.25.1] — 2026-06-25

### Documentation

- **skills**: Harden block/SRA/motion guidance from product-finder build

### Fixed

- **agents**: Grant feature-builder the figma MCP tools

## [1.25.0] — 2026-06-25

### Added

- **button**: Add icon_size setting to button blocks
- **block**: Product-finder
- **product-finder**: Collection-filter driven, Section-Rendering cascade (rework v1)
- **product-finder**: Heading child block, JS collapse w/ animation, border color + per-device, width
- **product-finder**: Static heading+button blocks, richtext heading, per-device icon, loading UX
- **product-finder**: Add icon color setting to heading block

### Changed

- **css-variables**: Assign font weight directly, drop *_inherit temps
- **article-card**: Use current date as placeholder, drop article_date key
- **article-card**: Split card into nested blocks with empty-state placeholders
- **product-finder**: Generic defaults, tidy schema, button icons + trailing, custom heading typography

### Fixed

- **product-finder**: Panel padding + heading/collapse/loading polish
- **product-finder**: Review fixes — heading subtext color, border opacity+color, dedupe rte

## [1.24.3] — 2026-06-24

### Added

- **button**: Allow parent to scope button block via wrapper_class/button_class

### Changed

- **dialog**: Centralize --swipe-container-width on .dialog
- **mega-menu**: Convert sidebar promotions to nested blocks

## [1.24.2] — 2026-06-23

### Changed

- **cart-drawer**: Extract recommendations into cart-drawer-recommendation snippet
- **button**: Replace mobile_full_width with width/width_mobile, add icon_end

### Fixed

- **cart**: Rename --card-table-row-spacing to --cart-table-row-spacing

## [1.24.1] — 2026-06-22

### Changed

- **carousel**: Center counter on mobile, start-align on desktop
- **product-card**: Kebab-case quick-add layout values, gate actions row by placement

### Fixed

- **product-card**: Expose card style param, apply box modifier

## [1.24.0] — 2026-06-18

### Added

- **product-card**: Quick-add on-media placement with horizontal fallback

## [1.23.0] — 2026-06-17

### Added

- **helpers**: Add .list-disc utility with inline-start padding
- **claude**: Core/child ownership model — child owns visual SCSS, role-aware additive guard

### Changed

- **cart-drawer**: Hoist dialog color scheme resolution, center empty state
- **search**: Resolve product type filter in Liquid instead of JS

## [1.22.3] — 2026-06-16

### Changed

- **cart**: Extract _cart-summary-addons block with parent-aware scheme border
- **button**: Use :is() positive selector for hover fill overlay
- **cart**: Use icon snippet for discount remove, simplify gift-wrap layout

## [1.22.2] — 2026-06-16

### Changed

- **cart**: Extract drawer addons snippet, hoist summary container to main-cart
- **cart**: Centralize gift-wrapping resolution and extract addons accordion snippet

### Fixed

- **cart**: Remove stray can_remove assign inside line-item remove button

## [1.21.1] — 2026-06-15

### Added

- **menu-drawer**: Add design mode block select/deselect handling

### Changed

- **locales**: Rename info.footer_menu key to menu_top_level_only
- **dialog**: Drop xl border-radius override on drawer left/right
- **compare**: Use svg mask for placeholder dashed border
- **gift-card**: Copy-to-clipboard toggles button label via data-* attrs

### Fixed

- **section-header**: Disable menu hover bridge pointer-events until hover
- **cart**: Remove duplicate total_price assignment in cart summary

## [1.20.0] — 2026-06-12

### Added

- **localization**: Make flag width, ratio and radius configurable via CSS vars
- **localization**: Support custom class on dropdown toggle button

## [1.19.1] — 2026-06-12

### Changed

- **menu-drawer**: Consolidate mobile submenu markup into menu-drawer-details
- **menu-drawer**: Rename item-link BEM modifiers by level
- **menu-drawer**: Drop redundant banner v-scrollable wrapper and accordion overrides

## [1.19.0] — 2026-06-11

### Added

- **search**: Set viewport-height and header-bottom CSS vars on open
- **claude**: Encode settings-spine + inheritance-ladder model into design-to-brief

### Fixed

- **predictive-search**: Cascade carousel column defaults down breakpoints

## [1.18.3] — 2026-06-11

### Added

- **predictive-search**: Responsive slides-per-view for products carousel

### Changed

- **button**: Rename icon position to boolean icon_end (RTL-safe)

### Fixed

- **carousel**: Hide absolute nav when both prev/next are disabled

## [1.18.1] — 2026-06-11

### Fixed

- **ci**: Make auto-release resilient to concurrent merges

## [1.18.0] — 2026-06-11

### Added

- **button**: Add icon_position + default with_wrapper true
- **claude**: Harden builder pipeline from category-card validation

### Changed

- **button**: Refine sizing, border box-model, and outline variant

### Documentation

- **skills**: Encode audited reuse-snippet contracts into create-liquid-snippet
- **skills**: Encode block archetypes + public/internal split into create-liquid-block
- **skills**: Encode section archetypes + Template-host family into create-liquid-section
- **skills**: Reconcile BLOCK-ANATOMY §8 with the responsive-image mode branch

### Fixed

- **article**: Add missing comma in clamp-calculate-style render args

## [1.17.1] — 2026-06-10

### Changed

- **search**: Extract view-all button into predictive-search-see-all-markup snippet
- **search**: Rename see-all snippet to result-view-all + wrap result titles

## [1.17.0] — 2026-06-10

### Added

- **claude**: Encode section anatomy into create-liquid-section skill
- **claude**: Encode block + snippet anatomy into their skills
- **claude**: Enrich brief template — implementation map + grouped settings + multi-version design
- **claude**: Design-to-brief skill — Think-phase analyze & propose → brief
- **claude**: Generalize builder to feature-builder (section/block/snippet) + self-review

## [1.16.1] — 2026-06-10

### Changed

- **search**: Resolve results panel via refs + merge listbox wrapper

## [1.16.0] — 2026-06-10

### Added

- **claude**: Briefs per-dev (gitignored) + yarn wt:clean to auto-remove merged worktrees

### Fixed

- **claude**: Wt:dev runs theme dev from repo root via --path (new sections show in Theme Editor)

## [1.15.2] — 2026-06-10

### Changed

- **menu-sidebar**: AbortController cleanup + reset height for panel-less items

## [1.15.1] — 2026-06-10

### Changed

- **search**: Split predictive-search panels into per-block snippets

## [1.15.0] — 2026-06-10

### Added

- **claude**: Allow builder read-only exploration commands (ls/grep/cat/head/git branch)

## [1.14.1] — 2026-06-10

### Fixed

- **claude**: Agent-auto-approve handles 'cd <path> && …' commands too

## [1.14.0] — 2026-06-09

### Added

- **claude**: /build-batch self-managed named worktrees + auto-symlink theme config
- **claude**: Brief-driven /build-batch — design/spec phase before parallel build
- **claude**: /build-batch preview defaults to local theme dev (parallel) over push-to-dev
- **header**: Render mega-menu theme blocks in mobile drawer
- **claude**: Yarn wt:dev — interactive worktree preview (builds gitignored assets first)
- **claude**: Per-agent auto-approve hook (config-driven, per-dev opt-in)

### Changed

- **header**: Rename overlay→backdrop and dropdown state classes

## [1.13.0] — 2026-06-09

### Added

- **claude**: Parallel-build toolkit — /build-batch + section-builder template + CHILD.md override point

## [1.12.2] — 2026-06-08

### Changed

- **menu**: Rename dropdown__nav→dropdown__list, add BEM item/link classes

### Fixed

- **form**: Select arrow default color + darker dialog backdrop

## [1.12.1] — 2026-06-05

### Changed

- **form**: Unify select styling via form-control-element + CSS vars

### Documentation

- **claude**: Document MCP setup (chrome project-scope, figma user-scope) in USAGE

## [1.12.0] — 2026-06-04

### Added

- **sync**: /sync-core can sync an untagged ref (e.g. upstream/main), not only tags

## [1.11.0] — 2026-06-04

### Added

- **claude**: /review-pr handles multiple PRs (unmerged-branch list + batch triage)
- **claude**: /review-pr auto-stashes WIP and reviews from a fresh main
- **claude**: /sync-core lands on main + cleans up the sync branch

## [1.10.1] — 2026-06-04

### Added

- **claude**: Add /review-pr command for local PR review

### Documentation

- **claude**: Add 'pull before push' to Working Agreements

## [1.10.0] — 2026-06-04

### Added

- **header**: Convert mega-menu from section blocks to theme blocks
- **claude**: Check file git history/blame before editing (cross-dev awareness)

### Changed

- **header**: Rename header__top→header__main, flatten search SCSS

## [1.9.0] — 2026-06-04

### Added

- **claude**: /sync-core freshens main from origin + auto-picks latest core tag

## [1.8.0] — 2026-06-04

### Added

- **claude**: Migrate theme skills to .claude/skills + add delete-section-block
- **claude**: Make yarn check-liquid usable as a gate
- **claude**: Add hard-block hooks + memory SessionStart (fail-open + kill-switch)
- **claude**: Add subagents (fork-sync-resolver, theme-reviewer, locale-auditor)
- **claude**: Add /sync-core command; drop commands that duplicate skill auto-routing

### Changed

- **claude**: Replace vendored shopify-liquid skill with yarn check-liquid
- **claude**: Sharpen skill/agent descriptions for accurate auto-routing

### Documentation

- **claude**: Add Claude Code toolkit design doc
- **claude**: Point CLAUDE.md at .claude/skills + add behavioral/memory guidance
- **claude**: Update toolkit design for Option A (yarn check-liquid)
- **claude**: Mark Phase 2 hooks implemented
- **claude**: Mark Phase 3 subagents implemented
- **claude**: Add .claude/USAGE guide + FORK-WORKFLOW toolkit section

### Fixed

- **claude**: Ignore features/ in theme-check (WIP, not deployed)

## [1.7.2] — 2026-06-03

### Changed

- **header**: Replace :is() button selector with header__button class
- **header**: Restyle search form and rework search-form-width vars
- **desktop-menu**: Hoist mega-menu check to remove duplicate render

## [1.7.0] — 2026-06-03

### Changed

- **header**: Remove enable_dividers setting
- **header**: Extract header buttons into snippets
- **header**: Restructure scss nesting and group media queries

## [1.6.0] — 2026-06-02

### Added

- **compare**: Product comparison feature with bar, table, and dialog
- **compare**: Gate compare table behind compare_enabled setting
- **localization**: Add country flag display to dropdown and list
- **top-bar**: Add top bar section with text, menu and localization blocks

### Changed

- **localization**: Mount dropdown on interaction intent
- **header**: Fix separator typo and restructure desktop menu

### Fixed

- **section-renderer**: Avoid mutating original URL when building section URL

## [1.5.0] — 2026-05-22

### Added

- **tooltip**: Add opt-in mobile bottom sheet and touch-friendly bindings
- **quantity-selector**: PDP/cart params, min/max buttons, dedupe updates
- **events**: Dispatch ThemeEvents hooks for cart, quick view, and AJAX add
- **cart**: Gift wrap, quantity rules, volume pricing, and quick order list
- **rtl**: Theme setting, conditional layout, and logical CSS
- **shopify-account**: Integrate customer account web component
- **media**: Optional aspect-ratio CSS vars in responsive-image
- **popup**: Enhance subscribe popup layout and settings
- **search**: Product type filter and unified search form layout

### Changed

- **tooltip**: Use data-tooltip-arrow instead of class in TooltipManager
- **product-card**: Extract metas snippet and fix link click-through
- **nav**: Replace class selectors with data-* hooks for JS contract
- **cart**: Inline remove-button loading reset, drop resetLoading util
- **marquee**: Defer init and reduce DOM clones for TBT
- **marquee**: Remove unused #cloneItem helper
- **header-account**: Move shopify-account shadow styles to Liquid snippet
- **dialog**: Reorganize drawer side and bottom modifier styles
- **header**: Fix BasicHeader lifecycle and theme editor listeners
- **rtl**: Rename RTL SCSS files to partial convention
- **reversed-link**: Optimize styles and add underline variant

### Fixed

- **localization**: RTL dropdown positioning and focus-out behavior
- **helpers**: Set position relative on pointer-pass-through wrapper
- **swipe-component**: DisconnectedCallback and AbortController cleanup
- **article-comments**: Remove blocks-radius from comment form alerts
- **product-card**: Hide metas wrapper when empty per breakpoint
- **quick-view**: Reset media padding and pointer cursor on thumbnails
- **schema**: Lower font size range min from 12px to 10px
- **popup**: Adjust subscribe popup close button position and size
- **article**: Remove no-empty class from meta separators

## [1.4.0] — 2026-05-18

### Added

- **release**: Include package.json.version in store-version bump

## [1.3.0] — 2026-05-18

### Added

- **release**: Add yarn theme:bump-store-version helper

### Changed

- **identity**: Extract theme name + store version to merge=ours snippets

## [1.2.5] — 2026-05-18

### Fixed

- **product-form**: Allow only enabled add-to-cart button to submit
- **product-form**: Plug listener leak in AddToCartComponent
- **variant-picker**: Plug change-listener leak in VariantPicker
- **cart-drawer**: Defer auto-open until after cart-items morph
- **cart-items**: Batch section fetches on error path
- **product-form**: Batch sections + drop redundant cart.js on error path
- **product-form**: Skip background variant sync in #onVariantUpdate

## [1.2.4] — 2026-05-18

### Documentation

- **fork-workflow**: Add core→child sync diagrams + drift patches

## [1.2.3] — 2026-05-18

### Documentation

- **fork-workflow**: Clarify Tier 2 semantics + feat/* origin rule

### Fixed

- **schema**: Remove trailing comma in inline schemas

## [1.2.1] — 2026-05-18

### Documentation

- **fork-workflow**: Restructure §7-§8 as step-by-step guide

## [1.2.0] — 2026-05-08

### Added

- **responsive-image**: Add preload param for liquid mode
- **product-media**: Preload main media image and disable zoom reveal on first slide

### Changed

- Dissolve critical.js into utilities and component modules

### Fixed

- Remove stale critical.js refs and add missing account locale keys

## [1.1.6] — 2026-05-08

### Changed

- **flex-carousel**: Extract FlexCarousel from theme.js into standalone module
- **show-more**: Extract ShowMoreComponent from theme.js into standalone module
- **read-more**: Extract ReadMore from theme.js into standalone module
- **swipe-component**: Extract SwipeComponent from theme.js into standalone module
- **slideshow**: Extract SlideshowComponent from theme.js into standalone module
- **featured-collection**: Extract FeaturedCollection from theme.js into standalone module
- **local-pickup**: Extract LocalPickup from theme.js into standalone module
- **image-comparison**: Extract ImageComparison from theme.js into standalone module
- **marquee**: Extract MarqueeComponent to dedicated module
- **theme**: Extract ScrollProgressBar, ProductRecentlyViewed, BackToTop, CounterComponent to modules
- **header-menu**: Extract BasicHeader, StickyHeader, DetailsDropdown, DetailsMega, MenuSidebar, MenuDrawerDetails, MenuDrawerSubmenu to modules
- **theme**: Extract remaining components — theme.js now empty

## [1.1.5] — 2026-05-07

### Changed

- **quick-view**: Separate quick-add and quick-view into distinct components
- **product**: Media gallery snippet, quick-view, carousel, block padding

### Fixed

- **quick-add**: Show correct sold-out text on initial render

## [1.1.4] — 2026-05-04

### Documentation

- **fork-workflow**: Add README.md and bitbucket-pipelines.yml to gitattributes template

## [1.1.3] — 2026-05-04

### Documentation

- Add README with project overview and workflow guide

## [1.1.2] — 2026-05-04

### Documentation

- **fork-workflow**: Update release section to reflect CI/CD auto-release workflow

## [1.1.1] — 2026-04-29

### Fixed

- **release**: Rename release.js to release.mjs, remove type:module from package.json

## [1.1.0] — 2026-04-29

### Added

- **dx**: Add husky commit-msg hook to enforce conventional commits
- **ci**: Add bitbucket pipeline for auto release on main

### Fixed

- **ci**: Fix pipeline YAML syntax error
- **ci**: Remove blank lines causing empty command error in pipeline
- **ci**: Move release logic to shell script to avoid YAML parsing issues
- **ci**: Fix git-cliff installation path in pipeline
- **ci**: Use find to locate git-cliff binary after extraction

## [1.0.4] — 2026-04-29

### Fixed

- **release**: Pass --tag to git-cliff so version appears in CHANGELOG

## [1.0.3] — 2026-04-29

### Fixed

- **release**: Guard against duplicate tag before running

## [1.0.2] — 2026-04-29

### Documentation

- Update release workflow to use git-cliff
- **fork-workflow**: Clarify child must merge via tag not upstream/main

## [1.0.1] — 2026-04-29

### Fixed

- **product-card**: Badge not updating when switching variants


