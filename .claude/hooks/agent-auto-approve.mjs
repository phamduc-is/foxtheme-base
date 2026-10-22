#!/usr/bin/env node
/**
 * PreToolUse hook — per-agent-type auto-approve (config-driven).
 *
 * Reads `.claude/agent-permissions.json`, a map of `agent_type → rule`. A rule is
 * either an ALLOWLIST — `{ tools, bash }` (auto-approve only listed tools / bash
 * command prefixes) — or, for an isolated-worktree builder, AUTO-APPROVE-ALL:
 * `{ autoApprove: true, deny: [prefixes] }` (approve everything EXCEPT the guarded
 * `deny` prefixes, which are hard-DENIED — blocked, never prompted, so a background
 * agent can't stall). `denySkills: [names]` is the same hard-deny for the Skill
 * tool, kept as its own list because bash prefixes and skill names don't share a
 * namespace. Decisions apply ONLY to the listed `agent_type`; other agent types
 * and the main session fall through to normal permission prompting.
 *
 * Add a new agent type by adding an entry to agent-permissions.json — no code
 * change. Each agent type gets its own tools/bash allowlist.
 *
 * Wired as a PreToolUse hook in `.claude/settings.json` (core-owned → every fork
 * inherits it via `core:sync`; the script + config are committed alongside).
 * Registering it there rather than in the per-dev, gitignored
 * `settings.local.json` is what makes an unattended `/build-batch` / `/ship-batch`
 * work in a child fork out of the box.
 *
 * Safe by design: `git -C <path> <sub>` is normalized to `git <sub>` before
 * matching, so e.g. `git -C … push` does NOT match a `git add`/`git commit`
 * allow. Fail-open: any error → no decision (normal prompting).
 * Kill-switch: FOX_HOOKS=off → never auto-approves.
 *
 * SCOPE — this is a COOPERATIVE policy, not a sandbox: prefix deny stops
 * accidents and background stalls in agents we authored; it does not resist an
 * adversary (`bash -c "…"`, `env X=1 git push`, `$()` all evade it). Also the
 * segment split is quote-blind — a quoted arg containing `; <deny-prefix>`
 * (e.g. in a commit message) can false-DENY; keep agent-generated strings free
 * of `;`/`&&` where possible.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const passthrough = () => process.exit(0); // emit nothing → normal permission flow

if (process.env.FOX_HOOKS === "off") passthrough();

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  passthrough();
}

const agentType = data.agent_type ?? data.agentType;
const toolName = data.tool_name ?? data.toolName;
const command = data.tool_input?.command ?? data.toolInput?.command ?? "";
if (!agentType || !toolName) passthrough();

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let config;
try {
  config = JSON.parse(readFileSync(resolve(root, ".claude/agent-permissions.json"), "utf8"));
} catch {
  passthrough();
}

const rule = config[agentType];
if (!rule) passthrough();

// Reduce a leading `cd <path> && …`, a `git -C <path> <sub>`, and a
// `yarn --cwd <path> <script>` to the bare command, so per-command allows match
// however the agent navigated into its worktree. The `--cwd` rewrite matters
// for allowlist SAFETY too: without it an allow prefix would have to be the
// broad "yarn --cwd", which approves EVERY script (deploy included) —
// rewriting lets the allowlist name the actual one ("yarn check…").
// `node <repo-root>/scripts/<name>` (or a worktree's copy) ≡ `node scripts/<name>`
// — rewrite so the allowlist names the script once, however the agent addressed it.
// Only paths under THIS project rewrite; the same command on a path outside the
// project keeps its absolute form and falls through to a prompt.
const rootRe = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nodeScriptsRe = new RegExp(`^\\s*node\\s+["']?${rootRe}(?:/\\.worktrees/[^/"'\\s]+)?/scripts/`);
const normalize = (cmd) =>
  String(cmd)
    .replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "")
    .replace(/^\s*git\s+-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+/, "git ")
    .replace(/^\s*yarn\s+--cwd\s+(?:"[^"]*"|'[^']*'|\S+)\s+/, "yarn ")
    .replace(nodeScriptsRe, "node scripts/")
    .trim();

const emit = (decision, reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
};

// HARD DENY (Bash) — guarded commands are BLOCKED outright, NOT prompted, so a
// background agent never stalls on them. Checked per shell segment (split on
// && || ; |) with `git -C <path>` stripped per segment, so a compound like
// `git add . && git push` can't smuggle a denied command past the check. Deny
// wins over autoApprove.
if (toolName === "Bash" && Array.isArray(rule.deny) && rule.deny.length) {
  const segments = String(command)
    .split(/&&|\|\||;|\n|\|/)
    .map((s) =>
      s
        .trim()
        .replace(/^git\s+-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+/, "git ")
        .replace(/^yarn\s+--cwd\s+(?:"[^"]*"|'[^']*'|\S+)\s+/, "yarn ")
    );
  const hit = rule.deny.find((prefix) => segments.some((seg) => seg.startsWith(prefix)));
  if (hit) {
    emit(
      "deny",
      `blocked for agent ${agentType}: "${hit}…" is a guarded command (remote/deploy/destructive/network) — not part of building a feature. Do it yourself after review.`
    );
  }
}

// HARD DENY (Skill) — orchestration + destructive skills are BLOCKED, so a
// subagent can never fan out another batch (recursive agent spawn) or run a
// skill that pushes/deletes. Matched on the bare skill name, so a plugin-scoped
// invocation (`plugin:name`) can't slip past. Deliberately a SEPARATE list from
// `deny` (bash prefixes): sharing one would make the `shopify` bash prefix block
// `shopify-plugin:shopify-liquid`, the lookup CLAUDE.md makes mandatory.
if (toolName === "Skill" && Array.isArray(rule.denySkills) && rule.denySkills.length) {
  const raw = data.tool_input?.skill ?? data.toolInput?.skill ?? "";
  const name = String(raw).split(":").pop().trim();
  if (rule.denySkills.includes(name)) {
    emit(
      "deny",
      `blocked for agent ${agentType}: skill "${raw}" is orchestration/destructive — not part of building or testing one feature. Run it yourself after review.`
    );
  }
}

// AUTO-APPROVE — everything not denied above.
//   autoApprove: true  → allow-all-except-deny (isolated-worktree builders)
//   tools/bash lists   → the original per-tool / per-command allowlist model
let approve = false;
if (rule.autoApprove) {
  approve = true;
} else if (Array.isArray(rule.tools) && rule.tools.includes(toolName)) {
  approve = true;
} else if (toolName === "Bash" && Array.isArray(rule.bash)) {
  // Per-SEGMENT matching: a compound is approved only when EVERY segment matches
  // an allowed prefix — a single whole-string prefix check would let
  // `git status; <anything>` ride in on the first segment. (Same splitter as
  // the deny path above.)
  const segs = String(command)
    .split(/&&|\|\||;|\n|\|/)
    .map((s) => normalize(s))
    .filter((s) => s !== "");
  if (segs.some((seg) => /^cd(\s|$)/.test(seg))) {
    // `cd` also trips the harness's own manual-confirm gate — deny with the
    // remedy so the agent self-corrects instead of prompting the dev.
    emit(
      "deny",
      `blocked for agent ${agentType}: never use cd — re-run the same command via git -C / yarn --cwd / absolute paths (see your operating notes).`
    );
  }
  approve = segs.length > 0 && segs.every((seg) => rule.bash.some((prefix) => seg.startsWith(prefix)));
}

if (approve) emit("allow", `auto-approved for agent ${agentType}`);
passthrough();
