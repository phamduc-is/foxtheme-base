#!/usr/bin/env node
/**
 * audit-coverage — runtime audit of EVERY section and theme block, independent of the demo store.
 *
 * A Lighthouse/axe run only sees what a page renders, so `/store-audit lighthouse` covers
 * exactly the sections the demo builder dragged in and nothing else. This script renders the
 * rest: one auto-generated fixture per section (its first preset, placed FIRST on the page so
 * its LCP is measurable), plus host pages of theme-block presets, all on a header/footer-less
 * layout so every finding is attributable to the fixture. Nothing in the store is mutated —
 * fixtures are alternate templates reached through `?view=audit-NN` on a `wt/audit-coverage`
 * development theme.
 *
 *   yarn audit:coverage                       # generate → push → lighthouse → report
 *   yarn audit:coverage --only hero-banner,slideshow
 *   yarn audit:coverage --blocks-only | --sections-only
 *   yarn audit:coverage --a11y-only           # skip the performance category (≈2× faster)
 *   yarn audit:coverage --generate            # write fixtures only (inspect them, push yourself)
 *   yarn audit:coverage --clean               # remove generated fixtures
 *   yarn audit:coverage --write-baseline      # snapshot the result as .audit-coverage-baseline.json
 *   STOREFRONT_PASSWORD=1 yarn audit:coverage # password-gated development store
 *
 * Output: .audit-coverage/report.md + report.json (gitignored). With a baseline present the
 * report also lists regressions (a new a11y failure, or perf dropping > 5 points) and, under
 * `--strict`, exits 1 on any.
 *
 * Noise this deliberately strips — leave it in and every page reports the same three things:
 *   - Shopify's privacy banner becomes the LCP element of every page  → URL blocked
 *   - the preview-bar iframe fails `frame-title` on every page          → URL blocked
 *   - header/footer widgets (localization dropdown…) repeat everywhere  → audit layout has no groups
 *
 * Limits: a preset is the merchant's first impression, not the settings matrix (that stays
 * L2's job, per feature). Presets carry no images, so a media section's LCP is its text unless
 * the store has seeded images. Performance here is per-section COST at the top of an otherwise
 * empty page, not a page score to publish.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readCreds, ensureTheme, shopifyBin } from "./wt-theme.mjs";
import {
  cookieJar,
  follow,
  unlock,
  lighthouse as runLighthouse,
  metrics,
  EmptyRenderError,
} from "./lib/lighthouse.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".audit-coverage");
const BASELINE = path.join(ROOT, ".audit-coverage-baseline.json");
const FIXTURES = path.join(OUT_DIR, "fixtures.json");
const LAYOUT = "audit";
const THEME_SLUG = "audit-coverage";
const BLOCKS_PER_PAGE = 12;
const BLOCKED = ["*privacy-banner*", "*preview-bar*"];
const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const only = opt("only")?.split(",").filter(Boolean);

// ───────────────────────── schema helpers ─────────────────────────

function readSchema(file) {
  const m = fs.readFileSync(file, "utf8").match(SCHEMA_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null; // check-liquid owns schema validity
  }
}

/** Preset `blocks` come in two shapes: an array (section blocks) or an object + block_order (theme blocks). */
function presetToInstance(type, preset) {
  const inst = { type, settings: preset.settings || {} };
  if (!preset.blocks) return inst;
  if (Array.isArray(preset.blocks)) {
    inst.blocks = {};
    inst.block_order = [];
    preset.blocks.forEach((b, i) => {
      // A static block keeps the id its section addresses it by, and is not part of block_order.
      const id = b.static ? b.id : blockId(`${b.type}_${i}`);
      inst.blocks[id] = b.static ? { ...presetToInstance(b.type, b), static: true } : presetToInstance(b.type, b);
      if (!b.static) inst.block_order.push(id);
    });
  } else {
    inst.blocks = preset.blocks;
    inst.block_order = preset.block_order || Object.keys(preset.blocks);
  }
  return inst;
}

/** Block ids may not start with `_` (private block types do). */
const blockId = (s) => s.replace(/[^a-z0-9]/gi, "_").replace(/^_+/, "");

/** A section the editor only offers in a group (header/footer/overlay) or on other templates cannot be placed on our fixture. */
function placeable(schema, context) {
  const on = schema.enabled_on;
  if (on) {
    if (on.templates && !on.templates.includes("*") && !on.templates.includes(context)) return false;
    if (!on.templates && on.groups) return false;
  }
  const off = schema.disabled_on;
  if (off?.templates && (off.templates.includes("*") || off.templates.includes(context))) return false;
  return true;
}

/** Which page a section needs to render its data: product / collection / index. */
function contextOf(source) {
  if (/closest\.product|(?<!settings\.)\bproduct\.(?!card)/.test(source)) return "product";
  if (/(?<!settings\.)\bcollection\.(products|title|image|handle|description)/.test(source)) return "collection";
  return "index";
}

// ───────────────────────── generate ─────────────────────────

function generate() {
  clean(true); // stale fixtures from an earlier run would still be pushed
  const fixtures = [];
  let n = 0;
  const next = () => `audit-${String(++n).padStart(2, "0")}`;

  if (!flag("blocks-only")) {
    for (const f of fs
      .readdirSync(path.join(ROOT, "sections"))
      .filter((f) => f.endsWith(".liquid"))
      .sort()) {
      const type = f.replace(/\.liquid$/, "");
      if (only && !only.includes(type)) continue;
      const schema = readSchema(path.join(ROOT, "sections", f));
      const preset = schema?.presets?.[0];
      if (!preset) continue; // template-only sections render through their own template (covered by /store-audit lighthouse)
      const context = contextOf(fs.readFileSync(path.join(ROOT, "sections", f), "utf8"));
      if (!placeable(schema, context)) {
        fixtures.push({
          suffix: "—",
          context,
          kind: "section",
          type,
          skipped: "editor restricts it to a group/other template",
        });
        continue;
      }
      const suffix = next();
      writeTemplate(context, suffix, { audit: presetToInstance(type, preset) }, ["audit"]);
      fixtures.push({ suffix, context, kind: "section", type });
    }
  }

  if (!flag("sections-only")) {
    const hostFile = path.join(ROOT, "sections", (opt("block-host") || "custom-section") + ".liquid");
    const host = fs.existsSync(hostFile) ? readSchema(hostFile) : null;
    if (!host?.blocks?.some((b) => b.type === "@theme")) {
      console.warn(
        `audit-coverage: no theme-block host section (${path.basename(hostFile)} must accept "@theme") — blocks skipped`
      );
    } else {
      const hostType = path.basename(hostFile, ".liquid");
      const hostPreset = host.presets?.[0] || {};
      const blocks = fs
        .readdirSync(path.join(ROOT, "blocks"))
        .filter((f) => f.endsWith(".liquid"))
        .sort()
        .map((f) => ({ type: f.replace(/\.liquid$/, ""), schema: readSchema(path.join(ROOT, "blocks", f)) }))
        .filter((b) => !b.type.startsWith("_")) // private blocks only live inside a parent — covered by that parent's preset
        .filter((b) => b.schema?.presets?.[0] && (!only || only.includes(b.type)));
      for (let i = 0; i < blocks.length; i += BLOCKS_PER_PAGE) {
        const page = blocks.slice(i, i + BLOCKS_PER_PAGE);
        const inst = { type: hostType, settings: hostPreset.settings || {}, blocks: {}, block_order: [] };
        for (const b of page) {
          const id = blockId(b.type);
          inst.blocks[id] = presetToInstance(b.type, b.schema.presets[0]);
          inst.block_order.push(id);
        }
        const suffix = next();
        writeTemplate("index", suffix, { audit: inst }, ["audit"]);
        fixtures.push({
          suffix,
          context: "index",
          kind: "blocks",
          type: page.map((b) => b.type).join(","),
          host: hostType,
        });
      }
    }
  }

  // Layout: theme.liquid minus the section groups (header / footer / overlays).
  const theme = fs.readFileSync(path.join(ROOT, "layout", "theme.liquid"), "utf8");
  const layout = theme.replace(/^[ \t]*\{%-?\s*sections\s+'[^']+'\s*-?%\}[ \t]*\n/gm, "");
  if (layout === theme) throw new Error("layout/theme.liquid has no `{% sections '…' %}` lines to strip");
  fs.writeFileSync(path.join(ROOT, "layout", `${LAYOUT}.liquid`), layout);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(FIXTURES, JSON.stringify(fixtures, null, 2));
  const live = fixtures.filter((f) => !f.skipped);
  console.log(
    `audit-coverage: ${live.length} fixtures (${live.filter((f) => f.kind === "section").length} sections, ${live.filter((f) => f.kind === "blocks").length} block pages; ${fixtures.length - live.length} section(s) skipped — group/template-restricted)`
  );
  return fixtures;
}

function writeTemplate(context, suffix, sections, order) {
  const file = path.join(ROOT, "templates", `${context}.${suffix}.json`);
  fs.writeFileSync(file, JSON.stringify({ layout: LAYOUT, sections, order }, null, 2) + "\n");
}

function clean(quiet = false) {
  let n = 0;
  for (const f of fs.readdirSync(path.join(ROOT, "templates"))) {
    if (/^(index|product|collection)\.audit-\d+\.json$/.test(f)) {
      fs.unlinkSync(path.join(ROOT, "templates", f));
      n++;
    }
  }
  const layout = path.join(ROOT, "layout", `${LAYOUT}.liquid`);
  if (fs.existsSync(layout)) {
    fs.unlinkSync(layout);
    n++;
  }
  if (!quiet) console.log(`audit-coverage: removed ${n} generated file(s)`);
}

// ───────────────────────── storefront session ─────────────────────────

/** Password-gated stores keep the session in HttpOnly cookies, so a jar is the only way in (see lib/lighthouse.mjs). */
async function session(store, themeId) {
  const jar = cookieJar();
  const base = `https://${store}`;
  const password = opt("password") || process.env.STOREFRONT_PASSWORD;
  if (password && !(await unlock(jar, base, password)))
    throw new Error(`storefront still shows the password page — wrong STOREFRONT_PASSWORD? (store ${store})`);
  // The preview is cookie-backed too, and a theme nobody has opened from the admin yet goes through a
  // share-token hop first (`/services/access_tokens/create_sharing/<id>` → back to `/`).
  const { status, url } = await follow(jar, `${base}/?preview_theme_id=${themeId}`);
  if (status !== 200) throw new Error(`storefront answered ${status} at ${url} (store ${store})`);

  const handle = async (kind) => {
    const res = await fetch(`${base}/${kind}.json?limit=1`, { headers: { cookie: jar.header() } });
    const json = await res.json().catch(() => ({}));
    return json[kind]?.[0]?.handle;
  };
  return { cookie: jar.header(), base, product: await handle("products"), collection: await handle("collections") };
}

// ───────────────────────── run ─────────────────────────

function lighthouse(url, cookie, file) {
  const categories = flag("a11y-only") ? ["accessibility"] : ["performance", "accessibility"];
  try {
    return runLighthouse(url, { cookie, categories, blocked: BLOCKED, file });
  } catch (e) {
    // A fixture that paints nothing (empty preset, or a section that needs store data such as recently-viewed) is a result, not a failure.
    if (e instanceof EmptyRenderError) return null;
    throw e;
  }
}

const summarize = (fixture, r) => ({ ...fixture, ...metrics(r) });

async function run(fixtures) {
  if (!fs.existsSync(path.join(ROOT, "assets", "theme.css"))) {
    console.log("audit-coverage: assets not built — running yarn build:assets");
    execFileSync("yarn", ["build:assets"], { stdio: "inherit" });
  }
  const creds = readCreds(ROOT);
  const theme = ensureTheme(THEME_SLUG, ROOT, creds); // first call uploads the whole theme
  console.log(`audit-coverage: pushing to ${theme.name} (#${theme.id}) on ${creds.store}`);
  execFileSync(
    shopifyBin(),
    [
      "theme",
      "push",
      "--path",
      ROOT,
      "--theme",
      String(theme.id),
      "-s",
      creds.store,
      "--password",
      creds.password,
      "--nodelete",
    ],
    {
      stdio: ["ignore", "ignore", "inherit"],
    }
  );

  const s = await session(creds.store, theme.id);
  const pathFor = (f) => {
    if (f.context === "product") return s.product ? `/products/${s.product}` : null;
    if (f.context === "collection") return s.collection ? `/collections/${s.collection}` : null;
    return "/";
  };

  const results = [];
  for (const [i, f] of fixtures.entries()) {
    if (f.skipped) {
      results.push(f);
      continue;
    }
    const p = pathFor(f);
    if (!p) {
      console.log(`  ${f.suffix} ${f.type} — skipped (store has no ${f.context})`);
      results.push({ ...f, skipped: `no ${f.context} on store` });
      continue;
    }
    const url = `${s.base}${p}?view=${f.suffix}`;
    process.stdout.write(
      `  [${i + 1}/${fixtures.length}] ${f.suffix} ${f.kind === "blocks" ? "blocks: " : ""}${f.type.slice(0, 60)} … `
    );
    try {
      const r = lighthouse(url, s.cookie, path.join(OUT_DIR, `${f.suffix}.json`));
      if (!r) {
        console.log("empty render — nothing painted (empty preset, or needs store data)");
        results.push({ ...f, skipped: "empty render (empty preset, or needs store data)" });
        continue;
      }
      const sum = summarize(f, r);
      results.push(sum);
      console.log(
        `${sum.perf !== undefined ? `perf=${sum.perf} ` : ""}a11y=${sum.a11y}${sum.a11yFails.length ? ` ✗ ${sum.a11yFails.map((x) => x.id).join(",")}` : ""}`
      );
    } catch (e) {
      console.log(`ERROR ${String(e.message).split("\n")[0].slice(0, 120)}`);
      results.push({ ...f, error: String(e.message).slice(0, 300) });
    }
  }
  return results;
}

// ───────────────────────── report ─────────────────────────

/** A block page is named by its fixture — naming it after its first block would blame the wrong one. */
const label = (r) => (r.kind === "blocks" ? `${r.suffix} (blocks page)` : r.type);

function report(results) {
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
  const regressions = [];
  if (baseline) {
    for (const r of results) {
      const b = baseline[r.type];
      if (!b || r.error || r.skipped) continue;
      for (const f of r.a11yFails)
        if (!b.a11yFails.includes(f.id)) regressions.push(`${r.type}: new a11y failure ${f.id}`);
      if (r.perf !== undefined && b.perf !== undefined && r.perf < b.perf - 5)
        regressions.push(`${r.type}: perf ${b.perf} → ${r.perf}`);
    }
  }

  const lines = ["# audit-coverage report", ""];
  lines.push(
    `${results.length} fixtures · ${results.filter((r) => r.error).length} errors · ${results.filter((r) => r.skipped).length} skipped${baseline ? ` · ${regressions.length} regression(s) vs baseline` : " · no baseline"}`,
    ""
  );
  if (regressions.length) lines.push("## Regressions", "", ...regressions.map((r) => `- ${r}`), "");

  const hasPerf = results.some((r) => r.perf !== undefined);
  lines.push("## Matrix", "");
  lines.push(`| Fixture | Type | A11y | ${hasPerf ? "Perf | LCP | Render delay | LCP element | " : ""}A11y failures |`);
  lines.push(`|---|---|---|${hasPerf ? "---|---|---|---|" : ""}---|`);
  for (const r of results) {
    const type = r.kind === "blocks" ? `blocks (${r.host}): ${r.type}` : r.type;
    if (r.error || r.skipped) {
      lines.push(
        `| ${r.suffix} | ${type} | — |${hasPerf ? " — | — | — | — |" : ""} ${r.error ? "ERROR " + r.error.split("\n")[0] : r.skipped} |`
      );
      continue;
    }
    const fails = r.a11yFails.map((f) => `\`${f.id}\`×${f.count}`).join(", ") || "—";
    const perf = hasPerf
      ? ` ${r.perf} | ${r.lcp ? (r.lcp / 1000).toFixed(1) + "s" : "—"} | ${r.lcpRenderDelay ?? "—"}ms | \`${(r.lcpElement || "").replace(/\|/g, "\\|").slice(0, 60)}\` |`
      : "";
    lines.push(`| ${r.suffix} | ${type} | ${r.a11y} |${perf} ${fails} |`);
  }

  const byId = {};
  for (const r of results)
    for (const f of r.a11yFails || []) (byId[f.id] ||= []).push(`${label(r)} (${f.count}) — \`${f.sample}\``);
  if (Object.keys(byId).length) {
    lines.push("", "## A11y failures by rule", "");
    for (const [id, where] of Object.entries(byId).sort((a, b) => b[1].length - a[1].length))
      lines.push(`### ${id} — ${where.length} fixture(s)`, "", ...where.map((w) => `- ${w}`), "");
  }
  if (hasPerf) {
    const slow = results.filter((r) => r.lcpRenderDelay > 500).sort((a, b) => b.lcpRenderDelay - a.lcpRenderDelay);
    if (slow.length) {
      lines.push(
        "## LCP element render delay > 500ms",
        "",
        "The LCP resource arrived but painted late — an entrance animation or JS-gated reveal on the LCP element is the usual cause.",
        ""
      );
      for (const r of slow) lines.push(`- ${label(r)}: ${r.lcpRenderDelay}ms — \`${r.lcpElement}\``);
      lines.push("");
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), lines.join("\n"));
  console.log(`\n${lines.slice(0, 3).join("\n")}\nreport: ${path.relative(ROOT, path.join(OUT_DIR, "report.md"))}`);
  if (regressions.length) console.log(regressions.map((r) => `  ✗ ${r}`).join("\n"));

  if (flag("write-baseline")) {
    const snap = {};
    for (const r of results)
      if (!r.error && !r.skipped) snap[r.type] = { perf: r.perf, a11yFails: r.a11yFails.map((f) => f.id) };
    fs.writeFileSync(BASELINE, JSON.stringify(snap, null, 2) + "\n");
    console.log(`baseline written: ${path.basename(BASELINE)}`);
  }
  return regressions;
}

// ───────────────────────── main ─────────────────────────

if (flag("clean")) {
  clean();
} else {
  const fixtures = generate();
  if (!flag("generate")) {
    const results = await run(fixtures);
    const regressions = report(results);
    if (flag("strict") && regressions.length) process.exit(1);
  }
}
