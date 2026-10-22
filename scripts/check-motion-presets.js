#!/usr/bin/env node
/**
 * Every `data-motion="..."` in Liquid must name a preset that exists.
 *
 * A typo here is silent: the component looks the name up, finds nothing, falls
 * back — and before the registry existed it simply did nothing at all, because
 * the switch statement had no default. Either way the merchant sees no
 * animation and no error. This is the check that makes the registry's names
 * load-bearing.
 *
 * Run: yarn check-motion-presets
 */
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = join(__dirname, "..");
const DIRS = ["sections", "blocks", "snippets", "layout", "templates"];

// The registry is an ES module; read the names out of it rather than importing,
// so this stays a plain CommonJS check like its neighbours.
const names = new Set(
  execSync(
    `node --input-type=module -e "import('${join(ROOT, "src/js/modules/motion-presets.js").replace(/\\/g, "/")}')` +
      `.then(m => console.log(m.listMotionPresets().map(p => p.name).join(String.fromCharCode(10))))"`,
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter(Boolean)
);

function walk(dir, match = /\.(liquid|json)$/, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, match, out);
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

// Presets a FORK added. docs/motion.md tells a child NOT to edit the registry
// above — it conflicts on every sync — and to call
// `FoxTheme.motion.registerPreset(name, definition)` instead. Reading only the
// core registry therefore rejected the very extension point the docs prescribe:
// the name is real at runtime, but absent from the file this check reads, so
// the first literal `data-motion` using it failed CI and the fork's only
// sanctioned route was a dead end.
//
// Scope is `src/js` — where the docs put the call, and the only place that runs
// on every page. A registration made anywhere else is not visible here, which
// is the same trade the rest of this check makes: literal values only.
const FORK_REGISTRATION = /\b(?:registerMotionPreset|registerPreset)\s*\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g;
const forkNames = new Set();
try {
  for (const file of walk(join(ROOT, "src/js"), /\.(js|mjs)$/)) {
    for (const match of readFileSync(file, "utf8").matchAll(FORK_REGISTRATION)) {
      if (!names.has(match[1])) forkNames.add(match[1]);
    }
  }
} catch {
  // no src/js in this checkout — nothing to add
}
for (const name of forkNames) names.add(name);

const problems = [];
let checked = 0;

for (const dir of DIRS) {
  let files;
  try {
    files = walk(join(ROOT, dir));
  } catch {
    continue;
  }

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");

    lines.forEach((line, index) => {
      // Literal values only. A Liquid expression resolves at render time and is
      // the settings schema's job to constrain, not this one's.
      for (const match of line.matchAll(/data-motion=["']([a-z0-9-]+)["']/gi)) {
        checked += 1;
        const value = match[1];
        if (value === "none" || names.has(value)) continue;
        problems.push({ file: relative(ROOT, file), line: index + 1, value });
      }
    });
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} unknown motion preset(s):\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  data-motion="${p.value}"`);
  }
  console.error(`\n  Known: ${Array.from(names).sort().join(", ")}`);
  console.error(
    `  Add it to src/js/modules/motion-presets.js (core), call ` +
      `registerMotionPreset("<name>", …) in src/js (fork), or fix the spelling.`
  );
  process.exit(1);
}

const forkNote = forkNames.size ? `, ${forkNames.size} registered by this theme` : "";
console.log(
  `✓ motion presets OK (${checked} literal data-motion values, ${names.size} presets registered${forkNote}).`
);
