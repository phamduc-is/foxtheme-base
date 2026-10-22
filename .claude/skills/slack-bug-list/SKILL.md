---
name: slack-bug-list
description: Use when working with the team's Slack List of tester-reported bugs — reading the list, building a triage table, or updating an item's status after a fix lands. For "đọc list bug", "triage bug từ slack", "update status bug X". Phase 6 (post-launch) intake — bugs route back into P2 lanes. Requires SLACK_BOT_TOKEN (per-dev, settings.local.json) and the List shared with the bot. Not for Slack messages/channels, and NOT a fixer — fixes go through review-and-refactor / /revise / /fix-core.
---

# Slack bug list (Phase 6 — bug intake)

Testers file bugs as items in a **Slack List** (one List per child fork). This skill reads that list, triages it, and updates statuses — the fixes themselves always go through the normal P2 lanes.

## Prerequisites (fail with the exact remedy, never guess)
- **`SLACK_BOT_TOKEN`** env var (per-dev `.claude/settings.local.json` → `env`; get the token from the teamlead — one shared workspace app (currently "DP Coder", bot @dpcoder)). Missing → say so, point at USAGE "Setup cho dev mới".
- Bot scopes: `lists:read`, `lists:write`, `files:read` (already on the shared app; a `missing_scope` error names the gap — the fix is add-scope + reinstall at api.slack.com/apps, teamlead-only).
- The List must be **shared with the bot** — convention: the bot is invited to the fork's channel and the List is shared with that channel. An access error on a correct id → the List isn't shared yet.
- **The fork's `list_id`** (`F0…` from the List's Copy-Link URL) lives in `.claude/CHILD.md` under a `Slack bug list:` line. Not there → ask the dev once, then suggest adding it to CHILD.md.

## Which list? — resolution order (the bot can see several)
1. **Explicit id/link** in the request (`F0…`) → use it.
2. **A name/keyword** ("list motrix", "list bug hyper") → enumerate what the bot can access and match the TITLE:
   ```bash
   curl -s -X POST https://slack.com/api/files.list \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" -d "types=list" -d "count=50"
   # → .files[]: {id: F…, title: "MOTRIX - Bugs Report", filetype: "list"}
   ```
   Exactly one title matches the keyword → use it (say which). **Two+ match → list them and ask — never pick for the dev.**
3. **Nothing specified** → the current repo's `.claude/CHILD.md` `Slack bug list:` line (repo context = fork = its list).
4. None of the above resolves → show the `files.list` titles and ask.

## Reading — always schema first, never hardcode ids
Column ids and select-option ids are **per-List** — the same "Status" column has different ids in every fork's list. Resolve everything by NAME/label at runtime:

```bash
# 1. Schema: column names + select choices (List is a file — files.info)
curl -s -X POST https://slack.com/api/files.info \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -d "file=<LIST_ID>"
# → .file.list_metadata.schema[]: {id, name, key, type, options.choices[{value: OptID, label}]}

# 2. Items (paginate with response_metadata.next_cursor; limit max 100)
curl -s -X POST https://slack.com/api/slackLists.items.list \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -d "list_id=<LIST_ID>" -d "limit=100"
# → .items[]: {id (Rec…), fields[{column_id, value, …typed value}]}
```

Decoding rules (verified against the real motrix list):
- `text` columns arrive as **rich_text JSON** — flatten by walking `elements[].text`.
- `select` values are `OptID`s → map via schema choices; **multi-select cells join values with `|`** — split before mapping.
- A select value not present in `choices` = a deleted/archived option — show the raw id, don't crash.
- `user` values are Slack user ids (`U…`); resolve names only if needed (`users:read` scope NOT granted by default — usually the id is enough since Assignee also shows in Slack).

## Triage output
One table, grouped/sorted: `priority · status · module · summary (· Rec-id)`. Then propose a **route per bug** — the dev decides:
- bug in a child-owned file → `review-and-refactor` (direct fix)
- bug in a feature that has a brief/worktree → `/revise <type>:<name> "<bug>"`
- bug in a CORE file → `/fix-core <file> "<fix>"`
- "Improve"/"Backlog" issue types → usually Jira material, not a hotfix — flag, don't fix.

## Updating status — only after the dev confirms the fix landed
`slackLists.items.update` writes cells by `row_id` (the item's `Rec…` id) + `column_id`:

```bash
curl -s -X POST https://slack.com/api/slackLists.items.update \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"list_id":"<LIST_ID>","cells":[{"row_id":"<Rec…>","column_id":"<StatusColId>","select":["<OptID>"]}]}'
```
- Resolve the target `OptID` from the schema by **label** (e.g. the choice whose label contains "FIXED") — labels are the team's contract, ids are not.
- ⚠️ The select-cell payload shape (`"select": ["Opt…"]`) follows the documented cells pattern but was **not yet exercised against a live list** — on the FIRST status update, verify the response (`ok:true`) and eyeball the List; if the shape differs, fix this file in the same commit.
- Optionally append attribution to the **Note** column (`fixed by <git user> — PR #<n>`), since bot updates all show as the bot.

## Hard rules
- **Read freely; write only Status/Note, only on items the dev names, only after they confirm the fix is merged.** Never `items.delete`, never touch other columns, never create items (testers own intake).
- Status flows FORWARD only (TO DO → IN PROGRESS → FIXED/INREVIEW) unless the dev explicitly says to reopen.
- Rate limit Tier 2 (~20 req/min) — batch cell updates into one `items.update` call per item, don't loop per-cell.
