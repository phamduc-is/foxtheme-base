/**
 * color_schemes parity across settings_data.json `current` + every `presets[*]`.
 *
 * Templates reference a scheme by id (`"color_scheme": "scheme-2"`), and Shopify applies ONE
 * settings_data to the store, so every preset must carry the same SET of scheme ids — a preset
 * that lacks an id its own (or another preset's) templates use renders that section with no
 * colours. Demos are built independently (demo A ends with 8 schemes, demo B with 12), so the
 * repo has to reconcile: the union of ids wins, and a missing id is copied from the preset that
 * has the most schemes (falling back to any preset that defines it).
 *
 * Dependency-free on purpose — check-listings imports this and runs in CI without yarn install.
 */
import fs from "node:fs";

// config/*.json is written by the theme editor with a leading `/* … */` banner that strict
// JSON.parse rejects. Only that banner is tolerated — the body stays strict.
export function readConfigJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
}

// Every settings object that ships: `current` (the install state, when it is an object rather
// than a preset name) + each preset.
export function settingsTargets(data) {
  const targets = [];
  if (data.current && typeof data.current === "object") targets.push({ name: "current", settings: data.current });
  for (const [name, settings] of Object.entries(data.presets ?? {})) targets.push({ name: `presets["${name}"]`, settings });
  return targets;
}

/**
 * Returns { union, missing: [{ name, ids }] } — which targets lack which scheme ids.
 */
export function colorSchemeGaps(data) {
  const targets = settingsTargets(data);
  const union = new Set();
  for (const t of targets) for (const id of Object.keys(t.settings.color_schemes ?? {})) union.add(id);
  const missing = [];
  for (const t of targets) {
    const have = new Set(Object.keys(t.settings.color_schemes ?? {}));
    const ids = [...union].filter((id) => !have.has(id));
    if (ids.length) missing.push({ name: t.name, ids });
  }
  return { union: [...union], missing };
}

/**
 * Mutates `data`: fills every missing scheme id from the richest target (most schemes), else from
 * whichever target defines it. Returns [{ name, id, from }] for the report. Never changes a scheme
 * a target already has — only additions, so a demo's own colours are untouched.
 */
export function padColorSchemes(data) {
  const targets = settingsTargets(data);
  const bySize = [...targets].sort(
    (a, b) => Object.keys(b.settings.color_schemes ?? {}).length - Object.keys(a.settings.color_schemes ?? {}).length
  );
  const added = [];
  for (const { name, ids } of colorSchemeGaps(data).missing) {
    const target = targets.find((t) => t.name === name);
    target.settings.color_schemes ??= {};
    for (const id of ids) {
      const source = bySize.find((t) => t.settings.color_schemes?.[id]);
      target.settings.color_schemes[id] = structuredClone(source.settings.color_schemes[id]);
      added.push({ name, id, from: source.name });
    }
  }
  return added;
}
