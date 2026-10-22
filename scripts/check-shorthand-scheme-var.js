#!/usr/bin/env node
// Fail when a colour-scheme variable is used inside a SHORTHAND property.
//
// `snippets/color-schemes.liquid` emits each scheme role as a custom property, and a role
// the merchant has not set (or has cleared) arrives EMPTY — `--color-border: ;` — not
// absent. An empty substitution is invalid at computed-value time, and IACVT throws away
// the whole DECLARATION it appears in. A shorthand IS one declaration, so:
//
//   border: 1px solid var(--tg-line-c)   →  border-style reverts to `none`  → no border at all
//   border-width / -style / -color       →  only border-color is dropped    → falls back to
//                                                                              currentcolor
//
// The longhand form degrades to a visible-but-wrong colour; the shorthand form makes the
// element silently stop existing. Neither theme-check nor stylelint sees the difference,
// and the default state of every shipped scheme hides it — this shipped once as guidance
// (create-scss-module SKILL.md) and the identical defect was written four days later.
//
// ⚠️ `yarn lint:css` is stylelint `--fix`, and `declaration-block-no-redundant-longhand-properties`
// collapses the longhand fix straight back into a shorthand. Wrap the longhands in
// `// stylelint-disable declaration-block-no-redundant-longhand-properties`.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIR = path.join(ROOT, "src", "scss");
const BASELINE = path.join(ROOT, ".shorthand-scheme-var-baseline.json");

// `--color-*` names that are NOT scheme roles. These are fixed literals declared once on
// :root in css-variables.liquid, not per-scheme output, so a merchant cannot clear them and
// they can never arrive empty — the whole premise of this rule. Without the exemption the
// check reads the prefix and reports a shorthand that is perfectly safe, which is how it
// first flagged `background: rgb(var(--carousel-nav-background, var(--color-white)))`.
// The 25 real roles are the ones snippets/color-schemes.liquid emits.
const FIXED_COLOURS = new Set(["--color-white", "--color-black"]);

// Shorthands that carry a colour AND have a longhand form to fall back to. box-shadow and
// text-shadow are deliberately absent: they have no longhand split, so the fix there is to
// stop the var from ever being empty (emit a literal in the Liquid), not to split it.
const SHORTHANDS = [
  "border",
  "border-top", "border-right", "border-bottom", "border-left",
  "border-block", "border-inline",
  "border-block-start", "border-block-end",
  "border-inline-start", "border-inline-end",
  "outline",
  "background",
  "column-rule",
  "text-decoration",
];

// The `m` flag plus a bound of `[^;{}]` lets a value WRAP across lines — Prettier splits any
// long `background:` / `border:` over several — while still stopping inside the rule it lives in.
// Scanning line by line, as this did, silently exempted every wrapped declaration: precisely the
// shape the rule exists to catch, since a long value is where a scheme role usually hides.
const DECL_RE = new RegExp(`^\\s*(${SHORTHANDS.join("|")})\\s*:\\s*([^;{}]*);`, "gm");
const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/** Strip `//` line comments and `/* *\/` blocks so commented-out code never trips the check. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

/** Custom properties assigned in this file whose value reaches a `--color-*` role. */
function localSchemeAliases(src) {
  const alias = new Set();
  const ASSIGN_RE = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*([^;]*);/gm;
  // Two passes so `--a: var(--b)` resolves when `--b: rgb(var(--color-x))` is declared later.
  for (let pass = 0; pass < 2; pass++) {
    let m;
    ASSIGN_RE.lastIndex = 0;
    while ((m = ASSIGN_RE.exec(src))) {
      const [, name, value] = m;
      if (/--color-/.test(value)) alias.add(name);
      else {
        let v;
        const refs = new RegExp(VAR_RE.source, "g");
        while ((v = refs.exec(value))) if (alias.has(v[1])) alias.add(name);
      }
    }
  }
  return alias;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith(".scss")) out.push(abs);
  }
  return out;
}

function main() {
  if (!fs.existsSync(SCAN_DIR)) {
    console.log("✓ no src/scss — nothing to check.");
    return;
  }

  const baseline = fs.existsSync(BASELINE)
    ? new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")))
    : new Set();

  const found = [];
  let declCount = 0;

  for (const abs of walk(SCAN_DIR)) {
    const rel = path.relative(ROOT, abs);
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    const aliases = localSchemeAliases(src);

    let m;
    DECL_RE.lastIndex = 0;
    while ((m = DECL_RE.exec(src))) {
      const [, prop, value] = m;
      declCount++;
      if (!value.includes("var(")) continue;

      const hits = [];
      let v;
      VAR_RE.lastIndex = 0;
      while ((v = VAR_RE.exec(value))) {
        const name = v[1];
        if (FIXED_COLOURS.has(name)) continue;
        if (name.startsWith("--color-") || aliases.has(name)) hits.push(name);
      }
      // Key on file + property + the roles used, NOT the line number: line numbers churn on
      // every unrelated edit, while file+prop alone is coarse enough to grandfather a genuinely
      // new violation that happens to reuse a property already baselined in that file.
      if (hits.length) {
        const key = `${rel}:${prop}:${[...new Set(hits)].sort().join("+")}`;
        found.push({ key, rel, line: src.slice(0, m.index).split("\n").length, prop, hits });
      }
    }
  }

  const fresh = found.filter((f) => !baseline.has(f.key));

  if (process.argv.includes("--baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify([...new Set(found.map((f) => f.key))].sort(), null, 2) + "\n");
    console.log(`✓ baseline written: ${found.length} existing violation(s) recorded in ${path.basename(BASELINE)}.`);
    return;
  }

  if (fresh.length === 0) {
    const note = baseline.size ? `, ${baseline.size} baselined` : "";
    console.log(`✓ no scheme-role var in a shorthand (${declCount} shorthand declarations scanned${note}).`);
    return;
  }

  console.error(`✗ ${fresh.length} scheme-role colour inside a shorthand:\n`);
  for (const f of fresh) {
    console.error(`  ${f.rel}:${f.line}  ${f.prop}: … ${f.hits.join(", ")}`);
  }
  console.error(
    "\nA scheme role the merchant has cleared arrives EMPTY, which is invalid at computed-value" +
      "\ntime and discards the WHOLE declaration — as a shorthand that also drops the `-style`," +
      "\nso the border/outline does not lose its colour, it stops existing." +
      "\n\nSplit into longhands (border-width / border-style / border-color) so only the colour is" +
      "\ndropped and it falls back to currentcolor. `snippets/border-style.liquid` already does this." +
      "\n⚠️ `yarn lint:css` is `--fix` and will collapse them back — wrap the longhands in" +
      "\n   `// stylelint-disable declaration-block-no-redundant-longhand-properties`," +
      "\n   and verify the BUILT assets/theme.css, not the source." +
      "\n\nTo grandfather pre-existing ones: yarn check-shorthand-scheme-var:baseline"
  );
  process.exit(1);
}

main();
