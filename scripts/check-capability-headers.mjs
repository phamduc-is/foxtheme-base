#!/usr/bin/env node
/**
 * check-capability-headers — ratchet: every NEW reusable source file must carry
 * a `@capability` doc header, so it lands in PROJECT-MAP §0 (Capability index)
 * and stays visible to every future builder's reuse check.
 *
 * Scope enforced:
 *   - src/js/modules/*.js
 *   - src/scss/global/_component-*.scss
 *
 * Pre-existing files without a header are grandfathered in the baseline
 * (.capability-headers-baseline.json) — the rule fails only on files NOT in
 * the baseline. Adding a header to a baselined file is always welcome; then
 * regenerate the baseline so it shrinks (a ratchet, never a wishlist).
 *
 * Usage:
 *   node scripts/check-capability-headers.mjs             # check (CI mode)
 *   node scripts/check-capability-headers.mjs --baseline  # regenerate baseline
 *
 * Header format (extracted by scripts/generate-project-map.js — see the
 * create-js-component / create-scss-module skills for full templates):
 *   JS:    a JSDoc block with `@capability` (+ @when/@contract/@keywords)
 *   SCSS:  `// @capability ...` line comments at the top of the partial
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, ".capability-headers-baseline.json");

// src/js/modules files whose basename also exists in src/js/library/ are VITE
// BUILD OUTPUT (vite.config.mjs outDir: "src/js/modules") — the bundle drops
// comments, so the header requirement applies to the library SOURCE instead.
const libraryFiles = readdirSync(path.join(ROOT, "src/js/library")).filter((f) => f.endsWith(".js"));
const libraryBasenames = new Set(libraryFiles);

const targets = [
  ...readdirSync(path.join(ROOT, "src/js/modules"))
    .filter((f) => f.endsWith(".js") && !libraryBasenames.has(f))
    .map((f) => `src/js/modules/${f}`),
  ...libraryFiles.map((f) => `src/js/library/${f}`),
  ...readdirSync(path.join(ROOT, "src/scss/global"))
    .filter((f) => f.startsWith("_component-") && f.endsWith(".scss"))
    .map((f) => `src/scss/global/${f}`),
];

// Same condition the generator's parseCapabilityBlocks() accepts: the tag with
// content, inside a comment line — a bare mention of "@capability" in prose
// does not count as a header.
const hasHeader = (relPath) => /(?:\*|\/\/)\s*@capability\s+\S/.test(readFileSync(path.join(ROOT, relPath), "utf8"));

const missing = targets.filter((f) => !hasHeader(f)).sort();

if (process.argv.includes("--baseline")) {
  writeFileSync(BASELINE_PATH, JSON.stringify(missing, null, 2) + "\n");
  console.log(`Baseline written: ${missing.length} grandfathered files → .capability-headers-baseline.json`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error("No .capability-headers-baseline.json — run `yarn check-capability-headers:baseline` once and commit it.");
  process.exit(1);
}

const offenders = missing.filter((f) => !baseline.includes(f));

if (offenders.length > 0) {
  console.error(`✗ ${offenders.length} new file(s) missing a @capability header (required so PROJECT-MAP §0 lists them for reuse):\n`);
  for (const f of offenders) console.error(`  ${f}`);
  console.error(
    "\nAdd a @capability doc block at the top (format: the create-js-component / create-scss-module skill templates, or copy src/js/modules/swipe-component.js / src/scss/global/_component-edge-shadows.scss), then re-run."
  );
  process.exit(1);
}

const healed = baseline.filter((f) => !missing.includes(f));
if (healed.length > 0) {
  console.log(`✓ No new files missing @capability headers (${missing.length} grandfathered). ${healed.length} baselined file(s) gained headers — run \`yarn check-capability-headers:baseline\` to shrink the baseline.`);
} else {
  console.log(`✓ No new files missing @capability headers (${missing.length} grandfathered in baseline).`);
}
