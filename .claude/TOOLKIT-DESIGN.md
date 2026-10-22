# Claude Code Toolkit — Design Doc

> **Trạng thái:** Bản nháp để team duyệt. Chưa implement.
> **Mục tiêu:** Xây bộ công cụ Claude Code (skills + agents + commands + hooks) cho FoxTheme Base, **share xuống child fork** qua pipeline `core:sync` sẵn có.

---

## 1. Mục tiêu & phạm vi

Bộ toolkit giải quyết 4 điểm đau hàng ngày của team theme:

1. **Tạo section/block/snippet/JS/SCSS mới** — lặp lại scaffold + schema + locale + scss, dễ sót bước.
2. **Conflict khi `core:sync`** core→child — giải thủ công mệt.
3. **Bug lọt** — locale thiếu key, vi phạm JS contract, stale template ref.
4. **Review/refactor chất lượng** — khó audit toàn diện đúng convention.

**Đối tượng:** team theme có kinh nghiệm (ưu tiên tăng tốc + lưới an toàn, không cần "dắt tay").
**IDE:** Claude Code là chính → xây native `.claude/`, **migrate hẳn** khỏi `.cursor/`.

---

## 2. Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| 1 | **Phân phối: Option 1** — commit `.claude/` vào repo, lan qua `core:sync` | Toolkit coupling sâu với code+version theme; dùng lại pipeline merge sẵn có; hooks gọi `scripts/check-*` cùng repo → không lệch version |
| 2 | **Hooks: chặn cứng (block)** khi phát hiện vi phạm | Team chấp nhận gate cứng để bug không lọt |
| 3 | **Migrate hẳn `.cursor/` → `.claude/`** | Claude Code là tool chính, `.cursor` là di sản |
| 4 | **Validate Liquid (chậm/mạng): Stop hook** (1 lần/turn), không PostToolUse mỗi edit | Vẫn block cứng mà không làm chậm từng lần sửa |
| 5 | Giữ cấu trúc self-contained để **sau này lên Plugin được** nếu cần dùng ngoài dòng fork | Mở cửa, không khóa |
| 6 | **Gỡ `claude-mem`; dựa native memory + 1 hook "memory-capture" zero-install** | claude-mem khó cài cho người mới + đôi lúc lỗi; nhu cầu thật chỉ là "đừng để thay đổi quan trọng biến mất ở phiên mới" → giải bằng native memory (sẵn có) + SessionStart surface git (xem §9b) |

---

## 3. Kiến trúc tổng

```
                    DEV (team theme)
        │ gõ /command            │ gõ prompt
        ▼                        ▼
   Slash Command ──────►   CLAUDE (context chính)  ◄──── CLAUDE.md (luật nền, luôn nạp)
                                 │  │  │
              tự nạp khi hợp ────┘  │  └──── tự spawn
                    ▼               │              ▼
                 Skills      ────────┘      Subagents (context riêng)
              (+ scripts)                   fork-sync / reviewer / locale
   ─────────────────────────────────────────────────────────────
   HOOKS (settings.json) bao quanh mọi tool-call → chặn cứng vi phạm
   ─────────────────────────────────────────────────────────────
   Tất cả nằm trong .claude/ committed → core:sync lan xuống mọi child
```

---

## 4. Cấu trúc thư mục đích

```
.claude/
  settings.json          # COMMITTED — hooks + permissions (core sở hữu → child inherit)
  settings.local.json    # gitignored — chỗ child override riêng (không bao giờ conflict)
  TOOLKIT-DESIGN.md      # tài liệu này
  skills/
    create-liquid-section/SKILL.md
    create-liquid-block/SKILL.md
    create-liquid-snippet/SKILL.md
    create-js-component/SKILL.md
    create-scss-module/SKILL.md
    update-locales/SKILL.md
    cart-operations/SKILL.md
    animation-motion/SKILL.md
    section-rendering-api/SKILL.md
    review-and-refactor/SKILL.md
    delete-section-block/SKILL.md          # "lên đời" từ rule
    # (KHÔNG còn shopify-liquid — validation → scripts/check-liquid.mjs + `yarn check-liquid`, §5.1)
  agents/
    fork-sync-resolver.md
    diff-reviewer.md
    locale-auditor.md
  commands/
    new-section.md  new-block.md  new-snippet.md  new-js.md  new-scss.md
    sync-core.md    review.md     audit-locales.md  delete-section.md  release.md
  hooks/                   # script điều phối hook (no-dep Node, version cùng repo)
    post-edit-guard.mjs    # PostToolUse — check nhanh (js-contract, missing-translate, settings-schema)
    stop-validate.mjs      # Stop — validate Liquid + check-template-refs
    session-context.mjs    # SessionStart — surface git gần đây (memory-capture, §9b)
```

---

## 5. Skills — migrate 1:1 từ `.cursor/skills/`

Nội dung giữ gần như nguyên (đã có frontmatter `name` + `description` đúng chuẩn). Chỉ cần copy sang `.claude/skills/` và rà lại path.

| Skill | Nguồn | Ghi chú |
|---|---|---|
| create-liquid-section | `.cursor/skills/create-liquid-section` | |
| create-liquid-block | `.cursor/skills/create-liquid-block` | |
| create-liquid-snippet | `.cursor/skills/create-liquid-snippet` | |
| create-js-component | `.cursor/skills/create-js-component` | |
| create-scss-module | `.cursor/skills/create-scss-module` | |
| update-locales | `.cursor/skills/update-locales` | Gộp thêm nội dung rule `locales-update` |
| cart-operations | `.cursor/skills/cart-operations` | |
| animation-motion | `.cursor/skills/animation-motion` | |
| section-rendering-api | `.cursor/skills/section-rendering-api` | |
| review-and-refactor | `.cursor/skills/review-and-refactor` | |
| **delete-section-block** | rule `.cursor/rules/delete-section-block.mdc` | **Mới**: lên đời từ rule thành skill |

> **shopify-liquid đã bị gỡ khỏi `.claude/skills/`** (quyết định Option A, §5.1). Không còn vendored skill/symlink.

> **Điểm khác cốt lõi vs Cursor:** không cần bảng routing thủ công (`when-to-use-skills`). Claude **tự chọn** skill theo `description`. Rule routing trở nên thừa.

### 5.1 `shopify-liquid` — tách 2 vai (ĐÃ TRIỂN KHAI ở Phase 1)

Skill này trùng nội dung với plugin chính thức `shopify-ai-toolkit`. Nó đóng **2 vai**, và ta tách đôi thay vì vendored cả cụm (lý do: symlink dễ vỡ trên Windows + `node_modules` không commit):

| Vai | Giải pháp | Vì sao |
|---|---|---|
| **Validation engine** (bắt buộc, Stop hook block) | **`yarn check-liquid`** — `scripts/check-liquid.mjs` + devDep `@shopify/theme-check-node@3.24.0` ở root `package.json` | Như mọi `yarn check-*`: cài bằng `yarn install` thường, version-pinned, **không symlink, không per-dev**, chạy mọi fork |
| **Kiến thức / doc-search** (advisory) | **Plugin `shopify-ai-toolkit` per-dev** + note trong `.claude/README.md` | Model + plugin lo; thiếu chỉ kém tiện, không vỡ gate |

**Đã làm:** xoá symlink `.claude/skills/shopify-liquid` + vendored `.agents/skills/shopify-liquid` + `skills-lock.json` + 3 script `skills:*`. Tạo `scripts/check-liquid.mjs` (full-app theme-check, local-only `OPT_OUT_INSTRUMENTATION=true`, truyền **absolute theme path** nếu không glob từ `/`). CLAUDE.md MANDATORY workflow → `yarn check-liquid` + plugin.

> ⚠️ **Còn lại cho Phase 2:** theme chưa có `.theme-check.yml` → `yarn check-liquid` hiện báo ~103 offense (phần lớn false-positive `UndefinedObject` cho snippet render-params). Trước khi làm gate block: thêm `.theme-check.yml` tinh chỉnh + Stop hook chỉ check file `.liquid` đã sửa (`--files`).

---

## 6. 10 Rules Cursor → đi về đâu

| Rule | Số phận |
|---|---|
| `when-to-use-skills` | **Bỏ** — Claude tự route theo `description` của skill |
| `read-before-edit` | → CLAUDE.md (nguyên tắc; đã có mục "Read before editing") |
| `confirm-before-edit` | → CLAUDE.md + permission mode của harness |
| `confirm-before-commit` | → CLAUDE.md + permission mode (commit vốn đã hỏi quyền) |
| `build-commands` | → CLAUDE.md (đã có mục Build Commands) |
| `project-map` | → CLAUDE.md (đã có mục PROJECT-MAP) + Stop hook nhắc `yarn map` |
| `respond-in-vietnamese` | → CLAUDE.md (preference team) |
| `skill-content-in-english` | → CLAUDE.md (convention viết skill) |
| `locales-update` | → gộp vào skill `update-locales` + hook `check-missing-translate` |
| `delete-section-block` | → **Skill** `delete-section-block` + command `/delete-section` |

---

## 7. Subagents (3) — việc nặng, cần context riêng

> ✅ **ĐÃ IMPLEMENT (Phase 3):** 3 file `.claude/agents/{fork-sync-resolver,diff-reviewer,locale-auditor}.md`. Skill-access đúng quy tắc: `diff-reviewer` có `tools: …, Skill` + `skills: [review-and-refactor]`; `locale-auditor` `skills: [update-locales]`; `fork-sync-resolver` không cần skill.

> ⚠️ **Quy tắc skill cho subagent (đã xác minh từ docs Claude Code):** subagent chỉ gọi được skill nếu (a) `tools:` để trống → kế thừa cả `Skill`, hoặc (b) liệt kê `Skill` trong `tools:`, hoặc (c) preload qua field `skills:`. Nếu `tools:` liệt kê mà thiếu `Skill` → **không dùng được skill nào**. Mỗi subagent dưới đây vì vậy phải khai báo rõ quyền truy cập skill.

### 7.1 `fork-sync-resolver`
- **Khi nào:** sau khi `yarn core:sync <ver>` báo conflict.
- **Làm gì:** đọc `.gitattributes` (merge=ours / merge=foxlocale), `git status`, phân loại từng file conflict theo chiến lược fork, đề xuất cách giải (giữ child / nhận core / merge tay). Tham chiếu FORK-WORKFLOW.md §8.
- **Tools:** Bash, Read, Edit.
- **Skill access:** không cần skill (dựa FORK-WORKFLOW.md) → giữ `tools:` giới hạn, không thêm `Skill`.
- **Lưu ý:** KHÔNG tự commit — chỉ giải và báo cáo, dev tự xác nhận.

### 7.2 `diff-reviewer`
- **Khi nào:** review diff trước commit/PR.
- **Làm gì:** chạy checklist skill `review-and-refactor` + `yarn check-js-contract:strict` + `yarn check-template-refs` + validate Liquid; fan-out mỗi file 1 agent; tổng hợp findings có mức độ.
- **Tools:** Read, Bash, Grep, **`Skill`** ← thêm để khám phá động (reviewer cần đối chiếu nhiều skill tùy loại file: create-liquid-section, create-js-component…). **KHÔNG Edit** (read-only audit).
- **Skill access:** thêm `Skill` vào `tools:` + preload `skills: [review-and-refactor]` (checklist luôn dùng).

### 7.3 `locale-auditor`
- **Khi nào:** sau khi thêm schema key, hoặc audit định kỳ.
- **Làm gì:** chạy `yarn check-missing-translate` + `yarn check-unused-translate`, vá key thiếu xuyên **tất cả** file locale (en/de/es/fr/it…), không chỉ en.default.
- **Tools:** Bash, Read, Edit.
- **Skill access:** preload `skills: [update-locales]` (luôn dùng 1 skill cố định → preload gọn hơn thêm `Skill`).

---

## 8. Slash commands — `/sync-core` + `/review-pr` (đã thu gọn)

> **Quyết định (Phase 4):** kế hoạch ban đầu có 10 command, nhưng review lại thấy phần lớn **trùng với skill auto-routing**. Skills đã tự nạp theo `description` → `/new-section|block|snippet|js|scss`, `/delete-section`, `/review`, `/audit-locales` đều **gọi bằng câu nói tốt hơn** (đặc biệt khi dựng feature đa phần: mô tả nguyên feature → Claude điều phối nhiều skill cùng lúc, không phải slash từng cái).
>
> **Nguyên tắc:** *đừng tạo slash command chỉ để bọc 1 skill đã auto-route.* Command chỉ đáng có khi **điều phối nhiều bước / spawn agent / có preprocessing**.

| Command | Vì sao GIỮ |
|---|---|
| ✅ `/sync-core [version]` | Workflow **phá huỷ, 2 confirm**: (stash WIP→) main mới → chọn version (bỏ trống=latest) → tạo `sync/core-<v>` → `dry-merge` preview → **confirm#1** → `core:sync` + `fork-sync-resolver` nếu conflict → rebuild+check → **confirm#2** → **land: merge vào main + push origin main + xoá sync branch** (fallback: main protected → push sync + PR, giữ branch) → về branch gốc + pop WIP. **Escape-hatch untagged:** core chỉ tag khi feat/fix (semantic-release) → docs/chore không tag; `/sync-core` nhận cả ref (`upstream/main`) + cảnh báo khi main ahead tag → lấy được latest dù chưa tag. `core-sync.mjs` nới validate nhận tag `vX.Y.Z` hoặc ref resolve được. |
| ✅ `/review-pr [branch… \| all]` | **Orchestrate review PR branch cho lead.** Không arg → liệt kê **branch chưa merge** (`git branch -r --no-merged origin/main` = proxy "PR mở", vì không có Bitbucket API) để chọn. 1 branch → báo cáo đầy đủ; **nhiều branch / `all`** → review tuần tự + **bảng triage** (branch · verdict · tóm tắt · #findings, worst-first), cap >5 phải confirm (mỗi branch = 1 lượt `diff-reviewer`). Cuối cùng checkout lại branch gốc. **Read-only: KHÔNG comment, KHÔNG merge** (lead tự làm). |

| Đã BỎ | Thay bằng |
|---|---|
| `/new-section|block|snippet|js|scss`, `/delete-section` | Nói tự nhiên → skill tự auto-route (`create-*`, `delete-section-block`) |
| `/review` (diff hiện tại), `/audit-locales` | Nói "review thay đổi" / "audit locale" → Claude spawn agent. *(Khác `/review-pr`: cái đó orchestrate fetch+checkout 1 PR branch khác — NL không làm gọn được.)* |
| `/release` | Mỏng (chỉ bọc `yarn release`) → gọi trực tiếp |

---

## 9. Hooks — chặn cứng (sketch `.claude/settings.json`)

**Nguyên tắc tách nhịp:** check nhanh (node local) → PostToolUse block ngay; check chậm/mạng → Stop hook (1 lần/turn).

| Check | Tốc độ | Event | Matcher | Hành vi |
|---|---|---|---|---|
| `check-js-contract --diff` | nhanh | PostToolUse | Edit\|Write trên `src/js/modules/*.js` | block nếu có class selector MỚI (ratchet) |
| `check-missing-translate` | nhanh | PostToolUse | Edit\|Write trên `sections/`,`blocks/`,`snippets/`,`locales/` | block nếu thiếu key |
| `check-settings-schema` | nhanh | PostToolUse | Edit\|Write trên `config/settings_schema.json` | block nếu JSON sai / dup id |
| `yarn check-liquid --files <đã sửa>` | trung bình | **Stop** | (các `.liquid` đã sửa trong turn) | block trước khi kết thúc turn — *cần `.theme-check.yml` trước, §5.1* |
| `check-template-refs --fail` | trung bình | **Stop** | khi có file structural mới | block |
| tự chạy `yarn map` | nhanh | **Stop** | khi add/delete/rename file structural (✅ đã làm) | regen PROJECT-MAP (gitignored), không block |

Phác cấu trúc:

```jsonc
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command",
            "command": "node .claude/hooks/post-edit-guard.mjs" }
        ]
      }
    ],
    "Stop": [
      { "hooks": [
          { "type": "command",
            "command": "node .claude/hooks/stop-validate.mjs" }
      ] }
    ],
    "SessionStart": [
      { "matcher": "startup|clear|compact",
        "hooks": [
          { "type": "command",
            "command": "node .claude/hooks/session-context.mjs" }
      ] }
    ]
  }
}
```

> SessionStart ở trên thuộc component **memory-capture** (§9b) — không phải hook "chặn", mà bơm context git vào phiên mới/sau-compact.

> **Thiết kế hook wrapper:** thay vì nhồi nhiều lệnh vào settings.json, dùng 1 script điều phối (`post-edit-guard.mjs`, `stop-validate.mjs`) đọc danh sách file bị sửa (từ payload hook), tự quyết chạy check nào, exit code 2 + message để **block**. Dễ test, dễ bảo trì, dễ version cùng repo.

> ✅ **ĐÃ IMPLEMENT (Phase 2):** 3 wrapper Node ở `.claude/hooks/` + `.claude/settings.json` (committed) đăng ký hook + `permissions.allow`. Hành vi đã xác minh qua smoke test:
> - `post-edit-guard.mjs` (PostToolUse Edit|Write): route file → chạy `check-js-contract --diff` / `check-settings-schema` / `check-missing-translate` → **exit 2 + stderr** khi vi phạm. (Codebase hiện pass sạch 3 check này → chỉ fail khi edit tạo lỗi mới.)
> - `stop-validate.mjs` (Stop): `git status` lấy `.liquid` đã đổi → `check-liquid --files` (+ `check-template-refs --fail` nếu structural) → `{"decision":"block","reason"}`. Tôn trọng `stop_hook_active`. **File-scoped** → 3 offense pre-existing (§5.1) không chặn việc khác.
> - `session-context.mjs` (SessionStart startup|clear|compact): in git context.
> - **An toàn (§15.1):** mọi wrapper **fail-open** (lỗi nội bộ → exit 0) + **kill-switch `FOX_HOOKS=off`** + per-check `FOX_DISABLED_HOOKS` + memory `FOX_MEMORY_CONTEXT=off`. Đã test các nhánh này.

---

## 9b. Component: memory-capture (thay claude-mem)

**Vấn đề thật:** không phải nhớ hết lịch sử. Chỉ là: làm xong việc *quan trọng* (refactor, fix bug, module mới) → đôi khi **quên dặn** ghi memory → mở **phiên mới** thì context đó biến mất, phiên mới mù.

**Quyết định:** gỡ `claude-mem` (khó cài, hay lỗi). Dùng **native memory (sẵn có, zero-install) + 1 hook surface git**. KHÔNG tái tạo claude-mem (không auto-summarize, không MCP, không search engine).

### Nền tảng: lifecycle đã xác minh từ docs Claude Code

| Sự kiện | Hội thoại sống sót? | Memory/CLAUDE.md/git |
|---|---|---|
| **Compaction** (context đầy / `/compact`) — *cùng session, KHÔNG phải phiên mới* | Tóm tắt có cấu trúc (giữ gist: intent, file đã sửa + snippet, lỗi+fix, task dở; **mất** output thô + reasoning) | ✅ **Tái nạp từ disk** sau MỖI lần compact |
| `claude --continue` / `--resume` | ✅ Khôi phục đầy đủ | ✅ |
| **Phiên mới / `/clear`** | ❌ **Mất** (chỉ còn CLAUDE.md + MEMORY.md) | ✅ |

> **Quy tắc vàng:** cái gì *quan trọng đủ để sống qua phiên mới* thì **bắt buộc đẩy ra disk** (memory + git commit). Compaction khoan dung; phiên mới phũ.

### ⚠️ Bẫy đã loại trừ (đừng sa lại khi implement)

- **`Stop` hook chạy sau MỖI lượt trả lời**, KHÔNG phải lúc hết phiên → không dùng Stop để "nhắc ghi cuối phiên" trừ khi **gate kỹ** (xem cơ chế 3).
- **`SessionEnd` & `PreCompact` là side-effect-only** — KHÔNG khiến Claude làm thêm 1 lượt, KHÔNG bơm context → **không capture ngữ nghĩa được**. Bỏ ý tưởng "ghi memory lúc hết phiên / trước compact".
- → Triết lý: **không capture ở cuối; surface ở đầu + capture ở lúc commit.**

### 3 cơ chế

**Cơ chế 1 (chủ lực) — SessionStart surface git** → `hooks/session-context.mjs`
- Hook `SessionStart`, matcher **`startup` + `clear` + `compact`** (cả 3, để sau compact cũng re-surface).
- stdout của SessionStart **được bơm thẳng vào context** (docs xác nhận) → xuất `git log --oneline -15` + `git diff --stat` (gồm cả thay đổi chưa commit).
- Kết quả: phiên mới / sau compact **không bao giờ mù** — thấy ngay "gần đây làm gì". Commit chính là bản ghi thay đổi quan trọng, zero công sức.
- Có **env opt-out** (vd `FOX_MEMORY_CONTEXT=off`) + giới hạn số dòng (bài học operator-hygiene từ ECC).

**Cơ chế 2 (bổ trợ) — CLAUDE.md: chủ động ghi memory**
- Chỉ dẫn Claude *tự* ghi memory sau việc quan trọng **không suy ra được từ git** (vd "chọn cách X vì Y" — diff không nói). Phần git không cover.
- `description` của memory phải rõ → để tầng recall theo ngữ nghĩa nổi đúng lúc. (Dòng index trong MEMORY.md luôn nạp; full file recall theo độ liên quan.)

**Cơ chế 3 (tùy chọn, để sau) — nhắc đúng lúc COMMIT**
- Tín hiệu "vừa xong việc quan trọng" = **commit**, không phải "hết phiên".
- Cách: `PostToolUse` khớp `git commit`, **hoặc** `Stop` hook `type: prompt` **có gate** (chỉ nhắc khi: lượt này có commit **và** phiên chưa ghi memory) → feed reason cho Claude ghi 1 memory.
- **Bắt buộc** tôn trọng cờ `stop_hook_active` (docs: Claude override sau 8 lần block liên tiếp).

### Đòn bẩy cho compaction
- Cơ chế 1 đã khớp matcher `compact`.
- Thêm mục **"Compact Instructions"** vào CLAUDE.md (docs hỗ trợ): bảo summary luôn giữ — quyết định + lý do, file đã đổi & bản chất, TODO/follow-up, thứ đã ghi memory phiên này. Dùng kèm `/compact focus on <X>` khi nén thủ công.

### Việc cần làm
- [x] **Viết `hooks/session-context.mjs`** (Phase 2) — SessionStart `startup|clear|compact`, in `git log -15` + branch + uncommitted, opt-out `FOX_MEMORY_CONTEXT=off`, fail-open.
- [x] **Chỉ dẫn "chủ động ghi memory" + "Compact Instructions" trong CLAUDE.md** (Phase 1, mục Memory & Continuity).
- [ ] **Disable `claude-mem`** — USER ACTION: `/plugin disable claude-mem@thedotmack` (global). Hook session-context đã thay chức năng trước → không gap. Gỡ hẳn sau bằng `/plugin uninstall`.
- [ ] (Tùy chọn) cơ chế 3 (nhắc lúc commit) — đánh giá sau khi cơ chế 1+2 chạy thực tế.

---

## 9c. MCP servers (layer tùy chọn — Figma, Chrome…)

MCP là **layer thứ 4** (kết nối ngoài), khác skills/hooks/agents. Điểm giao với toolkit: **project scope `.mcp.json` dùng ĐÚNG cơ chế propagation** đã chốt (commit → lan core→child). Nhưng MCP khác 3 điểm nên **không đối xử như skill/hook**.

### 3 scope

| Scope | Lưu ở | Commit/share? | Dùng cho |
|---|---|---|---|
| **local** | `~/.claude.json` | ❌ riêng bạn, project này | thử nghiệm cá nhân |
| **project** | **`.mcp.json`** (gốc repo) | ✅ **commit, lan core→child** | server cả team cần |
| **user** | `~/.claude.json` | ❌ riêng bạn, mọi project | server cá nhân, cần auth riêng |

### Format `.mcp.json` (project scope)

```jsonc
{
  "mcpServers": {
    "chrome": {                      // stdio — chạy local
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    },
    "figma": {                       // http/remote
      "type": "http",
      "url": "https://mcp.figma.com/mcp",
      "headers": { "Authorization": "Bearer ${FIGMA_TOKEN}" }
    }
  }
}
```
- **Secret:** KHÔNG hardcode vào `.mcp.json` committed. Dùng env expansion `${VAR}` / `${VAR:-default}`; giá trị thật ở env shell hoặc `.env` (gitignored). Figma/Chrome chính thức dùng **OAuth** (gõ `/mcp` để auth) → không cần token trong file.
- **CLI:** `claude mcp add --transport <stdio|http|sse> --scope <local|project|user> [--env K=V] <name> -- <cmd>`; `claude mcp list|get|remove`.
- **Token cost:** rất thấp — Tool Search defer schema, chỉ nạp tên tool lúc start (đặt `alwaysLoad: true` nếu muốn nạp sẵn).

### 3 khác biệt khiến phải scope cẩn thận (vs skill/hook)

1. **Auth/secret** — Figma cần token/OAuth; skill/hook không có secret → secret per-dev, không commit.
2. **Per-dev approval** — `.mcp.json` committed **KHÔNG tự bật** trên máy đồng đội (hiện `⏸ Pending approval`); mỗi dev phải duyệt + tự auth. Pre-approve team qua `permissions.allow: ["mcp__*"]` trong settings.json *(xác nhận key pre-enable server committed lúc implement)*.
3. **Nặng + phụ thuộc ngoài** — spawn process, cần `npx`/mạng/OAuth. **Đúng bài học claude-mem**: ép 1 MCP project-scope lên *mọi* child fork = nhân friction; headless/CI có thể thiếu auth.

### Khung quyết định (ánh xạ Option 1)

| Server | Scope đề xuất | Lý do |
|---|---|---|
| **Chrome DevTools** | **project** (commit, lan) | Không secret; hợp `diff-reviewer` (console error, visual, lighthouse) + verify thay đổi → chạm điểm đau #4 |
| **Figma** | **user** (không commit) | Cần OAuth cá nhân; chỉ dev design-handoff mới cần → đừng ép cả fork |

### Tie-in & wiring
- Subagent truy cập được MCP tool (qua ToolSearch) → `diff-reviewer` có thể dùng Chrome MCP mở preview, bắt lỗi console thật.
- **MCP là layer tùy chọn/additive** — không phải lõi 4 điểm đau (trừ review); **đừng để toolkit phụ thuộc nó**.
- `.mcp.json` committed → **không** merge=ours (core thêm server chung, child inherit); server riêng child → user/local scope → tránh conflict.
- Ghi env vars cần set vào **FORK-WORKFLOW.md**.

---

## 10. Propagation core → child (Option 1)

- **Hooks ở `.claude/settings.json` committed** → core sở hữu, child inherit khi sync.
- **`.claude/` KHÔNG đặt `merge=ours`** → child luôn nhận toolkit mới nhất từ core.
- Conflict chỉ xảy ra nếu child tự sửa file core → **quy ước:** child override ở `.claude/settings.local.json` (đã gitignore).
- `.gitignore` hiện đã có `.claude/skills/*/node_modules/` và `.claude/*.lock` → giữ.
- **`PROJECT-MAP.md` = generated, gitignored (KHÔNG commit)** — bỏ track để hết conflict (dev-to-dev + core→child) và hết stale-trong-VCS. Không có script/CI nào đọc nó làm input nên gitignore an toàn. **Auto-regen đa tầng đảm bảo luôn có/tươi:**
  - `postinstall: yarn map` → `yarn install` / clone mới có ngay.
  - **husky `post-merge` + `post-checkout`** → regen sau `git pull`/merge + đổi branch (case pull commit-rồi nên Stop hook không thấy).
  - **stop-validate hook** → regen khi turn có add/delete/rename structural (bắt cả thay đổi *chưa commit* như `git stash apply`).
  - skills `create-*`/`delete-section-block` → re-map khi tạo/xóa.
  - Bảng coverage: install→postinstall · pull/merge/checkout→husky · uncommitted (stash/edit)→stop-validate · agent tạo/xóa→skills.

**Việc cần làm khi wiring (✅ Phase 5):**
- [x] Cập nhật `CLAUDE.md`: bảng `.cursor/skills/*` → `.claude/skills/*` (Phase 1).
- [x] Cập nhật `FORK-WORKFLOW.md`: mục "Claude Code toolkit" (§2) — core-owned, inherit, override qua settings.local.json, restart sau sync.
- [x] Xác nhận `.gitattributes` KHÔNG khóa `.claude/` về merge=ours (`git check-attr` = unspecified) + thêm comment làm rõ.
- [x] **Vá lỗ gitignore:** `.claude/settings.local.json` thêm vào repo `.gitignore` (trước chỉ ignore bởi global của 1 máy → child fork có thể commit nhầm).
- [x] **Bẫy đã tránh:** rule `README.md merge=ours` (không neo root) khớp cả `.claude/README.md` → dev-guide đặt tên **`.claude/USAGE.md`** để inherit đúng (không sửa rule README.md sẵn có vì ảnh hưởng child fork khác).
- [ ] **Canary** — USER ACTION: áp 1 child fork trước, chạy vài ngày rồi nhân rộng (xem `.claude/USAGE.md`).
- [x] ~~Postinstall cho `shopify-liquid` deps~~ — **không còn cần** (Option A): theme-check là devDep root, cài bằng `yarn install` thường.

---

## 11. Migrate & dọn `.cursor/`

- Copy 10 skill `.cursor/skills/*` → `.claude/skills/*` (rà path `scripts/search_docs.mjs`, `validate.mjs` — đã có `yarn skills:patch` hỗ trợ).
- Chuyển nội dung rule cần giữ vào CLAUDE.md (xem §6).
- Sau khi verify `.claude/` chạy đúng → **xóa `.cursor/skills/` và `.cursor/rules/`** trong 1 commit riêng (dễ revert).

---

## 12. Kế hoạch theo phase (để duyệt từng bước)

| Phase | Nội dung | Đầu ra kiểm chứng |
|---|---|---|
| **0** | Duyệt design doc này | (bạn đang ở đây) |
| **1 — Skills** ✅ | Migrate 10 skill + tạo `delete-section-block`; **bỏ vendored shopify-liquid → `yarn check-liquid`** (Option A, §5.1); **refactor CLAUDE.md (§13b)**; dọn `.cursor` | Claude tự nạp đúng skill; `yarn check-liquid` chạy local OK |
| **2 — Hooks** ✅ | 3 wrapper + fail-open + kill-switch (§15.1) + `permissions` (§15.2) + smoke test (§15.3) + `settings.json` + `.theme-check.yml` (task #8). *claude-mem: chờ user `/plugin disable`* | Block đúng vi phạm; fail-open khi hook lỗi; phiên mới thấy git context; smoke-test pass |
| **3 — Subagents** ✅ | `.claude/agents/{fork-sync-resolver,diff-reviewer,locale-auditor}.md` — skill-access đúng quy tắc | Đăng ký OK; diff-reviewer chạy read-only trên diff thật |
| **3b — MCP (tùy chọn)** | Chrome DevTools → project scope `.mcp.json` (hỗ trợ reviewer); Figma → user scope per-dev (§9c) | `diff-reviewer` mở preview/bắt console error |
| **4 — Commands** ✅ | **Chỉ `/sync-core`** (thu gọn — bỏ command trùng auto-route, §8); xác nhận cho bước phá huỷ (§15.6) | `/sync-core` xuất hiện sau restart |
| **5 — Propagation** ✅ | `.claude/USAGE.md`; `.gitignore` vá settings.local.json; `.gitattributes` comment; FORK-WORKFLOW.md mục toolkit. *Canary = USER ACTION.* | gitignore/gitattributes verify OK; docs đầy đủ; canary chờ user áp 1 child fork |

---

## 13. Mở rộng tương lai (không làm bây giờ)

- **Plugin path:** nếu cần dùng toolkit cho project NGOÀI dòng fork, "nhấc" `.claude/` thành plugin + marketplace riêng. Giữ self-contained để chi phí chuyển thấp.
- **MCP:** chưa cần. Cân nhắc nếu sau này muốn tích hợp Shopify Admin API / preview store trực tiếp.
- **Statusline (nice-to-have):** dòng trạng thái đáy terminal (settings.json `statusLine` → script nhận JSON qua stdin). Hữu ích để hiện **đang ở core hay child fork** + branch + theme version → giảm nhầm khi nhảy giữa nhiều fork. Propagate qua settings.json committed; có agent `statusline-setup` hỗ trợ dựng. Cosmetic, không chạm 4 điểm đau → để sau.
- **Output styles:** KHÔNG dùng — ghi đè lõi system prompt, dễ phá convention. Cần "chế độ" riêng thì dùng subagent (vd `diff-reviewer`) thay vì output style.

---

## 13b. Refactor CLAUDE.md (làm ở Phase 1 — nghiên cứu kỹ trước khi sửa)

> **Note:** CLAUDE.md hiện đã dài và có mục "Code Quality Principles". Khi vào Phase 1, **nghiên cứu & refactor lại toàn bộ CLAUDE.md cho phù hợp** với toolkit mới (đổi bảng `.cursor/skills/*` → `.claude/skills/*`, gỡ phần routing thừa, gọn lại). Không sửa lặt vặt rời rạc.

**Ý tưởng cần cân nhắc khi refactor — merge bộ "behavioral guidelines" kiểu Karpathy** (nguồn: `multica-ai/andrej-karpathy-skills/CLAUDE.md`):
- **Thêm** phần *additive*: "Think before coding" (nêu giả định, hỏi khi mơ hồ, trình bày các cách hiểu, push back) + chi tiết "Surgical changes" (match style sẵn có, không đụng code lân cận, chỉ dọn orphan do chính mình tạo).
- **Bỏ trùng**: §"Simplicity First" và phần verify đã có sẵn trong "Code Quality Principles" → gộp, đừng tạo section thứ 2.
- **Adapt, KHÔNG bê nguyên** phần "Goal-Driven Execution": khung "viết test reproduce bug" KHÔNG hợp theme SSR (không có test framework). Đổi verify về thực tế: build + `yarn check-*` + Theme Editor / browser.
- Viết bằng **tiếng Anh** (đúng convention `skill-content-in-english`).
- Đã có bản nháp merge thảo luận ngày 2026-06-03 — tái dựng từ đây khi làm.

---

## 14. Câu hỏi mở → đã chốt

| Câu hỏi | Quyết định | Lý do |
|---|---|---|
| `confirm-before-commit/edit`: CLAUDE.md hay PreToolUse hook chặn? | **CLAUDE.md + permission mode** (KHÔNG hook block) | Commit/edit đã qua permission của harness; PreToolUse block trên `git commit` chỉ thêm phiền, không thêm an toàn |
| `diff-reviewer` diff so base nào? | **Mặc định `git diff main...HEAD` + thay đổi chưa commit**; cho override base qua arg | Khớp workflow `feat/*` branch; review đúng phần branch thêm vào so với `main` |
| Gộp `/new` hay giữ 5 lệnh `/new-*`? | **Giữ 5 lệnh riêng** | Rõ ràng, tab-complete được, `argument-hint` riêng từng loại; chi phí thấp |

---

## 15. Hardening & rủi ro cần xử lý (bổ sung — theo thứ tự ưu tiên)

### 🔴 15.1 An toàn hook: fail-open + kill-switch toàn cục **(bắt buộc)**

Hard-block + propagate xuống mọi fork → **1 hook bug có thể tê liệt mọi child fork**. Quy tắc thiết kế cho mọi hook wrapper:

- **Phân biệt 2 loại exit:**
  - `exit 2` **chỉ khi** đúng là *vi phạm* (class selector mới, locale thiếu key…) → block có chủ đích.
  - `exit 1` khi **hook tự lỗi** (script crash, thiếu `node`, file không đọc được…) → **warn, KHÔNG block** (fail-open). Hạ tầng hỏng không được chặn việc của dev.
- **Kill-switch toàn cục:** mọi wrapper đọc env `FOX_HOOKS` — nếu `=off` thì `exit 0` ngay. Cho debug gấp / CI tắt được mà không sửa settings.json. (Tổng quát hoá `FOX_MEMORY_CONTEXT` của §9b.)
- **Per-hook opt-out:** vd `FOX_DISABLED_HOOKS=js-contract,validate` (bài học operator-hygiene từ ECC).
- **Stop hook:** tôn trọng cờ `stop_hook_active` (Claude override sau 8 lần block liên tiếp) — áp cho cả `stop-validate.mjs` lẫn cơ chế 3 §9b.
- **Timeout:** đặt timeout ngắn cho hook command; quá hạn → fail-open.

### 🔴 15.2 Thiết kế `permissions` trong settings.json committed **(bắt buộc)**

Không pre-allow → dev child fork bị **spam prompt** mỗi lần Claude chạy `yarn check-*`, `git status`, `node scripts/*` → toolkit bị tắt vì phiền. Cần:
- Allowlist các lệnh **an toàn, đọc-là-chính** hay dùng trong `.claude/settings.json` (committed): `yarn check-*`, `yarn map`, `git status|diff|log`, `node scripts/*`…
- `permissions.allow: ["mcp__*"]` nếu duyệt sẵn MCP cho team (§9c).
- Dùng skill **`fewer-permission-prompts`** để quét transcript → sinh allowlist hợp lý thay vì đoán.
- Lệnh **phá huỷ** (`git push`, `core:sync`, xoá file) **KHÔNG** allow sẵn → giữ prompt.

### 🔴 15.3 Test & rollout cho chính toolkit **(bắt buộc)**

- **Test hook trước khi ship:** fixture 1 file *vi phạm* + 1 file *sạch* cho mỗi check → xác nhận block đúng cái vi phạm và **fail-open** khi script lỗi.
- **Smoke test skill/subagent/command** trên core trước.
- **Rollout canary:** bật trên **1 child fork** trước, chạy thật vài ngày → rồi mới propagate toàn bộ. Không bật đồng loạt.

### ✅ 15.4 Portability của symlink `shopify-liquid` — ĐÃ GIẢI QUYẾT (Option A)

Vấn đề symlink (vỡ trên Windows/CI) **không còn** — đã gỡ hẳn symlink + vendored shopify-liquid. Validation giờ là `yarn check-liquid` (devDep root, không symlink). Xem §5.1.

### 🟡 15.5 README dùng `.claude/` cho dev

Design doc này là tài liệu *thiết kế*, không phải *hướng dẫn dùng*. Thêm `.claude/README.md` ngắn: có command/skill/hook gì, hook làm gì, **cách tắt** (`FOX_HOOKS=off`), env vars cần set (Figma token…). Quyết định adoption.

### 🟡 15.6 Lệnh phá huỷ cần xác nhận

`/delete-section`, `/sync-core` khó hoàn tác → command phải in tóm tắt việc sắp làm + yêu cầu xác nhận trước khi chạy bước phá huỷ; không dựa hoàn toàn vào permission mode.

### 🟡 15.7 Versioning toolkit ↔ theme

Option 1 co-version với theme. Nói rõ trong FORK-WORKFLOW.md: thay đổi toolkit đi theo **CHANGELOG/release của theme** (`release.mjs`); child biết toolkit đổi gì khi đọc release notes lúc `core:sync`.

### 🟢 15.8 Tối ưu nhỏ

- **Model rẻ cho subagent thuần cơ học:** `locale-auditor` cân nhắc `model: haiku` (chạy check + vá key, không cần suy luận sâu).
- **Success metrics:** theo dõi để biết toolkit hiệu quả — số bug locale lọt, thời gian tạo section, số lần escalate sync-conflict.
- **Hook ↔ CI nhất quán:** hook = feedback nhanh local, CI = nguồn chân lý; **cùng gọi `yarn check-*`** nên không lệch — giữ nguyên tắc này khi sửa script.

---

## 16. Bảo trì & dispatch (vận hành lâu dài)

### 16.1 Sửa/thêm/xoá có dễ không?

| Loại | Cơ chế | Độ dễ | Lưu ý |
|---|---|---|---|
| **Skills** | Folder + `SKILL.md` (markdown) | ✅ Rất dễ | Thêm = tạo folder + frontmatter; xoá = xoá folder. **Không build, không restart** |
| **Agents** | 1 file `.md` (markdown + frontmatter) | ✅ Rất dễ | Drop-in file, không build |
| **Hooks** | JSON `settings.json` + script `.mjs` | 🟡 Cẩn thận hơn | JSON dễ sai cú pháp; đổi settings.json **thường cần mở phiên mới** mới áp; hook lỗi có thể block → §15.1 |

**Mẹo đã thiết kế:** logic hook nằm trong **wrapper `.mjs`**, settings.json chỉ trỏ tới script. → Sửa hook hằng ngày = sửa `.mjs` (dễ, test bằng fixture §15.3), không đụng JSON.

**Sửa đúng CHỖ (fork):**
- Thay đổi *dùng chung* → sửa ở **core** → lan xuống child qua `core:sync`.
- Child sửa file core-owned → **conflict** lần sync sau. Child muốn riêng → để ở `settings.local.json` (§10).
- Đổi tên/API skill → grep cập nhật tham chiếu (CLAUDE.md, `skills:patch` cho shopify-liquid).

### 16.2 Claude biết lúc nào dùng skill/agent nào? — gần như TỰ ĐỘNG

| Primitive | Ai quyết | Dựa vào |
|---|---|---|
| **Skills** | Claude **tự chọn** | trường `description` |
| **Agents** | Claude **tự spawn** | trường `description` ("Use this agent when…") |
| **Hooks** | Không ai — chạy máy móc | `event` + `matcher` (deterministic) |
| **Commands** | **Bạn gõ** `/tên` | chủ động |

- **`description` = "hợp đồng định tuyến".** Claude đọc description của *mọi* skill/agent rồi tự khớp task → **không cần bảng routing thủ công** (lý do bỏ rule `when-to-use-skills`). Vẫn ép tay được: `/skill-name` hoặc "dùng agent X".
- **Quy tắc bảo trì #1:** routing sai → cách sửa gần như **luôn là "viết lại `description` cho rõ"**, không phải thêm logic. Description mơ hồ = định tuyến kém.
- **Skill vs Agent cho việc giống nhau** (vd `review-and-refactor` skill vs `diff-reviewer` agent): description nêu rõ — skill = *hướng dẫn ngay trong phiên* (Claude tự làm); agent = *giao 1 lượt ở context riêng* (delegated).
