// scripts/zip-theme.js
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs-extra");
const { name, version } = require("../package.json");

const ROOT = path.join(__dirname, "..");
const filename = `release/${name}-${version}.zip`;

// Make dir if not exists
fs.ensureDirSync(path.join(ROOT, "release"));

// Xoá file zip cũ nếu có
try {
  execSync(`rm -f ${filename}`, { cwd: ROOT });
} catch (e) {}

// release-notes.md rides along only when it exists: a live-theme UPDATE ships one (merchants read it
// in the admin), a first submission does not — the theme is not on the store yet and its version
// does not move between reviewer rounds (see /submit-theme step 4). Listing it unconditionally made
// `zip` print "name not matched" on every first-submission build.
const releaseNotes = fs.existsSync(path.join(ROOT, "release-notes.md")) ? " release-notes.md" : "";

// Exclude docs page & section from release zip
const zipCmd = `zip -r ${filename} assets blocks config layout locales sections snippets templates listings${releaseNotes} -x sections/docs-examples.liquid -x templates/page.docs.json`;
execSync(zipCmd, { cwd: ROOT, stdio: "inherit" });
console.log(`Đã tạo file: ${filename}`);
