/**
 * Attribution + impact for a Lighthouse run: who owns each finding (theme / Shopify / third-party /
 * merchant), which performance metric it moves, and roughly how many score points it is worth.
 *
 * Owners:
 *   theme      — served from /cdn/shop/t/<id>/assets/, or a markup/CSS decision: fixable in the theme source
 *   shopify    — scripts Shopify injects (checkout-web, portable wallets, consent, pixels runtime, analytics):
 *                the theme cannot remove or reorder them; name them so nobody bills them to the theme
 *   thirdparty — apps and pixels the merchant installed (GTM, Facebook, Klaviyo…); removable by the merchant
 *   merchant   — content and settings: image files, font choices, colour settings, duplicated tags
 *
 * Score impact uses Lighthouse's own scoring model: each metric's value is mapped through a log-normal
 * curve (p10 / median control points) and weighted. Applying an audit's `metricSavings` to the metric and
 * re-scoring gives the points that finding is worth on THIS page — an estimate, and findings overlap, so
 * the sum is an upper bound, not a forecast.
 */

// Lighthouse v12/13 scoring (lighthouse-core/config/default-config + metric audits).
const CURVES = {
  mobile: { FCP: [1800, 3000], SI: [3387, 5800], LCP: [2500, 4000], TBT: [200, 600], CLS: [0.1, 0.25] },
  desktop: { FCP: [934, 1600], SI: [1311, 2300], LCP: [1200, 2400], TBT: [150, 350], CLS: [0.1, 0.25] },
};
const WEIGHTS = { FCP: 0.1, SI: 0.1, LCP: 0.25, TBT: 0.3, CLS: 0.25 };
const METRIC_AUDIT = {
  FCP: "first-contentful-paint",
  SI: "speed-index",
  LCP: "largest-contentful-paint",
  TBT: "total-blocking-time",
  CLS: "cumulative-layout-shift",
};

/** Lighthouse's log-normal score for one metric value (0..1). */
function metricScore(value, [p10, median]) {
  if (value <= 0) return 1;
  // Same derivation Lighthouse uses: podr/median → log-normal CDF complement.
  const logRatio = Math.log(p10 / median);
  const sigma = Math.abs(logRatio) / 1.2815515655446004; // z for the 10th percentile
  const z = Math.log(value / median) / sigma;
  return 0.5 * erfc(z / Math.SQRT2);
}
function erfc(x) {
  // Abramowitz–Stegun 7.1.26, good to ~1e-7 — plenty for a score estimate.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? 1 - y : 1 + y;
}

/** Current metric values from the run, keyed FCP/SI/LCP/TBT/CLS. */
export function metricValues(r) {
  const out = {};
  for (const [k, id] of Object.entries(METRIC_AUDIT)) out[k] = r.audits[id]?.numericValue;
  return out;
}

/**
 * Points gained on the 0–100 performance score if `savings` ({LCP: ms, FCP: ms, TBT: ms, CLS: n}) were
 * realised on this run. Also reports which metrics the saving touches.
 */
export function scoreImpact(r, savings, device = "mobile", ratios = {}) {
  const curves = CURVES[device] || CURVES.mobile;
  const vals = metricValues(r);
  let points = 0;
  const metrics = [];
  for (const [m, saved] of Object.entries(savings || {})) {
    if (!saved || !curves[m] || vals[m] === undefined) continue;
    const before = metricScore(vals[m], curves[m]);
    const after = metricScore(Math.max(0, vals[m] - saved), curves[m]);
    // Marginal points if only this were fixed. On a page far past the curve that is ~0 for everything, so
    // also take the finding's SHARE of the points the metric loses today (saved ÷ metric value, or a ratio
    // the caller measured) — what it is worth once the other fixes land. Report the larger.
    const lost = (1 - before) * WEIGHTS[m] * 100;
    const share = Math.min(1, ratios[m] ?? saved / Math.max(vals[m], 1)) * lost;
    const gain = Math.max((after - before) * WEIGHTS[m] * 100, share);
    // FCP savings usually pull Speed Index along; Lighthouse does not report SI savings, so fold half in.
    points +=
      gain +
      (m === "FCP"
        ? (metricScore(Math.max(0, vals.SI - saved), curves.SI) - metricScore(vals.SI, curves.SI)) *
          WEIGHTS.SI *
          100 *
          0.5
        : 0);
    if (saved > 0) metrics.push(m);
  }
  return { points: Math.round(points * 10) / 10, metrics };
}

/** What this page is currently losing per metric — the ceiling any fix can reach. */
export function metricShortfall(r, device = "mobile") {
  const curves = CURVES[device] || CURVES.mobile;
  const vals = metricValues(r);
  return Object.fromEntries(
    Object.keys(WEIGHTS).map((m) => [
      m,
      { value: vals[m], lostPoints: Math.round((1 - metricScore(vals[m] ?? 0, curves[m])) * WEIGHTS[m] * 1000) / 10 },
    ])
  );
}

// ───────────────────────── owners ─────────────────────────

const SHOPIFY_RE =
  /shopifycloud\/|shopifysvc\.com|\/cdn\/wpm\/|\/cdn\/s\/(trekkie|javascripts)|monorail|shop\.app\/|cdn\.shopify\.com\/(shopifycloud|storefront|static|s\/)|\/cdn\/shopifycloud\/|portable-wallets|accelerated-checkout|privacy-banner|web-pixels|consent-tracking|shop-js|\/checkouts\/internal|\/wpm\//;
const THEME_RE = /\/cdn\/shop\/t\/\d+\/assets\//;
const MERCHANT_MEDIA_RE = /\/cdn\/shop\/(files|products)\/|\/cdn\/fonts\//;
const APP_ON_SHOPIFY_RE = /cdn\.shopify\.com\/(shop-assets|extensions|proxy)|\/cdn\/shop\/extensions\/|\/apps\//;

export function ownerOf(url, base) {
  if (!url || /^data:|^blob:/.test(url)) return null;
  if (THEME_RE.test(url)) return "theme";
  if (APP_ON_SHOPIFY_RE.test(url)) return "thirdparty";
  if (SHOPIFY_RE.test(url)) return "shopify";
  if (MERCHANT_MEDIA_RE.test(url)) return "merchant";
  if (base && url.startsWith(base)) return /\.(js|css)(\?|$)/.test(url) ? "shopify" : "document"; // a first-party script that is not in the theme's asset folder is Shopify's
  return "thirdparty";
}

export const OWNER_LABEL = {
  theme: "Theme — fixable in the theme source",
  shopify: "Shopify-injected — outside the theme's control",
  thirdparty: "Third-party apps & pixels — the merchant installed them",
  merchant: "Merchant content & settings",
  document: "Document (HTML)",
};

// ───────────────────────── fix recipes (theme side) ─────────────────────────

const RECIPES = {
  "font-preload-control":
    'Blocking the theme\'s web fonts moved first paint by this much, so the fonts are holding the page\'s first paint. The usual cause is `<link rel="preload" as="font">` for the body/heading fonts: Chrome treats a preloaded font as render-blocking even with font-display: swap. Remove the preloads (the @font-face rules still name the files, the preload scanner finds them through the stylesheet) — measured on Motrix: FP 1.5–2.4 s → 0.3 s, mobile performance 60 → 78. If no preload exists, check font-display (block/auto) on every @font-face the theme emits.',
  "render-blocking-insight":
    "Render-blocking stylesheet. Inline the critical part for above-the-fold sections and load the rest non-blocking (`stylesheet_tag` with `media=\"print\" onload=\"this.media='all'\"`, or `preload` + swap); keep `theme.css` small and move section CSS into the section (`{{ 'section-x.css' | asset_url | stylesheet_tag }}` only where it renders).",
  "render-blocking-resources": "Same as render-blocking-insight.",
  "lcp-breakdown-insight":
    'LCP element. Load delay → add `preload: true` to the first media\'s `image_tag` (Link preload from TTFB) and make sure it is server-rendered with a real `srcset` (no JS-built src). Render delay → no entrance animation or JS-gated reveal (`opacity:0` until loaded/inView) on an above-the-fold element; paint it as soon as it arrives. Load duration → right `sizes`, stop thumbnails/other media competing (lazy + `fetchpriority="low"`).',
  "lcp-discovery-insight":
    'Make the LCP image discoverable from the HTML: real `src`/`srcset` (not data-src), `loading="eager"`, `fetchpriority="high"`, and a `preload`.',
  "image-delivery-insight":
    "The theme asked for an image larger than it displays: tighten `sizes` to the real rendered width for that breakpoint, and keep `widths` ≤ 2× the largest rendered width. (Compression findings are the merchant's file.)",
  "uses-responsive-images": "Same as image-delivery-insight.",
  "unsized-images":
    "Give every `<img>` `width`/`height` (or `aspect-ratio` on the wrapper) so the box is reserved before the image arrives — `image_tag` emits them when the Liquid image has dimensions.",
  "cls-culprits-insight":
    "Reserve space: dimensions on media, `min-height` on late-filled slots (reviews, recommendations, announcement bars), `font-display: optional`/metric-compatible fallback for web fonts, no layout-affecting entrance animations.",
  "layout-shifts": "Same as cls-culprits-insight.",
  "font-display-insight":
    "Set `font-display: swap` (or `optional`) on the theme's `@font-face` — `font_face` filter accepts `font_display`.",
  "font-display": "Same as font-display-insight.",
  "forced-reflow-insight":
    "JS reads layout (`offsetWidth`, `getBoundingClientRect`) after writing styles in the same frame. Batch reads before writes, use `requestAnimationFrame`, cache measurements, or ResizeObserver.",
  "unused-javascript":
    "Ship the bundle per page/section: load module JS only where its custom element renders (`scripts.liquid` conditions), split vendor bundles (Swiper only on pages with a carousel), drop dead code.",
  "unused-css-rules":
    "Split `theme.css`: per-section stylesheets loaded by the section, utilities purged of unused selectors.",
  "bootup-time":
    'Reduce main-thread JS on load: defer non-critical modules (`type="module"` + lazy `import()` on interaction/inView), avoid work in `connectedCallback` before first paint.',
  "mainthread-work-breakdown":
    "Same as bootup-time; check Style & Layout cost of very large DOMs and expensive selectors.",
  "dom-size":
    "Fewer nodes: don't pre-render hidden variants/slides/modals, paginate long lists, no empty wrapper divs in snippets.",
  "long-tasks":
    "Break up the theme's long tasks (carousel init, product form hydration) with `requestIdleCallback`/`scheduler.yield()`, init below-the-fold components on inView.",
  "total-blocking-time": "See bootup-time / long-tasks.",
  "legacy-javascript": "Drop legacy polyfills/transpilation for ES5 in the vendor bundle; target modern browsers.",
  "network-dependency-tree-insight":
    "Shorten the theme's chains: no CSS that `@import`s, no JS that loads JS that loads CSS; preload fonts the first paint needs.",
  "cache-insight": "Theme assets on the Shopify CDN already get a long TTL; a short TTL here is not the theme's.",
  "uses-long-cache-ttl": "Same as cache-insight.",
  "modern-image-formats":
    "Shopify serves WebP/AVIF automatically for `image_url` sources; a non-modern image is a hardcoded file, not the CDN pipeline.",
  "third-party-summary":
    "Not the theme's — but a theme can delay third-party init until after LCP (e.g. load chat widgets on interaction).",
  "viewport-insight": 'Add `<meta name="viewport" content="width=device-width, initial-scale=1">`.',
  "duplicated-javascript-insight":
    "The same library bundled twice (Swiper in vendor + a section bundle); share one copy.",
};

export const recipeFor = (auditId) => {
  let r = RECIPES[auditId];
  if (r?.startsWith("Same as ")) r = RECIPES[r.slice(8, -1)];
  return r || "Theme-owned; see the Lighthouse guidance for this audit.";
};

// ───────────────────────── findings ─────────────────────────

/** Audits that carry the story; everything else in `categories.performance.auditRefs` with savings is still picked up. */
const ITEM_URL_KEYS = ["url", "source", "request"];
const SKIP = new Set([
  "mainthread-work-breakdown", // category totals, no URL — bootup-time carries the per-script story
  "network-dependency-tree-insight", // nested chains; covered by the Shopify/third-party script lists
  "total-byte-weight", // restates image-delivery + unused-javascript
  "largest-contentful-paint-element",
  "network-requests",
  "metrics",
  "screenshot-thumbnails",
  "final-screenshot",
  "diagnostics",
  "main-thread-tasks",
  "script-treemap-data",
  "resource-summary",
  "critical-request-chains",
  "network-rtt",
  "network-server-latency",
]);

function shortUrl(url) {
  const u = url.replace(/^https?:\/\//, "").split("?")[0];
  if (u.length <= 72) return u;
  const parts = u.split("/");
  return `${parts[0]}/…/${parts.slice(-2).join("/")}`.slice(0, 90);
}

function itemUrl(item) {
  for (const k of ITEM_URL_KEYS) if (typeof item[k] === "string") return item[k];
  if (item.node?.snippet) {
    const m = item.node.snippet.match(/src="([^"]+)"/);
    if (m) return m[1].startsWith("//") ? "https:" + m[1] : m[1];
  }
  return null;
}

/**
 * Image-delivery items: a "larger than displayed" reason is the theme's `sizes`/`widths` only when the request
 * exceeds displayed × DPR (Lighthouse's mobile DPR is 1.75); a compression reason is the merchant's file.
 */
function imageOwner(item, device) {
  const reasons = (item.subItems?.items || []).map((s) => s.reason || "").join(" ");
  const dims = reasons.match(/\((\d+)x(\d+)\) for its displayed dimensions \((\d+)x(\d+)\)/);
  const compression = /compression/i.test(reasons) || /compression/i.test(item.reason || "");
  if (dims) {
    const dpr = device === "desktop" ? 1 : 1.75;
    const oversize = Number(dims[1]) > Number(dims[3]) * dpr * 1.25;
    if (oversize) return "theme";
    if (!compression) return null;
  }
  return compression || !dims ? "merchant" : null;
}

/** Owner for an item that has no URL (a DOM node): a markup decision is the theme's unless it is clearly a content value. */
function nodeOwner(auditId, item) {
  if (auditId === "color-contrast") return "merchant"; // colours come from theme settings the merchant picked
  if (
    /^(unsized-images|layout-shifts|cls-culprits-insight|lcp-breakdown-insight|lcp-discovery-insight|heading-order|button-name|link-name|label|image-alt|aria-|td-has-header|list|listitem|target-size|frame-title|label-content-name-mismatch)/.test(
      auditId
    )
  )
    return "theme";
  return "theme";
}

/**
 * Walk every failing performance audit of a run and bucket its items by owner.
 * Returns [{ auditId, title, metrics, ownerTotals: {owner: {items, bytes, ms}}, items: [{owner, label, bytes, ms, detail}] }]
 */
export function perfFindings(r, base, device) {
  const out = [];
  const refs = r.categories.performance?.auditRefs || [];
  for (const ref of refs) {
    const a = r.audits[ref.id];
    if (!a || SKIP.has(ref.id)) continue;
    // Lighthouse 13 insight audits (document-latency-insight, …) put a keyed OBJECT in details.items,
    // not a row array — iterating it throws. Only table/opportunity rows are attributable.
    const rows = Array.isArray(a.details?.items) ? a.details.items : [];
    const failing =
      (a.score !== null && a.score < 0.9) ||
      (a.scoreDisplayMode === "informative" && a.metricSavings && Object.values(a.metricSavings).some((v) => v > 0)) ||
      (rows.length && a.scoreDisplayMode !== "informative" && a.score !== 1);
    if (!failing) continue;
    if (ref.group === "metrics" || ref.group === "hidden") continue;
    const items = [];
    for (const it of rows) {
      const url = itemUrl(it);
      let owner = url ? ownerOf(url, base) : nodeOwner(ref.id, it);
      if (!owner) continue;
      if (/^font-display/.test(ref.id) && owner === "merchant") owner = "theme"; // `font_face` font_display is set by the theme
      if (/image-delivery|responsive-images|optimized-images/.test(ref.id) && owner === "merchant") {
        owner = imageOwner(it, device);
        if (!owner) continue; // right-sized for the device's DPR — Lighthouse's estimate ignores it
      }
      const label = url
        ? shortUrl(url)
        : (it.node?.selector || it.node?.snippet || it.label || "").replace(/\s+/g, " ").slice(0, 90);
      const bytes = it.wastedBytes ?? it.totalBytes ?? it.transferSize ?? 0;
      const ms = it.wastedMs ?? it.duration ?? it.total ?? it.blockingTime ?? it.mainThreadTime ?? 0;
      const detail =
        it.subItems?.items
          ?.map((s) => s.reason || s.url?.split("/").pop())
          .filter(Boolean)
          .slice(0, 2)
          .join("; ") ||
        (it.entity ? `${it.entity}` : "") ||
        (it.node?.snippet ? it.node.snippet.replace(/\s+/g, " ").slice(0, 120) : "");
      if (!label) continue; // a row with nothing to point at (e.g. a reflow with no attributed script) helps nobody
      items.push({ owner, label, bytes, ms, detail, entity: it.entity });
    }
    const ownerTotals = {};
    for (const i of items) {
      const t = (ownerTotals[i.owner] ||= { items: 0, bytes: 0, ms: 0 });
      t.items++;
      t.bytes += i.bytes;
      t.ms += i.ms;
    }
    const impact = scoreImpact(r, a.metricSavings, device);
    const metrics = impact.metrics.length
      ? impact.metrics
      : ref.acronym
        ? [ref.acronym]
        : Object.keys(a.metricSavings || {});
    out.push({
      auditId: ref.id,
      title: a.title,
      displayValue: a.displayValue,
      metricSavings: a.metricSavings || {},
      points: impact.points,
      metrics,
      ownerTotals,
      items,
    });
  }
  const lcp = lcpFinding(r, base, device);
  if (lcp) out.push(lcp);
  return out.sort(
    (x, y) =>
      y.points - x.points ||
      Object.values(y.metricSavings).reduce((s, v) => s + v, 0) -
        Object.values(x.metricSavings).reduce((s, v) => s + v, 0)
  );
}

/**
 * LCP has no `metricSavings`, yet it is usually where the points are. Build one finding from the breakdown:
 * load delay + render delay are the theme's (discoverability, preload, reveal animations); load duration is
 * shared between the merchant's file size and bandwidth contention from everything else; TTFB is Shopify's.
 */
function lcpFinding(r, base, device) {
  const b = r.audits["lcp-breakdown-insight"]?.details?.items;
  if (!b?.[0]?.items) return null;
  const ph = Object.fromEntries(b[0].items.map((i) => [i.subpart, Math.round(i.duration)]));
  const el = b[1] || {};
  const lcpMs = r.audits["largest-contentful-paint"]?.numericValue || 0;
  if (!lcpMs) return null;
  const themeMs = (ph.resourceLoadDelay || 0) + (ph.elementRenderDelay || 0);
  const loadMs = ph.resourceLoadDuration || 0;
  const ttfb = ph.timeToFirstByte || 0;
  const items = [];
  if (ph.resourceLoadDelay > 150)
    items.push({
      owner: "theme",
      label: "Resource load delay",
      ms: ph.resourceLoadDelay,
      bytes: 0,
      detail: "the LCP resource was requested late — not preloaded, or discovered only after CSS/JS",
    });
  if (ph.elementRenderDelay > 150)
    items.push({
      owner: "theme",
      label: "Element render delay",
      ms: ph.elementRenderDelay,
      bytes: 0,
      detail: "the element arrived and was painted later — entrance animation, JS-gated reveal, or a fade on load",
    });
  if (loadMs > 300)
    items.push({
      owner: "merchant",
      label: "Resource load duration",
      ms: loadMs,
      bytes: 0,
      detail:
        "download time of the LCP file — its size (merchant) plus everything competing for bandwidth at that moment (fonts, thumbnails, apps, Shopify prefetch)",
    });
  if (ttfb > 600)
    items.push({
      owner: "shopify",
      label: "Time to first byte",
      ms: ttfb,
      bytes: 0,
      detail: "server time is Shopify's; a theme only adds to it through heavy Liquid loops",
    });
  const ownerTotals = {};
  for (const i of items) {
    const t = (ownerTotals[i.owner] ||= { items: 0, bytes: 0, ms: 0 });
    t.items++;
    t.ms += i.ms;
  }
  const savings = { LCP: themeMs + loadMs * 0.5 }; // theme phases + half the download (the contention half)
  // Phases are observed ms while the LCP metric is simulated; the share must come from the phases themselves.
  const phaseSum = Object.values(ph).reduce((a, b) => a + b, 0) || 1;
  const impact = scoreImpact(r, savings, device, { LCP: savings.LCP / phaseSum });
  return {
    auditId: "lcp-breakdown-insight",
    title: `LCP breakdown — ${(el.snippet || el.selector || "").replace(/\s+/g, " ").slice(0, 80)}`,
    displayValue: `${Math.round(lcpMs)} ms`,
    metricSavings: savings,
    points: impact.points,
    metrics: ["LCP"],
    ownerTotals,
    items,
  };
}

/** Split a finding's points across owners in proportion to their share of the measurable cost (ms, then bytes, then item count). */
export function pointsByOwner(finding) {
  const totals = finding.ownerTotals;
  const owners = Object.keys(totals);
  if (!owners.length) return {};
  const key = owners.some((o) => totals[o].ms > 0) ? "ms" : owners.some((o) => totals[o].bytes > 0) ? "bytes" : "items";
  const sum = owners.reduce((s, o) => s + totals[o][key], 0) || 1;
  return Object.fromEntries(owners.map((o) => [o, Math.round(((finding.points * totals[o][key]) / sum) * 10) / 10]));
}
