#!/usr/bin/env node
/**
 * Validate the /listings folder (Theme Store preset listings) against the theme.
 *
 * Shopify rules (https://shopify.dev/docs/storefronts/themes/store/requirements):
 *   - listings/<preset>/templates/*.json (required per preset), listings/<preset>/sections/*.json (optional)
 *   - one preset must take the parent theme's name; names 1-2 words, < 30 chars
 *   - install state must mirror the demo store; no demo-store-specific resources in .json
 *
 * Checks (errors fail CI; warnings are informational unless --strict):
 *   E  every listings JSON parses; unknown subfolders; empty preset folders; no nested folder under
 *      templates/ (templates/customers/* are theme-owned system templates, never preset content)
 *   E  every section type referenced in listings JSON exists in sections/
 *   E  every block type exists in blocks/ OR in the owning section's inline schema
 *   E  preset folder names match a preset key in config/settings_data.json (slug-insensitive: case + space/dash)
 *   E  preset naming: 1-2 words, < 30 chars; exactly one preset named after the theme
 *   E  color_schemes parity: `current` + every preset define the same scheme ids (yarn listings:pad-schemes fills gaps)
 *   E  the DEFAULT preset (the one named after the theme) mirrors the install state: every
 *      listings/<default>/{templates,sections}/*.json deep-equals the root file of the same name,
 *      and settings_data.json `presets[<default>]` deep-equals `current` (what a fresh install gets)
 *   E  store-specific leftovers (shopify:// URLs, and any value under a setting id the schemas
 *      type as a store resource — product, collection_list, link_list, page, …) in listings
 *      JSON and settings_data `current`/presets — /sync-listing cleans at sync time; the repo
 *      is always shippable
 *   E  header section: a static block still carrying children (demo mega-menu / custom links)
 *   E  a credential value (a Google `AIza…` key) anywhere in listings JSON or root templates/
 *   E  list-collections.json (listings AND root templates/): the `main-*` section enabled, every
 *      other section disabled — reviewers open that page for the paginated collections list; the
 *      demo's dressing stays on the demo store (clean-data-json normalises it at sync time)
 *   W  placeholder content (lorem ipsum)
 *
 * No listings/ folder is a PASS (single-preset themes don't need one — the base repo has none).
 *
 * Usage: yarn check-listings [--strict]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfigJson, colorSchemeGaps, settingsTargets } from "./lib/color-schemes.mjs";
import resourceSettings from "./lib/resource-settings.js";

const { buildResourceSettingIds, findResourceLeaks, CREDENTIAL_VALUE_PATTERN } = resourceSettings;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// "Horizon Bold" (presets key / theme_name) and "horizon-bold" (folder) must compare equal.
const slug = (s) => String(s).toLowerCase().replace(/[-_\s]+/g, "-");
const LISTINGS = path.join(ROOT, "listings");
const STRICT = process.argv.includes("--strict");

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// Strict JSON on purpose (and dependency-free, so CI can run this without yarn install):
// listings JSON ships inside the theme zip and Shopify only accepts strict JSON — a
// tolerant parser would pass files the Theme Store upload then rejects.
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function themeName() {
  try {
    const schema = readConfigJson(path.join(ROOT, "config", "settings_schema.json"));
    return schema[0]?.theme_name ?? null;
  } catch {
    return null;
  }
}

function settingsData() {
  try {
    return readConfigJson(path.join(ROOT, "config", "settings_data.json"));
  } catch (e) {
    err(`config/settings_data.json · cannot parse: ${e.message}`);
    return {};
  }
}

function settingsDataPresets(data) {
  return Object.keys(data.presets ?? {});
}

// One settings_data ships for every preset, so a scheme id one demo uses must exist in all.
function checkColorSchemeParity(data) {
  for (const { name, ids } of colorSchemeGaps(data).missing) {
    err(`config/settings_data.json · ${name} is missing color_schemes ${ids.join(", ")} — run \`yarn listings:pad-schemes\``);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const resourceSettingIds = buildResourceSettingIds(ROOT);

// A value under a setting id the schemas type as a store resource (product, collection_list,
// link_list, page, …) is a demo-store handle — a fresh install cannot have it. clean-data-json
// strips these by the same map; this is the CI sanction when it did not run.
function checkResourceLeaks(file, json) {
  const rel = path.relative(ROOT, file);
  for (const { key, types, value } of findResourceLeaks(json, resourceSettingIds)) {
    err(`${rel} · "${key}" (${types.join("/")}) still holds store data: ${JSON.stringify(value).slice(0, 60)} — run \`yarn clean-data-json <path>\` (/sync-listing does this at sync time)`);
  }
}

const sectionSchemaCache = new Map();
// Substring heuristic, not a schema parse — any quoted occurrence of the type in the
// section file passes. Good enough to catch typos; parse {% schema %} if it ever misleads.
function sectionDeclaresBlock(sectionType, blockType) {
  if (!sectionSchemaCache.has(sectionType)) {
    const file = path.join(ROOT, "sections", `${sectionType}.liquid`);
    sectionSchemaCache.set(sectionType, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  }
  return sectionSchemaCache.get(sectionType).includes(`"${blockType}"`);
}

// Walk a template/section-group JSON: verify every section + block type resolves.
function checkTypes(file, json) {
  const rel = path.relative(ROOT, file);
  for (const [id, section] of Object.entries(json.sections ?? {})) {
    const type = section?.type;
    if (!type) continue;
    if (!fs.existsSync(path.join(ROOT, "sections", `${type}.liquid`))) {
      err(`${rel} · section "${id}" references missing sections/${type}.liquid`);
      continue;
    }
    for (const [blockId, block] of Object.entries(section.blocks ?? {})) {
      const bType = block?.type;
      if (!bType || bType.startsWith("@")) continue;
      const isThemeBlock = fs.existsSync(path.join(ROOT, "blocks", `${bType}.liquid`));
      if (!isThemeBlock && !sectionDeclaresBlock(type, bType)) {
        err(`${rel} · block "${blockId}" type "${bType}" is neither blocks/${bType}.liquid nor a section block of sections/${type}.liquid`);
      }
    }
  }
}

// The header's static blocks are containers for demo navigation (mega-menu columns, custom
// links, drawer items) authored against the demo store's menus — clean-data-json empties them.
function checkHeaderStaticBlocks(file, json) {
  const rel = path.relative(ROOT, file);
  for (const [id, section] of Object.entries(json.sections ?? {})) {
    if (section?.type !== "header") continue;
    for (const [blockId, block] of Object.entries(section.blocks ?? {})) {
      if (block?.static !== true) continue;
      const n = Object.keys(block.blocks ?? {}).length;
      if (n > 0) {
        err(`${rel} · section "${id}" static block "${blockId}" still has ${n} child block(s) — demo navigation content; run \`yarn clean-data-json <path>\` (/sync-listing does this at sync time)`);
      }
    }
  }
}

function checkContent(file, raw) {
  const rel = path.relative(ROOT, file);
  if (/lorem ipsum/i.test(raw)) warn(`${rel} · contains "lorem ipsum" placeholder text (Theme Store demo content must be authentic)`);
  const shopifyUrls = raw.match(/shopify:\/\/[^"'\s]*/g) || [];
  if (shopifyUrls.length) err(`${rel} · contains shopify:// URLs (${[...new Set(shopifyUrls)].slice(0, 3).join(", ")}) — run \`yarn clean-data-json listings/<preset>\` (drops every picked resource and route — a merchant chooses their own targets after install; a typed path like `/collections` stays); /sync-listing does this at sync time`);
  if (CREDENTIAL_VALUE_PATTERN.test(raw)) err(`${rel} · contains a Google API key (AIza…) — the demo's credential must not ship; run \`yarn clean-data-json <path>\``);
}

// The collections list page is what a reviewer opens for "collections with pagination" — the
// template's main-* section. clean-data-json ships it enabled and everything else disabled; the
// demo store keeps its own design. Applies to every listing AND the root template (install state).
function checkListCollections(file, json) {
  if (path.basename(file) !== "list-collections.json") return;
  const rel = path.relative(ROOT, file);
  for (const [id, section] of Object.entries(json.sections ?? {})) {
    const isMain = typeof section?.type === "string" && section.type.startsWith("main-");
    if (isMain && section.disabled === true) {
      err(`${rel} · main section "${id}" (${section.type}) is disabled — reviewers expect the paginated collections list; run \`yarn clean-data-json <path>\``);
    } else if (!isMain && section?.disabled !== true) {
      err(`${rel} · section "${id}" (${section.type}) is enabled — on list-collections only the main section ships enabled (the demo's dressing stays on the demo store); run \`yarn clean-data-json <path>\``);
    }
  }
}

// Root templates/ ship in every zip, listings or not: the two rules above hold there too.
function checkRootTemplates() {
  const dir = path.join(ROOT, "templates");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const file = path.join(dir, f);
    const raw = fs.readFileSync(file, "utf8");
    if (CREDENTIAL_VALUE_PATTERN.test(raw)) err(`templates/${f} · contains a Google API key (AIza…) — the demo's credential must not ship; run \`yarn clean-data-json templates/${f}\``);
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      continue; // theme-check reports invalid template JSON
    }
    checkListCollections(file, json);
  }
}

function checkPresetNames(folders, presetKeys) {
  const theme = themeName();
  const slugPresets = presetKeys.map(slug);
  let matchesTheme = 0;
  for (const folder of folders) {
    if (!slugPresets.includes(slug(folder))) {
      err(`listings/${folder} · no matching preset key in config/settings_data.json presets (have: ${presetKeys.join(", ") || "none"})`);
    }
    if (folder.length >= 30) err(`listings/${folder} · preset name must be under 30 characters`);
    if (folder.split(/[-_\s]+/).filter(Boolean).length > 2) err(`listings/${folder} · preset name must be 1-2 words`);
    if (theme && slug(folder) === slug(theme)) matchesTheme++;
  }
  if (theme && folders.length > 0 && matchesTheme === 0) {
    err(`listings/ · no preset folder named after the theme ("${theme}") — one preset must take the parent theme's name`);
  }
}

// The default preset is what a merchant gets on install, so its listing must be a copy of the
// root templates/ + sections/ JSON and of settings_data `current` (Theme Store: "install state
// mirrors the demo store"). /sync-listing writes both places for it; this catches drift.
function checkDefaultPresetMirror(folders, data) {
  const theme = themeName();
  if (!theme) return;
  const folder = folders.find((f) => slug(f) === slug(theme));
  if (!folder) return;
  const rel = `listings/${folder}`;
  for (const sub of ["templates", "sections"]) {
    const subDir = path.join(LISTINGS, folder, sub);
    if (!fs.existsSync(subDir)) continue;
    for (const f of fs.readdirSync(subDir).filter((f) => f.endsWith(".json"))) {
      const rootFile = path.join(ROOT, sub, f);
      if (!fs.existsSync(rootFile)) {
        err(`${rel}/${sub}/${f} · default preset file has no root ${sub}/${f} — the default listing must mirror the install state`);
        continue;
      }
      let a, b;
      try {
        a = readJson(path.join(subDir, f));
        b = readJson(rootFile);
      } catch {
        continue; // parse errors are reported by the main walk
      }
      if (!deepEqual(a, b)) err(`${rel}/${sub}/${f} · differs from root ${sub}/${f} — re-run /sync-listing for the default preset (it writes both)`);
    }
  }
  const key = settingsDataPresets(data).find((k) => slug(k) === slug(folder));
  if (key && data.current && typeof data.current === "object" && !deepEqual(data.presets[key], data.current)) {
    err(`config/settings_data.json · presets["${key}"] differs from current — the default preset must equal the install settings`);
  }
}

function main() {
  const data = settingsData();
  // `current` + every preset ship in the zip whether or not a listings/ folder exists.
  if (data) {
    for (const { name, settings } of settingsTargets(data)) {
      for (const { key, types, value } of findResourceLeaks(settings, resourceSettingIds)) {
        err(`config/settings_data.json · ${name}."${key}" (${types.join("/")}) still holds store data: ${JSON.stringify(value).slice(0, 60)} — run \`yarn clean-data-json config/settings_data.json\``);
      }
    }
  }
  checkRootTemplates();
  if (!fs.existsSync(LISTINGS)) {
    const presets = settingsDataPresets(data);
    if (presets.length > 1) {
      warn(`no listings/ folder but config/settings_data.json defines ${presets.length} presets (${presets.join(", ")}) — multi-preset themes need per-preset listings`);
    }
    report(`no listings/ folder (single-preset theme) — root templates/ + settings_data checked`);
    return;
  }

  const folders = fs
    .readdirSync(LISTINGS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const presetKeys = settingsDataPresets(data);
  checkPresetNames(folders, presetKeys);
  checkColorSchemeParity(data);
  checkDefaultPresetMirror(folders, data);

  let files = 0;
  for (const folder of folders) {
    const dir = path.join(LISTINGS, folder);
    const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const sub of subs) {
      if (!["templates", "sections"].includes(sub)) warn(`listings/${folder}/${sub} · unexpected subfolder (Shopify reads only templates/ and sections/)`);
    }
    if (!subs.includes("templates")) err(`listings/${folder} · missing templates/ (each preset needs a unique set of templates)`);
    for (const sub of ["templates", "sections"]) {
      const subDir = path.join(dir, sub);
      if (!fs.existsSync(subDir)) continue;
      for (const nested of fs.readdirSync(subDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        err(`listings/${folder}/${sub}/${nested.name} · nested folder — customer-account templates are theme-owned, not preset content; /sync-listing skips them (files inside are not checked)`);
      }
      for (const f of fs.readdirSync(subDir).filter((f) => f.endsWith(".json"))) {
        const file = path.join(subDir, f);
        const raw = fs.readFileSync(file, "utf8");
        files++;
        let json;
        try {
          json = JSON.parse(raw);
        } catch (e) {
          err(`${path.relative(ROOT, file)} · invalid JSON: ${e.message}`);
          continue;
        }
        checkTypes(file, json);
        checkHeaderStaticBlocks(file, json);
        checkContent(file, raw);
        checkResourceLeaks(file, json);
        checkListCollections(file, json);
      }
    }
  }
  report(`${folders.length} preset(s), ${files} JSON file(s) checked`);
}

function report(scope) {
  for (const w of warnings) console.log(`  ⚠️  ${w}`);
  for (const e of errors) console.log(`  ❌ ${e}`);
  const failed = errors.length > 0 || (STRICT && warnings.length > 0);
  console.log(
    `check-listings: ${scope} — ${errors.length} error(s), ${warnings.length} warning(s)${failed ? "" : " ✓"}`
  );
  process.exit(failed ? 1 : 0);
}

main();
