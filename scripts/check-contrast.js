#!/usr/bin/env node
// Fail when muted text drops below the WCAG AA contrast minimum.
//
// A scheme role carries a colour that WORKS against its own background — `--color-foreground`
// on `--color-background` is the scheme's whole contract. Fade it, though, and the guarantee
// goes with it: `color: rgb(var(--color-foreground) / 40%)` composites to something the scheme
// never promised, and the number it lands on depends on the merchant's background.
//
// This is invisible to every other tool we run. theme-check does not read SCSS; stylelint has
// no notion of what the variable resolves to; and the alpha reads as a deliberate design choice
// rather than a defect, so review waves it through. It shipped once as an inactive step label
// at 40%, measuring 2.81:1 on the default scheme — a link a merchant could not read — and was
// caught only by rendering the page and sampling the painted pixels.
//
// SCOPE — deliberately narrow, so a hit is worth acting on:
//
//   * Only `color:` that actually paints TEXT. A faded background or border degrades to a weak
//     edge; faded text is what the 4.5:1 rule is about. A `color` feeding `currentColor` for an
//     SVG stroke or fill is skipped automatically — see `paintsSvg` — because that is a graphic,
//     not text, and judging it as text is how you get a decorative ring reported as body copy.
//   * Only an ALPHA on a role. A role used at full strength is the scheme's own contract and
//     is not this check's business.
//   * Only the roles whose backdrop is knowable — `--color-foreground` and
//     `--color-foreground-secondary`, which by definition sit on `--color-background`. A faded
//     `--color-primary-button-text` sits on a button whose colour this script cannot infer from
//     source, and guessing would produce noise, so those are skipped rather than mis-judged.
//
// It therefore CANNOT see: text over an image or gradient, text on `background_secondary` or on
// a nested surface, or large text (WCAG allows 3:1 at 24px / 18.66px bold). Sub-threshold text
// that is genuinely exempt — placeholders, disabled controls — belongs in the baseline or behind
// the disable comment, with a reason.
//
// ADVISORY BY DEFAULT — this check reports, it does not gate. Unlike the other ratchets here, a
// value below the bar can be a deliberate design decision: a designer may want text quiet, and a
// script does not get to overrule that. So the default run always exits 0. The failing form is
// opt-in, for the one place the decision stops being ours — Shopify requires accessible contrast
// to pass Theme Store review, so /store-audit runs `--strict` before submission.
//
//   yarn check-contrast            report only, always exits 0
//   yarn check-contrast:strict     same report, exits 1 on anything not baselined
//   yarn check-contrast:baseline   grandfather what exists today
//   // check-contrast-disable-next-line   silence one line entirely (say why on the line above)
//
// Prefer the disable comment over the baseline for a deliberate one: it keeps the reason next to
// the value, where the next reader is, instead of in a JSON file nobody opens.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIR = path.join(ROOT, "src", "scss");
const SETTINGS = path.join(ROOT, "config", "settings_data.json");
const BASELINE = path.join(ROOT, ".contrast-baseline.json");

// WCAG 2.1 AA, normal-size text. Large text is 3:1, but a stylesheet does not tell us the
// rendered size, so the stricter number is the safe default and the escape hatch is explicit.
const MIN_RATIO = 4.5;

// Roles that ARE the scheme's text-on-background pair. See SCOPE above for why the list stops here.
const TEXT_ROLES = { "--color-foreground": "foreground", "--color-foreground-secondary": "foreground_secondary" };

const DISABLE = "check-contrast-disable-next-line";

/** `#rgb`, `#rrggbb`, `#rrggbbaa` → [r, g, b, a]. */
function parseHex(hex) {
  let h = String(hex || "")
    .trim()
    .replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

/** WCAG relative luminance. */
function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Composite `fg` at `alpha` over the opaque `bg` — what the eye actually receives. */
function over(fg, bg, alpha) {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
}

/** The shipped schemes, as { id, background, roleName → rgba }. Shopify allows a `/* *\/` preamble. */
function loadSchemes() {
  if (!fs.existsSync(SETTINGS)) return [];
  const raw = fs.readFileSync(SETTINGS, "utf8").replace(/^\s*\/\*[\s\S]*?\*\//, "");
  const schemes = JSON.parse(raw).current?.color_schemes ?? {};
  const out = [];
  for (const [id, scheme] of Object.entries(schemes)) {
    const s = scheme.settings ?? {};
    const bg = parseHex(s.background);
    if (!bg) continue;
    out.push({ id, bg, roles: s });
  }
  return out;
}

/** Strip `//` line comments and `/* *\/` blocks, preserving line count so numbers stay true. */
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith(".scss")) out.push(abs);
  }
  return out;
}

// `m` + a `[^;{}]` bound so a value Prettier wrapped across lines is still seen — the same trap
// check-shorthand-scheme-var walked into by matching one line at a time.
const DECL_RE = /^\s*color\s*:\s*([^;{}]*);/gm;
const ALPHA_RE = /rgba?\(\s*var\(\s*(--color-[A-Za-z0-9_-]+)\s*\)\s*\/\s*([\d.]+)%/;

// `color` is not always text. On an SVG it feeds `currentColor` for a stroke or a fill, which
// makes it a GRAPHIC — WCAG 1.4.3 does not apply, and 1.4.11's 3:1 for non-text is a different
// test this script does not run. Judging those as text produces confident, wrong findings: a
// decorative dashed ring at 20% reported as unreadable body copy. Detect the shape rather than
// asking every author to remember a disable comment.
const SVG_EL = /(^|[\s,>+~])(svg|circle|path|rect|polyline|polygon|ellipse)\b/;
const SVG_PROP =
  /(^|[\s;{])(stroke|stroke-width|stroke-dasharray|stroke-dashoffset|stroke-linecap|stroke-linejoin|fill|vector-effect)\s*:/;

/** The rule containing `idx`: its selector, and its whole body including nested blocks. */
function enclosingRule(src, idx) {
  let depth = 0;
  let open = -1;
  for (let i = idx; i >= 0; i--) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open < 0) return null;

  let sel = open - 1;
  while (sel >= 0 && !"{};".includes(src[sel])) sel--;

  let d = 1;
  let close = open + 1;
  for (; close < src.length && d > 0; close++) {
    if (src[close] === "{") d++;
    else if (src[close] === "}") d--;
  }
  return { selector: src.slice(sel + 1, open).trim(), body: src.slice(open + 1, close - 1) };
}

/**
 * True when this `color` is painting SVG rather than text — either the rule targets an SVG
 * element, or it (or a block nested inside it) sets an SVG paint property. The nested case is
 * the common one: the colour sits on a wrapper and a `circle {}` inside consumes it.
 */
const paintsSvg = (rule) => !!rule && (SVG_EL.test(rule.selector) || SVG_PROP.test(rule.body));

function main() {
  if (!fs.existsSync(SCAN_DIR)) {
    console.log("✓ no src/scss — nothing to check.");
    return;
  }
  const schemes = loadSchemes();
  if (schemes.length === 0) {
    console.log("✓ no colour schemes in config/settings_data.json — nothing to measure against.");
    return;
  }

  const baseline = fs.existsSync(BASELINE) ? new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8"))) : new Set();
  const found = [];
  let checked = 0;

  for (const abs of walk(SCAN_DIR)) {
    const rel = path.relative(ROOT, abs);
    const src = stripBlockComments(fs.readFileSync(abs, "utf8"));
    const lines = src.split("\n");

    let m;
    DECL_RE.lastIndex = 0;
    while ((m = DECL_RE.exec(src))) {
      const hit = ALPHA_RE.exec(m[1]);
      if (!hit) continue;
      const [, role, pct] = hit;
      const roleKey = TEXT_ROLES[role];
      if (!roleKey) continue;
      if (paintsSvg(enclosingRule(src, m.index))) continue;

      const line = src.slice(0, m.index).split("\n").length;
      if ((lines[line - 2] ?? "").includes(DISABLE)) continue;

      const alpha = Number(pct) / 100;
      checked++;

      let worst = null;
      for (const scheme of schemes) {
        const fg = parseHex(scheme.roles[roleKey]);
        if (!fg) continue;
        // A role can itself carry alpha (#000000b3); fold it in before the declaration's own.
        const base = over(fg, scheme.bg, fg[3]);
        const ratio = contrast(over(base, scheme.bg, alpha), scheme.bg);
        if (!worst || ratio < worst.ratio) worst = { ratio, scheme: scheme.id };
      }
      if (!worst || worst.ratio >= MIN_RATIO) continue;

      // Key on file + role + alpha, not the line: line numbers churn on every unrelated edit,
      // while changing the alpha is exactly the edit that should re-open the question.
      found.push({ key: `${rel}:${role}:${pct}%`, rel, line, role, pct, ...worst });
    }
  }

  if (process.argv.includes("--baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify([...new Set(found.map((f) => f.key))].sort(), null, 2) + "\n");
    console.log(`✓ baseline written: ${found.length} existing value(s) recorded in ${path.basename(BASELINE)}.`);
    return;
  }

  const fresh = found.filter((f) => !baseline.has(f.key));
  if (fresh.length === 0) {
    const note = baseline.size ? `, ${baseline.size} baselined` : "";
    console.log(
      `✓ faded text meets AA (${checked} alpha'd text colour(s) measured across ${schemes.length} scheme(s)${note}).`
    );
    return;
  }

  const strict = process.argv.includes("--strict");
  const log = strict ? console.error : console.warn;

  log(`${strict ? "✗" : "⚠"} ${fresh.length} faded text colour(s) below ${MIN_RATIO}:1:\n`);
  for (const f of fresh) {
    log(`  ${f.rel}:${f.line}  ${f.role} / ${f.pct}%  →  ${f.ratio.toFixed(2)}:1 on ${f.scheme}`);
  }
  log(
    `\nWCAG AA wants ${MIN_RATIO}:1 for normal text. A role faded with an alpha no longer carries the` +
      "\nscheme's contrast guarantee — the number depends on the merchant's background." +
      "\n\nRaise the alpha until the WORST scheme clears the bar, and re-measure rather than guessing:" +
      "\nthe step from failing to passing is often only 5-10 percentage points." +
      "\n\nIf a value is a deliberate design decision, or the text is exempt — a placeholder, a disabled" +
      "\ncontrol, or text WCAG counts as large (24px, or 18.66px bold) — say so on the line above and" +
      "\nopt it out, so the reason lives next to the value:" +
      `\n   // ${DISABLE}` +
      "\n\nTo grandfather everything that exists today: yarn check-contrast:baseline"
  );

  // Advisory unless asked to gate: a designer's call is not a script's to overrule. /store-audit
  // runs --strict, where the standard stops being ours and becomes Shopify's review requirement.
  if (strict) process.exit(1);
  log("\nReporting only — run `yarn check-contrast:strict` to fail on these.");
}

main();
