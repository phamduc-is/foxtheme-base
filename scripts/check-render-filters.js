#!/usr/bin/env node
// Fail on a Liquid FILTER inside a `{% render %}` / `{% content_for %}` argument.
//
//   {% render 'clamp-calculate-style', min_value: settings.pad | default: 20 %}
//                                                              ^^^^^^^^^^^^^
//
// A render tag's arguments accept only literals and plain variables. The parser
// stops at the pipe and raises `Liquid syntax error: Expected end_of_string but
// found pipe`, so the value has to be resolved BEFORE the tag:
//
//   {%- liquid
//     assign min_value = settings.pad | default: 20
//   -%}
//   {% render 'clamp-calculate-style', min_value: min_value %}
//
// Nothing else catches this. theme-check parses the tag happily and every yarn
// check stays green; the only signal is the theme UPLOAD, and even there it does
// not fail loudly — Shopify accepts the push, reports the error, and REWRITES the
// file server-side to something parseable (it turns `| default: 20` into a
// separate, unread `, default: 20` argument and appends a `{% comment %}`
// changelog). The stored theme then silently disagrees with the repo, the
// fallback is gone, and a later `shopify theme pull` imports the mangled version.
// A push only validates the files it actually uploads that run, so a file whose
// checksum has not changed is never re-checked — an invalid one can sit on a live
// theme for months without anyone seeing an error.
//
// `{% doc %}` blocks are scanned too, on purpose: an `@example` is copy-paste
// bait, and a wrong one manufactures this bug in the next file that reuses it.
//
// SCOPE — `render` and `content_for` only, established by experiment, not by the
// docs (shopify.dev documents neither tag's argument grammar). Pushed to a
// disposable unpublished theme:
//   render      + filter → rejected at upload, file rewritten server-side
//   content_for + filter → rejected: "Error in tag 'content_for 'block' - Valid
//                          syntax: {% content_for 'block', type: …, id: … %}"
//   content_for + an arbitrary NON-filter param (`foo: 1`) → accepted, so the
//                          error above is the pipe, not the extra argument
//   include     + filter → ACCEPTED, stored byte-identical, no rewrite
// `include` is therefore deliberately NOT checked: the deprecated tag parses its
// attributes differently, and flagging it would report code Shopify accepts.
//
// Usage:
//   yarn check-render-filters

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["sections", "blocks", "snippets", "layout", "templates"];
const TAGS = "render|content_for";

const TAG_RE = new RegExp(`\\{%-?\\s*(${TAGS})\\b([\\s\\S]*?)-?%\\}`, "g");
const LIQUID_RE = /\{%-?\s*liquid\b([\s\S]*?)-?%\}/g;
const LIQUID_LINE_RE = new RegExp(`^\\s*(${TAGS})\\b(.*)$`);

/**
 * Index of the first `|` that is NOT inside a quoted string, or -1.
 * A pipe inside quotes is data (`name: 'a|b'`), not a filter.
 */
function unquotedPipe(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "|") {
      return i;
    }
  }
  return -1;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;
const oneLine = (text) => text.trim().replace(/\s+/g, " ");

function liquidFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".liquid"))
    .map((entry) => path.join(dir, entry.name));
}

const findings = [];
let scanned = 0;

for (const dir of DIRS) {
  for (const file of liquidFiles(dir)) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    scanned++;

    // Tag form — {% render 'name', arg: value %}, possibly across several lines.
    TAG_RE.lastIndex = 0;
    let match;
    while ((match = TAG_RE.exec(source))) {
      const pipe = unquotedPipe(match[2]);
      if (pipe === -1) continue;
      findings.push({
        file,
        line: lineOf(source, match.index),
        tag: match[1],
        code: oneLine(match[0]),
      });
    }

    // Same tags written inside a {% liquid %} block, one per line. Lines inside a
    // `comment … endcomment` are skipped — prose about the rule is not the rule.
    LIQUID_RE.lastIndex = 0;
    let block;
    while ((block = LIQUID_RE.exec(source))) {
      let offset = block.index + block[0].indexOf(block[1]);
      let inComment = false;
      for (const line of block[1].split("\n")) {
        const word = line.trim().split(/\s+/)[0];
        if (word === "comment") inComment = true;
        else if (word === "endcomment") inComment = false;
        else if (!inComment) {
          const call = line.match(LIQUID_LINE_RE);
          if (call && unquotedPipe(call[2]) !== -1) {
            findings.push({
              file,
              line: lineOf(source, offset),
              tag: call[1],
              code: oneLine(line),
            });
          }
        }
        offset += line.length + 1;
      }
    }
  }
}

if (!findings.length) {
  console.log(`✓ No filters in render arguments (${scanned} liquid files).`);
  process.exit(0);
}

console.error(`✖ ${findings.length} render argument(s) contain a filter — this fails at theme upload:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.code}`);
  console.error(`    fix:  assign the filtered value first, then pass the plain variable to ${f.tag}.\n`);
}
process.exit(1);
