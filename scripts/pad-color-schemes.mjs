#!/usr/bin/env node
/**
 * Equalise color_schemes across config/settings_data.json `current` + every `presets[*]`.
 *
 * Each demo store ends with its own number of schemes; the theme ships ONE settings_data, so
 * every preset must define the same scheme ids. A preset missing an id gets a copy from the
 * preset with the most schemes (see scripts/lib/color-schemes.mjs). Additive only — a scheme a
 * preset already has is never altered.
 *
 * Usage:
 *   yarn listings:pad-schemes            # write the padded file, print what was added
 *   yarn listings:pad-schemes --check    # report gaps, exit 1 if any (what check-listings runs)
 *
 * /sync-listing runs this after adding a preset. The rewrite drops the editor's `/* … *\/` banner
 * (Shopify accepts the strict form).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfigJson, colorSchemeGaps, padColorSchemes } from "./lib/color-schemes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "config", "settings_data.json");
const CHECK = process.argv.includes("--check");

const data = readConfigJson(FILE);
const { union, missing } = colorSchemeGaps(data);

if (missing.length === 0) {
  console.log(`pad-color-schemes: ${union.length} scheme id(s), every preset has all of them ✓`);
  process.exit(0);
}

if (CHECK) {
  for (const { name, ids } of missing) console.log(`  ❌ ${name} · missing color_schemes ${ids.join(", ")}`);
  console.log(`pad-color-schemes: ${missing.length} target(s) short — run \`yarn listings:pad-schemes\` to fill from the richest preset`);
  process.exit(1);
}

const added = padColorSchemes(data);
fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
for (const { name, id, from } of added) console.log(`  + ${name} · ${id}  (copied from ${from})`);
console.log(`pad-color-schemes: added ${added.length} scheme(s) → config/settings_data.json now carries ${union.length} id(s) in every preset ✓`);
