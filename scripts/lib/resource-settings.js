/**
 * Store-resource (and credential) setting ids, resolved from the SCHEMAS — not from a hand-kept
 * name list.
 *
 * clean-data-json strips demo-store data (product/collection handles, menus…) so a zip installs
 * clean, and check-listings fails CI when any survives. Both used to recognise those values by
 * the setting's NAME (`collection`, `product_list`, …), so any resource setting with a
 * descriptive id leaked straight through: `search_recommendation_products` (product_list),
 * `cart_empty_recommendation_collection` (collection_list), `menu_mobile` (link_list),
 * `size_chart_page` (page) all shipped real handles. The schema knows the TYPE of every id —
 * this module walks config/settings_schema.json plus every `{% schema %}` in sections/ and
 * blocks/ once, and hands back the set of ids whose type points at store data.
 *
 * An id is matched wherever it appears; if ANY schema declares it resource-typed, its value is
 * treated as store data everywhere. Conservative on purpose — demo values for such an id are
 * exactly what must not ship, and ids are near-unique across schemas in practice.
 *
 * Dependency-free on purpose — check-listings imports this and runs in CI without yarn install.
 */
const fs = require("fs");
const path = require("path");

// Setting types whose VALUE names a store resource (a handle or id a fresh store cannot have).
// Not here: image_picker/video (shopify:// URLs, caught by the string rule), url (relative
// paths like /collections/all are theme-meaningful), font_picker, text.
const RESOURCE_SETTING_TYPES = new Set([
  "article",
  "blog",
  "collection",
  "collection_list",
  "link_list",
  "metaobject",
  "metaobject_list",
  "page",
  "product",
  "product_list",
]);

// Setting ids that hold a CREDENTIAL (a Google Maps browser key, an app token…). The schema types
// them `text`, so the type rule above cannot see them — the id is the only signal. A demo's key
// shipping in the zip bills the demo's quota to every merchant who installs and is a leaked
// secret in Google's eyes; `maps.api_key` sailed through clean-data-json for exactly this reason.
const CREDENTIAL_ID_PATTERN = /(^|_)(api_?key|secret|token|access_key|client_id|site_key|password)(_|$)/i;

// Value-shaped safety net for the same leak under an id the pattern misses: a Google API key is
// `AIza` + 35 URL-safe characters, wherever it lands.
const CREDENTIAL_VALUE_PATTERN = /\bAIza[0-9A-Za-z_-]{35}\b/;

function collect(settings, ids) {
  for (const setting of settings ?? []) {
    if (!setting?.id) continue;
    if (RESOURCE_SETTING_TYPES.has(setting.type)) {
      if (!ids.has(setting.id)) ids.set(setting.id, new Set());
      ids.get(setting.id).add(setting.type);
    }
    if (CREDENTIAL_ID_PATTERN.test(setting.id)) {
      if (!ids.has(setting.id)) ids.set(setting.id, new Set());
      ids.get(setting.id).add("credential");
    }
  }
}

/**
 * @param {string} root - repo root
 * @returns {Map<string, Set<string>>} setting id → the resource types schemas declare for it
 */
function buildResourceSettingIds(root) {
  const ids = new Map();

  const settingsSchema = path.join(root, "config", "settings_schema.json");
  if (fs.existsSync(settingsSchema)) {
    // The theme editor writes a leading /* … */ banner strict JSON.parse rejects.
    const raw = fs.readFileSync(settingsSchema, "utf8").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
    for (const group of JSON.parse(raw)) collect(group.settings, ids);
  }

  for (const dir of ["sections", "blocks"]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of fs.readdirSync(abs)) {
      if (!file.endsWith(".liquid")) continue;
      const source = fs.readFileSync(path.join(abs, file), "utf8");
      const match = source.match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
      if (!match) continue;
      let schema;
      try {
        schema = JSON.parse(match[1]);
      } catch {
        continue; // invalid schema JSON is theme-check's finding, not ours
      }
      collect(schema.settings, ids);
      for (const block of schema.blocks ?? []) collect(block.settings, ids);
    }
  }

  return ids;
}

const EMPTY = new Set(["", null, undefined]);

/**
 * Walk parsed JSON for keys that are resource-typed setting ids still carrying a value.
 * @returns {{ key: string, types: string[], value: unknown }[]}
 */
function findResourceLeaks(node, ids, leaks = []) {
  if (Array.isArray(node)) {
    for (const item of node) findResourceLeaks(item, ids, leaks);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (ids.has(key) && !EMPTY.has(value) && !(Array.isArray(value) && value.length === 0)) {
        leaks.push({ key, types: [...ids.get(key)], value });
      }
      findResourceLeaks(value, ids, leaks);
    }
  }
  return leaks;
}

// Every shopify:// value is something the demo builder picked in the editor — a product, a
// collection, an image, or one of the store-wide routes the link picker writes for "All
// collections" / "All products" (`shopify://collections`, `shopify://products`,
// `shopify://collections/all`). All of it is removed: the shipped JSON carries no picked link at
// all, and the merchant chooses their own targets after install. A path the demo builder TYPED
// (`/collections`) is a deliberate value and stays.
/** One setting value: is it a shopify:// URL (a picked resource or route — demo data)? */
function isStoreSpecificShopifyUrl(value) {
  return typeof value === "string" && value.includes("shopify://");
}

module.exports = {
  RESOURCE_SETTING_TYPES,
  CREDENTIAL_ID_PATTERN,
  CREDENTIAL_VALUE_PATTERN,
  buildResourceSettingIds,
  findResourceLeaks,
  isStoreSpecificShopifyUrl,
};
