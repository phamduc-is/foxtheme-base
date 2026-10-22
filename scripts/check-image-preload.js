#!/usr/bin/env node
// Fail on any image Link-header preload: `preload:` passed to `image_tag` or to
// `{% render 'responsive-image' %}` (anything but a literal `false`).
//
//   {% render 'responsive-image', …, preload: true %}
//   {{ image | image_url: … | image_tag: preload: true, widths: '…' }}
//
// `image_tag preload: true` asks Shopify to add `<url>; as=image; imagesrcset=…;
// imagesizes=…` to the response's Link header (and its 103 Early Hints). For a
// responsive image that entry is a liability, not a hint:
//
//   1. Chrome evaluates the Link-header `imagesizes` BEFORE the document exists,
//      against the 980px default layout viewport — <meta viewport> has not been
//      parsed yet. On a phone the preload therefore picks the DESKTOP candidate
//      (measured: width=1600, 30 KB, priority Low) and the <img> then fetches the
//      right one (width=640, 12 KB) on top. Two downloads, the first never painted.
//      LCP did not move (real Chrome, Slow 4G, fresh cache: 2140 vs 2084 ms without
//      the preload). Chrome's Early Hints doc says as much: "Preloading responsive
//      images (using imagesrcset, imagesizes or media) may not be supported using
//      HTTP Link … the viewport is not defined until the document is created."
//   2. The entry carries no `fetchpriority`, so it runs at Low and is never
//      upgraded when the `<img fetchpriority="high">` matches it.
//   3. It is added LAST to a Link header Shopify caps at ~2048 bytes, so it also
//      silently disappears whenever the filename is long — which made the whole
//      thing look like it "worked" on short-named demo files only.
//
// The <img> with loading="eager" fetchpriority="high" in server-rendered HTML is the
// right requester (that is what `image-priority` already arranges). Shopify's own
// Horizon theme preloads stylesheets only, never images. A preload is only safe
// when `sizes` is a fixed px value; the theme has no such call, so the rule is
// simply "none".
//
// `{% doc %}` blocks are skipped (prose, not code). `snippets/responsive-image.liquid`
// no longer forwards `preload` to image_tag — this check keeps it that way.
//
// Usage:
//   yarn check-image-preload

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["sections", "blocks", "snippets", "layout"];

const DOC_RE = /\{%-?\s*doc\s*-?%\}[\s\S]*?\{%-?\s*enddoc\s*-?%\}/g;
const RENDER_RE = /\{%-?\s*render\s+'responsive-image'\s*,([\s\S]*?)-?%\}/g;
const IMAGE_TAG_RE = /\{\{-?(?:(?!\}\})[\s\S])*?\|\s*image_tag\s*:([\s\S]*?)-?\}\}/g;

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

/** Named arguments of a tag/filter call — `a: 1, b: 'x'` → { a: "1", b: "'x'" }. Quotes-aware. */
function namedArgs(text) {
  const args = {};
  let key = "";
  let value = "";
  let quote = null;
  let inValue = false;
  const flush = () => {
    if (key.trim()) args[key.trim()] = value.trim();
    key = "";
    value = "";
    inValue = false;
  };
  for (const ch of text) {
    if (quote) {
      value += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      value += ch;
    } else if (ch === ",") {
      flush();
    } else if (ch === ":" && !inValue) {
      inValue = true;
    } else if (inValue) {
      value += ch;
    } else {
      key += ch;
    }
  }
  flush();
  return args;
}

const findings = [];
let scanned = 0;

for (const dir of DIRS) {
  for (const file of liquidFiles(dir)) {
    const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
    const source = raw.replace(DOC_RE, (doc) => doc.replace(/[^\n]/g, " "));
    scanned++;
    for (const [re, kind] of [
      [RENDER_RE, "responsive-image"],
      [IMAGE_TAG_RE, "image_tag"],
    ]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(source))) {
        const args = namedArgs(match[1]);
        if (!("preload" in args) || args.preload === "false") continue;
        findings.push({
          file,
          line: lineOf(source, match.index),
          kind,
          code: oneLine(match[0]).slice(0, 110),
          value: args.preload,
        });
      }
    }
  }
}

if (!findings.length) {
  console.log(`✓ No image Link preloads (${scanned} liquid files).`);
  process.exit(0);
}

console.error(
  `✖ ${findings.length} image preload(s) — a responsive Link-header preload fetches the wrong candidate on phones and never paints:\n`
);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  (${f.kind}, preload: ${f.value})`);
  console.error(`    ${f.code}`);
  console.error(
    `    fix:  drop the preload — keep loading="eager" fetchpriority="high" on the <img> (image-priority) and let it request the image.\n`
  );
}
process.exit(1);
