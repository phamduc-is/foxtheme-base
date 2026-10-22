#!/usr/bin/env node
// Fail on a value-emitting snippet whose `{% doc %}` block leaks a leading newline.
//
// A `{% doc %}…{% enddoc %}` block renders nothing, but the newline AFTER
// `{% enddoc %}` is output — and the `{%- liquid` on the next line does NOT
// strip it across the doc boundary (measured on Shopify: `{% enddoc %}\n{%- liquid`
// → "\nvalue"; `{% enddoc -%}` → "value"). For a markup snippet that is harmless.
// For a snippet whose output is CAPTURED and used as a value it is not:
// `image-priority` returned "\neager,high", so `loading == 'eager'` in
// responsive-image was never true (every eager image at section index 2–3 fell
// to js mode, invisible to the preload scanner) and `<img loading="\nlazy">` is an
// invalid enum value the browser treats as eager — lazy loading silently off on
// every direct image_tag consumer.
//
// Rule: a snippet that opens with a doc block AND whose body is a `{% liquid %}`
// tag that `echo`es (the shape of every helper whose output is captured) must
// close the doc block with `{% enddoc -%}` (or `{%- enddoc -%}`). Markup snippets
// are not held to it.
//
// Usage:
//   yarn check-doc-newline

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "snippets");
const problems = [];

for (const file of fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".liquid"))
  .sort()) {
  const source = fs.readFileSync(path.join(dir, file), "utf8");
  const doc = source.match(/^\s*\{%-?\s*doc\s*-?%\}[\s\S]*?\{%-?\s*enddoc\s*(-?)%\}/);
  if (!doc) continue;
  const rest = source.slice(doc[0].length);
  const body = rest.replace(/^\s+/, "");
  const isValueSnippet = /^\{%-?\s*liquid\b/.test(body) && /^\s*echo\b/m.test(body.slice(0, 6000));
  if (!isValueSnippet) continue;
  const leaks = doc[1] !== "-" && /^\s/.test(rest);
  if (leaks) problems.push(file);
}

if (problems.length) {
  console.error(`✗ ${problems.length} value snippet(s) leak a leading newline from their doc block:\n`);
  for (const file of problems) console.error(`  snippets/${file}`);
  console.error(`\n  Close the block with \`{% enddoc -%}\` — a captured "\\nvalue" never equals 'value',`);
  console.error(`  and as an enum attribute (loading="\\nlazy") the browser ignores it.`);
  process.exit(1);
}
console.log("✓ doc blocks: no value snippet leaks a leading newline.");
