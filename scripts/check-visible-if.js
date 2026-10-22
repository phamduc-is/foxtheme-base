#!/usr/bin/env node
// Validate that a chained `visible_if` restates the gate of every setting it
// depends on.
//
// Shopify's `visible_if` is flat: each setting carries its own expression and
// knows nothing about the settings it names. So when B is gated on A, and A is
// itself gated on C, B stays VISIBLE whenever A is hidden — the merchant sees a
// control whose parent has gone away, and it usually emits nothing.
//
// Nothing else catches this. theme-check validates the expression's syntax, the
// editor renders both settings happily, and the section still works — the only
// symptom is a stray control in the sidebar, which is exactly the kind of thing
// a reviewer sees once and then stops seeing.
//
// The rule is purely structural: whatever ids A's expression names, B's has to
// name too (transitively). It deliberately does NOT compare the operators or the
// values — `A == 'custom'` and `A != blank` are both legitimate ways to depend on
// A, and demanding textual equality would reject correct code.
//
// Expressions containing `or` are SKIPPED, on purpose. Visibility then rests on
// no single operand — blocks/grid.liquid's `enable_swipe_on_mobile or
// columns_mobile > 1` is correct precisely because either half suffices — so
// demanding the gate of every named id would flag working code. That is an
// under-approximation: a genuine miss inside a disjunction goes unreported. The
// trade is deliberate, because a check that cries wolf gets muted, and the shape
// this exists to catch (a control gated on one parent that has a gate of its own)
// is a plain conjunction.
//
// Scans every inline {% schema %} in sections/ + blocks/, plus the global groups
// in config/settings_schema.json. Ids are scoped to the settings array they live
// in; a reference that does not resolve there (a global `settings.*`, a typo)
// is skipped rather than guessed — check-liquid owns unknown ids.
//
// Usage:
//   yarn check-visible-if              # fail on any violation
//   yarn check-visible-if --list       # print every chained visible_if, pass or fail

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
const REF_RE = /\b(?:section|block|app)\.settings\.([a-zA-Z0-9_]+)/g;
// config/settings_schema.json writes its own ids WITHOUT a prefix — `settings.foo`, not
// `section.settings.foo`. Matching those needs a second pattern, and it must stay separate:
// inside a section or block schema a bare `settings.foo` means a GLOBAL theme setting, i.e.
// a different scope this audit deliberately does not judge. The lookbehind keeps it from
// also firing on the `settings.` inside `block.settings.foo`.
const GLOBAL_REF_RE = /(?<![.\w])settings\.([a-zA-Z0-9_]+)/g;

const listOnly = process.argv.includes("--list");

/**
 * Every id an expression names, in the scope being audited.
 * `global` selects the bare `settings.*` form used by config/settings_schema.json.
 */
function referencedIds(expression, global = false) {
  const ids = new Set();
  const re = global ? GLOBAL_REF_RE : REF_RE;
  re.lastIndex = 0;
  for (const m of String(expression).matchAll(re)) ids.add(m[1]);
  return ids;
}

/**
 * The ids B must ALSO name: for each gate B depends on, that gate's own
 * references, and theirs in turn.
 */
function inheritedIds(id, byId, seen = new Set(), global = false) {
  const needed = new Set();
  if (seen.has(id)) return needed; // a cycle is check-liquid's problem, not ours
  seen.add(id);

  const setting = byId.get(id);
  if (!setting?.visible_if) return needed;

  for (const ref of referencedIds(setting.visible_if, global)) {
    needed.add(ref);
    for (const deeper of inheritedIds(ref, byId, seen, global)) needed.add(deeper);
  }
  return needed;
}

/** One flat settings array = one id scope. */
function auditScope(settings, where, findings, listed, global = false) {
  const byId = new Map();
  for (const s of settings) if (s && s.id) byId.set(s.id, s);

  for (const setting of settings) {
    if (!setting?.id || !setting.visible_if) continue;

    // A disjunction makes every operand optional — see the header note.
    if (/\bor\b/.test(setting.visible_if)) continue;

    const own = referencedIds(setting.visible_if, global);
    const missing = [];

    for (const ref of own) {
      if (!byId.has(ref)) continue; // global setting or typo — not ours to judge
      for (const needed of inheritedIds(ref, byId, new Set(), global)) {
        if (!own.has(needed) && !missing.includes(needed)) missing.push(needed);
      }
    }

    const chained = [...own].some((r) => byId.get(r)?.visible_if);
    if (chained) listed.push(`  ${where} · ${setting.id} → gated on ${[...own].join(", ")}`);
    if (missing.length) {
      findings.push({ where, id: setting.id, missing, expression: setting.visible_if });
    }
  }
}

function auditSchema(schema, file, findings, listed) {
  if (Array.isArray(schema?.settings)) auditScope(schema.settings, file, findings, listed);

  // Section blocks declare their own settings, in their own id scope.
  for (const block of schema?.blocks ?? []) {
    if (Array.isArray(block?.settings)) {
      auditScope(block.settings, `${file} › block "${block.type}"`, findings, listed);
    }
  }
}

function liquidFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".liquid"))
    .map((f) => path.join(dir, f));
}

const findings = [];
const listed = [];

for (const rel of [...liquidFiles("sections"), ...liquidFiles("blocks")]) {
  const m = fs.readFileSync(path.join(ROOT, rel), "utf8").match(SCHEMA_RE);
  if (!m) continue;
  let schema;
  try {
    schema = JSON.parse(m[1]);
  } catch {
    continue; // check-liquid owns schema-JSON validity
  }
  auditSchema(schema, rel, findings, listed);
}

const globalSchema = path.join(ROOT, "config/settings_schema.json");
if (fs.existsSync(globalSchema)) {
  try {
    for (const group of JSON.parse(fs.readFileSync(globalSchema, "utf8"))) {
      if (Array.isArray(group?.settings)) {
        auditScope(
          group.settings,
          `config/settings_schema.json › ${group.name ?? "theme_info"}`,
          findings,
          listed,
          true, // ids here are referenced bare, as `settings.foo`
        );
      }
    }
  } catch {
    // check-settings-schema owns this file's validity
  }
}

if (listOnly) {
  console.log(`Chained visible_if (${listed.length}):`);
  for (const line of listed) console.log(line);
  console.log("");
}

if (!findings.length) {
  console.log(`✓ visible_if chains OK (${listed.length} chained conditions, each restates its parent's gate).`);
  process.exit(0);
}

console.error(`✖ ${findings.length} chained visible_if do not restate their parent's gate:\n`);
for (const f of findings) {
  console.error(`  ${f.where} · ${f.id}`);
  console.error(`    visible_if: ${f.expression}`);
  console.error(`    missing:    ${f.missing.join(", ")}`);
  console.error(
    `    fix:        add the gate of ${f.missing.join(" / ")} to this expression, so the control cannot outlive the setting it depends on.\n`
  );
}
process.exit(1);
