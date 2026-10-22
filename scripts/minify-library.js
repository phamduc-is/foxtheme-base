#!/usr/bin/env node

// Auto-minify all library files built by vite based on vite.config.mjs entries
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Read vite.config.mjs and extract entries
const viteConfigPath = path.join(__dirname, "../vite.config.mjs");
const viteConfigContent = fs.readFileSync(viteConfigPath, "utf-8");

// Extract entries object using regex
// Match: entries = { ... }
const entriesMatch = viteConfigContent.match(/const entries\s*=\s*\{([\s\S]*?)\};/);
if (!entriesMatch) {
  console.error("❌ Could not find entries in vite.config.mjs");
  process.exit(1);
}

// Extract entry names (keys) from entries object
const entriesBlock = entriesMatch[1];
const entryNames = [];

// Match each entry: "key": "path" or key: "path"
// Handles: "key", 'key', or key (with or without quotes)
const entryRegex = /["']?([\w-]+)["']?\s*:\s*["'][^"']+["']/g;
let match;
while ((match = entryRegex.exec(entriesBlock)) !== null) {
  entryNames.push(match[1]);
}

if (entryNames.length === 0) {
  console.error("❌ No entries found in vite.config.mjs");
  process.exit(1);
}

console.log(`📦 Found ${entryNames.length} library entries to minify:`);
entryNames.forEach((name) => console.log(`  - ${name}.js`));

// Minify each file directly in assets/ to avoid touching src/js/modules/
// This prevents file changes when yarn zip runs while yarn start is active
const assetsDir = path.join(__dirname, "../assets");
const nameCacheFile = path.join(__dirname, "../.terser-name-cache.json");
let successCount = 0;
let errorCount = 0;

// Load existing name cache if available
let nameCache = {};
if (fs.existsSync(nameCacheFile)) {
  try {
    nameCache = JSON.parse(fs.readFileSync(nameCacheFile, "utf-8"));
  } catch (e) {
    // Ignore if cache is invalid
  }
}

entryNames.forEach((entryName) => {
  const filePath = path.join(assetsDir, `${entryName}.js`);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}, skipping...`);
    errorCount++;
    return;
  }

  try {
    // Use deterministic options to ensure consistent output
    // --compress passes=1: limit compression passes for consistency
    // --mangle: deterministic property mangling with reserved names
    // --format comments=false: remove comments
    // --module: preserve ES module syntax
    // --keep-classnames: keep class names for consistency
    // --name-cache: use cache for deterministic mangling
    const tempFile = `${filePath}.tmp`;
    execSync(
      `terser "${filePath}" -c passes=1 -m --module --format comments=false --keep-classnames --name-cache "${nameCacheFile}" -o "${tempFile}"`,
      {
        stdio: "inherit",
      }
    );

    // Move temp file to final location atomically
    fs.renameSync(tempFile, filePath);

    // Normalize line endings to LF to ensure consistency
    const content = fs.readFileSync(filePath, "utf-8");
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    fs.writeFileSync(filePath, normalized, "utf-8");

    console.log(`✅ Minified: ${entryName}.js`);
    successCount++;
  } catch (error) {
    // Clean up temp file if exists
    const tempFile = `${filePath}.tmp`;
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    console.error(`❌ Error minifying ${entryName}.js:`, error.message);
    errorCount++;
  }
});

console.log(`\n🎉 Minification completed: ${successCount} succeeded, ${errorCount} failed`);

if (errorCount > 0) {
  process.exit(1);
}
