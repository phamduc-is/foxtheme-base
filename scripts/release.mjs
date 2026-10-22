#!/usr/bin/env node
// Usage: yarn release --version=v1.1.0

import { execSync } from "child_process";

const version = process.argv[2];

if (!version) {
  console.error("Missing version. Usage: yarn release v1.1.0");
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version format: "${version}". Expected: v1.0.0`);
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

// Guard: kiểm tra tag chưa tồn tại trước khi làm bất cứ thứ gì
try {
  execSync(`git rev-parse ${version}`, { stdio: "ignore" });
  console.error(`Tag "${version}" already exists. Bump the version and try again.`);
  process.exit(1);
} catch {
  // tag chưa tồn tại → tiếp tục
}

console.log(`\nReleasing ${version}...`);

run(`git-cliff --config cliff.toml --tag ${version} --output CHANGELOG.md`);
run("git add CHANGELOG.md");
run(`git commit -m "chore(release): ${version}"`);
run(`git tag -a ${version} -m "${version}"`);
run("git push origin main");
run(`git push origin ${version}`);

console.log(`\nDone! Released ${version}`);
