#!/usr/bin/env node
// Fail when a file the theme inlines with `inline_asset_content` is at or over
// Shopify's size limit — because Shopify itself will not fail.
//
//   <style>{{ 'template-collection.css' | inline_asset_content }}</style>
//
// Measured on a dev store (2026-09-08), bracketing with 15,009 / 15,359 / 15,409-byte
// files: the limit is **15,360 bytes (15 KiB) of the file as uploaded** — the
// minified size Shopify serves from the CDN does not count. At or over it the
// filter outputs, inside your <style>, only
//
//   <!-- Asset size is too large. … Size limit: 15360 bytes. -->
//
// `<!--`/`-->` are ignored CSS tokens, so the page simply loses that stylesheet:
// no Liquid error, theme-check green, upload accepted. Nothing else catches it,
// and the collection stylesheet of a fork sat 120 bytes under the line.
//
// What is measured: the inlined stylesheets are BUILT from src/scss (assets/ is
// gitignored), so this compiles each entry with the repo's dart-sass exactly as
// scripts/build-css.js does (same output + trailing newline) and measures that.
// SVG/JS inlines are measured from their sources (src/images, src/js/modules).
// A call whose file name is a variable can't be resolved; the only one is
// snippets/icon.liquid, which inlines `icon-<name>.svg`, so every
// src/images/icon-*.svg is measured instead.
//
// Needs node_modules (sass) — in CI it runs in the "Inline asset budget" step
// after `yarn install`, not in the bare-node lint step.
//
// Usage:
//   yarn check-inline-assets            # exit 1 at/over the limit, warn from 14 KiB

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LIMIT = 15360; // Shopify: "Size limit: 15360 bytes"
const WARN_AT = 14336; // 14 KiB — one more feature and it's gone
const DIRS = ["layout", "sections", "blocks", "snippets"];
const SCSS_DIR = path.join(ROOT, "src/scss");
const SCOPED_DIR = path.join(SCSS_DIR, "scoped");

let sass;
try {
  sass = require("sass");
} catch {
  console.error("✖ check-inline-assets needs the repo's dart-sass (run `yarn install`).");
  process.exit(1);
}

const CALL_RE = /\{\{-?\s*([^|}]+?)\s*\|\s*inline_asset_content\b/g;
const LITERAL_RE = /^['"]([^'"]+)['"]$/;
const lineOf = (source, index) => source.slice(0, index).split("\n").length;

function liquidFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".liquid"))
    .map((e) => path.join(dir, e.name));
}

/** assets/<name>.css ← the SCSS entry that builds it (mirrors scripts/build-css.js outputFor). */
function scssEntryFor(cssName) {
  const base = cssName.replace(/\.css$/, "");
  const wanted = base.startsWith("scoped-") ? path.join(SCOPED_DIR, `${base.slice("scoped-".length)}.scss`) : null;
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".scss") && !e.name.startsWith("_")) {
        if (wanted ? p === wanted : !p.startsWith(SCOPED_DIR + path.sep) && e.name === `${base}.scss`) hits.push(p);
      }
    }
  })(SCSS_DIR);
  return hits[0] || null;
}

function measure(file) {
  const ext = path.extname(file);
  if (ext === ".css") {
    const entry = scssEntryFor(file);
    if (!entry) return { error: `no SCSS entry builds assets/${file}` };
    const { css } = sass.compile(entry, { sourceMap: false });
    return { bytes: Buffer.byteLength(css + "\n", "utf8"), from: path.relative(ROOT, entry) };
  }
  const candidates =
    ext === ".svg"
      ? [path.join(ROOT, "src/images", file), path.join(ROOT, "assets", file)]
      : [path.join(ROOT, "src/js/modules", file), path.join(ROOT, "assets", file)];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found)
    return { error: `source not found (looked in ${candidates.map((p) => path.relative(ROOT, p)).join(", ")})` };
  return { bytes: fs.statSync(found).size, from: path.relative(ROOT, found) };
}

const sites = new Map(); // asset file → [{file,line}]
let dynamic = 0;
for (const dir of DIRS) {
  for (const rel of liquidFiles(dir)) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(source))) {
      const lit = m[1].trim().match(LITERAL_RE);
      if (!lit) {
        dynamic++;
        continue;
      }
      if (!sites.has(lit[1])) sites.set(lit[1], []);
      sites.get(lit[1]).push({ file: rel, line: lineOf(source, m.index) });
    }
  }
}
if (dynamic) {
  const imgDir = path.join(ROOT, "src/images");
  if (fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir).filter((f) => /^icon-.*\.svg$/.test(f))) {
      if (!sites.has(f))
        sites.set(f, [{ file: "src/images (icon-*.svg, dynamic inline via snippets/icon.liquid)", line: 0 }]);
    }
  }
}

const rows = [];
let failed = 0;
let warned = 0;
for (const [asset, where] of [...sites.entries()].sort()) {
  const r = measure(asset);
  if (r.error) {
    failed++;
    rows.push(`  ✖ ${asset}: ${r.error}  ← ${where.map((w) => `${w.file}:${w.line}`).join(", ")}`);
    continue;
  }
  const pct = Math.round((r.bytes / LIMIT) * 100);
  if (r.bytes >= LIMIT) {
    failed++;
    rows.push(
      `  ✖ ${asset}: ${r.bytes} B (${pct}% of ${LIMIT}) — Shopify will inline an HTML comment instead; split it or link it with stylesheet_tag  ← ${where.map((w) => `${w.file}:${w.line}`).join(", ")}`
    );
  } else if (r.bytes >= WARN_AT) {
    warned++;
    rows.push(
      `  ⚠ ${asset}: ${r.bytes} B (${pct}% of ${LIMIT}) — ${LIMIT - r.bytes} B of headroom left  ← ${where.map((w) => `${w.file}:${w.line}`).join(", ")}`
    );
  } else if (r.bytes >= 2048) {
    rows.push(`  ✓ ${asset}: ${r.bytes} B (${pct}%)`);
  }
}

const small = sites.size - rows.length;
console[failed ? "error" : "log"](
  `${failed ? "✖" : "✓"} inline_asset_content budget (limit ${LIMIT} B): ${sites.size} asset(s) checked${small ? `, ${small} tiny ones not listed` : ""}${warned ? `, ${warned} near the limit` : ""}${failed ? `, ${failed} FAILING` : ""}.`
);
for (const row of rows) console[failed ? "error" : "log"](row);
process.exit(failed ? 1 : 0);
