#!/usr/bin/env node
/**
 * An opacity transition must run on one of the theme's easing TOKENS (or
 * linear / steps), never on a curve written inline.
 *
 * Which curve is right depends on what the fade belongs to: an opacity change
 * that accompanies a movement rides that movement's curve, so the two stay in
 * step; a transition that only trades opacity between two stacked layers stays
 * on --motion-ease-fade (linear), so the blend midpoint does not move. Both are
 * decisions the token layer makes in one place (css-variables.liquid). What
 * this check stops is a literal cubic-bezier() on opacity — a curve nobody can
 * re-tune, that drifts from the rest of the theme.
 *
 * Only DECLARED easings are checked. A transition that leaves the timing
 * function to the browser default is out of scope: adding one would change the
 * other properties in the same declaration too.
 *
 * Run: yarn check-motion-easing
 */
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src/scss");
const LINEAR = new Set(["linear", "steps", "step-start", "step-end"]);

// A theme easing token: --motion-ease-*, or a component's own *-ease token.
const isEasingToken = (value) => /^var\(--[\w-]*ease[\w-]*\)$/.test(value);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith(".scss")) out.push(path);
  }
  return out;
}

/**
 * A component may route its easing through a local variable
 * (`--tooltip-backdrop-easing: var(--motion-ease-fade)`). Resolve one hop
 * within the same file before judging, or every such indirection reads as a
 * violation even when it points at the right curve.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function localCustomProperties(text) {
  const map = new Map();
  for (const match of text.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    if (!map.has(match[1])) map.set(match[1], match[2].trim());
  }
  return map;
}

const isLinear = (value, locals = new Map()) => {
  const trimmed = value.trim();
  if (LINEAR.has(trimmed) || trimmed.startsWith("steps(") || isEasingToken(trimmed)) return true;

  const local = trimmed.match(/^var\((--[\w-]+)/);
  if (local && locals.has(local[1])) {
    const resolved = locals.get(local[1]);
    // One hop only — deeper chains are rare and worth flagging for a human.
    return LINEAR.has(resolved) || resolved.startsWith("steps(") || isEasingToken(resolved);
  }

  return false;
};

const problems = [];
let checked = 0;

// Shorthand: `transition: opacity <duration> <easing>`. The duration is almost
// always a token here, so it has to accept `var(--motion-ui)` and not just
// `0.35s` — the first version of this check only matched literal durations,
// which meant it passed a deliberately broken probe.
const DURATION = String.raw`(?:var\([^)]*\)|[\d.]+m?s)`;
const SHORTHAND = new RegExp(String.raw`\bopacity\s+${DURATION}\s+([^;,{}]+)`);

/**
 * Blank out comments while keeping every other character where it was, so
 * offsets still map to the right line. Comments talk ABOUT opacity transitions
 * all the time — the first run of this check failed on a @capability header
 * explaining that a component animates opacity from JS.
 *
 * @param {string} text
 * @returns {string}
 */
function maskComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const locals = localCustomProperties(text);

  // Scanned over the whole file rather than line by line. A declaration is not
  // a line: prettier wraps any transition list long enough to matter, and the
  // previous version required `transition:` and the property to share one, so
  // every wrapped declaration in the theme was invisible to it — fourteen of
  // them, three carrying real violations that this rule existed to catch.
  const masked = maskComments(text);
  const lines = text.split("\n");
  const report = (index, value) =>
    problems.push({
      file: relative(ROOT, file),
      line: lineAt(masked, index),
      value: value.trim(),
      text: lines[lineAt(masked, index) - 1].trim(),
    });

  for (const declaration of masked.matchAll(/\btransition\s*:\s*([^;{}]*);/g)) {
    const valueStart = declaration.index + declaration[0].indexOf(declaration[1]);
    let offset = 0;
    // One comma-separated entry at a time, so a multi-property shorthand is
    // examined per property.
    for (const entry of declaration[1].split(",")) {
      const shorthand = entry.match(SHORTHAND);
      if (shorthand) {
        checked += 1;
        if (!isLinear(shorthand[1], locals)) report(valueStart + offset + entry.indexOf("opacity"), shorthand[1]);
      }
      offset += entry.length + 1; // + the comma that split() removed
    }
  }

  // Longhand: a `transition-property` list containing opacity, paired with a
  // `transition-timing-function` that is a single value (a comma-matched list
  // is how a mixed declaration gets this right, and is accepted).
  for (const property of masked.matchAll(/\btransition-property\s*:\s*([^;{}]*);/g)) {
    if (!/\bopacity\b/.test(property[1])) continue;

    // The enclosing block, in both directions — the pair is written in either
    // order, and a fixed look-ahead of N lines missed the other one.
    const blockStart = masked.lastIndexOf("{", property.index) + 1;
    const blockEnd = masked.indexOf("}", property.index);
    const scope = masked.slice(blockStart, blockEnd === -1 ? masked.length : blockEnd);
    const timing = scope.match(/\btransition-timing-function\s*:\s*([^;{}]*);/);
    if (!timing) continue;

    const values = timing[1].split(",").map((v) => v.trim());
    const properties = property[1].split(",").map((v) => v.trim());
    checked += 1;

    if (values.length === 1) {
      if (!isLinear(values[0], locals)) report(blockStart + scope.indexOf(timing[0]), values[0]);
    } else {
      const paired = values[properties.indexOf("opacity")];
      if (paired && !isLinear(paired, locals)) report(blockStart + scope.indexOf(timing[0]), paired);
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} opacity transition(s) on an inline curve:\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}\n      ${p.text}\n      easing: ${p.value}`);
  }
  console.error(
    `\n  Use an easing token — var(--motion-ease-fade) for a crossfade, the movement's own token when it moves. For a mixed declaration, give`
  );
  console.error(`  transition-timing-function a comma list matched to transition-property.`);
  process.exit(1);
}

console.log(`✓ motion easing OK (${checked} opacity transitions, all on a token or linear).`);
