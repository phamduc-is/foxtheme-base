#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const sass = require("sass");

// Compile a SCSS entry with the repo's dart-sass JS API. Worktree-safe: require()
// resolves node_modules upward, so it always uses the repo's dart-sass — never a
// global Ruby `sass` on PATH. (Worktrees have no local node_modules/.bin, so the
// old bare `sass` CLI call there silently ran the wrong compiler and left
// assets/*.css stale — the documented "sass shadow" gotcha.)
function compileSass(input, output) {
  const { css } = sass.compile(input, { sourceMap: false });
  // assets/ is fully gitignored — a fresh worktree (or fresh clone that never ran
  // clean:assets) has NO assets dir at all, and writeFileSync does not create it.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, css + "\n");
}

// Scoped stylesheets. An entry under src/scss/scoped/ compiles to
// assets/scoped-<name>.css, and the OWNING section / markup snippet loads it
// itself ({{ 'scoped-<name>.css' | asset_url | stylesheet_tag }} before its
// markup) — so a page only downloads the CSS of sections/blocks it actually
// renders, instead of shipping every section's CSS inside theme.css everywhere.
// Interim stand-in for Shopify's {% stylesheet %} subsetting, which is not yet
// consistently rolled out (2026-08: the &subset= variant appears only
// intermittently). When it stabilises, flip these to {% stylesheet %} snippets —
// see the parked branch spike/stylesheet-subsetting.
// The scoped- prefix keeps generated names from colliding with hand-named
// src/scss entries compiled into assets/.
const SCOPED_DIR = path.resolve(__dirname, "../src/scss/scoped");

function isScoped(file) {
  return path.resolve(file).startsWith(SCOPED_DIR + path.sep);
}

// Where a compiled entry lands. Absolute, so watch mode (absolute paths) and
// the one-shot build agree.
function outputFor(file) {
  const name = path.basename(file, ".scss");
  return isScoped(file)
    ? path.join(__dirname, "../assets", `scoped-${name}.css`)
    : path.join(__dirname, "../assets", `${name}.css`);
}

// Biến global để lưu danh sách files
let files = [];
let dependencyGraph = new Map(); // Map<partialPath, Set<mainFilePaths>>

// Tìm tất cả file SCSS không phải partial
function scanScssFiles() {
  const scssDir = "src/scss";
  files = [];

  function scanDir(dir) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else if (item.endsWith(".scss") && !item.startsWith("_")) {
        files.push(fullPath);
      }
    }
  }

  scanDir(scssDir);
  return files;
}

// Parse @use statements từ file SCSS
function parseImports(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const imports = [];
  const scssDir = path.join(__dirname, "../src/scss");

  // Match @use statements: @use "path" or @use "../path" or @use "./path"
  const useRegex = /@use\s+["']([^"']+)["']/g;
  let match;

  while ((match = useRegex.exec(content)) !== null) {
    const importPath = match[1];
    let resolvedPath;

    // Resolve relative paths
    if (importPath.startsWith("../") || importPath.startsWith("./")) {
      resolvedPath = path.resolve(path.dirname(filePath), importPath);
    } else {
      // Absolute from scss directory
      resolvedPath = path.join(scssDir, importPath);
    }

    // Try with .scss extension
    if (!resolvedPath.endsWith(".scss")) {
      const withExt = resolvedPath + ".scss";
      if (fs.existsSync(withExt)) {
        resolvedPath = withExt;
      } else {
        // Try with _ prefix (partial)
        const withPartial = path.join(path.dirname(resolvedPath), "_" + path.basename(resolvedPath) + ".scss");
        if (fs.existsSync(withPartial)) {
          resolvedPath = withPartial;
        } else {
          continue;
        }
      }
    }

    // Normalize path
    resolvedPath = path.resolve(resolvedPath);
    if (fs.existsSync(resolvedPath)) {
      imports.push(resolvedPath);
    }
  }

  return imports;
}

// Recursively find all partials imported by a file (including nested)
function findAllImports(filePath, visited = new Set()) {
  if (visited.has(filePath)) return [];
  visited.add(filePath);

  const directImports = parseImports(filePath);
  const allImports = [...directImports];

  // Recursively find nested imports
  directImports.forEach((importPath) => {
    const nestedImports = findAllImports(importPath, visited);
    allImports.push(...nestedImports);
  });

  return allImports;
}

// Build dependency graph: which main files depend on which partials (including nested)
function buildDependencyGraph() {
  dependencyGraph.clear();
  scanScssFiles();

  files.forEach((mainFile) => {
    // Get all imports (direct + nested)
    const allImports = findAllImports(mainFile);

    allImports.forEach((importPath) => {
      if (!dependencyGraph.has(importPath)) {
        dependencyGraph.set(importPath, new Set());
      }
      dependencyGraph.get(importPath).add(mainFile);
    });
  });
}

// Build CSS từ SCSS files
function buildCss() {
  // Scan files trước khi build
  scanScssFiles();

  if (files.length === 0) {
    console.log("No SCSS files found to build");
    return;
  }

  console.log(`Found ${files.length} SCSS files to build:`);

  // Build từng file
  let failed = 0;
  files.forEach((file) => {
    const outputPath = outputFor(file);
    const outputName = path.basename(outputPath);

    try {
      compileSass(file, outputPath);
      console.log(`✅ Built: ${outputName}`);
    } catch (error) {
      console.error(`❌ Error building ${outputName}:`, error.message);
      failed++;
    }
  });

  // One-shot builds must FAIL loudly — a zero exit here let wt:dev serve a broken
  // theme and testers false-pass the build step. (Watch mode keeps running.)
  if (failed > 0) {
    console.error(`\n❌ CSS build finished with ${failed} error(s)`);
    process.exit(1);
  }
  console.log("\n🎉 CSS build completed!");
}

// Watch mode
function watchCss() {
  const args = process.argv.slice(2);
  const skipInitialBuild = args.includes("--skip-initial-build");

  console.log("👀 Watching SCSS files for changes...");

  // Build lần đầu nếu không skip
  if (!skipInitialBuild) {
    buildCss();
  } else {
    // Vẫn cần scan files để có danh sách cho watch
    scanScssFiles();
    console.log(`Found ${files.length} SCSS files to watch (skipping initial build)`);
  }

  // Build dependency graph for watch mode
  buildDependencyGraph();

  // Use chokidar to watch directory for new files and changes
  const chokidar = require("chokidar");
  const scssDir = path.join(__dirname, "../src/scss");

  // Watch for file changes and new files (including partials)
  chokidar
    .watch(scssDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    })
    .on("all", (event, filePath) => {
      if (!filePath.endsWith(".scss")) return;

      const fileName = path.basename(filePath);
      const isPartial = fileName.startsWith("_");
      const normalizedPath = path.resolve(filePath);

      if (isPartial) {
        // When partial file changes, rebuild only files that import it
        // Rebuild dependency graph first to catch any new dependencies
        buildDependencyGraph();

        const dependentFiles = dependencyGraph.get(normalizedPath);
        if (dependentFiles && dependentFiles.size > 0) {
          dependentFiles.forEach((mainFile) => {
            const mainOutputPath = outputFor(mainFile);
            const mainFileName = path.basename(mainOutputPath);

            try {
              compileSass(mainFile, mainOutputPath);
              console.log(`✅ Rebuilt (partial changed): ${mainFileName}`);
            } catch (error) {
              console.error(`❌ Error building ${mainFileName}:`, error.message);
            }
          });
        } else {
          console.log(`ℹ️  No files depend on partial: ${fileName}`);
        }
      } else {
        // Non-partial file changed, build it directly
        const outputPath = outputFor(normalizedPath);
        const outputName = path.basename(outputPath);

        if (event === "add" || event === "change") {
          try {
            compileSass(normalizedPath, outputPath);
            console.log(`✅ ${event === "add" ? "Built new" : "Rebuilt"}: ${outputName}`);
          } catch (error) {
            console.error(`❌ Error building ${outputName}:`, error.message);
          }
        } else if (event === "unlink") {
          // Remove CSS file when SCSS is deleted
          try {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
              console.log(`🗑️  Deleted: ${outputName}`);
            }
          } catch (error) {
            // File might not exist, ignore
          }
        }
      }
    });

  // Cleanup map files periodically
  setInterval(() => {
    try {
      execSync("rm -f assets/*.css.map", { stdio: "ignore" });
    } catch (error) {
      // Ignore cleanup errors
    }
  }, 1000);

  console.log("Press Ctrl+C to stop watching");
}

// Main execution
const args = process.argv.slice(2);
const isWatch = args.includes("--watch");

if (isWatch) {
  watchCss();
} else {
  buildCss();
}
