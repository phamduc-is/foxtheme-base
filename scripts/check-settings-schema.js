#!/usr/bin/env node
// Sanity lint for config/settings_schema.json. Catches silent corruption from
// manual merges between core and child (which is the current strategy until
// Phase 2.3-B foxschema merge driver is added).
//
// Checks:
//   1. File is valid JSON (no trailing comma, no merge conflict markers, etc).
//   2. Top level is an array.
//   3. theme_info object is at index 0 (Shopify requirement).
//   4. Every other entry has a `name` field (otherwise theme editor breaks).
//   5. No duplicate section `name` (Shopify behavior undefined).
//   6. Within each section, no duplicate setting `id` (id is key — duplicates
//      silently lose data).

const fs = require("fs");
const path = require("path");

const SCHEMA_FILE = path.resolve(__dirname, "../config/settings_schema.json");

function isThemeInfo(entry) {
  return typeof entry === "object" && entry !== null && "theme_name" in entry;
}

function main() {
  if (!fs.existsSync(SCHEMA_FILE)) {
    console.error(`Schema file not found: ${SCHEMA_FILE}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(SCHEMA_FILE, "utf8");

  // Quick check for merge conflict markers — common when manual merge goes wrong
  if (/^<<<<<<<|^=======$|^>>>>>>>/m.test(raw)) {
    console.error(`✗ settings_schema.json contains unresolved merge conflict markers.`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ settings_schema.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error("✗ settings_schema.json top level must be an array.");
    process.exit(1);
  }

  const errors = [];

  if (data.length === 0 || !isThemeInfo(data[0])) {
    errors.push("[0] theme_info object must be the first element.");
  }

  const sectionNames = new Map(); // name → index where first seen
  for (let i = 1; i < data.length; i++) {
    const entry = data[i];
    if (typeof entry !== "object" || entry === null) {
      errors.push(`[${i}] entry is not an object`);
      continue;
    }
    if (isThemeInfo(entry)) {
      errors.push(`[${i}] duplicate theme_info — only allowed at index 0`);
      continue;
    }
    if (!entry.name) {
      errors.push(`[${i}] section is missing 'name' field`);
      continue;
    }
    if (sectionNames.has(entry.name)) {
      errors.push(`[${i}] duplicate section name "${entry.name}" (first seen at index ${sectionNames.get(entry.name)})`);
    } else {
      sectionNames.set(entry.name, i);
    }

    // Check setting IDs within this section
    const settings = entry.settings;
    if (settings != null && !Array.isArray(settings)) {
      errors.push(`[${i}] "${entry.name}": settings field must be an array`);
      continue;
    }
    if (Array.isArray(settings)) {
      const idsSeen = new Map();
      for (let j = 0; j < settings.length; j++) {
        const s = settings[j];
        if (typeof s !== "object" || s === null) continue;
        if (!s.id) continue; // header/paragraph types have no id — OK
        if (idsSeen.has(s.id)) {
          errors.push(
            `[${i}] "${entry.name}": duplicate setting id "${s.id}" at positions ${idsSeen.get(s.id)} and ${j}`
          );
        } else {
          idsSeen.set(s.id, j);
        }
      }
    }
  }

  if (errors.length === 0) {
    const sectionCount = data.length - 1; // exclude theme_info
    console.log(`✓ settings_schema.json sanity OK (theme_info + ${sectionCount} section${sectionCount === 1 ? "" : "s"}).`);
    return;
  }

  console.error(`✗ settings_schema.json has ${errors.length} issue(s):\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(`\nSee FORK-WORKFLOW.md §8 for manual merge guidance.`);
  process.exit(1);
}

main();
