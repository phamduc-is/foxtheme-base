#!/usr/bin/env node
/**
 * test-presets — preview one listings/<preset> in its OWN git worktree.
 *
 * The outbound half of the demo pipeline (`/sync-listing` is the inbound half): it answers
 * "is this preset's JSON right?" — the section/block/settings data, NOT the demo store's
 * products and menus (those are stripped at sync time on purpose).
 *
 * It used to swap the preset's JSON over the REAL working tree, push it to a `preset`
 * environment, then restore — a backup/restore dance that could leave the repo dirty if the
 * run died, could only show one preset at a time, and needed an environment most forks never
 * defined. The repo now has worktrees, so a preview is just a throwaway checkout:
 *
 *   preview/<preset>  →  .worktrees/preview-<preset>  →  its own wt/* development theme
 *
 * Your working tree is never touched, several presets can run side by side on their own
 * ports, and nothing needs restoring — you delete the worktree when you're done.
 *
 * Usage:
 *   yarn test-presets                 # pick a preset from listings/
 *   yarn test-presets <preset>        # e.g. `yarn test-presets stavo`
 *   yarn test-presets <preset> --port 9400
 *   yarn test-presets <preset> --no-dev   # build the worktree, don't start `theme dev`
 *   yarn test-presets --clean [<preset>|--all]   # remove preview worktrees + their dev themes
 *
 * The preview worktree is created off HEAD, so it previews the preset ON TOP of the branch you
 * are on. The preset's own JSON is read from your WORKING TREE, so a listing /sync-listing just
 * wrote previews before you commit it; uncommitted Liquid/SCSS changes are not included.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import fs from "node:fs";
import path from "node:path";

const PREVIEW_PREFIX = "preview";
const SUBFOLDERS = ["templates", "sections"];

// "Horizon Bold" (presets key) and "horizon-bold" (folder) must compare equal — same rule as
// check-listings and /sync-listing.
const slug = (s) => String(s).toLowerCase().replace(/[-_\s]+/g, "-");

// config/*.json is written by the theme editor with a leading `/* … */` banner that strict
// JSON.parse rejects. Only that banner is tolerated — the body stays strict.
const readConfigJson = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts });
const run = (file, args, opts = {}) => spawnSync(file, args, { stdio: "inherit", ...opts });

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--port");

const ROOT = git(["rev-parse", "--show-toplevel"]).trim();
// A worktree inside a worktree is never what anyone means, and `.worktrees/` would nest.
if (ROOT.includes(`${path.sep}.worktrees${path.sep}`)) {
  console.error("Run this from the main checkout, not from inside a worktree.");
  process.exit(1);
}
const LISTINGS = path.join(ROOT, "listings");
const SETTINGS_DATA = path.join(ROOT, "config", "settings_data.json");

function presetFolders() {
  if (!fs.existsSync(LISTINGS)) return [];
  return fs
    .readdirSync(LISTINGS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function worktreeDir(name) {
  return path.join(ROOT, ".worktrees", `${PREVIEW_PREFIX}-${slug(name)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// --clean: remove preview worktrees, their branches, and their development themes.
// Preview branches never merge anywhere, so `yarn wt:clean` (which only removes MERGED
// worktrees) would leave them behind forever — this is their reaper.
// ─────────────────────────────────────────────────────────────────────────────
function clean(target) {
  const dirs = fs.existsSync(path.join(ROOT, ".worktrees"))
    ? fs
        .readdirSync(path.join(ROOT, ".worktrees"), { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith(`${PREVIEW_PREFIX}-`))
        .map((d) => d.name)
    : [];
  const wanted = target && target !== "--all" ? dirs.filter((d) => d === `${PREVIEW_PREFIX}-${slug(target)}`) : dirs;
  if (wanted.length === 0) {
    console.log(target ? `No preview worktree for "${target}".` : "No preview worktrees to clean.");
    return;
  }
  for (const name of wanted) {
    const branch = `${PREVIEW_PREFIX}/${name.slice(PREVIEW_PREFIX.length + 1)}`;
    console.log(`Removing ${name}…`);
    run("git", ["worktree", "remove", "--force", path.join(".worktrees", name)], { cwd: ROOT });
    // -D, not -d: a preview branch is throwaway by construction and never merges anywhere.
    spawnSync("git", ["branch", "-D", branch], { cwd: ROOT, stdio: "ignore" });
    run(process.execPath, [path.join(ROOT, "scripts", "wt-theme.mjs"), "--delete", name, "--force"], { cwd: ROOT });
  }
  console.log(`Cleaned ${wanted.length} preview worktree(s).`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply a listing onto a worktree: the preset's JSON becomes the theme's own templates and
// section groups, and `current` becomes the preset's settings — i.e. exactly the state a
// merchant installing that preset would get.
// ─────────────────────────────────────────────────────────────────────────────
function applyPreset(dir, folder, presetKey, presetSettings) {
  let copied = 0;
  for (const sub of SUBFOLDERS) {
    const from = path.join(LISTINGS, folder, sub);
    if (!fs.existsSync(from)) continue;
    for (const file of fs.readdirSync(from).filter((f) => f.endsWith(".json"))) {
      const dest = path.join(dir, sub, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(from, file), dest);
      copied++;
    }
  }
  const data = readConfigJson(path.join(dir, "config", "settings_data.json"));
  // The preset OBJECT, not its name: a name relies on Shopify resolving it, and a silent
  // resolution miss would render theme defaults that look like a broken preset.
  //
  // It comes from the repo's WORKING TREE, not from the worktree's checkout of HEAD: the whole
  // point of previewing right after /sync-listing is to see a preset that is not committed yet,
  // and the worktree's own settings_data would not carry its key at all (→ an empty `current`
  // that silently renders theme defaults).
  data.current = structuredClone(presetSettings);
  data.presets = { ...(data.presets ?? {}), [presetKey]: structuredClone(presetSettings) };
  fs.writeFileSync(path.join(dir, "config", "settings_data.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
  return copied;
}

async function main() {
  if (flag("--clean")) {
    clean(value("--clean") && !value("--clean").startsWith("--") ? value("--clean") : flag("--all") ? "--all" : positional[0]);
    return;
  }

  const folders = presetFolders();
  if (folders.length === 0) {
    console.error(`No listings/ presets — run /sync-listing first.`);
    process.exit(1);
  }

  // Residue from the pre-worktree version of this script, which swapped files over the real
  // working tree. Nothing here can restore it; say how to.
  if (fs.existsSync(path.join(ROOT, ".json_backup"))) {
    console.warn(
      "⚠ .json_backup/ exists — residue from the old swap-based test-presets. Your working tree may still\n" +
        "  hold a preset's JSON. Restore with: git checkout -- templates sections config/settings_data.json\n" +
        "  then: rm -rf .json_backup\n"
    );
  }

  let folder = positional[0];
  if (!folder) {
    if (!stdin.isTTY) {
      console.error(`Usage: yarn test-presets <preset>   (have: ${folders.join(", ")})`);
      process.exit(1);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    folders.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
    const answer = (await rl.question("Preview which preset? [number] ")).trim();
    rl.close();
    folder = folders[Number(answer) - 1];
    if (!folder) {
      console.error("No preset picked.");
      process.exit(1);
    }
  }
  folder = folders.find((f) => slug(f) === slug(folder)) ?? folder;
  if (!fs.existsSync(path.join(LISTINGS, folder))) {
    console.error(`No listings/${folder} (have: ${folders.join(", ")}).`);
    process.exit(1);
  }

  const settings = readConfigJson(SETTINGS_DATA);
  const presetKey = Object.keys(settings.presets ?? {}).find((k) => slug(k) === slug(folder));
  if (!presetKey) {
    console.error(
      `listings/${folder} has no matching key in config/settings_data.json presets ` +
        `(have: ${Object.keys(settings.presets ?? {}).join(", ") || "none"}) — \`yarn check-listings\` explains it.`
    );
    process.exit(1);
  }

  const name = `${PREVIEW_PREFIX}-${slug(folder)}`;
  const branch = `${PREVIEW_PREFIX}/${slug(folder)}`;
  const existed = fs.existsSync(worktreeDir(folder));

  // Off HEAD, not main: preview the preset on top of the branch you are on.
  const add = spawnSync(process.execPath, [path.join(ROOT, "scripts", "wt-add.mjs"), branch, "--base", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (add.status !== 0) {
    console.error(add.stderr || add.stdout);
    process.exit(1);
  }
  const dir = add.stdout.trim().split("\n").pop().trim();
  if (existed) console.log(`  ▸ reusing the existing preview worktree (created off an earlier commit)`);

  const copied = applyPreset(dir, folder, presetKey, settings.presets[presetKey]);
  git(["add", "-A"], { cwd: dir });
  const dirty = git(["status", "--porcelain"], { cwd: dir }).trim().length > 0;
  if (dirty) {
    // Committing keeps the worktree clean, which is what `wt:dev` and `wt:clean` expect —
    // and a dirty worktree is exactly what wt:clean refuses to touch.
    git(["commit", "-q", "-m", `chore(preview): apply the ${presetKey} listing`], { cwd: dir });
  }
  console.log(`  ▸ applied listings/${folder} (${copied} JSON file(s)) + settings_data.current = presets["${presetKey}"]`);

  if (flag("--no-dev")) {
    console.log(`\nWorktree ready: ${path.relative(ROOT, dir)}`);
    console.log(`  yarn wt:dev ${name}            # start the preview`);
    console.log(`  yarn test-presets --clean ${folder}   # remove it + its dev theme`);
    return;
  }

  const port = value("--port");
  console.log(`\nStarting the preview on its own development theme (wt/${name})…\n`);
  const dev = run(process.execPath, [path.join(ROOT, "scripts", "wt-dev.mjs"), name, ...(port ? ["--port", port] : [])], {
    cwd: ROOT,
  });
  console.log(`\nDone previewing. Clean up with:  yarn test-presets --clean ${folder}`);
  process.exit(dev.status ?? 0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
