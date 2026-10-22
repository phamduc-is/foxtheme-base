#!/usr/bin/env node
// Flag runtime values interpolated into a CSS selector string without escaping.
//
// Origin: PR #174 review (carousel-centered-slider). The code rebuilt Swiper's
// own bullet selector as `` `.${bulletClass}` ``. Swiper never does that — it
// goes through `classesToSelector()`, which turns a multi-class value into
// `.a.b` and escapes `. : ! + / ( ) [ ]`. A theme that sets a custom
// `bulletClass` therefore gets a SyntaxError thrown out of `closest()` on every
// pagination click, from a line that reads as obviously correct.
//
// Two failure shapes, both invisible to every other check:
//   `.${x}`            class position — `x = "a b"` silently matches nothing,
//                      `x = "a.b"` throws. CSS.escape does NOT fix this (it
//                      escapes the space instead of splitting on it); the fix is
//                      classList.contains(), or the library's own selector helper.
//   `[data-x="${y}"]`  attribute position — a quote or backslash in `y` breaks
//                      out of the selector. CSS.escape(y) fixes it, and two call
//                      sites in this repo already do exactly that.
//
// Scope: hand-written modules only. `src/js/modules/<n>.js` that has a matching
// `src/js/library/<n>.js` is vite build output (see CLAUDE.md) and is skipped —
// the vendor source is not ours to fix, and editing the output is already wrong.
//
// Ratcheted like check-js-contract: existing sites are baselined, only NEW ones
// fail. Suppress one line with `// selector-interp-disable-next-line`.
//
// Usage:
//   yarn check-selector-interp            # fail on NEW violations only
//   yarn check-selector-interp:strict     # report every violation, baselined or not
//   yarn check-selector-interp:baseline   # re-record the baseline after a cleanup

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src/js/modules", "src/js/global"];
const LIBRARY_DIR = path.join(ROOT, "src/js/library");
const BASELINE_FILE = path.join(ROOT, ".selector-interp-baseline.json");

// DOM APIs whose first argument is parsed as a CSS selector.
const SELECTOR_CALL_RE = /\b(?:querySelectorAll|querySelector|closest|matches)\s*\(\s*`/g;

const DISABLE_COMMENT = "selector-interp-disable-next-line";

/** Basenames that are vite output of a src/js/library/ source — not hand-written. */
function buildOutputNames() {
  if (!fs.existsSync(LIBRARY_DIR)) return new Set();
  return new Set(fs.readdirSync(LIBRARY_DIR).filter((f) => f.endsWith(".js")));
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) yield* walk(p);
    else if (entry.endsWith(".js")) yield p;
  }
}

/**
 * Read the `${...}` expression starting at `text[i]` (the `$`).
 * Returns { expr, end } where `end` is the index just past the closing `}`,
 * or null if the braces never balance (malformed / too exotic — we skip it).
 */
function readInterpolation(text, i) {
  let depth = 0;
  let j = i + 1; // at `{`
  const start = i + 2;
  let quote = null;
  for (; j < text.length; j++) {
    const ch = text[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { expr: text.slice(start, j), end: j + 1 };
    }
  }
  return null;
}

/**
 * Walk the template literal that opens at `text[open]` (the backtick).
 * Returns the list of interpolations with the literal character preceding each,
 * or null if the literal is unterminated.
 */
function readTemplateLiteral(text, open) {
  const parts = [];
  let prevChar = "";
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      prevChar = text[i + 1] ?? "";
      i++;
      continue;
    }
    if (ch === "`") return parts;
    if (ch === "$" && text[i + 1] === "{") {
      const interp = readInterpolation(text, i);
      if (!interp) return null;
      parts.push({ expr: interp.expr, prevChar, index: i });
      prevChar = "";
      i = interp.end - 1;
      continue;
    }
    prevChar = ch;
  }
  return null;
}

const isEscaped = (expr) => /^\s*CSS\.escape\s*\(/.test(expr) && /\)\s*$/.test(expr);

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

function findViolations() {
  const violations = [];
  const skip = buildOutputNames();

  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      if (skip.has(path.basename(file))) continue;

      const text = fs.readFileSync(file, "utf8");
      const lines = text.split("\n");
      const rel = path.relative(ROOT, file);

      SELECTOR_CALL_RE.lastIndex = 0;
      let m;
      while ((m = SELECTOR_CALL_RE.exec(text)) !== null) {
        const backtick = m.index + m[0].length - 1;
        const parts = readTemplateLiteral(text, backtick);
        if (!parts) continue;

        for (const part of parts) {
          if (isEscaped(part.expr)) continue;
          const line = lineOf(text, part.index);
          if (lines[line - 2]?.includes(DISABLE_COMMENT)) continue;

          violations.push({
            file: rel,
            line,
            // A `.` immediately before the interpolation puts the value in class
            // position, where escaping alone is not the right fix.
            kind: part.prevChar === "." ? "class" : "unescaped",
            expr: part.expr.trim(),
            source: lines[line - 1].trim(),
          });
        }
      }
    }
  }
  return violations;
}

// Line-independent so the baseline survives edits above the call site.
const key = (v) => `${v.file}::${v.kind}::${v.expr.replace(/\s+/g, "")}`;

const ADVICE = {
  class:
    "value lands in class position — CSS.escape() is not enough (a multi-class value must be split, not escaped).\n" +
    "      Use element.classList.contains(value), or the library's own selector helper (e.g. Swiper's classesToSelector).",
  unescaped: "wrap the interpolation in CSS.escape() — see product-finder.js / product-bundle.js for the pattern.",
};

function main() {
  const mode = process.argv[2]; // --baseline | --strict | undefined (ratchet)
  const violations = findViolations();

  if (mode === "--baseline") {
    const baseline = violations.map((v) => ({ file: v.file, kind: v.kind, expr: v.expr }));
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`Wrote ${baseline.length} entries to ${path.relative(ROOT, BASELINE_FILE)}`);
    return;
  }

  let toReport = violations;
  let baselined = 0;
  if (mode !== "--strict") {
    if (!fs.existsSync(BASELINE_FILE)) {
      console.error(
        `No baseline at ${path.relative(ROOT, BASELINE_FILE)}. Run \`yarn check-selector-interp:baseline\` first.`
      );
      process.exit(2);
    }
    const known = new Set(
      JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")).map((b) =>
        key({ file: b.file, kind: b.kind, expr: b.expr })
      )
    );
    toReport = violations.filter((v) => !known.has(key(v)));
    baselined = violations.length - toReport.length;
  }

  if (toReport.length === 0) {
    console.log(
      `✓ No${mode !== "--strict" ? " new" : ""} unescaped selector interpolations ` +
        `(${violations.length} total, ${baselined} in baseline).`
    );
    return;
  }

  console.error(`✗ ${toReport.length} unescaped selector interpolation(s):\n`);
  for (const v of toReport) {
    console.error(`  ${v.file}:${v.line}  [${v.kind}]  \${${v.expr}}`);
    console.error(`    > ${v.source}`);
    console.error(`      ${ADVICE[v.kind]}`);
    console.error("");
  }
  console.error(`Suppress a deliberate one with: // ${DISABLE_COMMENT}`);
  process.exit(1);
}

main();
