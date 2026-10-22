const fs = require("fs-extra");
const chokidar = require("chokidar");
const path = require("path");

const srcDir = path.join(__dirname, "../src/images");
const destDir = path.join(__dirname, "../assets");

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");
const skipInitialCopy = args.includes("--skip-initial-copy");

// Copy all images initially nếu không skip
if (!skipInitialCopy) {
fs.copySync(srcDir, destDir, { overwrite: true, recursive: true });
}

// Watch for changes if run with --watch
if (isWatch) {
  // Nếu skip initial copy, vẫn cần scan lại để phát hiện file mới
  if (skipInitialCopy) {
    console.log("Scanning for new images...");
    fs.copySync(srcDir, destDir, { overwrite: true, recursive: true });
  }

  chokidar.watch(srcDir, { ignoreInitial: true }).on("all", (event, filePath) => {
    const relPath = path.relative(srcDir, filePath);
    const destPath = path.join(destDir, relPath);

    if (event === "add" || event === "change") {
      fs.copySync(filePath, destPath);
      console.log(`[${event}] ${relPath}`);
    }
    if (event === "unlink") {
      fs.removeSync(destPath);
      console.log(`[delete] ${relPath}`);
    }
    if (event === "addDir") {
      fs.ensureDirSync(destPath);
      console.log(`[mkdir] ${relPath}`);
    }
    if (event === "unlinkDir") {
      fs.removeSync(destPath);
      console.log(`[rmdir] ${relPath}`);
    }
  });
  console.log("Watching for image changes...");
}
