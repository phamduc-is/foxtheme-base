#!/usr/bin/env node
// Enforce JS contract from CLAUDE.md:
// src/js/modules/*.js phải truy cập DOM qua ref="name", data-*, hoặc custom
// element tag — không dùng class selector.
//
// Allowed exceptions:
//   - State / utility classes (hidden, is-*, has-*, disabled, active, etc)
//   - Shopify platform classes (.shopify-*)
//   - Vendor / third-party libraries bundled vào modules/ (allowlist VENDOR_FILES)
//
// Suppress per-line: precede with comment `// js-contract-disable-next-line`.
//
// Usage:
//   yarn check-js-contract             # report violations, exit 1 if any
//   yarn check-js-contract --baseline  # write current violations to baseline file
//   yarn check-js-contract --diff      # only report violations NOT in baseline

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(ROOT, "src/js/modules");
const BASELINE_FILE = path.join(ROOT, ".js-contract-baseline.json");

// Files allowlisted entirely (vendor libs bundled into modules/)
const VENDOR_FILES = new Set([
  "swiper.js",
  // add more vendor files here if any
]);

// Class selector patterns allowed (state, platform, framework-injected)
const ALLOWED_PATTERNS = [
  /^\.hidden$/,
  /^\.disabled$/,
  /^\.active$/,
  /^\.open$/,
  /^\.focused$/,
  /^\.loading$/,
  /^\.is-[\w-]+$/,
  /^\.has-[\w-]+$/,
  /^\.shopify-[\w-]+$/,
  /^\.swiper-[\w-]+$/, // Swiper auto-injects these classes
];

// Match `.querySelector('...')` / `.querySelectorAll("...")` / template literal
// Captures: quote char + selector string
const QS_RE = /\bquerySelector(?:All)?\s*\(\s*(['"`])((?:(?!\1).)*)\1/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = fs.statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (entry.endsWith(".js")) yield p;
  }
}

function isAllowed(selector) {
  // Must start with `.` to be a class selector. If not, ignore (handled by caller).
  return ALLOWED_PATTERNS.some((re) => re.test(selector));
}

function findViolations() {
  const violations = [];
  for (const file of walk(MODULE_DIR)) {
    const filename = path.basename(file);
    if (VENDOR_FILES.has(filename)) continue;

    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    const relPath = path.relative(ROOT, file);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (lines[i - 1]?.includes("js-contract-disable-next-line")) continue;

      // Reset regex state for each line
      QS_RE.lastIndex = 0;
      let m;
      while ((m = QS_RE.exec(line)) !== null) {
        const selector = m[2];
        // Only flag selectors starting with `.` (class)
        // Also flag selectors with embedded `.foo` after combinators (basic check)
        const classMatch = selector.match(/(?:^|[\s>+~,])(\.[\w-]+)/);
        if (!classMatch) continue;

        // Check ALL class tokens in the selector against allowlist
        const classTokens = Array.from(selector.matchAll(/(?:^|[\s>+~,])(\.[\w-]+)/g)).map((x) => x[1]);
        const violatingClasses = classTokens.filter((c) => !isAllowed(c));
        if (violatingClasses.length === 0) continue;

        violations.push({
          file: relPath,
          line: i + 1,
          selector,
          violatingClasses,
          source: line.trim(),
        });
      }
    }
  }
  return violations;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

function violationKey(v) {
  return `${v.file}:${v.violatingClasses.join(",")}`;
}

function main() {
  const args = process.argv.slice(2);
  const mode = args[0]; // --baseline | --diff | undefined (strict)

  const violations = findViolations();

  if (mode === "--baseline") {
    const baseline = violations.map((v) => ({ file: v.file, classes: v.violatingClasses }));
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`Wrote ${baseline.length} entries to ${path.relative(ROOT, BASELINE_FILE)}`);
    return;
  }

  let toReport = violations;
  if (mode === "--diff") {
    const baseline = loadBaseline();
    if (!baseline) {
      console.error(`No baseline file at ${path.relative(ROOT, BASELINE_FILE)}. Run with --baseline first.`);
      process.exit(2);
    }
    const baselineKeys = new Set(baseline.map((b) => `${b.file}:${b.classes.join(",")}`));
    toReport = violations.filter((v) => !baselineKeys.has(violationKey(v)));
  }

  if (toReport.length === 0) {
    console.log(
      `✓ No${mode === "--diff" ? " new" : ""} JS contract violations in src/js/modules/ (${violations.length} total, ${
        mode === "--diff" ? violations.length - toReport.length : 0
      } in baseline).`
    );
    return;
  }

  console.error(`✗ ${toReport.length} JS contract violation(s):\n`);
  for (const v of toReport) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    selector: ${v.selector}`);
    console.error(`    violating: ${v.violatingClasses.join(", ")}`);
    console.error(`    > ${v.source}`);
    console.error("");
  }
  console.error(`Use ref="name", data-*, or custom element tag instead.`);
  console.error(`See CLAUDE.md → JavaScript section. Suppress single line with: // js-contract-disable-next-line`);
  process.exit(1);
}

main();
