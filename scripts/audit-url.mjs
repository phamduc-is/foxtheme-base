#!/usr/bin/env node
/**
 * audit-url — Lighthouse a live storefront the way a merchant experiences it: any URL, ours or a
 * customer's, no repo access needed. Backs the `lighthouse` part of /store-audit and the
 * "can you check our store's performance?" request.
 *
 *   yarn audit:url https://store.com                       # home + first product + first collection, mobile, 3 runs each
 *   yarn audit:url https://store.com --pages=/,/products/best-seller,/collections/sale
 *   yarn audit:url https://store.com --runs=1 --desktop    # quick look; --desktop adds the desktop preset
 *   yarn audit:url https://demo.myshopify.com --password=1 # password-gated demo
 *   yarn audit:url https://store.com --a11y-only --block-banner
 *   yarn audit:url https://dev.myshopify.com --preview-theme=<id>   # an unpublished theme (before/after a fix)
 *   yarn audit:url https://store.com --no-font-control             # skip the extra fonts-blocked run
 *
 * Font control: for every page × device one extra run is made with the theme's web fonts blocked.
 * Chrome holds the whole page's first paint for a preloaded font, and Lighthouse then reports it as
 * an "LCP element render delay" — which points at the LCP element, i.e. the wrong thing. If first
 * paint moves by more than ~0.7 s (or the score by 5+ points) with fonts blocked, the report files a
 * theme finding for it with the measured delta instead of a guess.
 *
 * Each page × device runs `--runs` times and the report keeps the MEDIAN — a single mobile run
 * swings ±5–10 points, and a number you send a customer must not depend on the run you happened
 * to get. The report splits what loaded by origin — theme assets, Shopify platform, images,
 * third-party apps — because on a live store the apps are usually the biggest cost and the
 * merchant will otherwise read every point as the theme's.
 *
 * The privacy banner is NOT blocked by default (it is part of the real experience and of what
 * Google measures); `--block-banner` strips it when you want the theme's own LCP.
 *
 * Output: .audit-url/<host>/report.md + report.json + every raw lighthouse JSON (gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import { cookieJar, follow, unlock, lighthouse, metrics, EmptyRenderError } from "./lib/lighthouse.mjs";
import { perfFindings, pointsByOwner, metricShortfall, recipeFor, OWNER_LABEL } from "./lib/attribution.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const target = args.find((a) => /^https?:\/\//.test(a));
if (!target) {
  console.error(
    "usage: yarn audit:url <https://store> [--pages=/a,/b] [--runs=3] [--desktop] [--password=…] [--a11y-only] [--block-banner]"
  );
  process.exit(2);
}
const base = target.replace(/\/+$/, "");
const host = new URL(base).host;
const runs = Math.max(1, Number(opt("runs") || 3));
const devices = flag("desktop") ? ["mobile", "desktop"] : ["mobile"];
const categories = flag("a11y-only") ? ["accessibility"] : ["performance", "accessibility"];
const blocked = flag("block-banner") ? ["*privacy-banner*"] : [];
const fontControl = !flag("no-font-control") && !flag("a11y-only");
const FONT_PATTERNS = ["*cdn/fonts*", "*fonts.shopifycdn.com*"];
const OUT = path.join(
  process.cwd(),
  ".audit-url",
  opt("preview-theme") ? `${host}--theme-${opt("preview-theme")}` : host
);
const themeRepo = opt("theme-repo"); // optional: map theme-owned findings to source files
fs.mkdirSync(OUT, { recursive: true });

const median = (xs) => {
  const s = xs.filter((x) => x !== undefined && x !== null).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : undefined;
};

// ───────────────────────── session + page discovery ─────────────────────────

const jar = cookieJar();
const password = opt("password") || process.env.STOREFRONT_PASSWORD;
if (password && !(await unlock(jar, base, password))) {
  console.error(`audit-url: ${host} still shows the password page — wrong password?`);
  process.exit(1);
}
// An unpublished theme is cookie-pinned by one redirect through preview_theme_id (a share-token hop for a
// theme nobody has opened from the admin yet) — `follow` keeps every hop's cookies.
const previewTheme = opt("preview-theme");
const home = await follow(jar, previewTheme ? `${base}/?preview_theme_id=${previewTheme}` : `${base}/`);
// A gated store 302s to /password, and THAT page answers 200 — so the status alone reads as a healthy
// home page and Lighthouse would happily score the password form (small, fast, meaningless). Judge
// the landing URL, not just the status.
const gated = new URL(home.url).pathname === "/password";
if (home.status !== 200 || gated) {
  console.error(
    `audit-url: ${home.url} answered ${home.status}${gated ? " — the store is password-gated, pass --password=… (or STOREFRONT_PASSWORD)" : ""}`
  );
  process.exit(1);
}
const html = await home.res.text();
const clean = (v) => v?.replace(/\\n/g, " ").replace(/\s+/g, " ").trim(); // `| json` keeps the snippet's stray newlines
const shopifyTheme = (() => {
  try {
    return JSON.parse(html.match(/Shopify\.theme\s*=\s*(\{[^}]*\})/)?.[1] || "{}");
  } catch {
    return {};
  }
})();
const theme = {
  // FoxTheme globals when present; Shopify's own theme object (schema_name = the Theme Store name) as the fallback
  name: clean(html.match(/themeName:\s*"([^"]*)"/)?.[1]) || shopifyTheme.schema_name,
  version: clean(html.match(/themeVersion:\s*"([^"]*)"/)?.[1]) || shopifyTheme.schema_version,
  shopifyThemeId: shopifyTheme.id,
  storeThemeName: shopifyTheme.name,
};

let pages = opt("pages")?.split(",").filter(Boolean);
if (!pages) {
  const first = (re) => html.match(re)?.[1];
  pages = ["/", first(/href="(\/products\/[^"?#]+)/), first(/href="(\/collections\/(?!all["?#])[^"?#]+)/)].filter(
    Boolean
  );
}
console.log(
  `audit-url: ${host} · theme ${theme.name || "?"} ${theme.version || ""} · ${pages.length} page(s) × ${devices.join("+")} × ${runs} run(s)`
);

// ───────────────────────── runs ─────────────────────────

const results = [];
for (const p of pages) {
  for (const device of devices) {
    const samples = [];
    let empty = false;
    for (let i = 1; i <= runs; i++) {
      process.stdout.write(`  ${p} ${device} run ${i}/${runs} … `);
      const file = path.join(OUT, `${p.replace(/[^a-z0-9]+/gi, "_") || "home"}-${device}-${i}.json`);
      try {
        const r = lighthouse(`${base}${p}`, {
          cookie: jar.header(),
          categories,
          mobile: device === "mobile",
          blocked,
          file,
        });
        const m = metrics(r);
        m.origins = originSplit(r);
        m.file = file;
        samples.push(m);
        console.log(`${m.perf !== undefined ? `perf=${m.perf} ` : ""}a11y=${m.a11y}`);
      } catch (e) {
        if (e instanceof EmptyRenderError) {
          console.log("empty render");
          empty = true;
          break;
        }
        console.log(`ERROR ${e.message.slice(0, 120)}`);
      }
    }
    if (!samples.length) {
      results.push({ page: p, device, error: empty ? "page painted nothing" : "every run failed" });
      continue;
    }
    const med = (k) => median(samples.map((s) => s[k]));
    const rep = samples.find((s) => s.perf === med("perf")) || samples[0]; // the run that produced the median score tells the LCP story
    let fontCtl;
    if (fontControl && rep.perf !== undefined) {
      process.stdout.write(`  ${p} ${device} fonts-blocked control … `);
      try {
        const file = path.join(OUT, `${p.replace(/[^a-z0-9]+/gi, "_") || "home"}-${device}-nofonts.json`);
        const rc = lighthouse(`${base}${p}`, {
          cookie: jar.header(),
          categories: ["performance"],
          mobile: device === "mobile",
          blocked: [...blocked, ...FONT_PATTERNS],
          file,
        });
        const observedFp = (f) =>
          JSON.parse(fs.readFileSync(f, "utf8")).audits.metrics?.details?.items?.[0]?.observedFirstPaint;
        const baseFp = observedFp(rep.file);
        const fp = observedFp(file);
        const perf = Math.round(rc.categories.performance.score * 100);
        fontCtl = { basePerf: rep.perf, perf, baseFp, fp, deltaPerf: perf - rep.perf, deltaFp: baseFp - fp };
        console.log(
          `perf=${perf} (${fontCtl.deltaPerf >= 0 ? "+" : ""}${fontCtl.deltaPerf}) first paint ${baseFp}ms → ${fp}ms`
        );
      } catch (e) {
        console.log(`skipped (${e.message.slice(0, 60)})`);
      }
    }
    results.push({
      fontControl: fontCtl,
      page: p,
      device,
      runs: samples.length,
      perf: med("perf"),
      a11y: med("a11y"),
      lcp: med("lcp"),
      cls: med("cls"),
      tbt: med("tbt"),
      lcpRenderDelay: rep.lcpRenderDelay,
      lcpElement: rep.lcpElement,
      renderBlocking: rep.renderBlocking,
      a11yFails: rep.a11yFails,
      origins: rep.origins,
      file: rep.file,
    });
  }
}

/** Bytes by who shipped them. Platform includes Shopify's checkout-web prefetch (large, but off the critical path). */
function originSplit(r) {
  const split = { document: 0, theme: 0, fonts: 0, images: 0, platform: 0, apps: 0 };
  for (const i of r.audits["network-requests"]?.details?.items || []) {
    const u = i.url || "";
    const b = i.transferSize || 0;
    if (/^data:/.test(u)) continue;
    if (i.resourceType === "Document" && u.startsWith(base)) split.document += b;
    else if (/\/cdn\/shop\/t\/\d+\/assets\//.test(u)) split.theme += b;
    else if (/\/cdn\/fonts\//.test(u)) split.fonts += b;
    else if (/\/cdn\/shop\/(files|products)\/|\/cdn\/shop\/.*\.(jpe?g|png|webp|avif|gif|svg)/i.test(u))
      split.images += b;
    else if (
      /shopifycloud|shopifysvc|\/cdn\/wpm\/|\/cdn\/s\/|monorail|shop\.app\/|cdn\.shopify\.com\/(shopifycloud|storefront|static|s\/)/.test(
        u
      )
    )
      split.platform += b;
    else split.apps += b; // another origin, an app extension, or app assets on cdn.shopify.com/shop-assets
  }
  const thirdParties = (r.audits["third-parties-insight"]?.details?.items || [])
    .map((i) => ({
      entity: i.entity,
      kb: Math.round((i.transferSize || 0) / 1024),
      mainThreadMs: Math.round(i.mainThreadTime || 0),
    }))
    .sort((a, b) => b.mainThreadMs - a.mainThreadMs)
    .slice(0, 8);
  return { ...Object.fromEntries(Object.entries(split).map(([k, v]) => [k, Math.round(v / 1024)])), thirdParties };
}

// ───────────────────────── report ─────────────────────────

const hasPerf = results.some((r) => r.perf !== undefined);
const lines = [`# Lighthouse — ${host}`, ""];
lines.push(
  `Theme: **${theme.name || "unknown"} ${theme.version || ""}**${theme.shopifyThemeId ? ` (theme id ${theme.shopifyThemeId}${theme.storeThemeName ? ` "${theme.storeThemeName}"` : ""})` : ""} · ${runs} run(s) per cell, medians · ${blocked.length ? "privacy banner blocked" : "privacy banner left in (real experience)"}`,
  ""
);
lines.push(
  "Theme Store thresholds: performance ≥ 60 and accessibility ≥ 90, averaged over home + product + collection.",
  ""
);
lines.push("## Scores", "");
lines.push(`| Page | Device | ${hasPerf ? "Perf | LCP | CLS | TBT | " : ""}A11y | A11y failures |`);
lines.push(`|---|---|${hasPerf ? "---|---|---|---|" : ""}---|---|`);
for (const r of results) {
  if (r.error) {
    lines.push(`| ${r.page} | ${r.device} |${hasPerf ? " — | — | — | — |" : ""} — | ${r.error} |`);
    continue;
  }
  const perf = hasPerf
    ? ` ${r.perf} | ${(r.lcp / 1000).toFixed(1)}s | ${r.cls?.toFixed(3)} | ${Math.round(r.tbt)}ms |`
    : "";
  lines.push(
    `| ${r.page} | ${r.device} |${perf} ${r.a11y} | ${r.a11yFails.map((f) => `\`${f.id}\`×${f.count}`).join(", ") || "—"} |`
  );
}
const ok = results.filter((r) => !r.error);
if (ok.length) {
  const avg = (k) => Math.round(ok.reduce((s, r) => s + r[k], 0) / ok.length);
  lines.push("", `Average: ${hasPerf ? `performance **${avg("perf")}** · ` : ""}accessibility **${avg("a11y")}**`);
}

if (hasPerf) {
  lines.push(
    "",
    "## Who loaded what (KB transferred, median run)",
    "",
    "| Page | Device | Document | Theme assets | Fonts | Images | Shopify platform | Third-party apps |",
    "|---|---|---|---|---|---|---|---|"
  );
  for (const r of ok)
    lines.push(
      `| ${r.page} | ${r.device} | ${r.origins.document} | ${r.origins.theme} | ${r.origins.fonts} | ${r.origins.images} | ${r.origins.platform} | ${r.origins.apps} |`
    );
  lines.push(
    "",
    "Theme assets = `/cdn/shop/t/<id>/assets/` — the column the theme owns (plus its share of Document and Images). Platform = Shopify's own scripts incl. the checkout-web prefetch (large, off the critical path) and Shop Pay. Apps = another origin, an app extension, or app assets on cdn.shopify.com.",
    ""
  );
  const tp = new Map();
  for (const r of ok)
    for (const t of r.origins.thirdParties) tp.set(t.entity, Math.max(tp.get(t.entity) || 0, t.mainThreadMs));
  if (tp.size) {
    lines.push("## Third parties by main-thread time (worst page)", "");
    for (const [e, ms] of [...tp].sort((a, b) => b[1] - a[1]).slice(0, 10)) lines.push(`- ${e}: ${ms}ms`);
    lines.push("");
  }
  lines.push("## LCP", "");
  for (const r of ok)
    lines.push(
      `- ${r.page} ${r.device}: ${(r.lcp / 1000).toFixed(1)}s, element render delay ${r.lcpRenderDelay ?? "?"}ms — \`${r.lcpElement}\`${r.renderBlocking.length ? ` · render-blocking: ${r.renderBlocking.join(", ")}` : ""}`
    );
  lines.push(
    "",
    "A large element render delay with a fast resource load = the LCP element arrived and was then hidden (entrance animation, JS-gated reveal, or a banner painting over it).",
    ""
  );
}

// ───────────────────────── attribution + impact ─────────────────────────

/** Map a theme asset (or a DOM selector) back to the files that emit it, when a theme repo was given. */
const repoIndex = (() => {
  if (!themeRepo) return null;
  const files = [];
  for (const dir of ["layout", "sections", "snippets", "blocks", "templates"]) {
    const d = path.join(themeRepo, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d))
      if (/\.(liquid|json)$/.test(f))
        files.push({ rel: `${dir}/${f}`, text: fs.readFileSync(path.join(d, f), "utf8") });
  }
  return files;
})();
function sourceFor(item) {
  if (!repoIndex) return "";
  if (/\/cdn\/shop\/(files|products)\/|\/cdn\/fonts\//.test(item.label)) return ""; // merchant files have no source file
  const asset = item.label.match(/\/assets\/([^/?]+)$/)?.[1];
  const needles = asset ? [asset] : (item.label.match(/\.[a-z][\w-]+/g) || []).slice(0, 3).map((c) => c.slice(1));
  if (!needles.length) return "";
  const hits = repoIndex.filter((f) => needles.some((n) => f.text.includes(n))).map((f) => f.rel);
  if (!hits.length) return "";
  const src =
    asset && fs.existsSync(path.join(themeRepo, "src"))
      ? ` (built from src/…/${asset.replace(/\.(css|js)$/, "")}.*)`
      : "";
  return ` → ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ` +${hits.length - 3}` : ""}${src}`;
}

function merchantAdvice(id) {
  if (/image-delivery|responsive-images|modern-image|optimized-images/.test(id))
    return "Upload the image at the size it is displayed (≈2× the largest rendered width is enough) and compress it; Shopify re-encodes to WebP/AVIF but cannot shrink a huge source for free.";
  if (/font/.test(id))
    return "Fewer font families/weights in theme settings; each weight is a separate download before text can settle.";
  if (/color-contrast/.test(id))
    return "Pick colours in theme settings that reach 4.5:1 against their background (badges, prices, alert text are the usual offenders).";
  if (/cache/.test(id))
    return "Merchant-uploaded files are served by Shopify's CDN with long caching — a short TTL here comes from somewhere else.";
  return "Content or setting chosen in the admin; adjust there.";
}

if (hasPerf) {
  lines.push(
    "## Where the performance points are lost",
    "",
    "Lighthouse weights: TBT 30% · LCP 25% · CLS 25% · FCP 10% · Speed Index 10%. `−n` = points this page forfeits on that metric today.",
    ""
  );
  lines.push("| Page | Device | LCP | TBT | CLS | FCP | SI |", "|---|---|---|---|---|---|---|");
  const owners = { theme: {}, merchant: {}, thirdparty: {}, shopify: {}, document: {} };
  for (const r of ok) {
    const raw = JSON.parse(fs.readFileSync(r.file, "utf8"));
    const sf = metricShortfall(raw, r.device);
    const cell = (m) =>
      `${m === "CLS" ? (sf[m].value ?? 0).toFixed(3) : Math.round(sf[m].value ?? 0) + "ms"} (−${sf[m].lostPoints})`;
    lines.push(
      `| ${r.page} | ${r.device} | ${cell("LCP")} | ${cell("TBT")} | ${cell("CLS")} | ${cell("FCP")} | ${cell("SI")} |`
    );
    for (const f of perfFindings(raw, base, r.device)) {
      const split = pointsByOwner(f);
      for (const [owner, t] of Object.entries(f.ownerTotals)) {
        const bucket = (owners[owner] ||= {});
        const e = (bucket[f.auditId] ||= {
          title: f.title,
          metrics: new Set(),
          points: 0,
          bytes: 0,
          ms: 0,
          items: new Map(),
          pages: new Set(),
        });
        e.points = Math.max(e.points, split[owner] || 0);
        e.bytes = Math.max(e.bytes, t.bytes);
        e.ms = Math.max(e.ms, t.ms);
        f.metrics.forEach((m) => e.metrics.add(m));
        e.pages.add(`${r.page} ${r.device}`);
        for (const it of f.items.filter((i) => i.owner === owner)) {
          const prev = e.items.get(it.label);
          if (!prev || prev.bytes + prev.ms < it.bytes + it.ms) e.items.set(it.label, it);
        }
      }
    }
  }
  // Fonts-blocked control: a measured delta, filed on the theme when it is large enough to matter.
  const fontHits = ok.filter((r) => r.fontControl && (r.fontControl.deltaFp >= 700 || r.fontControl.deltaPerf >= 5));
  if (fontHits.length) {
    const e = (owners.theme["font-preload-control"] = {
      title: "Web fonts hold the first paint (measured: fonts blocked vs not)",
      metrics: new Set(["FCP", "LCP"]),
      // Score delta can be ≤ 0 even when first paint moves by seconds (the LCP then becomes a small text
      // node and the rest of the page sets the score) — never report a negative worth; the ms is the finding.
      points: Math.max(0, ...fontHits.map((r) => r.fontControl.deltaPerf)),
      bytes: 0,
      ms: Math.max(...fontHits.map((r) => r.fontControl.deltaFp)),
      items: new Map(),
      pages: new Set(fontHits.map((r) => `${r.page} ${r.device}`)),
    });
    for (const r of fontHits)
      e.items.set(`${r.page} ${r.device}`, {
        label: `${r.page} ${r.device}`,
        ms: r.fontControl.deltaFp,
        bytes: 0,
        detail: `first paint ${r.fontControl.baseFp}ms → ${r.fontControl.fp}ms, performance ${r.fontControl.basePerf} → ${r.fontControl.perf} with the theme's fonts blocked`,
      });
  }
  const ownerPoints = Object.fromEntries(
    Object.entries(owners).map(([o, b]) => [
      o,
      Math.round(Object.values(b).reduce((s, e) => s + e.points, 0) * 10) / 10,
    ])
  );
  lines.push(
    "",
    "## Who is responsible for what",
    "",
    "Estimated points each owner could give back. Findings overlap, so each number is a ceiling, not a sum that will materialise.",
    ""
  );
  lines.push("| Owner | ≈ points | findings |", "|---|---|---|");
  for (const o of ["theme", "merchant", "thirdparty", "shopify"])
    lines.push(`| ${OWNER_LABEL[o]} | ${ownerPoints[o] || 0} | ${Object.keys(owners[o] || {}).length} |`);
  lines.push("");
  for (const o of ["theme", "merchant", "thirdparty", "shopify"]) {
    const entries = Object.entries(owners[o] || {}).sort(
      (a, b) => b[1].points - a[1].points || b[1].ms + b[1].bytes - (a[1].ms + a[1].bytes)
    );
    if (!entries.length) continue;
    lines.push(`### ${OWNER_LABEL[o]}`, "");
    if (o === "shopify")
      lines.push(
        "Injected by Shopify (checkout, wallets, consent, pixels runtime, analytics). The theme cannot remove, defer or reorder them — listed so nobody bills them to the theme.",
        ""
      );
    if (o === "thirdparty")
      lines.push(
        "Installed by the merchant (apps, tag managers, pixels). The theme does not load them; removing or deferring them is the merchant's call.",
        ""
      );
    for (const [id, e] of entries) {
      const metricsTxt = [...e.metrics].join(", ") || "—";
      lines.push(
        `#### ${e.title} — ≈${e.points} pt · affects ${metricsTxt}${e.ms ? ` · ${Math.round(e.ms)}ms` : ""}${e.bytes ? ` · ${Math.round(e.bytes / 1024)} KB` : ""}`,
        ""
      );
      lines.push(`Seen on: ${[...e.pages].join(", ")}`, "");
      const items = [...e.items.values()].sort((a, b) => b.ms + b.bytes - (a.ms + a.bytes)).slice(0, 8);
      for (const it of items) {
        const cost = [it.ms ? `${Math.round(it.ms)}ms` : "", it.bytes ? `${Math.round(it.bytes / 1024)} KB` : ""]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `- \`${it.label}\`${cost ? ` — ${cost}` : ""}${it.entity && o === "thirdparty" ? ` (${it.entity})` : ""}${it.detail && !it.label.includes(it.detail) ? ` · ${it.detail.slice(0, 100)}` : ""}${o === "theme" ? sourceFor(it) : ""}`
        );
      }
      if (e.items.size > items.length) lines.push(`- … +${e.items.size - items.length} more`);
      if (o === "theme") lines.push("", `**Fix:** ${recipeFor(id)}`);
      if (o === "merchant") lines.push("", `**Merchant action:** ${merchantAdvice(id)}`);
      lines.push("");
    }
  }
}

const byId = {};
for (const r of ok)
  for (const f of r.a11yFails) (byId[f.id] ||= []).push(`${r.page} ${r.device} (${f.count}) — \`${f.sample}\``);
if (Object.keys(byId).length) {
  lines.push("## A11y failures by rule", "");
  for (const [id, where] of Object.entries(byId).sort((a, b) => b[1].length - a[1].length))
    lines.push(`### ${id}`, "", ...where.map((w) => `- ${w}`), "");
}

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ host, theme, runs, results }, null, 2));
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
console.log(
  `\n${lines.slice(2, 3).join("")}\n${ok.length ? lines.find((l) => l.startsWith("Average")) : "no successful run"}\nreport: ${path.relative(process.cwd(), path.join(OUT, "report.md"))}`
);
