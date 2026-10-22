#!/usr/bin/env node

/**
 * Local Liquid/theme validation via @shopify/theme-check-node.
 *
 * Runs the recommended theme-check ruleset over the theme and reports offenses.
 * Local-only: no telemetry, no network doc-search (theme-check-node manages its
 * own docs cache). Adapted from the Shopify "shopify-liquid" skill's validate.mjs
 * (full-app mode only) — the knowledge/doc-search half now lives in the
 * `shopify-ai-toolkit` plugin (per-dev), this is the always-on validation gate
 * that hooks and `yarn check-liquid` depend on.
 *
 * Usage:
 *   node scripts/check-liquid.mjs                       # check whole theme
 *   node scripts/check-liquid.mjs --files a.liquid,b/c.liquid   # only report these
 *   node scripts/check-liquid.mjs --theme-path .        # explicit theme root
 *
 * Exit 0 = no offenses (in scope); exit 1 = offenses found OR usage/internal error.
 */

import { access, readFile } from "fs/promises";
import { join, normalize, relative, resolve, sep } from "path";
import { parseArgs } from "util";
import { themeCheckRun } from "@shopify/theme-check-node";

const { values } = parseArgs({
  options: {
    "theme-path": { type: "string" },
    files: { type: "string" },
    verbose: { type: "boolean" },
  },
});

// theme-check-node needs an ABSOLUTE theme root, otherwise it computes the
// root URI from the filesystem root and globs the whole disk.
const themePath = resolve(values["theme-path"] ?? ".");
const onlyFiles = (values.files ?? "")
  .split(",")
  .map((f) => f.trim())
  .filter(Boolean);

/**
 * Read the `ignore:` globs out of .theme-check.yml ourselves.
 *
 * theme-check honours them when the theme root is a normal checkout, but NOT
 * inside a linked git worktree (`.git` is a FILE there, not a directory) — the
 * rest of the config still applies, only `ignore` silently stops matching. Every
 * review / L1 / L2 run happens in a worktree, so an ignored directory reappears
 * as phantom offenses exactly where nobody is looking at the repo root.
 * Re-applying the globs on the offense list is independent of however
 * theme-check resolves its root, so it holds in both layouts.
 */
async function readIgnoreGlobs(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const globs = [];
  let inIgnore = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (/^ignore:\s*$/.test(line)) {
      inIgnore = true;
      continue;
    }
    if (!inIgnore) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (!item) break; // first non-list line ends the block
    globs.push(item[1].trim().replace(/^["']|["']$/g, ""));
  }
  return globs;
}

/** Minimal glob → RegExp: `**` spans separators, `*` and `?` do not. */
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function formatOffense(offense) {
  const line = offense.start.line + 1;
  const col = offense.start.character + 1;
  const code = offense.check ? `${offense.check}: ` : "";
  const base = `[line ${line}, col ${col}] ${code}${offense.message}`;
  if (offense.suggest && offense.suggest.length > 0) {
    return `${base}  (fix: ${offense.suggest.map((s) => s.message).join(" OR ")})`;
  }
  return base;
}

async function main() {
  let configPath = join(themePath, ".theme-check.yml");
  try {
    await access(configPath);
  } catch {
    configPath = undefined;
  }

  // Silence theme-check's internal logger (docs-cache "Loaded schema …" noise);
  // pass --verbose to surface it when debugging.
  const log = values.verbose ? (msg) => console.error(msg) : () => {};
  const checkResult = await themeCheckRun(themePath, configPath, log);

  let offenses = checkResult.offenses;

  const ignoreGlobs = configPath ? await readIgnoreGlobs(configPath) : [];
  if (ignoreGlobs.length > 0) {
    const ignored = ignoreGlobs.map(globToRegExp);
    offenses = offenses.filter((o) => {
      const rel = relative(themePath, o.uri.replace(/^file:\/\//, "")).split(sep).join("/");
      return !ignored.some((re) => re.test(rel));
    });
  }

  if (onlyFiles.length > 0) {
    offenses = offenses.filter((o) =>
      onlyFiles.some((rel) => normalize(o.uri).endsWith(normalize(rel))),
    );
  }

  if (offenses.length === 0) {
    const scope = onlyFiles.length ? onlyFiles.join(", ") : "all Liquid files";
    console.log(`theme-check: ${scope} passed.`);
    process.exit(0);
  }

  const byUri = {};
  for (const o of offenses) {
    (byUri[o.uri] ??= []).push(formatOffense(o));
  }
  for (const [uri, msgs] of Object.entries(byUri)) {
    console.error(`\n${uri.replace(/^file:\/\//, "")}`);
    for (const m of msgs) console.error(`  ${m}`);
  }
  console.error(`\ntheme-check: ${offenses.length} offense(s) found.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(
    `check-liquid failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
