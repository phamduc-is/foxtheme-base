#!/usr/bin/env node
/**
 * Generates snippets/motion-prestage.liquid from the motion registry.
 *
 * The prestage rules and the runtime have to agree exactly on where every
 * animation starts — a mismatch is a visible jump on the first frame — so they
 * are not written twice. src/js/modules/motion-presets.js is the source; this
 * emits the CSS half of it.
 *
 * Run: yarn motion:build     Verify: yarn check-motion-prestage
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  listMotionPresets,
  motionCssFrom,
  getMotionPreset,
  motionPresetForViewport,
  MOBILE_MAX_WIDTH,
} from "../src/js/modules/motion-presets.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../snippets/motion-prestage.liquid");

const header = `{% comment %}
  GENERATED FILE — do not edit.

  Source: src/js/modules/motion-presets.js
  Rebuild: yarn motion:build

  The start state of every motion preset, as CSS, so content is already hidden
  at first paint instead of flashing once the runtime arrives. Rendered inside
  critical-css.liquid's <style>.

  Every rule is gated on \`data-motion-armed\`, which motion-boot.liquid sets and
  takes back if the runtime never reports in — hiding content is only safe while
  something is guaranteed to un-hide it.
{% endcomment %}
`;

const lines = [header.trimEnd(), "@media (prefers-reduced-motion: no-preference) {"];

// Neutralisers first, so a disabled scope wins wherever it appears.
lines.push(
  "  [data-motion-disabled] motion-component:not([data-initialized]),",
  "  [data-motion-disabled] [data-motion-from],",
  "  motion-component[data-motion-off]:not([data-initialized]) {",
  "    visibility: visible !important;",
  "    opacity: 1 !important;",
  "    transform: none !important;",
  "    will-change: auto !important;",
  "  }",
  "  [data-motion-disabled] div[is='motion-group'],",
  "  div[is='motion-group'][data-motion-off] {",
  "    opacity: 1 !important;",
  "  }",
  // The rule above lifts the GROUP. A cell staged inside it is a separate
  // element at opacity 0, and opacity on a parent does not raise a child, so
  // switching a group off after its cells were staged would leave the grid
  // invisible with no code path back.
  "  [data-motion-off] [data-motion-from],",
  "  [data-motion-from][data-motion-off] {",
  "    opacity: 1 !important;",
  "    transform: none !important;",
  "  }"
);

// A group hides as a whole until its JS has written per-cell start styles.
// `data-motion-builtins` is the extra gate: the group is a customized built-in,
// so on a browser that cannot upgrade it the flag is absent and this never
// matches.
lines.push(
  "  [data-motion-armed][data-motion-builtins] div[is='motion-group']:not([data-motion-ready]) {",
  "    opacity: 0;",
  "  }"
);

// will-change only while an entrance is actually pending.
lines.push(
  // Deliberately NOT extended to `[data-motion-from]`. A group clears the hint
  // on each staged cell on purpose — "no layer for a cell that is not
  // animating", motion-group.js — and a stylesheet rule would re-impose it, so
  // a 24-card grid below the fold would hold 24 promoted layers from first
  // paint. #enter() sets the hint inline, per property, on what is about to run.
  "  [data-motion-armed] motion-component:not([data-initialized]):not([data-motion-hold]) {",
  "    will-change: transform, opacity;",
  "  }",
  "  motion-component[data-initialized] {",
  "    will-change: auto;",
  "  }"
);

for (const preset of listMotionPresets()) {
  const declarations = motionCssFrom(preset);
  if (!declarations.length) continue;

  // Two ways in, one declaration block — which is the point. `data-motion-from`
  // is written by the runtime onto whatever is about to animate (a group's
  // cells, a component being replayed); the motion-component selector covers
  // first paint, where no script has run yet to write anything.
  //
  // Both resolve `var(--motion-distance)` against the ELEMENT, so a section that
  // scopes the token gets the same start state from the stylesheet and from the
  // animation. The runtime no longer computes that start state at all.
  //
  // A HELD element (`data-motion-hold`) is on this rule too. Hold means "stay in
  // the start state until a host calls replay()" — the slideshow holds its slide
  // images and replays the active one once Swiper is ready, after the page
  // transition. Excluding it here painted the image at its natural size first,
  // and the replay then snapped it to scale(1.15) before easing back (measured:
  // 500ms of the finished image, a jump, then the entrance). Only the
  // will-change rule above leaves held elements out: no layer for a start state
  // nothing is animating yet.
  const selector =
    `  [data-motion-armed] motion-component:not([data-initialized])` +
    `[data-motion='${preset.name}'],\n` +
    `  [data-motion-armed] [data-motion-from='${preset.name}'] {`;

  lines.push(selector, ...declarations.map((d) => `    ${d}`), "  }");
}

lines.push("}");

// Small-screen step-down. The runtime applies motionPresetForViewport() at the
// same breakpoint, so the start state the CSS paints and the one the animation
// tweens from cannot disagree — a mismatch here is a visible jump on frame one.
const degraded = listMotionPresets().filter((preset) => motionPresetForViewport(preset.name, true) !== preset.name);

if (degraded.length) {
  lines.push("", `@media (prefers-reduced-motion: no-preference) and (max-width: ${MOBILE_MAX_WIDTH}px) {`);

  for (const preset of degraded) {
    const fallback = getMotionPreset(motionPresetForViewport(preset.name, true));
    const declarations = motionCssFrom(fallback);

    lines.push(
      // Only the motion-component branch keys on the ORIGINAL name here: that
      // element carries `data-motion` as authored. `data-motion-from` is written
      // by the runtime, which resolves the viewport fallback first, so on mobile
      // it already holds the fallback's name and lands on that preset's own rule
      // in the block above. Emitting the original name here would be a selector
      // that can never match.
      `  [data-motion-armed] motion-component:not([data-initialized])` + `[data-motion='${preset.name}'] {`,
      "    transform: none;",
      ...declarations.map((d) => `    ${d}`),
      "  }"
    );
  }

  lines.push("}");
}

lines.push("");

const output = lines.join("\n");
const previous = (() => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return null;
  }
})();

if (process.argv.includes("--check")) {
  if (previous !== output) {
    console.error("✗ snippets/motion-prestage.liquid is stale — run `yarn motion:build`.");
    process.exit(1);
  }
  console.log("✓ motion prestage CSS matches the registry.");
} else {
  writeFileSync(OUT, output);
  console.log(`✓ wrote snippets/motion-prestage.liquid (${listMotionPresets().length} presets)`);
}
