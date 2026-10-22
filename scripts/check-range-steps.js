#!/usr/bin/env node
// Validate every `range` setting in the theme against Shopify's schema rules.
//
// Shopify rejects the WHOLE file at theme-upload time if a range breaks these,
// and `@shopify/theme-check` does not catch them — so a block can pass every
// static check, then 500 the page on a real store. This script closes that gap.
//
// Rules (per Shopify's input-settings docs):
//   1. step > 0, min < max
//   2. (max - min) must be evenly divisible by step
//   3. (max - min) / step <= 101   ← the one that bites: `0..999 step 1` = 999
//   4. default, when present, must sit within [min, max]
//
// Scans the inline {% schema %} of blocks/ + sections/ and config/settings_schema.json.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAX_STEPS = 101;

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

/** Every settings array reachable in a schema object (top level + section blocks). */
function* settingsArrays(schema) {
  if (Array.isArray(schema.settings)) yield schema.settings;
  for (const block of schema.blocks || []) {
    if (Array.isArray(block.settings)) yield block.settings;
  }
}

function checkRange(s, where, errors) {
  const { id, min, max, step = 1 } = s;
  const at = `${where} → range "${id}"`;

  if (typeof min !== "number" || typeof max !== "number") {
    errors.push(`${at}: min and max must both be numbers (got ${min}, ${max})`);
    return;
  }
  if (typeof step !== "number" || step <= 0) {
    errors.push(`${at}: step must be a positive number (got ${step})`);
    return;
  }
  if (min >= max) {
    errors.push(`${at}: min (${min}) must be less than max (${max})`);
    return;
  }

  const span = max - min;
  // Float-safe divisibility: steps like 0.1 lose precision under plain %.
  const steps = span / step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) {
    errors.push(`${at}: (max - min) = ${span} is not evenly divisible by step ${step}`);
    return;
  }
  if (Math.round(steps) > MAX_STEPS) {
    errors.push(
      `${at}: ${Math.round(steps)} steps exceeds Shopify's limit of ${MAX_STEPS} ` +
        `(min ${min}, max ${max}, step ${step}) — the theme upload will reject this file. ` +
        `Raise step or lower max.`
    );
  }
  if (typeof s.default === "number" && (s.default < min || s.default > max)) {
    errors.push(`${at}: default ${s.default} is outside [${min}, ${max}]`);
  }
}

function collectLiquid(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".liquid"))
    .map((f) => path.join(dir, f));
}

function main() {
  const errors = [];
  let rangeCount = 0;
  let fileCount = 0;

  for (const rel of [...collectLiquid("blocks"), ...collectLiquid("sections")]) {
    const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const m = raw.match(SCHEMA_RE);
    if (!m) continue;
    let schema;
    try {
      schema = JSON.parse(m[1]);
    } catch {
      continue; // check-liquid owns schema-JSON validity
    }
    fileCount++;
    for (const settings of settingsArrays(schema)) {
      for (const s of settings) {
        if (s && s.type === "range") {
          rangeCount++;
          checkRange(s, rel, errors);
        }
      }
    }
  }

  const globalSchema = path.join(ROOT, "config/settings_schema.json");
  if (fs.existsSync(globalSchema)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(globalSchema, "utf8"));
    } catch {
      data = null; // check-settings-schema owns JSON validity
    }
    for (const entry of Array.isArray(data) ? data : []) {
      for (const s of entry.settings || []) {
        if (s && s.type === "range") {
          rangeCount++;
          checkRange(s, `config/settings_schema.json [${entry.name}]`, errors);
        }
      }
    }
    if (data) fileCount++;
  }

  if (errors.length === 0) {
    console.log(`✓ range settings OK (${rangeCount} ranges across ${fileCount} files, all ≤ ${MAX_STEPS} steps).`);
    return;
  }

  console.error(`✗ ${errors.length} invalid range setting(s):\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(`\nShopify rejects the entire file on upload; theme-check does not catch this.`);
  process.exit(1);
}

main();
