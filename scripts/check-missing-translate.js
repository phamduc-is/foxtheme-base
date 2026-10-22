/**
 * Theme translation / schema i18n checks
 *
 * 1) Hardcoded user-facing strings in {% schema %} (must use t:* keys)
 * 2) Every t:* reference resolves to a path in locales/en.default.schema.json
 * 3) Valid JSON inside {% schema %} blocks (parse errors are reported)
 * 4) Keys in en.default.schema.json missing from other *.schema.json locale files
 * 5) Keys in en.default.json missing from other storefront *.json locale files
 *
 * Scanned: sections/*.liquid, blocks/*.liquid, config/settings_schema.json, templates/*.json
 *
 * Exit 1 if any issue; exit 0 if clean.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
/** t:group.key… — segments after the first may start with a digit (e.g. t:names.404, t:options.1_line) */
const T_REF_RE = /^t:[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i;

/** @type {object | null} */
let enSchema = null;

function loadEnDefaultSchema() {
  const p = path.join(ROOT, "locales", "en.default.schema.json");
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function findLineNumber(fileContent, searchValue) {
  const lines = fileContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchValue)) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * @param {object} localeSchema - parsed en.default.schema.json
 * @param {string} tRef - e.g. t:names.countdown_timer
 * @returns {boolean} true if path exists and resolves to a non-null leaf (string expected)
 */
function schemaKeyExists(localeSchema, tRef) {
  if (!tRef || typeof tRef !== "string" || !tRef.startsWith("t:")) {
    return true;
  }
  const pathStr = tRef.slice(2);
  const parts = pathStr.split(".");
  let cur = localeSchema;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") {
      return false;
    }
    cur = cur[part];
  }
  return cur !== undefined;
}

/**
 * Recursively flatten an object to dot-separated keys.
 * @param {object} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

/**
 * Check that all keys in en.default.schema.json exist in every other *.schema.json.
 * @returns {Map<string, string[]>} locale file → missing keys
 */
function checkOtherLocaleSchemas() {
  const localesDir = path.join(ROOT, "locales");
  const enKeys = new Set(flattenKeys(enSchema));

  const missing = new Map();
  const otherFiles = fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith(".schema.json") && f !== "en.default.schema.json")
    .sort();

  for (const file of otherFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"));
    const localeKeys = new Set(flattenKeys(data));
    const missingKeys = [...enKeys].filter((k) => !localeKeys.has(k)).sort();
    if (missingKeys.length > 0) {
      missing.set(file, missingKeys);
    }
  }
  return missing;
}

/**
 * Check that all keys in en.default.json exist in every other storefront *.json locale.
 * @returns {Map<string, string[]>} locale file → missing keys
 */
function checkOtherStorefrontLocales() {
  const localesDir = path.join(ROOT, "locales");
  const enPath = path.join(localesDir, "en.default.json");
  if (!fs.existsSync(enPath)) return new Map();

  const enData = JSON.parse(fs.readFileSync(enPath, "utf8"));
  const enKeys = new Set(flattenKeys(enData));

  const missing = new Map();
  const otherFiles = fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".schema.json") && f !== "en.default.json")
    .sort();

  for (const file of otherFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"));
    const localeKeys = new Set(flattenKeys(data));
    const missingKeys = [...enKeys].filter((k) => !localeKeys.has(k)).sort();
    if (missingKeys.length > 0) {
      missing.set(file, missingKeys);
    }
  }
  return missing;
}

/**
 * Recursively collect string values starting with t:
 * @param {unknown} value
 * @param {Set<string>} out
 */
function collectTRefs(value, out) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith("t:")) {
      out.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectTRefs(item, out));
    return;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((v) => collectTRefs(v, out));
  }
}

/**
 * @param {Set<string>} refs
 * @param {string} sourceLabel
 * @param {Map<string, string[]>} missingMap
 */
function recordMissingTKeys(refs, sourceLabel, missingMap) {
  for (const ref of refs) {
    if (!T_REF_RE.test(ref)) {
      if (!missingMap.has(ref)) {
        missingMap.set(ref, []);
      }
      missingMap.get(ref).push(`${sourceLabel} (invalid t: format)`);
      continue;
    }
    if (!schemaKeyExists(enSchema, ref)) {
      if (!missingMap.has(ref)) {
        missingMap.set(ref, []);
      }
      missingMap.get(ref).push(sourceLabel);
    }
  }
}

function checkLiquidFiles(dir, dirLabel, resultKey, missingTranslations, schemaParseErrors, missingTKeys) {
  const absDir = path.join(ROOT, dir);
  if (!fs.existsSync(absDir)) {
    return;
  }
  const files = fs.readdirSync(absDir).filter((file) => file.endsWith(".liquid"));

  files.forEach((file) => {
    const filePath = path.join(absDir, file);
    const relPath = path.join(dir, file);
    const fileContent = fs.readFileSync(filePath, "utf8");
    const schemeMatch = fileContent.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);

    if (!schemeMatch) {
      return;
    }

    try {
      const schemeData = JSON.parse(schemeMatch[1]);
      const missing = findMissingHardcodedStrings(schemeData, filePath, fileContent);
      if (missing.length > 0) {
        missingTranslations[resultKey][file] = missing;
      }
      const refs = new Set();
      collectTRefs(schemeData, refs);
      recordMissingTKeys(refs, relPath, missingTKeys);
    } catch (error) {
      schemaParseErrors.push({
        file: relPath,
        message: error.message,
      });
    }
  });
}

function checkSettingsSchema(missingTranslations, missingTKeys) {
  const settingsPath = path.join(ROOT, "config", "settings_schema.json");
  const settingsContent = fs.readFileSync(settingsPath, "utf8");
  const settingsData = JSON.parse(settingsContent);

  settingsData.forEach((section) => {
    if (section?.name === "theme_info") {
      return;
    }

    const missing = findMissingHardcodedStrings(section, settingsPath, settingsContent);
    if (missing.length > 0) {
      missingTranslations.settings[section.name || "Unnamed section"] = missing;
    }
    const refs = new Set();
    collectTRefs(section, refs);
    recordMissingTKeys(refs, `config/settings_schema.json (${section.name || "section"})`, missingTKeys);
  });
}

function checkTemplateJsonFiles(schemaParseErrors, missingTKeys) {
  const templatesDir = path.join(ROOT, "templates");
  if (!fs.existsSync(templatesDir)) {
    return;
  }
  const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const relPath = path.join("templates", file);
    const filePath = path.join(templatesDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const refs = new Set();
      collectTRefs(data, refs);
      recordMissingTKeys(refs, relPath, missingTKeys);
    } catch (error) {
      schemaParseErrors.push({
        file: relPath,
        message: error.message,
      });
    }
  }
}

function checkMissingTranslations() {
  enSchema = loadEnDefaultSchema();

  const missingTranslations = {
    sections: {},
    blocks: {},
    settings: {},
  };
  /** @type {{ file: string, message: string }[]} */
  const schemaParseErrors = [];
  /** @type {Map<string, string[]>} */
  const missingTKeys = new Map();

  checkLiquidFiles("sections", "sections", "sections", missingTranslations, schemaParseErrors, missingTKeys);
  checkLiquidFiles("blocks", "blocks", "blocks", missingTranslations, schemaParseErrors, missingTKeys);

  try {
    checkSettingsSchema(missingTranslations, missingTKeys);
  } catch (error) {
    schemaParseErrors.push({
      file: "config/settings_schema.json",
      message: error.message,
    });
  }

  checkTemplateJsonFiles(schemaParseErrors, missingTKeys);

  const missingSchemaLocales = checkOtherLocaleSchemas();
  const missingStorefrontLocales = checkOtherStorefrontLocales();

  printReport(missingTranslations, schemaParseErrors, missingTKeys, missingSchemaLocales, missingStorefrontLocales);

  const hasHardcoded =
    Object.keys(missingTranslations.sections).length > 0 ||
    Object.keys(missingTranslations.blocks).length > 0 ||
    Object.keys(missingTranslations.settings).length > 0;
  const hasParseErrors = schemaParseErrors.length > 0;
  const hasMissingTKeys = missingTKeys.size > 0;
  const hasMissingLocales = missingSchemaLocales.size > 0 || missingStorefrontLocales.size > 0;

  if (hasHardcoded || hasParseErrors || hasMissingTKeys || hasMissingLocales) {
    process.exit(1);
  }
  process.exit(0);
}

function findMissingHardcodedStrings(data, filePath, fileContent) {
  const missing = [];

  function addMissing(type, value, settingType = null, propertyPath = "") {
    const lineNumber = findLineNumber(fileContent, value);
    missing.push({
      type,
      value,
      settingType,
      file: filePath,
      line: lineNumber,
      link: `${filePath}:${lineNumber}`,
      path: propertyPath,
    });
  }

  if (data.name && !data.name.startsWith("t:")) {
    addMissing("name", data.name, null, "name");
  }
  if (data.content && !data.content.startsWith("t:")) {
    addMissing("content", data.content, null, "content");
  }

  if (data.settings && Array.isArray(data.settings)) {
    data.settings.forEach((setting, index) => {
      const basePath = `settings[${index}]`;

      if (setting.name && !setting.name.startsWith("t:")) {
        addMissing("name", setting.name, setting.type, `${basePath}.name`);
      }
      if (setting.label && !setting.label.startsWith("t:")) {
        addMissing("label", setting.label, setting.type, `${basePath}.label`);
      }
      if (setting.content && !setting.content.startsWith("t:")) {
        addMissing("content", setting.content, setting.type, `${basePath}.content`);
      }
      if (setting.info && !setting.info.startsWith("t:")) {
        addMissing("info", setting.info, setting.type, `${basePath}.info`);
      }

      if (setting.options && Array.isArray(setting.options)) {
        setting.options.forEach((option, optIndex) => {
          if (option.label && !option.label.startsWith("t:")) {
            addMissing(
              "option",
              option.label,
              setting.type,
              `${basePath}.options[${optIndex}].label`
            );
          }
        });
      }
    });
  }

  if (data.blocks && Array.isArray(data.blocks)) {
    data.blocks.forEach((block, blockIndex) => {
      const blockPath = `blocks[${blockIndex}]`;

      if (block.name && !block.name.startsWith("t:")) {
        addMissing("block_name", block.name, block.type, `${blockPath}.name`);
      }

      if (block.settings && Array.isArray(block.settings)) {
        block.settings.forEach((setting, settingIndex) => {
          const settingPath = `${blockPath}.settings[${settingIndex}]`;

          if (setting.name && !setting.name.startsWith("t:")) {
            addMissing("block_setting_name", setting.name, setting.type, `${settingPath}.name`);
          }
          if (setting.label && !setting.label.startsWith("t:")) {
            addMissing("block_setting_label", setting.label, setting.type, `${settingPath}.label`);
          }
          if (setting.info && !setting.info.startsWith("t:")) {
            addMissing("block_setting_info", setting.info, setting.type, `${settingPath}.info`);
          }

          if (setting.options && Array.isArray(setting.options)) {
            setting.options.forEach((option, optIndex) => {
              if (option.label && !option.label.startsWith("t:")) {
                addMissing(
                  "block_option",
                  option.label,
                  setting.type,
                  `${settingPath}.options[${optIndex}].label`
                );
              }
            });
          }
        });
      }
    });
  }

  if (data.presets && Array.isArray(data.presets)) {
    data.presets.forEach((preset, index) => {
      if (preset.name && !preset.name.startsWith("t:")) {
        addMissing("preset", preset.name, null, `presets[${index}].name`);
      }
    });
  }

  return missing;
}

function printReport(results, schemaParseErrors, missingTKeys, missingSchemaLocales, missingStorefrontLocales) {
  if (schemaParseErrors.length > 0) {
    console.log("\n📛 Schema JSON parse errors (fix these first — blocks other checks for that file)\n");
    schemaParseErrors.forEach(({ file, message }) => {
      console.log(`  ❌ ${file}`);
      console.log(`     ${message}`);
    });
  }

  if (missingTKeys.size > 0) {

    console.log("\n🔑 Missing keys in locales/en.default.schema.json\n");
    const sorted = [...missingTKeys.keys()].sort();
    for (const key of sorted) {
      const sources = missingTKeys.get(key);
      console.log(`  ❌ ${key}`);
      const unique = [...new Set(sources)];
      unique.slice(0, 8).forEach((src) => console.log(`     → ${src}`));
      if (unique.length > 8) {
        console.log(`     → … and ${unique.length - 8} more`);
      }
    }
  }

  const totalSections = Object.keys(results.sections).length;
  const totalBlocks = Object.keys(results.blocks).length;
  const totalSettings = Object.keys(results.settings).length;

  if (totalSections > 0 || totalBlocks > 0 || totalSettings > 0) {

    console.log("\n📝 Hardcoded strings (should use t:* keys)\n");

    if (totalSections > 0) {
      console.log("📁 Section files:");
      for (const [file, missing] of Object.entries(results.sections)) {
        console.log(`\n${file}:`);
        missing.forEach((item) => {
          console.log(
            `  ❌ ${item.type}: "${item.value}"${item.settingType ? ` (${item.settingType})` : ""}`
          );
          console.log(`     📍 ${item.link}`);
          console.log(`     🔍 Path: ${item.path}`);
        });
      }
    }

    if (totalBlocks > 0) {
      console.log("\n🧩 Block files:");
      for (const [file, missing] of Object.entries(results.blocks)) {
        console.log(`\n${file}:`);
        missing.forEach((item) => {
          console.log(
            `  ❌ ${item.type}: "${item.value}"${item.settingType ? ` (${item.settingType})` : ""}`
          );
          console.log(`     📍 ${item.link}`);
          console.log(`     🔍 Path: ${item.path}`);
        });
      }
    }

    if (totalSettings > 0) {
      console.log("\n⚙️  Settings schema:");
      for (const [section, missing] of Object.entries(results.settings)) {
        console.log(`\n${section}:`);
        missing.forEach((item) => {
          console.log(
            `  ❌ ${item.type}: "${item.value}"${item.settingType ? ` (${item.settingType})` : ""}`
          );
          console.log(`     📍 ${item.link}`);
          console.log(`     🔍 Path: ${item.path}`);
        });
      }
    }
  }

  if (missingSchemaLocales.size > 0) {

    console.log("\n🌐 Keys missing from schema locale files (present in en.default.schema.json)\n");
    for (const [file, keys] of missingSchemaLocales) {
      console.log(`  locales/${file} (${keys.length} missing):`);
      keys.forEach((k) => console.log(`    ❌ ${k}`));
    }
  }

  if (missingStorefrontLocales.size > 0) {

    console.log("\n🌐 Keys missing from storefront locale files (present in en.default.json)\n");
    for (const [file, keys] of missingStorefrontLocales) {
      console.log(`  locales/${file} (${keys.length} missing):`);
      keys.forEach((k) => console.log(`    ❌ ${k}`));
    }
  }

  const totalMissingLocaleKeys = [...missingSchemaLocales.values(), ...missingStorefrontLocales.values()]
    .reduce((sum, arr) => sum + arr.length, 0);

  console.log("\n📈 Summary:");
  console.log(`  Schema parse errors: ${schemaParseErrors.length}`);
  console.log(`  Missing t: keys in en.default.schema.json: ${missingTKeys.size}`);
  console.log(`  Files with hardcoded schema strings — sections: ${totalSections}, blocks: ${totalBlocks}, settings: ${totalSettings}`);
  console.log(`  Missing keys in other locale files: ${totalMissingLocaleKeys}`);

  if (
    schemaParseErrors.length === 0 &&
    missingTKeys.size === 0 &&
    totalSections === 0 &&
    totalBlocks === 0 &&
    totalSettings === 0 &&
    missingSchemaLocales.size === 0 &&
    missingStorefrontLocales.size === 0
  ) {
    console.log("  All checks passed.");
  }
}

checkMissingTranslations();
