// Copy all JS files from src/js to assets. If --watch is passed, watch for changes.
// With --strip-comments (used by `yarn zip` only), JS is passed through terser
// with compress/mangle OFF — code ships readable, comments (JSDoc/@capability
// headers) stay a dev-only artifact.

const fs = require("fs-extra");
const chokidar = require("chokidar");
const path = require("path");

const srcDir = path.join(__dirname, "../src/js");
const destDir = path.join(__dirname, "../assets");

// Danh sách các thư mục con được phép copy (ví dụ: chỉ copy từ 'modules' và 'utils')
const allowedDirs = ["modules", "utils", "global", "custom"];

// Helper: kiểm tra filePath có nằm trong allowedDirs không
function isInAllowedDirs(filePath) {
  // Lấy relative path từ srcDir
  const rel = path.relative(srcDir, filePath);
  const pathParts = rel.split(path.sep);

  // Skip backup folders (e.g., backup-gsap)
  if (pathParts.some((part) => part.includes("backup"))) {
    return false;
  }

  // Lấy thư mục gốc đầu tiên
  const firstDir = pathParts[0];
  return allowedDirs.includes(firstDir);
}

// Helper: kiểm tra file có phải .js hoặc .mjs không
function isJsModuleFile(filePath) {
  return filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".css");
}

// Helper: copy 1 file js/mjs vào assets, giữ nguyên tên file
function copyJsFileToAssets(filePath) {
  if (!isJsModuleFile(filePath)) return;
  const fileName = path.basename(filePath);
  fs.copySync(filePath, path.join(destDir, fileName), { overwrite: true });
}

// --strip-comments: rewrite the copied .js/.mjs through terser, dropping ONLY
// comments (compress/mangle off, beautified output). A parse failure exits
// non-zero so `yarn zip` fails loudly instead of packaging a broken asset.
async function stripCommentsInAssets(fileNames) {
  const { minify } = require("terser");
  for (const fileName of fileNames) {
    if (fileName.endsWith(".css")) continue;
    const target = path.join(destDir, fileName);
    const result = await minify(fs.readFileSync(target, "utf8"), {
      compress: false,
      mangle: false,
      format: { comments: false, beautify: true },
    });
    fs.writeFileSync(target, result.code);
  }
  console.log(`Stripped comments from ${fileNames.filter((f) => !f.endsWith(".css")).length} JS assets (terser, code unchanged).`);
}

// Helper: xóa 1 file js/mjs khỏi assets
function removeJsFileFromAssets(filePath) {
  if (!isJsModuleFile(filePath)) return;
  const fileName = path.basename(filePath);
  fs.removeSync(path.join(destDir, fileName));
}

// Copy all JS/MJS files initially (duyệt đệ quy). Trả về danh sách tên file đã copy.
function copyAllJsFiles(dir, copied = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      copyAllJsFiles(entryPath, copied);
    } else if (entry.isFile() && isJsModuleFile(entry.name) && isInAllowedDirs(entryPath)) {
      copyJsFileToAssets(entryPath);
      copied.push(path.basename(entryPath));
    }
  });
  return copied;
}

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");
const skipInitialCopy = args.includes("--skip-initial-copy");
const stripComments = args.includes("--strip-comments");

// Copy files initially nếu không skip
if (!skipInitialCopy) {
  const copied = copyAllJsFiles(srcDir);
  if (stripComments) {
    stripCommentsInAssets(copied).catch((err) => {
      console.error(`--strip-comments failed: ${err.message}`);
      process.exit(1);
    });
  }
}

// Watch for changes if run with --watch
if (isWatch) {
  // Nếu skip initial copy, vẫn cần scan lại để phát hiện file mới
  if (skipInitialCopy) {
    console.log(`Scanning for JS/MJS files in allowedDirs (${allowedDirs.join(", ")})...`);
    copyAllJsFiles(srcDir);
  }

  chokidar.watch(srcDir, { ignoreInitial: true }).on("all", (event, filePath) => {
    if (!isJsModuleFile(filePath) || !isInAllowedDirs(filePath)) return;
    if (event === "add" || event === "change") {
      copyJsFileToAssets(filePath);
      console.log(`[${event}] ${path.basename(filePath)}`);
    }
    if (event === "unlink") {
      removeJsFileFromAssets(filePath);
      console.log(`[delete] ${path.basename(filePath)}`);
    }
  });
  console.log(`Watching for JS/MJS changes in allowedDirs (${allowedDirs.join(", ")})...`);
}
