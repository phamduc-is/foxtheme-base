#!/usr/bin/env node
/**
 * List open Bitbucket PRs for this repo — powers /review-pr's menu without a
 * curl approval popup (this script is allow-listed by name in the command).
 *
 * Auth: ATLASSIAN_EMAIL + ATLASSIAN_API_TOKEN from the per-dev
 * `.claude/settings.local.json` env (scopes: read:pullrequest + read:repository).
 * Workspace/repo are derived from `git remote get-url origin`.
 *
 * Output: one tab-separated line per PR: #id · source-branch · title · author · updated
 * Exit 2 on missing creds / API failure — the caller falls back to the
 * unmerged-branches proxy.
 */
import { execFileSync } from "node:child_process";

const email = process.env.ATLASSIAN_EMAIL;
const token = process.env.ATLASSIAN_API_TOKEN;
if (!email || !token) {
  console.error("bitbucket-prs: ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN not set (see USAGE → Setup cho dev mới)");
  process.exit(2);
}

const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
const m = origin.match(/bitbucket\.org[:/]([^/]+)\/([^/.]+)/);
if (!m) {
  console.error(`bitbucket-prs: origin is not a bitbucket.org remote: ${origin}`);
  process.exit(2);
}
const [, workspace, repo] = m;

const fields = "values.id,values.title,values.author.display_name,values.source.branch.name,values.destination.branch.name,values.updated_on";
const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests?state=OPEN&pagelen=50&fields=${fields}`;
const res = await fetch(url, {
  headers: { Authorization: "Basic " + Buffer.from(`${email}:${token}`).toString("base64") },
});
if (!res.ok) {
  console.error(`bitbucket-prs: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  process.exit(2);
}
const data = await res.json();
const prs = data.values ?? [];
for (const pr of prs) {
  console.log(
    [`#${pr.id}`, pr.source?.branch?.name ?? "?", pr.title, pr.author?.display_name ?? "?", (pr.updated_on ?? "").slice(0, 16)].join("\t")
  );
}
if (!prs.length) console.log("(no open PRs)");
