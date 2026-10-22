/**
 * Remove orphaned section/block entries from template JSON and sections/*.json
 * (same rules as check-template-refs.js). Syncs block_order after deletes.
 *
 * Usage: node scripts/clean-template-refs.js
 */
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const ROOT = path.resolve(__dirname, "..");

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
      /* skip */
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

function isValidBlockType(blockType, parentSectionType, schemaBlockTypes) {
  if (!blockType || blockType.startsWith("@")) {
    return true;
  }
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

function syncBlockOrder(container) {
  if (!container.blocks || !Array.isArray(container.block_order)) {
    return;
  }
  container.block_order = container.block_order.filter((id) => container.blocks[id] != null);
}

/**
 * Depth-first: clean nested blocks, then remove invalid blocks at this level.
 */
function pruneContainer(container, parentSectionType, schemaBlockTypes) {
  if (!container.blocks || typeof container.blocks !== "object" || Array.isArray(container.blocks)) {
    return;
  }

  for (const bid of Object.keys(container.blocks)) {
    const block = container.blocks[bid];
    if (block && typeof block === "object") {
      pruneContainer(block, parentSectionType, schemaBlockTypes);
    }
  }

  for (const bid of [...Object.keys(container.blocks)]) {
    const block = container.blocks[bid];
    const btype = block && block.type;
    if (typeof btype === "string" && !isValidBlockType(btype, parentSectionType, schemaBlockTypes)) {
      delete container.blocks[bid];
    }
  }

  syncBlockOrder(container);
}

function cleanSection(section, schemaBlockTypes) {
  const stype = section.type;
  if (typeof stype !== "string") {
    return true;
  }
  if (!stype.startsWith("@") && !sectionExists(stype)) {
    return false;
  }
  pruneContainer(section, stype, schemaBlockTypes);
  return true;
}

function cleanRoot(data, schemaBlockTypes) {
  if (!data || typeof data !== "object" || !data.sections || typeof data.sections !== "object") {
    return { removedSections: [] };
  }
  const removedSections = [];

  for (const sid of [...Object.keys(data.sections)]) {
    const sec = data.sections[sid];
    if (!cleanSection(sec, schemaBlockTypes)) {
      delete data.sections[sid];
      removedSections.push(sid);
    }
  }

  if (Array.isArray(data.order)) {
    data.order = data.order.filter((id) => data.sections[id] != null);
  }

  return { removedSections };
}

function collectJsonFiles() {
  const files = new Set();
  glob.sync("templates/**/*.json", { cwd: ROOT, absolute: true }).forEach((f) => files.add(f));
  glob.sync("sections/*.json", { cwd: ROOT, absolute: true }).forEach((f) => files.add(f));
  return [...files];
}

function main() {
  console.log("Cleaning stale section/block references…\n");
  const schemaBlockTypes = buildSectionSchemaBlockTypes();
  let filesChanged = 0;

  for (const abs of collectJsonFiles()) {
    const rel = path.relative(ROOT, abs);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      console.warn(`Skip (invalid JSON): ${rel} — ${e.message}`);
      continue;
    }

    const before = JSON.stringify(data);
    const { removedSections } = cleanRoot(data, schemaBlockTypes);
    const after = JSON.stringify(data);

    if (before !== after) {
      fs.writeFileSync(abs, JSON.stringify(data, null, 2) + "\n", "utf8");
      filesChanged++;
      console.log(`✓ ${rel}`);
      if (removedSections.length) {
        console.log(`    removed sections: ${removedSections.join(", ")}`);
      }
    }
  }

  console.log(`\nDone. Updated ${filesChanged} file(s). Run: yarn check-template-refs`);
}

main();
