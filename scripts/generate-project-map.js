/**
 * generate-project-map.js
 *
 * Generates PROJECT-MAP.md — a pre-built index so AI agents know exactly
 * where snippets, blocks, sections, and JS components are used without
 * having to grep through the entire project.
 *
 * Usage:
 *   node scripts/generate-project-map.js
 *
 * Output: PROJECT-MAP.md (project root)
 */

const fs = require("fs");
const path = require("path");
const glob = require("glob");

const ROOT = path.resolve(__dirname, "..");

// ─── helpers ────────────────────────────────────────────────────────────────

function read(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function files(pattern, options = {}) {
  return glob.sync(pattern, { cwd: ROOT, absolute: true, ...options });
}

function sortByUsage(map) {
  return Object.entries(map).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function parseSchemaFromLiquid(content) {
  const match = content.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ─── 0. Capability index ─────────────────────────────────────────────────────
// Opt-in via `@capability` doc blocks in the source files themselves:
//   JS  — a JSDoc block:      /** @capability ... @when ... @contract ... @keywords ... */
//   SCSS — a line-comment run: // @capability ...  (one tag per line)
// A file may hold SEVERAL blocks (src/js/global/modules.js bundles many
// components) — each block names its component with @component <tag>; a file
// with a single block defaults to its own basename.
// Tags: @capability (required, one line: what it does), @when (when to reuse),
// @contract (required markup/classes/attrs), @keywords (behaviour vocabulary a
// builder would grep for), @component (element tag or partial name).

function parseCapabilityBlocks(content) {
  const blocks = [];

  // JSDoc blocks and consecutive line-comment runs (// or SCSS //)
  const rawBlocks = [
    ...[...content.matchAll(/\/\*\*[\s\S]*?\*\//g)].map((m) => m[0]),
    ...[...content.matchAll(/(?:^[ \t]*\/\/.*\r?\n?)+/gm)].map((m) => m[0]),
  ];

  for (const raw of rawBlocks) {
    if (!raw.includes("@capability")) continue;
    const tags = {};
    for (const m of raw.matchAll(/(?:\*|\/\/)\s*@(capability|when|contract|keywords|component)\s+(.+)/g)) {
      // First occurrence wins; tags are one line each.
      if (!tags[m[1]]) tags[m[1]] = m[2].trim();
    }
    if (tags.capability) blocks.push(tags);
  }

  return blocks;
}

function buildCapabilityIndex(customElementMap) {
  const entries = [];
  const missingJs = [];
  const missingScss = [];

  // src/js/modules files whose basename also exists in src/js/library/ are
  // VITE BUILD OUTPUT (vite.config.mjs outDir: "src/js/modules") — the bundle
  // drops leading comments, so headers live in the library SOURCE and the
  // generated copy is skipped here.
  const libraryBasenames = new Set(files("src/js/library/*.js").map((f) => path.basename(f)));
  const jsSources = [
    ...files("src/js/modules/*.js").filter((f) => !libraryBasenames.has(path.basename(f))),
    ...files("src/js/library/*.js"),
    path.join(ROOT, "src/js/global/modules.js"),
  ];
  // Headers are opt-in, so scan wide: foundation partials (_helpers, _layout,
  // _spacing, _keyframes…) and mixins carry capability headers too. Only
  // _component-* partials are NAGGED about when missing (the footer below) —
  // template-*/section-* partials don't need one.
  const scssSources = [...files("src/scss/global/*.scss"), ...files("src/scss/mixins/*.scss")];

  for (const file of jsSources) {
    const blocks = parseCapabilityBlocks(read(file));
    if (blocks.length === 0) {
      missingJs.push(path.basename(file));
      continue;
    }
    for (const b of blocks) {
      const name = b.component || path.basename(file, ".js");
      const usedIn = customElementMap[name]?.usedIn || [];
      entries.push({ ...b, name, file: rel(file), usedIn });
    }
  }

  for (const file of scssSources) {
    const blocks = parseCapabilityBlocks(read(file));
    if (blocks.length === 0) {
      if (path.basename(file).startsWith("_component-")) missingScss.push(path.basename(file));
      continue;
    }
    for (const b of blocks) {
      const name = b.component || path.basename(file, ".scss").replace(/^_/, "");
      entries.push({ ...b, name, file: rel(file), usedIn: [] });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, missingJs, missingScss };
}

// ─── 1. Snippet usage ────────────────────────────────────────────────────────
// Map: snippet-name → [...files that render it]

function buildSnippetMap() {
  const snippetFiles = files("snippets/*.liquid");
  const snippetNames = snippetFiles.map((f) => path.basename(f, ".liquid"));

  const searchIn = [
    ...files("sections/*.liquid"),
    ...files("blocks/*.liquid"),
    ...files("snippets/*.liquid"),
    ...files("layout/*.liquid"),
  ];

  const map = {};
  for (const name of snippetNames) map[name] = [];

  for (const file of searchIn) {
    const content = read(file);
    for (const m of content.matchAll(/\{%-?\s*render\s+['"]([^'"]+)['"]/g)) {
      const name = m[1];
      if (map[name]) {
        const r = rel(file);
        if (!map[name].includes(r)) map[name].push(r);
      }
    }
  }

  return map;
}

// ─── 2. Section → where it is used ──────────────────────────────────────────
// Scans templates/*.json AND sections/*.json (header/footer/overlay groups)

function buildSectionUsageMap() {
  const sectionFiles = files("sections/*.liquid");
  const sectionNames = sectionFiles.map((f) => path.basename(f, ".liquid"));

  const map = {};
  for (const name of sectionNames) map[name] = [];

  // helper: scan a JSON file for section type entries
  function scanJson(file, label) {
    const content = read(file);
    let json;
    try { json = JSON.parse(content); } catch { return; }
    for (const entry of Object.values(json.sections || {})) {
      const type = entry?.type;
      if (type && map[type] !== undefined) {
        const tag = label || rel(file);
        if (!map[type].includes(tag)) map[type].push(tag);
      }
    }
  }

  for (const f of files("templates/**/*.json")) scanJson(f);

  // Section groups
  const groupLabels = {
    "header-group.json": "sections/header-group.json (header group)",
    "footer-group.json": "sections/footer-group.json (footer group)",
    "overlay-group.json": "sections/overlay-group.json (overlay group)",
  };
  for (const f of files("sections/*.json")) {
    const base = path.basename(f);
    scanJson(f, groupLabels[base] || rel(f));
  }

  return map;
}

// ─── 3. Section blocks map ────────────────────────────────────────────────────
// For sections using section blocks (not @theme), list the block types they define

function buildSectionBlocksMap() {
  const result = {}; // section-name → { usesThemeBlocks: bool, sectionBlockTypes: string[] }

  for (const file of files("sections/*.liquid")) {
    const name = path.basename(file, ".liquid");
    const schema = parseSchemaFromLiquid(read(file));
    if (!schema) continue;

    const blockTypes = (schema.blocks || []).map((b) => b.type);
    const usesTheme = blockTypes.some((t) => t === "@theme" || t === "@app");
    const sectionOnly = blockTypes.filter((t) => t !== "@theme" && t !== "@app");

    if (blockTypes.length > 0) {
      result[name] = { usesThemeBlocks: usesTheme, sectionBlockTypes: sectionOnly };
    }
  }

  return result;
}

// ─── 4. Theme blocks (files in blocks/) ─────────────────────────────────────
// Split public (no _ prefix) vs internal (_ prefix)
// Return: { sections: string[], publicBlocks: string[], internalBlocks: string[] }

function buildThemeBlockInfo() {
  const blockFiles = files("blocks/*.liquid");
  const publicBlocks = [];
  const internalBlocks = [];

  for (const f of blockFiles) {
    const name = path.basename(f, ".liquid");
    if (name.startsWith("_")) internalBlocks.push(name);
    else publicBlocks.push(name);
  }

  const sections = [];
  for (const file of files("sections/*.liquid")) {
    const schema = parseSchemaFromLiquid(read(file));
    if (!schema) continue;
    const types = (schema.blocks || []).map((b) => b.type);
    if (types.includes("@theme") || types.includes("@app")) {
      sections.push(rel(file));
    }
  }

  return { sections, publicBlocks, internalBlocks };
}

// ─── 5. JS custom elements ───────────────────────────────────────────────────
// Map: element-tag → { jsFile, usedIn: [...liquid files] }

function buildCustomElementMap() {
  // src/js/global/modules.js bundles several components (tabs-component,
  // accordion-component, responsive-image, …) — scan it too, or they vanish
  // from the map entirely.
  const jsFiles = [...files("src/js/modules/*.js"), ...files("src/js/global/*.js")];
  const elementToFile = {};

  for (const file of jsFiles) {
    const content = read(file);
    for (const m of content.matchAll(/customElements\.define\(\s*['"]([^'"]+)['"]/g)) {
      elementToFile[m[1]] = rel(file);
    }
  }

  const liquidFiles = [
    ...files("sections/*.liquid"),
    ...files("blocks/*.liquid"),
    ...files("snippets/*.liquid"),
    ...files("layout/*.liquid"),
  ];

  const map = {};
  for (const [tag, jsFile] of Object.entries(elementToFile)) {
    map[tag] = { jsFile, usedIn: [] };
  }

  for (const file of liquidFiles) {
    const content = read(file);
    for (const tag of Object.keys(elementToFile)) {
      // `<tag` = autonomous custom element; `is="tag"` = customized built-in
      // (e.g. <div is="swipe-component">) — both are real usage.
      if (content.includes(`<${tag}`) || content.includes(`is="${tag}"`)) {
        const r = rel(file);
        if (!map[tag].usedIn.includes(r)) map[tag].usedIn.push(r);
      }
    }
  }

  return map;
}

// ─── 6. JS module @theme imports ────────────────────────────────────────────

// Also scans src/js/global/ entry points (modules.js, theme.js)
function buildJsImportMap() {
  const map = {};
  const allJs = [
    ...files("src/js/modules/*.js"),
    ...files("src/js/global/*.js"),
  ];
  for (const file of allJs) {
    const content = read(file);
    const imports = [];
    for (const m of content.matchAll(/from\s+['"](@theme\/[^'"]+)['"]/g)) {
      if (!imports.includes(m[1])) imports.push(m[1]);
    }
    if (imports.length > 0) {
      // Prefix global files to distinguish from modules
      const key = file.includes("/global/")
        ? `global/${path.basename(file)}`
        : path.basename(file);
      map[key] = imports;
    }
  }
  return map;
}

// ─── 8. ThemeEvents constants ────────────────────────────────────────────────

function buildThemeEventsInfo() {
  // Try src/js/modules/events.js first, fall back to assets/events.js
  const candidates = [
    path.join(ROOT, "src/js/modules/events.js"),
    ...files("assets/events.js"),
  ];
  let content = "";
  for (const f of candidates) {
    content = read(f);
    if (content) break;
  }

  // Extract: static propertyName = "event:string"
  const constants = [];
  for (const m of content.matchAll(/static\s+(\w+)\s*=\s*["']([^"']+)["']/g)) {
    // Skip non-event strings (e.g. static eventName = ThemeEvents.xxx)
    if (m[2].includes(":") || m[2].includes("-")) {
      constants.push({ name: m[1], value: m[2] });
    }
  }

  // Extract event class names
  const classes = [];
  for (const m of content.matchAll(/^export class (\w+Event\w*)/gm)) {
    if (!classes.includes(m[1])) classes.push(m[1]);
  }
  // Also catch non-"Event" suffixed exported classes
  for (const m of content.matchAll(/^export class (ThemeEvents|CartGroupedSections)/gm)) {
    if (!classes.includes(m[1])) classes.push(m[1]);
  }

  return { constants, classes };
}

// ─── 9. @theme/utilities API ────────────────────────────────────────────────

function buildUtilitiesApi() {
  const candidates = [
    path.join(ROOT, "src/js/modules/utilities.js"),
    ...files("assets/utilities.js"),
  ];
  let content = "";
  for (const f of candidates) {
    content = read(f);
    if (content) break;
  }

  const functions = [];
  const constants = [];
  const classes = [];

  for (const m of content.matchAll(/^export\s+(function|async function)\s+(\w+)/gm)) {
    functions.push(m[2]);
  }
  for (const m of content.matchAll(/^export\s+const\s+(\w+)/gm)) {
    constants.push(m[1]);
  }
  for (const m of content.matchAll(/^export\s+class\s+(\w+)/gm)) {
    classes.push(m[1]);
  }

  return { functions, constants, classes };
}

// ─── 10. SCSS file index + CSS loading conditions ────────────────────────────

function buildScssIndex() {
  const globalFiles = files("src/scss/global/*.scss").map((f) => path.basename(f));
  const moduleFiles = files("src/scss/modules/*.scss").map((f) => path.basename(f));

  const sections = globalFiles.filter((f) => f.startsWith("_section-")).map((f) => f.replace(/^_/, "").replace(/\.scss$/, ""));
  const components = globalFiles.filter((f) => f.startsWith("_component-")).map((f) => f.replace(/^_/, "").replace(/\.scss$/, ""));
  const blocks = globalFiles.filter((f) => f.startsWith("_block-")).map((f) => f.replace(/^_/, "").replace(/\.scss$/, ""));
  const entries = globalFiles.filter((f) => !f.startsWith("_")).map((f) => f.replace(/\.scss$/, ""));

  // Parse styles.liquid for conditional CSS loading
  const stylesLiquid = read(path.join(ROOT, "snippets/styles.liquid"));
  const cssLoading = [];
  const cssLines = stylesLiquid.split("\n");
  const cssCondStack = [null];

  for (const line of cssLines) {
    const t = line.trim();
    if (/^\{%-?\s*if\s/.test(t)) {
      const m = t.match(/\{%-?\s*if\s+(.+?)\s*-?%\}/);
      cssCondStack.push(m ? m[1].trim() : "unknown");
    } else if (/^\{%-?\s*elsif\s/.test(t)) {
      const m = t.match(/\{%-?\s*elsif\s+(.+?)\s*-?%\}/);
      cssCondStack[cssCondStack.length - 1] = m ? m[1].trim() : "unknown";
    } else if (/^\{%-?\s*else\b/.test(t)) {
      cssCondStack[cssCondStack.length - 1] = null;
    } else if (/^\{%-?\s*endif\b/.test(t)) {
      if (cssCondStack.length > 1) cssCondStack.pop();
    }
    // Match: 'file.css' | asset_url | stylesheet_tag  OR  href="{{ 'file.css' | asset_url }}"
    const cssMatch = t.match(/['"]([^'"]+\.css)['"]\s*\|\s*asset_url/);
    if (cssMatch) {
      const condition = cssCondStack[cssCondStack.length - 1];
      cssLoading.push({ file: cssMatch[1], condition });
    }
  }

  return { sections, components, blocks, entries, moduleFiles, cssLoading };
}

// ─── 11. Other @theme/* module exports ───────────────────────────────────────
// Key modules beyond utilities and events: dialog, section-renderer, morph,
// image-coordinator, motion-coordinator, critical, animation (library)

function buildThemeModuleExports() {
  const targets = [
    { alias: "@theme/dialog",            srcGlob: "src/js/modules/dialog.js" },
    { alias: "@theme/section-renderer",  srcGlob: "src/js/modules/section-renderer.js" },
    { alias: "@theme/morph",             srcGlob: "src/js/modules/morph.js" },
    { alias: "@theme/image-coordinator", srcGlob: "src/js/modules/image-coordinator.js" },
    { alias: "@theme/motion-coordinator",srcGlob: "src/js/modules/motion-coordinator.js" },
    { alias: "@theme/critical",          srcGlob: "src/js/modules/critical.js" },
    { alias: "@theme/animation",         srcGlob: "src/js/library/animation.js" },
    { alias: "@theme/component",         srcGlob: "src/js/modules/component.js" },
  ];

  const result = [];

  for (const { alias, srcGlob } of targets) {
    const candidates = [
      path.join(ROOT, srcGlob),
      ...files(srcGlob.replace("src/js/", "assets/").replace(".js", ".js")),
    ];
    let content = "";
    for (const f of candidates) {
      content = read(f);
      if (content) break;
    }
    if (!content) continue;

    const exports = new Set();

    // export class/function/const/async function Name
    for (const m of content.matchAll(/^export\s+(?:async\s+)?(?:class|function|const|let)\s+(\w+)/gm)) {
      exports.add(m[1]);
    }
    // export { name1, name2 }
    for (const m of content.matchAll(/^export\s*\{([^}]+)\}/gm)) {
      for (const name of m[1].split(",")) {
        const clean = name.trim().split(/\s+as\s+/).pop().trim();
        if (clean) exports.add(clean);
      }
    }

    if (exports.size > 0) {
      result.push({ alias, exports: [...exports].sort() });
    }
  }

  return result;
}

// ─── 7. JS loading conditions (scripts.liquid) ───────────────────────────────
// BUG FIX: use proper regex to detect `{% if %}` vs `{% endif %}`.
// `{% endif %}` contains "if" but NOT as a standalone tag — use /\{%-?\s*if\s/

function buildJsLoadingMap() {
  const content = read(path.join(ROOT, "snippets/scripts.liquid"));
  const lines = content.split("\n");

  const entries = [];
  // Stack-based to handle nested if/endif correctly
  const condStack = [null]; // null = no condition (always)

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\{%-?\s*if\s/.test(trimmed)) {
      // Opening if — push new condition
      const m = trimmed.match(/\{%-?\s*if\s+(.+?)\s*-?%\}/);
      condStack.push(m ? m[1].trim() : "unknown");
    } else if (/^\{%-?\s*elsif\s/.test(trimmed)) {
      // elsif — replace top of stack
      const m = trimmed.match(/\{%-?\s*elsif\s+(.+?)\s*-?%\}/);
      condStack[condStack.length - 1] = m ? m[1].trim() : "unknown";
    } else if (/^\{%-?\s*else\b/.test(trimmed)) {
      // else — mark as "else branch" (no condition)
      condStack[condStack.length - 1] = null;
    } else if (/^\{%-?\s*endif\b/.test(trimmed)) {
      // endif — pop stack
      if (condStack.length > 1) condStack.pop();
    }

    // Current condition = top of stack (null = always)
    const currentCondition = condStack[condStack.length - 1];

    // Match: src="{{ 'filename.js' | asset_url }}"
    const m = trimmed.match(/src="\{\{\s*['"]([^'"]+\.js)['"]\s*\|/);
    if (m) {
      entries.push({ file: m[1], condition: currentCondition });
    }
  }

  return entries;
}

// ─── render markdown ─────────────────────────────────────────────────────────

function renderMarkdown({
  capabilityIndex,
  snippetMap,
  sectionUsageMap,
  sectionBlocksMap,
  themeBlockInfo,
  customElementMap,
  jsImportMap,
  jsLoading,
  themeEvents,
  utilitiesApi,
  scssIndex,
  themeModuleExports,
}) {
  const lines = [];
  const ts = new Date().toISOString().slice(0, 10);

  lines.push(`# PROJECT-MAP`);
  lines.push(`> Auto-generated ${ts} by \`node scripts/generate-project-map.js\`. Do not edit manually — run \`yarn map\` to refresh.`);
  lines.push(`> Purpose: AI agent quick reference — what reusable behaviour exists (§0), and where each snippet/section/block/component is used, without grepping.`);
  lines.push("");

  // ── 0. Capability index ──
  lines.push(`## 0. Capability index — reusable behaviours (check BEFORE writing new CSS/JS)`);
  lines.push(`_Generated from \`@capability\` headers in the source. Before hand-rolling ANY behaviour (scroll row, dialog, tabs, carousel, countdown, sticky…), find it here — the keywords line is what to grep for. Reuse-first: hand-rolling one of these passes every check and still ships a worse widget._`);
  lines.push("");

  for (const e of capabilityIndex.entries) {
    lines.push(`**${e.name}** (\`${e.file}\`) — ${e.capability}`);
    if (e.when) lines.push(`- when: ${e.when}`);
    if (e.contract) lines.push(`- contract: ${e.contract}`);
    if (e.keywords) lines.push(`- keywords: ${e.keywords}`);
    if (e.usedIn.length > 0) {
      const shown = e.usedIn.slice(0, 5);
      const more = e.usedIn.length - shown.length;
      lines.push(`- used by: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`);
    }
    lines.push("");
  }

  if (capabilityIndex.missingJs.length > 0) {
    lines.push(`_JS modules WITHOUT a capability header yet (they still exist — filename is the only hint; check before building similar):_ ${capabilityIndex.missingJs.join(", ")}`);
    lines.push("");
  }
  if (capabilityIndex.missingScss.length > 0) {
    lines.push(`_Component partials without a header yet:_ ${capabilityIndex.missingScss.join(", ")}`);
    lines.push("");
  }

  // ── 1. Snippets ──
  lines.push(`## 1. Snippets — where each is rendered`);
  lines.push(`_Format: snippet-name (N usages) → caller files_`);
  lines.push("");

  const unusedSnippets = [];
  for (const [name, usages] of sortByUsage(snippetMap)) {
    if (usages.length === 0) unusedSnippets.push(name);
    else lines.push(`**${name}** (${usages.length}) → ${usages.join(", ")}`);
  }
  if (unusedSnippets.length > 0) {
    lines.push("");
    lines.push(`_No static render call found (may be rendered via variable or unused):_ ${unusedSnippets.join(", ")}`);
  }
  lines.push("");

  // ── 2. Sections → where used ──
  lines.push(`## 2. Sections — where each is used`);
  lines.push("");

  const notInAny = [];
  for (const [name, places] of sortByUsage(sectionUsageMap)) {
    if (places.length === 0) notInAny.push(name);
    else lines.push(`**${name}** → ${places.join(", ")}`);
  }
  if (notInAny.length > 0) {
    lines.push("");
    lines.push(`_Not found in any template or group JSON (may be unused or rendered dynamically):_ ${notInAny.join(", ")}`);
  }
  lines.push("");

  // ── 3. Section blocks ──
  lines.push(`## 3. Section blocks — block types defined per section`);
  lines.push(`_Sections using \`@theme\` blocks are in Section 4. Sections below define their own block types in schema._`);
  lines.push("");

  const sectionWithTheme = Object.entries(sectionBlocksMap)
    .filter(([, v]) => v.usesThemeBlocks)
    .map(([k]) => k);
  const sectionWithOwn = Object.entries(sectionBlocksMap)
    .filter(([, v]) => !v.usesThemeBlocks && v.sectionBlockTypes.length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (sectionWithTheme.length > 0) {
    lines.push(`Uses \`@theme\` blocks (see Section 4): ${sectionWithTheme.join(", ")}`);
    lines.push("");
  }
  for (const [name, { sectionBlockTypes }] of sectionWithOwn) {
    lines.push(`**${name}**: ${sectionBlockTypes.join(", ")}`);
  }
  lines.push("");

  // ── 4. Theme blocks ──
  lines.push(`## 4. Theme blocks (files in \`blocks/\`)`);
  lines.push("");
  lines.push(`**Sections accepting \`@theme\` blocks** (any file in \`blocks/\` can be used here):`);
  lines.push(themeBlockInfo.sections.join(", ") || "_none_");
  lines.push("");
  lines.push(`**Public blocks** (user-addable in editor): ${themeBlockInfo.publicBlocks.map((n) => `blocks/${n}.liquid`).join(", ")}`);
  lines.push("");
  lines.push(`**Internal blocks** (\`_\` prefix — preset-only, not user-addable): ${themeBlockInfo.internalBlocks.map((n) => `blocks/${n}.liquid`).join(", ")}`);
  lines.push("");

  // ── 5. JS custom elements ──
  lines.push(`## 5. JS custom elements — Liquid usage`);
  lines.push(`_Format: <tag> (JS file) → liquid files using it_`);
  lines.push("");

  const sorted = Object.entries(customElementMap).sort(
    (a, b) => b[1].usedIn.length - a[1].usedIn.length || a[0].localeCompare(b[0])
  );
  const notFoundTags = [];
  for (const [tag, { jsFile, usedIn }] of sorted) {
    if (usedIn.length === 0) notFoundTags.push(`\`<${tag}>\` (${jsFile})`);
    else lines.push(`**\`<${tag}>\`** (${jsFile}) → ${usedIn.join(", ")}`);
  }
  if (notFoundTags.length > 0) {
    lines.push("");
    lines.push(`_Tag not found in Liquid (may use \`is="..."\`, dynamic tag, or component not yet used in Liquid):_ ${notFoundTags.join(", ")}`);
  }
  lines.push("");

  // ── 6. JS imports ──
  lines.push(`## 6. JS modules — @theme dependencies`);
  lines.push(`_What each module imports from \`@theme/*\`_`);
  lines.push("");
  for (const [file, imports] of Object.entries(jsImportMap).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`**${file}** ← ${imports.join(", ")}`);
  }
  lines.push("");

  // ── 7. JS loading ──
  lines.push(`## 7. JS loading — scripts.liquid conditions`);
  lines.push(`_Always vs conditionally loaded from \`snippets/scripts.liquid\`_`);
  lines.push("");

  const always = jsLoading.filter((e) => e.condition === null);
  const conditional = jsLoading.filter((e) => e.condition !== null);

  if (always.length > 0) {
    lines.push(`**Always loaded:** ${always.map((e) => e.file).join(", ")}`);
    lines.push("");
  }
  if (conditional.length > 0) {
    lines.push(`**Conditionally loaded:**`);
    for (const { file, condition } of conditional) {
      lines.push(`- \`${file}\` — when \`${condition}\``);
    }
  }
  lines.push("");

  // ── 8. ThemeEvents ──
  lines.push(`## 8. ThemeEvents constants & event classes (@theme/events)`);
  lines.push(`_Import: \`import { ThemeEvents, EventClassName } from "@theme/events"\`_`);
  lines.push("");
  if (themeEvents.constants.length > 0) {
    lines.push(`**Constants (ThemeEvents.*):**`);
    for (const { name, value } of themeEvents.constants) {
      lines.push(`- \`ThemeEvents.${name}\` = \`"${value}"\``);
    }
    lines.push("");
  }
  if (themeEvents.classes.length > 0) {
    lines.push(`**Event classes:** ${themeEvents.classes.join(", ")}`);
  }
  lines.push("");

  // ── 9. @theme/utilities API ──
  lines.push(`## 9. @theme/utilities — exported API`);
  lines.push(`_Import: \`import { fn } from "@theme/utilities"\`_`);
  lines.push("");
  if (utilitiesApi.functions.length > 0) {
    lines.push(`**Functions:** ${utilitiesApi.functions.join(", ")}`);
  }
  if (utilitiesApi.constants.length > 0) {
    lines.push(`**Constants:** ${utilitiesApi.constants.join(", ")}`);
  }
  if (utilitiesApi.classes.length > 0) {
    lines.push(`**Classes:** ${utilitiesApi.classes.join(", ")}`);
  }
  lines.push("");

  // ── 10. SCSS index + CSS loading ──
  lines.push(`## 10. SCSS file index & CSS loading (src/scss/)`);
  lines.push(`_Naming convention: \`_section-{name}\`, \`_component-{name}\`, \`_block-{name}\` in \`src/scss/global/\`_`);
  lines.push("");
  if (scssIndex.sections.length > 0) {
    lines.push(`**Sections:** ${scssIndex.sections.join(", ")}`);
  }
  if (scssIndex.components.length > 0) {
    lines.push(`**Components:** ${scssIndex.components.join(", ")}`);
  }
  if (scssIndex.blocks.length > 0) {
    lines.push(`**Blocks:** ${scssIndex.blocks.join(", ")}`);
  }
  if (scssIndex.moduleFiles.length > 0) {
    lines.push(`**Modules** (src/scss/modules/): ${scssIndex.moduleFiles.join(", ")}`);
  }
  lines.push("");

  // CSS loading conditions from styles.liquid
  lines.push(`**CSS loading (snippets/styles.liquid):**`);
  const alwaysCss = scssIndex.cssLoading.filter((e) => e.condition === null);
  const conditionalCss = scssIndex.cssLoading.filter((e) => e.condition !== null);
  if (alwaysCss.length > 0) {
    lines.push(`- Always: ${alwaysCss.map((e) => e.file).join(", ")}`);
  }
  for (const { file, condition } of conditionalCss) {
    lines.push(`- \`${file}\` — when \`${condition}\``);
  }
  lines.push("");

  // ── 11. Other @theme/* module exports ──
  lines.push(`## 11. Other @theme/* module exports`);
  lines.push(`_Key exports beyond @theme/utilities and @theme/events_`);
  lines.push("");
  for (const { alias, exports } of themeModuleExports) {
    lines.push(`**${alias}**: ${exports.join(", ")}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ─── main ────────────────────────────────────────────────────────────────────

function main() {
  console.log("Generating PROJECT-MAP.md...");

  const snippetMap = buildSnippetMap();
  console.log(`  ✓ Snippets: ${Object.keys(snippetMap).length}`);

  const sectionUsageMap = buildSectionUsageMap();
  console.log(`  ✓ Sections: ${Object.keys(sectionUsageMap).length}`);

  const sectionBlocksMap = buildSectionBlocksMap();
  console.log(`  ✓ Section block schemas: ${Object.keys(sectionBlocksMap).length}`);

  const themeBlockInfo = buildThemeBlockInfo();
  console.log(`  ✓ Theme blocks: ${themeBlockInfo.publicBlocks.length} public, ${themeBlockInfo.internalBlocks.length} internal`);

  const customElementMap = buildCustomElementMap();
  console.log(`  ✓ Custom elements: ${Object.keys(customElementMap).length}`);

  const capabilityIndex = buildCapabilityIndex(customElementMap);
  console.log(`  ✓ Capability index: ${capabilityIndex.entries.length} entries (${capabilityIndex.missingJs.length} JS + ${capabilityIndex.missingScss.length} SCSS without headers)`);

  const jsImportMap = buildJsImportMap();
  console.log(`  ✓ JS modules: ${Object.keys(jsImportMap).length}`);

  const jsLoading = buildJsLoadingMap();
  const alwaysCount = jsLoading.filter((e) => e.condition === null).length;
  const conditionalCount = jsLoading.filter((e) => e.condition !== null).length;
  console.log(`  ✓ JS loading: ${alwaysCount} always, ${conditionalCount} conditional`);

  const themeEvents = buildThemeEventsInfo();
  console.log(`  ✓ ThemeEvents: ${themeEvents.constants.length} constants, ${themeEvents.classes.length} event classes`);

  const utilitiesApi = buildUtilitiesApi();
  console.log(`  ✓ Utilities API: ${utilitiesApi.functions.length} functions, ${utilitiesApi.constants.length} constants`);

  const scssIndex = buildScssIndex();
  console.log(`  ✓ SCSS: ${scssIndex.sections.length} sections, ${scssIndex.components.length} components, ${scssIndex.blocks.length} blocks, ${scssIndex.cssLoading.length} CSS entries`);

  const themeModuleExports = buildThemeModuleExports();
  console.log(`  ✓ @theme/* module exports: ${themeModuleExports.length} modules`);

  const markdown = renderMarkdown({
    capabilityIndex,
    snippetMap,
    sectionUsageMap,
    sectionBlocksMap,
    themeBlockInfo,
    customElementMap,
    jsImportMap,
    jsLoading,
    themeEvents,
    utilitiesApi,
    scssIndex,
    themeModuleExports,
  });

  const outPath = path.join(ROOT, "PROJECT-MAP.md");
  fs.writeFileSync(outPath, markdown, "utf8");
  console.log(`\nDone → PROJECT-MAP.md (${(markdown.length / 1024).toFixed(1)} KB)`);
}

main();
