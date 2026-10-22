#!/usr/bin/env node
// Validate every value a `presets` entry assigns to a `select` / `radio` setting
// against that setting's own `options[]`.
//
// Nothing else catches this. `@shopify/theme-check` accepts any string, Shopify
// accepts the upload, and the editor just renders the select blank — so the bug
// ships silently and only surfaces as "the default preset looks wrong".
//
// The failure is worse than a no-op: a bad value still reaches Liquid, so
// `class="text-limit-{{ value }}"` emits `text-limit-1-lines`, which matches a
// catch-all `[class*="text-limit-"]` rule but sets no `--line-clamp` — the
// element gets `-webkit-box` with no clamp, the OPPOSITE of the intent.
//
// A preset's block settings are defined in ANOTHER file (a theme block in
// blocks/), so resolution has to cross files — a same-file check misses the
// most common form of this bug.
//
// Scans presets in sections/ + blocks/. Only reports when the setting definition
// is resolvable and is a select/radio with options — unknown ids and unresolvable
// block types are skipped, not guessed (check-liquid owns those).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
const ENUM_TYPES = new Set(["select", "radio"]);

/** Parse the inline {% schema %} of a .liquid file. Returns null when absent/invalid. */
function readSchema(absPath) {
  const m = fs.readFileSync(absPath, "utf8").match(SCHEMA_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null; // check-liquid owns schema-JSON validity
  }
}

function liquidFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".liquid"))
    .map((f) => ({ rel: `${dir}/${f}`, abs: path.join(abs, f), type: f.slice(0, -".liquid".length) }));
}

/** id → setting definition, for one settings array. */
function indexSettings(settings) {
  const map = new Map();
  for (const s of Array.isArray(settings) ? settings : []) {
    if (s && typeof s.id === "string") map.set(s.id, s);
  }
  return map;
}

/**
 * Check one `settings` object from a preset against the resolved definitions.
 * `where` is a human path like `sections/x.liquid → preset "Foo" → block "bar"`.
 */
function checkSettings(presetSettings, defs, where, errors) {
  if (!presetSettings || typeof presetSettings !== "object") return;
  for (const [id, value] of Object.entries(presetSettings)) {
    const def = defs.get(id);
    // Unknown id, or a type with no closed option list → not ours to judge.
    if (!def || !ENUM_TYPES.has(def.type) || !Array.isArray(def.options)) continue;
    // Shopify compares option values as strings.
    const allowed = def.options
      .map((o) => (o && o.value !== undefined ? String(o.value) : null))
      .filter((v) => v !== null);
    if (allowed.length === 0) continue;
    if (!allowed.includes(String(value))) {
      errors.push(
        `${where} → "${id}": ${JSON.stringify(value)} is not one of its options ` +
          `[${allowed.map((v) => JSON.stringify(v)).join(", ")}]`
      );
    }
  }
}

/** Normalise a preset's `blocks` (object-map or array form) to a flat list. */
function presetBlockList(blocks) {
  if (Array.isArray(blocks)) return blocks.map((b, i) => ({ key: String(i), block: b }));
  if (blocks && typeof blocks === "object") {
    return Object.entries(blocks).map(([key, block]) => ({ key, block }));
  }
  return [];
}

/**
 * Walk a preset's block tree. `inlineDefs` maps a section's INLINE block types
 * (schema `blocks: [{type, settings}]`) to their settings; theme blocks resolve
 * through `themeBlocks` (blocks/<type>.liquid).
 */
function checkPresetBlocks(blocks, inlineDefs, themeBlocks, where, errors, depth = 0) {
  if (depth > 6) return; // nesting guard; real themes stay far below this
  for (const { key, block } of presetBlockList(blocks)) {
    if (!block || typeof block !== "object") continue;
    const type = block.type;
    if (typeof type !== "string" || type.startsWith("@")) continue; // @theme / @app: no concrete schema

    const defs = inlineDefs.get(type) || themeBlocks.get(type);
    const at = `${where} → block "${key}" (${type})`;
    if (defs) checkSettings(block.settings, defs, at, errors);
    // Nested children are always theme blocks — inline section blocks cannot nest.
    if (block.blocks) checkPresetBlocks(block.blocks, new Map(), themeBlocks, at, errors, depth + 1);
  }
}

function main() {
  const errors = [];
  let presetCount = 0;

  // Pass 1 — every theme block's settings, so section presets can resolve them.
  const themeBlocks = new Map();
  for (const { abs, type } of liquidFiles("blocks")) {
    const schema = readSchema(abs);
    if (schema) themeBlocks.set(type, indexSettings(schema.settings));
  }

  // Pass 2 — presets in sections/ and blocks/.
  for (const { rel, abs } of [...liquidFiles("sections"), ...liquidFiles("blocks")]) {
    const schema = readSchema(abs);
    if (!schema || !Array.isArray(schema.presets)) continue;

    const ownDefs = indexSettings(schema.settings);
    const inlineDefs = new Map();
    for (const b of Array.isArray(schema.blocks) ? schema.blocks : []) {
      if (b && typeof b.type === "string" && Array.isArray(b.settings)) {
        inlineDefs.set(b.type, indexSettings(b.settings));
      }
    }

    for (const preset of schema.presets) {
      if (!preset || typeof preset !== "object") continue;
      presetCount++;
      const where = `${rel} → preset "${preset.name || "(unnamed)"}"`;
      checkSettings(preset.settings, ownDefs, where, errors);
      if (preset.blocks) checkPresetBlocks(preset.blocks, inlineDefs, themeBlocks, where, errors);
    }
  }

  if (errors.length === 0) {
    console.log(`✓ preset values OK (${presetCount} presets checked, all select/radio values match their options).`);
    return;
  }

  console.error(`✗ ${errors.length} preset value(s) not in the setting's option list:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    `\nThe editor renders these blank and the raw value still reaches Liquid, so a` +
      `\nclass/attribute built from it matches nothing. theme-check does not catch this.`
  );
  process.exit(1);
}

main();
