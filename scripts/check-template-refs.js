/**
 * Detect stale references in JSON templates / section groups:
 * - Section `type` must match `sections/{type}.liquid`
 * - Block `type` must be either `blocks/{type}.liquid` (theme block) OR declared
 *   in the parent section's `{% schema %}` `blocks` array (section block)
 *
 * Usage:
 *   node scripts/check-template-refs.js
 *   node scripts/check-template-refs.js --fail   # exit 1 if any issue
 */
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const ROOT = path.resolve(__dirname, "..");
const FAIL = process.argv.includes("--fail");

/** @type {Map<string, Set<string>>} sectionHandle -> block types from schema (excl. @theme / @app) */
function buildSectionSchemaBlockTypes() {
  const map = new Map();
  const liquidFiles = glob.sync("sections/*.liquid", { cwd: ROOT, absolute: true });
  for (const file of liquidFiles) {
    const handle = path.basename(file, ".liquid");
    const raw = fs.readFileSync(file, "utf8");
    const m = raw.match(/\{%\s*schema\s*%}([\s\S]*?)\{%\s*endschema\s*%}/);
    if (!m) {
      continue;
    }
    try {
      const schema = JSON.parse(m[1]);
      const set = new Set();
      if (Array.isArray(schema.blocks)) {
        for (const b of schema.blocks) {
          if (b && typeof b.type === "string" && b.type !== "@theme" && b.type !== "@app") {
            set.add(b.type);
          }
        }
      }
      map.set(handle, set);
    } catch {
      console.warn(`Warning: invalid schema JSON in sections/${handle}.liquid (skipping block types)`);
    }
  }
  return map;
}

function themeBlockExists(type) {
  return fs.existsSync(path.join(ROOT, "blocks", `${type}.liquid`));
}

function sectionExists(type) {
  return fs.existsSync(path.join(ROOT, "sections", `${type}.liquid`));
}

/**
 * @param {string} blockType
 * @param {string} parentSectionType
 * @param {Map<string, Set<string>>} schemaBlockTypes
 */
function isValidBlockType(blockType, parentSectionType, schemaBlockTypes) {
  if (!blockType || blockType.startsWith("@")) {
    return true;
  }
  /* App blocks / deep links */
  if (blockType.includes("://")) {
    return true;
  }
  if (themeBlockExists(blockType)) {
    return true;
  }
  const fromSchema = schemaBlockTypes.get(parentSectionType);
  if (fromSchema && fromSchema.has(blockType)) {
    return true;
  }
  return false;
}

/**
 * @param {object} block
 * @param {string} parentSectionType
 * @param {string} sourceFile
 * @param {string} jsonPath
 * @param {Map<string, Set<string>>} schemaBlockTypes
 * @param {Array} issues
 */
function walkBlocksTree(block, parentSectionType, sourceFile, jsonPath, schemaBlockTypes, issues) {
  if (!block || typeof block !== "object") {
    return;
  }
  const btype = block.type;
  if (typeof btype === "string" && !isValidBlockType(btype, parentSectionType, schemaBlockTypes)) {
    issues.push({
      file: sourceFile,
      path: jsonPath,
      kind: "block",
      type: btype,
      parentSection: parentSectionType,
      hint: `no blocks/${btype}.liquid and not declared in sections/${parentSectionType}.liquid schema blocks[]`,
    });
  }
  if (block.blocks && typeof block.blocks === "object" && !Array.isArray(block.blocks)) {
    for (const [bid, child] of Object.entries(block.blocks)) {
      walkBlocksTree(child, parentSectionType, sourceFile, `${jsonPath}.blocks.${bid}`, schemaBlockTypes, issues);
    }
  }
}

/**
 * @param {object} section
 * @param {string} sourceFile
 * @param {string} jsonPath
 * @param {Map<string, Set<string>>} schemaBlockTypes
 * @param {Array} issues
 */
function walkSection(section, sourceFile, jsonPath, schemaBlockTypes, issues) {
  if (!section || typeof section !== "object") {
    return;
  }
  const stype = section.type;
  let sectionOk = true;
  if (typeof stype === "string" && !stype.startsWith("@") && !sectionExists(stype)) {
    sectionOk = false;
    issues.push({
      file: sourceFile,
      path: `${jsonPath}.type`,
      kind: "section",
      type: stype,
      parentSection: null,
      hint: `no sections/${stype}.liquid`,
    });
  }
  if (
    sectionOk &&
    section.blocks &&
    typeof section.blocks === "object" &&
    !Array.isArray(section.blocks)
  ) {
    for (const [bid, block] of Object.entries(section.blocks)) {
      walkBlocksTree(block, stype, sourceFile, `${jsonPath}.blocks.${bid}`, schemaBlockTypes, issues);
    }
  }
}

function processJsonRoot(data, sourceFile, schemaBlockTypes, issues) {
  if (!data || typeof data !== "object") {
    return;
  }
  if (data.sections && typeof data.sections === "object" && !Array.isArray(data.sections)) {
    for (const [sid, section] of Object.entries(data.sections)) {
      walkSection(section, sourceFile, `sections.${sid}`, schemaBlockTypes, issues);
    }
  }
}

function collectJsonFiles() {
  const files = new Set();
  glob.sync("templates/**/*.json", { cwd: ROOT, absolute: true }).forEach((f) => files.add(f));
  glob.sync("sections/*.json", { cwd: ROOT, absolute: true }).forEach((f) => files.add(f));
  return [...files];
}

function main() {
  console.log("Checking template / section-group JSON references against theme files…\n");
  const schemaBlockTypes = buildSectionSchemaBlockTypes();
  const issues = [];

  for (const abs of collectJsonFiles()) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      issues.push({
        file: path.relative(ROOT, abs),
        path: "(file)",
        kind: "parse",
        type: null,
        parentSection: null,
        hint: e.message,
      });
      continue;
    }
    processJsonRoot(data, path.relative(ROOT, abs), schemaBlockTypes, issues);
  }

  if (issues.length === 0) {
    console.log("✅ No missing section/block references found.\n");
    process.exit(0);
  }

  console.log(`❌ Found ${issues.length} issue(s):\n`);
  for (const i of issues) {
    console.log(`  [${i.kind}] ${i.type || "JSON"}`);
    console.log(`    file: ${i.file}`);
    console.log(`    path: ${i.path}`);
    if (i.parentSection) {
      console.log(`    parent section: ${i.parentSection}`);
    }
    console.log(`    ${i.hint}`);
    console.log("");
  }

  if (FAIL) {
    process.exit(1);
  }
  process.exit(0);
}

main();
