#!/usr/bin/env node
// Git custom merge driver for Shopify locale JSON files.
//
// 3-way deep merge:
//   - Key only added in theirs (core) → copy into ours (additive update)
//   - Key only changed in theirs → take theirs (core re-worded text)
//   - Key only changed in ours → keep ours (child translated)
//   - Key changed in both ours and theirs differently → keep ours, warn (child wins; reason: child knows its store wording)
//   - Key deleted in theirs but present in ours → keep ours (child still uses it)
//   - Key deleted in ours and changed in theirs → keep deleted (child intentionally removed)
//
// Invoked by git via .gitattributes `locales/*.json merge=foxlocale` plus
// per-machine config:
//   git config merge.foxlocale.driver "node $REPO/scripts/merge-drivers/locale-merge.mjs %O %A %B"
//
// Args: ancestor_path ours_path theirs_path
// Writes resolved JSON to ours_path. Exit 0 = success.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [, , ancestorPath, oursPath, theirsPath] = process.argv;

if (!oursPath || !theirsPath) {
  console.error("locale-merge: missing args. Expected: <ancestor> <ours> <theirs>");
  process.exit(2);
}

const readJson = (path) => {
  if (!path || !existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`locale-merge: invalid JSON at ${path}: ${err.message}`);
    process.exit(2);
  }
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
};

const warnings = [];

/**
 * 3-way merge at one level. Returns merged object preserving key order:
 * keys from `ours` first (in their original order), then new keys from `theirs`.
 */
const merge = (base, ours, theirs, path = "") => {
  if (!isPlainObject(ours) || !isPlainObject(theirs)) {
    // Leaf-level non-object: apply 3-way rule
    const baseEqOurs = deepEqual(base, ours);
    const baseEqTheirs = deepEqual(base, theirs);
    if (deepEqual(ours, theirs)) return ours;
    if (baseEqOurs) return theirs; // only theirs changed
    if (baseEqTheirs) return ours; // only ours changed
    // both changed differently
    warnings.push(`${path}: both sides changed, kept ours ("${truncate(ours)}" vs theirs "${truncate(theirs)}")`);
    return ours;
  }

  const baseObj = isPlainObject(base) ? base : {};
  const result = {};
  const handled = new Set();

  // Preserve ours key order
  for (const key of Object.keys(ours)) {
    handled.add(key);
    const subPath = path ? `${path}.${key}` : key;
    const inBase = key in baseObj;
    const inTheirs = key in theirs;

    if (!inTheirs) {
      // theirs removed it, or never had it
      if (inBase && deepEqual(baseObj[key], ours[key])) {
        // ours unchanged from base, theirs deleted → respect deletion
        continue;
      }
      // ours added or changed it → keep ours
      result[key] = ours[key];
      continue;
    }

    // present in both ours and theirs
    if (isPlainObject(ours[key]) && isPlainObject(theirs[key])) {
      result[key] = merge(baseObj[key], ours[key], theirs[key], subPath);
    } else {
      result[key] = merge(baseObj[key], ours[key], theirs[key], subPath);
    }
  }

  // New keys from theirs not in ours
  for (const key of Object.keys(theirs)) {
    if (handled.has(key)) continue;
    const subPath = path ? `${path}.${key}` : key;
    const inBase = key in baseObj;
    if (inBase && deepEqual(baseObj[key], theirs[key])) {
      // ours deleted it intentionally, theirs unchanged → respect deletion
      continue;
    }
    // theirs added or changed it → take theirs
    result[key] = theirs[key];
  }

  return result;
};

const truncate = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? s.slice(0, 37) + "..." : s;
};

const ancestor = readJson(ancestorPath);
const ours = readJson(oursPath);
const theirs = readJson(theirsPath);

const merged = merge(ancestor, ours, theirs);

writeFileSync(oursPath, JSON.stringify(merged, null, 2) + "\n", "utf8");

if (warnings.length) {
  console.error(`locale-merge: ${oursPath} — kept child wording over core for ${warnings.length} key(s):`);
  for (const w of warnings.slice(0, 20)) console.error(`  • ${w}`);
  if (warnings.length > 20) console.error(`  ... and ${warnings.length - 20} more`);
}

process.exit(0);
