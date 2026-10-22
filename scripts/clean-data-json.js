/**
 * Strip store-specific values from JSON (JSON5 input OK) for Theme Store / zip installs.
 *
 * Removes every setting the schemas type as a store resource (product, collection_list,
 * link_list, page, … — resolved by scripts/lib/resource-settings.js, so descriptive ids like
 * `search_recommendation_products` are caught too), every credential-shaped setting (`api_key`,
 * `*_token`… plus any Google `AIza…` key value), the legacy settingsToSkip names, and strings
 * with shopify://, http, metafield liquid, etc. Presets stay valid; merchants re-pick menus/collections.
 * EVERY shopify:// value goes, including the store-wide routes the link picker writes for
 * "All collections" / "All products" (`shopify://collections`, `shopify://products`,
 * `shopify://collections/all`): a picked link is demo data, the merchant chooses their own targets
 * after install. A path the demo builder typed by hand (`/collections`) is deliberate and stays —
 * that is how a 404 "Continue shopping" button keeps its way-forward link through a sync.
 * Also empties the children of the header section's static blocks (mega menu columns, custom
 * links/icons, drawer items) — see clearStaticBlockChildren — and normalises
 * templates/list-collections.json to the reviewer's shape — see normalizeListCollections.
 *
 * Usage (from repo root):
 *   node scripts/clean-data-json.js --release [--dry-run]     # templates/, sections/, listings/ + config/settings_data.json (before zip)
 *   node scripts/clean-data-json.js <dir|file.json>… [--dry-run]  # scoped: folders and/or JSON files (what /sync-listing runs)
 *   yarn clean-data-json                                     # TTY: interactive pick
 *
 * Cleaning happens at SYNC time (/sync-listing cleans what it just wrote — the repo is always
 * shippable); --release before zip is the idempotent safety net for hand edits.
 *
 * --force: deprecated no-op (kept for old scripts); theme JSON is always allowed.
 *
 * Exit code 1 if any file failed to parse/write — a release must not continue on a half-cleaned tree.
 */
const fs = require("fs");
const path = require("path");
const JSON5 = require("json5");
const { buildResourceSettingIds, CREDENTIAL_VALUE_PATTERN, isStoreSpecificShopifyUrl } = require("./lib/resource-settings");

const ROOT = path.resolve(__dirname, "..");
// Setting ids the SCHEMAS declare as store resources (product, collection_list, link_list,
// page…) — stripped wherever they appear, whatever they are called. The name list below stays
// as a fallback for keys no schema types (legacy/ad-hoc data keys).
const resourceSettingIds = buildResourceSettingIds(ROOT);
let failures = 0;

// Sections whose static blocks are CONTAINERS for demo navigation content: the header's
// mega-menu columns, custom links/icons and drawer items are authored against the demo store's
// menus (`menu_title: "Performance"`, a button to /pages/part_finder). The `menu`/`collection`
// settings inside them are stripped like anywhere else, but the leftover column and link
// structure would still ship — pointing at menu items the merchant does not have. Core's own
// header-group.json carries no blocks at all, so emptying them restores exactly that state.
// Only the CHILDREN go: the static block entries themselves stay (they hold the section's own
// settings and are rendered by `content_for 'block'` regardless).
// Not a general rule — `static: true` is used by ~960 blocks across the theme (hero content,
// product details, testimonials…), and those children ARE the demo content a preset must keep.
const SECTIONS_WITH_DEMO_STATIC_CHILDREN = ["header"];

const settingsToSkip = [
  "collection",
  "collection_list",
  "product_list",
  "products",
  "product",
  "menu",
  "footer_menu_bottom",
  "cart_product_recommendations",
  "blog_posts",
];

function parseArgs(argv) {
  const flags = new Set();
  const pos = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      flags.add(a);
    } else {
      pos.push(a);
    }
  }
  return { flags, targets: pos };
}

function isThemeCoreDataDir(absPath) {
  const rel = path.relative(ROOT, absPath).replace(/\\/g, "/");
  if (rel.startsWith("..")) {
    return false;
  }
  return (
    rel === "templates" ||
    rel.startsWith("templates/") ||
    rel === "sections" ||
    rel.startsWith("sections/") ||
    rel === "listings" ||
    rel.startsWith("listings/") ||
    rel === "config/settings_data.json"
  );
}

// Empty `blocks` + `block_order` of every static block in the sections listed above.
// Returns the number of blocks emptied (0 for a file with no such section).
function clearStaticBlockChildren(data) {
  let cleared = 0;
  for (const section of Object.values(data?.sections ?? {})) {
    if (!SECTIONS_WITH_DEMO_STATIC_CHILDREN.includes(section?.type)) {
      continue;
    }
    for (const block of Object.values(section.blocks ?? {})) {
      if (block?.static !== true) {
        continue;
      }
      if (Object.keys(block.blocks ?? {}).length === 0 && (block.block_order ?? []).length === 0) {
        continue;
      }
      block.blocks = {};
      block.block_order = [];
      cleared++;
    }
  }
  return cleared;
}

// Theme Store reviewers open the collections list page expecting the paginated list of
// collections — the template's `main-*` section. A demo dresses that page up (hero, product tabs,
// blog posts) and often switches the main section OFF; that is the demo's design, not the install
// state a reviewer receives in the zip. On this one template the main section ships enabled and
// every other section disabled. The demo store itself is untouched — sync only rewrites the repo
// copy — so the live demo keeps its design.
function normalizeListCollections(file, data) {
  if (path.basename(file) !== "list-collections.json") {
    return 0;
  }
  let changed = 0;
  for (const section of Object.values(data?.sections ?? {})) {
    const isMain = typeof section?.type === "string" && section.type.startsWith("main-");
    if (isMain) {
      if (section.disabled !== undefined) {
        delete section.disabled;
        changed++;
      }
    } else if (section && section.disabled !== true) {
      section.disabled = true;
      changed++;
    }
  }
  return changed;
}

function cleanObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(cleanObject);
  }
  if (obj && typeof obj === "object") {
    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
      if (
        settingsToSkip.includes(key) ||
        resourceSettingIds.has(key) ||
        (key === "icon" && value === "5-stars") ||
        (typeof value === "string" &&
          (isStoreSpecificShopifyUrl(value) ||
            /\{\{[^}]*metafields[^}]*\}\}/.test(value) ||
            /https?:\/\//.test(value) ||
            CREDENTIAL_VALUE_PATTERN.test(value) ||
            value.includes("/search?")))
      ) {
        continue;
      }
      newObj[key] = cleanObject(value);
    }
    return newObj;
  }
  return obj;
}

function processFile(file, dryRun) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON5.parse(raw);
    clearStaticBlockChildren(data);
    normalizeListCollections(file, data);
    const cleaned = cleanObject(data);
    const out = JSON.stringify(cleaned, null, 2) + "\n";
    if (dryRun) {
      const norm = (s) => s.replace(/\r\n/g, "\n");
      if (norm(out) !== norm(raw)) {
        console.log(`[dry-run] would rewrite: ${path.relative(ROOT, file)}`);
      }
      return;
    }
    fs.writeFileSync(file, out, "utf8");
    console.log(`Done: ${path.relative(ROOT, file)}`);
  } catch (e) {
    failures++;
    console.error(`Error: ${path.relative(ROOT, file)} — ${e.message}`);
  }
}

function walk(dir, dryRun) {
  if (!fs.existsSync(dir)) {
    return;
  }
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p, dryRun);
    } else if (p.endsWith(".json")) {
      processFile(p, dryRun);
    }
  });
}

function getFolderChoices() {
  const folders = [];
  const listingsPath = path.join(ROOT, "listings");
  if (fs.existsSync(listingsPath)) {
    fs.readdirSync(listingsPath).forEach((f) => {
      const p = path.join(listingsPath, f);
      if (fs.statSync(p).isDirectory()) {
        folders.push(p);
      }
    });
  }
  for (const name of ["sections", "templates"]) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      folders.push(p);
    }
  }
  return folders;
}

function promptFolder(folders) {
  return new Promise((resolve, reject) => {
    console.log("Chọn folder để làm sạch dữ liệu:");
    folders.forEach((f, i) => {
      console.log(`${i + 1}) ${path.relative(ROOT, f)}`);
    });
    process.stdout.write("#? ");
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      const idx = parseInt(data.trim(), 10) - 1;
      if (idx >= 0 && idx < folders.length) {
        resolve(folders[idx]);
      } else {
        reject(new Error("Invalid choice"));
      }
    });
  });
}

function warnThemeJsonTarget(absTarget) {
  if (!isThemeCoreDataDir(absTarget)) {
    return;
  }
  console.warn(
    "\n[clean-data-json] Sanitizing theme JSON (templates/, sections/, listings/*, settings_data): store-specific keys (menu, collection, …) are removed for clean zip installs.\n"
  );
}

(async () => {
  const { flags, targets: targetArgs } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has("--dry-run");
  const release = flags.has("--release");

  if (flags.has("--force")) {
    console.warn("[clean-data-json] --force is no longer required; ignoring.\n");
  }

  if (release) {
    if (targetArgs.length) {
      console.error(
        "Do not pass a directory with --release (cleans templates/, sections/, listings/, settings_data)."
      );
      process.exit(1);
    }
    console.log(
      "Release mode: cleaning JSON in templates/, sections/, and listings/ (preset data)…\n"
    );
    if (dryRun) {
      console.log("Dry run — no files written.\n");
    }
    walk(path.join(ROOT, "templates"), dryRun);
    walk(path.join(ROOT, "sections"), dryRun);
    walk(path.join(ROOT, "listings"), dryRun);
    // `current` + every `presets` entry ship in the zip too (shopify://shop_images/… logos,
    // favicons, menu handles) — the same rules apply. The editor's `/* … */` banner is dropped
    // on rewrite; Shopify accepts the strict form.
    const settingsData = path.join(ROOT, "config", "settings_data.json");
    if (fs.existsSync(settingsData)) processFile(settingsData, dryRun);
    process.exit(failures ? 1 : 0);
  }

  let absTargets;

  if (targetArgs.length) {
    absTargets = targetArgs.map((t) => path.resolve(ROOT, t));
  } else {
    if (!process.stdin.isTTY) {
      console.error(
        "Usage:\n" +
          "  node scripts/clean-data-json.js --release [--dry-run]            # templates + sections + listings + settings_data\n" +
          "  node scripts/clean-data-json.js <dir|file.json>… [--dry-run]     # scoped targets\n" +
          "Or run without args from a TTY for interactive pick."
      );
      process.exit(1);
    }
    const folders = getFolderChoices();
    if (folders.length === 0) {
      console.log("No folders found (listings/*, sections/, templates/).");
      process.exit(1);
    }
    try {
      absTargets = [await promptFolder(folders)];
      console.log("Selected:", path.relative(ROOT, absTargets[0]));
    } catch {
      console.log("Invalid choice. Exit.");
      process.exit(1);
    }
  }

  for (const absTarget of absTargets) {
    if (!fs.existsSync(absTarget)) {
      console.error("Not found:", absTarget);
      process.exit(1);
    }
    if (!fs.statSync(absTarget).isDirectory() && !absTarget.endsWith(".json")) {
      console.error("Not a directory or .json file:", absTarget);
      process.exit(1);
    }
  }

  for (const absTarget of absTargets) warnThemeJsonTarget(absTarget);

  if (dryRun) {
    console.log("Dry run — no files written.\n");
  }

  for (const absTarget of absTargets) {
    if (fs.statSync(absTarget).isDirectory()) {
      walk(absTarget, dryRun);
    } else {
      processFile(absTarget, dryRun);
    }
  }
  process.exit(failures ? 1 : 0);
})();
