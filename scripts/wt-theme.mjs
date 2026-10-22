#!/usr/bin/env node
/**
 * wt:theme — give every worktree its OWN Shopify theme, so parallel previews
 * stop overwriting each other.
 *
 * `shopify.theme.toml` pins ONE theme per environment, and `theme dev` does not
 * render locally — it uploads to that theme and proxies it back. Two worktrees
 * previewing at once therefore share a theme: per-feature files coexist, but the
 * shared ones (`assets/theme.css`, `layout/theme.liquid`, `locales/*.json`) are
 * last-write-wins, so you watch preview A while its CSS is B's build.
 *
 * The fix is one theme per worktree, keyed by the worktree folder name. We use
 * DEVELOPMENT themes rather than unpublished ones because they:
 *   - do NOT count against the store's ~20 theme limit (separate role), so a
 *     wide `/ship-batch` fan-out cannot exhaust it;
 *   - expire on their own after ~7 days idle, so a crashed run or a worktree
 *     removed by hand cannot leak a theme forever.
 *
 * Nothing here deletes a theme on its own — removal is always something you ask
 * for (`--delete`), or the 7-day expiry doing it for you.
 *
 * Usage:
 *   yarn wt:theme                     # list the wt/* themes + whether their worktree still exists
 *   yarn wt:theme --delete            # in a terminal: list them numbered, then pick
 *   yarn wt:theme --delete <slug>     # delete one (slug = worktree folder name)
 *   yarn wt:theme --delete-orphans    # delete the ones whose worktree is gone
 *   yarn wt:theme --delete-all        # delete every wt/* theme
 *   yarn wt:theme --force             # skip the confirmation prompt
 *
 * `yarn wt:dev` calls ensureTheme() from here; you rarely need this directly.
 */
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const semverCmp = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/**
 * Resolve the Shopify CLI binary. Prefer the repo-pinned devDependency
 * (`node_modules/.bin/shopify` — every dev gets the SAME version from
 * `yarn install`, so a script can rely on its flags). Fall back to PATH with a
 * version gate: a stale global CLI fails HERE with the remedy, instead of
 * mid-run with a cryptic `Nonexistent flag: --development-context`.
 */
let cachedShopifyBin;
export function shopifyBin() {
  if (cachedShopifyBin) return cachedShopifyBin;
  const local = path.join(REPO_ROOT, "node_modules", ".bin", "shopify");
  if (existsSync(local)) return (cachedShopifyBin = local);

  const pinned = (
    JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).devDependencies?.["@shopify/cli"] ?? ""
  ).replace(/^[~^]/, "");
  let installed;
  try {
    installed = execFileSync("shopify", ["version"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Shopify CLI not found — run `yarn install` (uses the repo-pinned CLI) or `npm install -g @shopify/cli`");
  }
  if (pinned && semverCmp(installed, pinned) < 0) {
    throw new Error(
      `Shopify CLI ${installed} on PATH is older than the repo's pinned ${pinned} — run \`yarn install\` (preferred) or \`npm install -g @shopify/cli@latest\``
    );
  }
  return (cachedShopifyBin = "shopify");
}

/** Theme name prefix that marks a theme as ours — the delete guard keys off it. */
export const PREFIX = "wt/";

/**
 * Read store + password out of `shopify.theme.toml`.
 *
 * We deliberately do NOT pass `-e development` to the CLI: that environment
 * pins `theme = <id>`, which the CLI injects as `--theme`, and `--theme` is
 * rejected alongside `--development-context`. Passing the credentials straight
 * through sidesteps the injection for every command here.
 */
export function readCreds(root = process.cwd()) {
  const file = path.join(root, "shopify.theme.toml");
  if (!existsSync(file)) throw new Error(`shopify.theme.toml not found at ${root}`);
  const toml = readFileSync(file, "utf8");

  const block = toml.split(/^\[environments\./m).find((b) => b.startsWith("development]"));
  if (!block) throw new Error("no [environments.development] block in shopify.theme.toml");

  const pick = (key) => block.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
  const store = pick("store");
  const password = pick("password");
  if (!store || !password) throw new Error("[environments.development] needs both store and password");

  // The CLI wants a bare domain; the toml usually carries a full URL.
  return { store: store.replace(/^https?:\/\//, "").replace(/\/+$/, ""), password };
}

const cli = (args, { capture = true } = {}) =>
  execFileSync(shopifyBin(), args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });

/** Every development theme on the store. Returns [] when the store has none. */
export function listDevThemes(creds) {
  try {
    // Exits non-zero with empty output when nothing matches the role — not an error.
    return JSON.parse(cli(["theme", "list", "-s", creds.store, "--password", creds.password, "--role", "development", "--json"]));
  } catch {
    return [];
  }
}

/** Our themes only, newest naming convention — `wt/<worktree folder name>`. */
export const listWorktreeThemes = (creds) => listDevThemes(creds).filter((t) => t.name.startsWith(PREFIX));

export const themeNameFor = (slug) => `${PREFIX}${slug}`;

/**
 * Resolve the development theme for a worktree, creating it on first use.
 *
 * `--development-context` is create-or-reuse, and it names the theme after the
 * context verbatim — which is why a plain name lookup can find it again later
 * and skip the upload (`theme dev` re-uploads on start anyway).
 */
export function ensureTheme(slug, worktreePath, creds = readCreds()) {
  const name = themeNameFor(slug);

  const found = listDevThemes(creds).find((t) => t.name === name);
  if (found) return found;

  console.log(`\n▸ creating development theme "${name}" (first preview of this worktree) …`);
  const out = cli([
    "theme", "push",
    "-s", creds.store,
    "--password", creds.password,
    "--development",
    "--development-context", name,
    "--path", worktreePath,
    "--json",
  ]);
  // The upload progress is written to stderr; stdout carries the one-line JSON result, but the
  // CLI can append notices after it — parse that line only, not everything past the first "{".
  const line = out.split("\n").find((l) => l.trimStart().startsWith('{"'));
  const theme = line && JSON.parse(line).theme;
  if (!theme) throw new Error(`theme push returned no theme JSON:\n${out.slice(0, 500)}`);
  console.log(`  ▸ created #${theme.id}`);
  return theme;
}

/** Delete a theme, but only ever one of ours. */
export function deleteTheme(theme, creds) {
  if (theme.role !== "development" || !theme.name.startsWith(PREFIX)) {
    throw new Error(`refusing to delete ${theme.name} (#${theme.id}) — not a ${PREFIX}* development theme`);
  }
  cli(["theme", "delete", "-s", creds.store, "--password", creds.password, "-t", String(theme.id), "-f"]);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const deleteAll = argv.includes("--delete-all");
  const deleteOrphans = argv.includes("--delete-orphans");
  const deleteOne = argv.includes("--delete") ? argv[argv.indexOf("--delete") + 1] : undefined;
  const wantsDelete = deleteAll || deleteOrphans || argv.includes("--delete");

  // `--delete` with no slug used to be an error. In a terminal it now means "show me the list
  // and let me choose": the slug is a worktree folder name nobody remembers exactly, so the old
  // flow was always list → squint → re-run → typo. Without a TTY there is nobody to ask, so it
  // stays an error rather than a prompt into the void.
  const wantsPick = argv.includes("--delete") && (!deleteOne || deleteOne.startsWith("--"));
  if (wantsPick && !stdin.isTTY) {
    console.error("--delete needs a slug (the worktree folder name). See `yarn wt:theme` for the list.");
    process.exit(1);
  }

  const creds = readCreds();
  const themes = listWorktreeThemes(creds);
  if (themes.length === 0) {
    console.log(`No ${PREFIX}* development themes on ${creds.store}.`);
    process.exit(0);
  }

  const root = process.cwd();
  // Orphan detection reads `.worktrees/` relative to cwd, so running this from
  // inside a worktree (no `.worktrees/` there) would mark EVERY theme an orphan
  // and let --delete-orphans wipe the lot. Refuse rather than guess.
  const worktreesDir = path.join(root, ".worktrees");
  const canDetectOrphans = existsSync(worktreesDir);
  if (deleteOrphans && !canDetectOrphans) {
    console.error(`No .worktrees/ in ${root} — run this from the repo root; refusing to guess which themes are orphans.`);
    process.exit(1);
  }
  const hasWorktree = (t) => existsSync(path.join(worktreesDir, t.name.slice(PREFIX.length)));

  if (!wantsDelete) {
    console.log(`\n${PREFIX}* development themes on ${creds.store}:\n`);
    for (const t of themes) {
      const state = !canDetectOrphans ? "" : hasWorktree(t) ? "worktree present" : "worktree GONE (orphan)";
      console.log(`  ${t.name.padEnd(40)} #${t.id}  ${state}`);
    }
    if (!canDetectOrphans) console.log(`\n  (run from the repo root to see which themes still have a worktree)`);
    console.log("\n  yarn wt:theme --delete   (pick from the list) | --delete <slug> | --delete-orphans | --delete-all");
    console.log("  (untouched themes expire on their own after ~7 days idle)\n");
    process.exit(0);
  }

  let targets;
  let picked = false;
  if (deleteAll) targets = themes;
  else if (deleteOrphans) targets = themes.filter((t) => !hasWorktree(t));
  else if (wantsPick) {
    console.log(`\n${PREFIX}* development themes on ${creds.store}:\n`);
    themes.forEach((t, i) => {
      const state = !canDetectOrphans ? "" : hasWorktree(t) ? "worktree present" : "worktree GONE (orphan)";
      console.log(`  [${i + 1}] ${t.name.padEnd(40)} #${t.id}  ${state}`);
    });
    if (!canDetectOrphans) console.log(`\n  (run from the repo root to see which themes still have a worktree)`);

    const rl = createInterface({ input: stdin, output: stdout });
    let answer = "";
    try {
      answer = (await rl.question("\n  Delete which? [number, 1,3 for several, a=all, o=orphans, Enter=none]: ")).trim();
    } catch {
      // ctrl-D closes stdin mid-question and readline rejects with ABORT_ERR. Unhandled that
      // prints a stack trace, which reads like it crashed while deleting something. Closing
      // the input is a way of saying "never mind".
      answer = "";
    } finally {
      rl.close();
    }

    const pick = answer.toLowerCase();
    if (pick === "" || pick === "q") { console.log("Nothing selected."); process.exit(0); }
    if (pick === "a" || pick === "all") targets = themes;
    else if (pick === "o" || pick === "orphans") {
      // Same guard as --delete-orphans: from inside a worktree every theme looks like an
      // orphan, so refuse rather than delete the lot.
      if (!canDetectOrphans) {
        console.error("Cannot tell which are orphans from here — run from the repo root.");
        process.exit(1);
      }
      targets = themes.filter((t) => !hasWorktree(t));
    } else {
      const chosen = pick.split(",").map((n) => Number(n.trim()));
      if (chosen.some((n) => !Number.isInteger(n) || n < 1 || n > themes.length)) {
        console.error(`"${answer}" is not one of the numbers listed.`);
        process.exit(1);
      }
      targets = chosen.map((n) => themes[n - 1]);
    }
    picked = true; // picking each theme by hand IS the confirmation — do not ask again below.
  } else targets = themes.filter((t) => t.name === themeNameFor(deleteOne));

  if (targets.length === 0) {
    console.log("Nothing matches — nothing deleted.");
    process.exit(0);
  }

  if (!force && !picked) {
    console.log("\nAbout to DELETE:\n");
    targets.forEach((t) => console.log(`  ${t.name.padEnd(40)} #${t.id}`));
    // Without a TTY there is nobody to type 'yes': readline never settles, so node
    // exits with an "unsettled top-level await" warning that reads like the script
    // crashed rather than "I am waiting for input". Agent shells and CI have no TTY,
    // so say what to do instead of hanging.
    if (!stdin.isTTY) {
      console.error("\nNon-interactive shell — cannot ask for confirmation.");
      console.error("Re-run with --force to delete the themes listed above.");
      process.exit(1);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    let ans = "";
    try {
      ans = (await rl.question("\nType 'yes' to confirm: ")).trim();
    } catch {
      ans = ""; // ctrl-D, as in the picker above — anything but "yes" aborts anyway.
    } finally {
      rl.close();
    }
    if (ans !== "yes") { console.log("Aborted."); process.exit(0); }
  }

  for (const t of targets) {
    try {
      deleteTheme(t, creds);
      console.log(`  deleted ${t.name} (#${t.id})`);
    } catch (e) {
      console.error(`  ! ${e.message}`);
    }
  }
}
