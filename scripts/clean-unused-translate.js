/**
 * Remove unused translation keys from all locale files.
 *
 * Reuses the same detection logic as check-unused-translate.js.
 * Removes confirmed-unused keys from both storefront and schema locale files
 * across all languages (en, de, es, fr, it).
 *
 * Usage:
 *   node scripts/clean-unused-translate.js          # dry run (preview only)
 *   node scripts/clean-unused-translate.js --write  # write changes to disk
 */

const fs = require("fs");
const path = require("path");
const glob = require("glob");

const ROOT = process.cwd();
const DRY_RUN = !process.argv.includes("--write");

const RE_T_REF = /["']t:([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)["']/gi;
const RE_LIQUID_T_QUOTED = /\{\{-?\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t\b/g;
const RE_LIQUID_TRANSLATE = /\{\{-?\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*translate\b/g;
const RE_LIQUID_T_PLURAL = /\{\{-?\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t:/g;
const RE_LIQUID_ASSIGN_T = /assign\s+\w+\s*=\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t\b/g;
// Detects two-step pattern: assign translation_key = 'content.foo' (used later as {{ translation_key | t }})
const RE_LIQUID_ASSIGN_KEY = /assign\s+\w+\s*=\s*['"]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"]/g;
const RE_LIQUID_TAG_PARAM_KEY = /\w+\s*:\s*['"]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"]/gi;

function flattenObject(obj, prefix = "") {
  return Object.keys(obj).reduce((acc, k) => {
    const pre = prefix.length ? prefix + "." : "";
    if (typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k])) {
      Object.assign(acc, flattenObject(obj[k], pre + k));
    } else {
      acc[pre + k] = obj[k];
    }
    return acc;
  }, {});
}

function collectUsedKeysFromContent(content, used, isLiquid = false) {
  let m;
  RE_T_REF.lastIndex = 0;
  while ((m = RE_T_REF.exec(content)) !== null) used.add(m[1]);

  for (const re of [RE_LIQUID_T_QUOTED, RE_LIQUID_TRANSLATE, RE_LIQUID_T_PLURAL, RE_LIQUID_ASSIGN_T, RE_LIQUID_ASSIGN_KEY]) {
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) if (m[1]) used.add(m[1]);
  }

  if (isLiquid) {
    RE_LIQUID_TAG_PARAM_KEY.lastIndex = 0;
    while ((m = RE_LIQUID_TAG_PARAM_KEY.exec(content)) !== null) used.add(m[1]);
  }
}

function gatherUsedKeys() {
  const searchPaths = ["sections", "snippets", "templates", "layout", "blocks", "config", "src", "assets"];
  const files = new Set();
  for (const sp of searchPaths) {
    const abs = path.join(ROOT, sp);
    if (!fs.existsSync(abs)) continue;
    glob.sync("**/*.{liquid,js,json}", { cwd: abs, ignore: ["**/node_modules/**"], nodir: true })
      .forEach((f) => files.add(path.join(abs, f)));
  }

  const used = new Set();
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    collectUsedKeysFromContent(content, used, file.endsWith(".liquid"));
  }

  // Plural heuristic: if base key used, mark .one/.other as used
  const allUsed = new Set(used);
  for (const key of used) {
    allUsed.add(key + ".one");
    allUsed.add(key + ".other");
  }
  return allUsed;
}

function deleteKeyPath(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur[parts[i]] !== "object") return false;
    cur = cur[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  if (!(leaf in cur)) return false;
  delete cur[leaf];
  // Clean up empty parent objects
  pruneEmpty(obj, parts.slice(0, -1));
  return true;
}

function pruneEmpty(obj, pathParts) {
  if (pathParts.length === 0) return;
  let cur = obj;
  const parents = [obj];
  for (const part of pathParts) {
    cur = cur[part];
    parents.push(cur);
  }
  for (let i = pathParts.length - 1; i >= 0; i--) {
    if (Object.keys(parents[i + 1]).length === 0) {
      delete parents[i][pathParts[i]];
    } else {
      break;
    }
  }
}

function getCanonicalKeys(localeFile) {
  const raw = fs.readFileSync(localeFile, "utf8");
  const parsed = JSON.parse(raw);
  return Object.keys(flattenObject(parsed));
}

function processLocaleFile(filePath, unusedKeys, label) {
  if (!fs.existsSync(filePath)) return 0;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const flat = flattenObject(parsed);

  let removed = 0;
  for (const key of unusedKeys) {
    if (key in flat) {
      deleteKeyPath(parsed, key);
      removed++;
    }
  }

  if (removed > 0) {
    if (DRY_RUN) {
      console.log(`  [dry-run] ${label}: would remove ${removed} key(s)`);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
      console.log(`  ✅ ${label}: removed ${removed} key(s)`);
    }
  } else {
    console.log(`  ✓ ${label}: nothing to remove`);
  }
  return removed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const localesDir = path.join(ROOT, "locales");
const enStorefront = path.join(localesDir, "en.default.json");
const enSchema = path.join(localesDir, "en.default.schema.json");

console.log("Gathering used keys from theme files…");
const usedKeys = gatherUsedKeys();

const storefrontKeys = new Set(getCanonicalKeys(enStorefront));
const schemaKeys = new Set(getCanonicalKeys(enSchema));

const unusedStorefront = [...storefrontKeys].filter((k) => !usedKeys.has(k));
const unusedSchema = [...schemaKeys].filter((k) => !usedKeys.has(k));

console.log(`\nUnused storefront keys: ${unusedStorefront.length}`);
console.log(`Unused schema keys:     ${unusedSchema.length}`);
console.log(`Total:                  ${unusedStorefront.length + unusedSchema.length}`);

if (unusedStorefront.length + unusedSchema.length === 0) {
  console.log("\n✅ No unused keys found.");
  process.exit(0);
}

if (DRY_RUN) {
  console.log("\n⚠️  Dry run — pass --write to apply changes.\n");
} else {
  console.log("\nApplying changes…\n");
}

const storefrontFiles = ["en.default.json", "de.json", "es.json", "fr.json", "it.json"];
const schemaFiles = ["en.default.schema.json", "de.schema.json", "es.schema.json", "fr.schema.json", "it.schema.json"];

console.log("── Storefront locale files ──────────────────────────────────────");
for (const f of storefrontFiles) {
  processLocaleFile(path.join(localesDir, f), unusedStorefront, f);
}

console.log("\n── Schema locale files ──────────────────────────────────────────");
for (const f of schemaFiles) {
  processLocaleFile(path.join(localesDir, f), unusedSchema, f);
}

if (DRY_RUN) {
  console.log("\nRun with --write to apply changes.");
}
