/**
 * Find locale keys in en.default.json + en.default.schema.json that appear unused
 * in theme source (Liquid, JSON templates, config, optional src/).
 *
 * Strategy: scan each file once and collect used keys (O(files)), not O(keys × files).
 *
 * Usage:
 *   node scripts/check-unused-translate.js           # report only, exit 0
 *   node scripts/check-unused-translate.js --fail    # exit 1 if any unused
 */
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const ROOT = process.cwd();
const FAIL = process.argv.includes("--fail");

/** Same segment rules as check-missing-translate.js (e.g. names.404, options.1_line) */
const RE_T_REF = /["']t:([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)["']/gi;

/** {{ 'key' | t }} — same line; multiline liquid not covered */
const RE_LIQUID_T_QUOTED = /\{\{-?\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t\b/g;

const RE_LIQUID_TRANSLATE = /\{\{-?\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*translate\b/g;

/** Plural / count: {{ 'base' | t: count: n }} */
const RE_LIQUID_T_PLURAL = /\{\{-?\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t:/g;

/** {% liquid %} assign foo = 'key' | t */
const RE_LIQUID_ASSIGN_T = /assign\s+\w+\s*=\s*['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t\b/g;

/**
 * {% liquid %} echo 'key' | t — the output form of the above, and the idiomatic
 * way to emit a translated string inside a `capture`. Without this, a key used
 * ONLY via `echo` is reported unused, and the natural "fix" is to reshape
 * working Liquid to satisfy this scanner. `\b` after `t` also covers `| t: …`.
 */
const RE_LIQUID_ECHO_T = /echo\s+['"]([a-zA-Z0-9_.]+)['"]\s*\|\s*t\b/g;

/**
 * Translation key passed as a Liquid tag argument (later used as {{ param | t }} in snippet).
 * Example: {% render 'skip-to-content-link', text: 'accessibility.skip_to_text' %}
 * Liquid-only: avoids matching JSON "version": "1.2.0" in config. Requires ≥1 dot (namespace.key).
 */
const RE_LIQUID_TAG_PARAM_KEY =
  /\w+\s*:\s*['"]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"]/gi;

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

/**
 * Canonical keys: English storefront + schema only (avoid 6× duplicate keys from every locale).
 */
function loadCanonicalKeys(localesPath) {
  const keys = new Set();
  const names = ["en.default.json", "en.default.schema.json"];
  for (const name of names) {
    const p = path.join(localesPath, name);
    if (!fs.existsSync(p)) {
      console.warn(`Warning: missing ${p}`);
      continue;
    }
    const raw = fs.readFileSync(p, "utf8");
    try {
      const parsed = JSON.parse(raw);
      Object.keys(flattenObject(parsed)).forEach((k) => keys.add(k));
    } catch (e) {
      console.error(`Error parsing locales/${name}:`, e.message);
      process.exit(1);
    }
  }
  return keys;
}

function collectUsedKeysFromContent(content, used, options = {}) {
  const { isLiquid = false } = options;
  let m;

  RE_T_REF.lastIndex = 0;
  while ((m = RE_T_REF.exec(content)) !== null) {
    used.add(m[1]);
  }

  for (const re of [
    RE_LIQUID_T_QUOTED,
    RE_LIQUID_TRANSLATE,
    RE_LIQUID_T_PLURAL,
    RE_LIQUID_ASSIGN_T,
    RE_LIQUID_ECHO_T,
  ]) {
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) {
        used.add(m[1]);
      }
    }
  }

  if (isLiquid) {
    RE_LIQUID_TAG_PARAM_KEY.lastIndex = 0;
    while ((m = RE_LIQUID_TAG_PARAM_KEY.exec(content)) !== null) {
      used.add(m[1]);
    }
  }
}

function isPluralKey(key) {
  return key.endsWith(".one") || key.endsWith(".other");
}

function getBasePluralKey(key) {
  return key.replace(/\.(one|other)$/, "");
}

/**
 * Mark plural siblings as used when base key (without .one/.other) appears in sources.
 */
function applyPluralHeuristic(allKeys, usedRaw) {
  const used = new Set(usedRaw);
  for (const key of allKeys) {
    if (!isPluralKey(key)) {
      continue;
    }
    const base = getBasePluralKey(key);
    if (used.has(base)) {
      used.add(key);
    }
  }
  return used;
}

function gatherSourceFiles(searchPaths) {
  const ignorePatterns = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.cache/**",
  ];
  const files = new Set();
  for (const searchPath of searchPaths) {
    const absDir = path.join(ROOT, searchPath);
    if (!fs.existsSync(absDir)) {
      continue;
    }
    const found = glob.sync("**/*.{liquid,js,json}", {
      cwd: absDir,
      ignore: ignorePatterns,
      nodir: true,
    });
    found.forEach((f) => files.add(path.join(absDir, f)));
  }
  return [...files];
}

function findKeyLineInFile(filePath, leafKey) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const quoted = `"${leafKey}"`;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(quoted)) {
        return i + 1;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function suggestLocaleFile(key) {
  const first = key.split(".")[0];
  if (["names", "settings", "options", "content", "categories", "info"].includes(first)) {
    return "locales/en.default.schema.json";
  }
  return "locales/en.default.json";
}

function main() {
  console.log("Analyzing unused translation keys (canonical: en.default.json + en.default.schema.json)…\n");

  const localesPath = path.join(ROOT, "locales");
  const allKeysSet = loadCanonicalKeys(localesPath);
  const allKeys = [...allKeysSet].sort();

  const searchPaths = [
    "sections",
    "snippets",
    "templates",
    "layout",
    "blocks",
    "config",
    "src",
    "assets",
  ];

  console.log("Scanning theme files (single pass per file)…");
  const files = gatherSourceFiles(searchPaths);
  console.log(`  ${files.length} files\n`);

  const usedRaw = new Set();
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf8");
      collectUsedKeysFromContent(content, usedRaw, {
        isLiquid: file.endsWith(".liquid"),
      });
    } catch (e) {
      console.error(`Error reading ${path.relative(ROOT, file)}:`, e.message);
    }
  }

  const used = applyPluralHeuristic(allKeys, usedRaw);

  const unusedKeys = allKeys.filter((key) => !used.has(key));

  console.log("=== SUMMARY ===");
  console.log(`Canonical keys (en): ${allKeys.length}`);
  console.log(`Distinct used keys matched in theme: ${used.size}`);
  console.log(`Unused keys: ${unusedKeys.length}`);
  console.log("===============\n");

  if (unusedKeys.length > 0) {
    console.log("Unused translation keys (heuristic — dynamic keys may be false positives):\n");
    for (const key of unusedKeys) {
      const localeFile = suggestLocaleFile(key);
      const abs = path.join(ROOT, localeFile);
      const leaf = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
      const line = findKeyLineInFile(abs, leaf);
      const rel = path.relative(ROOT, abs);
      if (line) {
        console.log(`- ${key}`);
        console.log(`  📄 ${rel}:${line}`);
      } else {
        console.log(`- ${key}`);
        console.log(`  📄 ${rel} (search key path)`);
      }
    }
    console.log("");
  }

  if (FAIL && unusedKeys.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
