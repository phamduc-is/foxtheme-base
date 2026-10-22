# Claude Code toolkit — hướng dẫn dùng

Bộ công cụ Claude Code cho FoxTheme Base, **commit trong repo** và **lan xuống child fork** qua `yarn core:sync`. Thiết kế đầy đủ: [`TOOLKIT-DESIGN.md`](./TOOLKIT-DESIGN.md).

## Bản đồ vòng đời theme — toolkit xếp theo phase

Mọi tool trong bộ này thuộc về một **phase của vòng đời theme** (hoặc một lane xuyên suốt). Đang ở phase nào → tra ngăn đó:

```
P0 Bootstrap ─▶ P1 Break design ─▶ P2 Build ─▶ P3 Review/merge ─▶ [i18n gate] ─▶ P4 Demos ─▶ P5 Submit ─▶ P6 Post-launch
   fork mới      (teamlead)          (mỗi dev)    (teamlead)                       (team)       (teamlead)      │
                                        ▲──────────────────────────────────────────────────── bug/update quay về P2
════ Lane A: core/child — /sync-core · /fix-core · propose-core · harvest-proposals ════
════ Lane B: bảo trì toolkit — /audit-toolkit · yarn check-toolkit-refs (CI) ════
```

| Phase | Việc | Tool |
|---|---|---|
| **P0** | Fork child mới từ base (remotes, merge drivers, CHILD.md, envs) | `/init-child` |
| **P1** | Cả theme design → đề xuất task breakdown cho Jira (Task-0 skin luôn đứng đầu; teamlead quyết) | `/break-design` |
| **P1** | Spec MỘT section/block từ Figma → brief | `design-to-brief` |
| **P2** | Build/sửa theo task (chi tiết: *Quy trình chuẩn* bên dưới) | `create-liquid-*`, `review-and-refactor`, `/build-batch`, `/test-batch`, `/ship-batch`, `/revise`, `/fix-core` |
| **P3** | Dev tự audit diff trước khi mở PR; teamlead review PR branch | `diff-reviewer` (nói "review my changes"), `/review-pr` |
| **Gate** | i18n đủ de/es/fr/it trước khi dựng demo | `locale-auditor`, `yarn check-missing-translate` |
| **P4** | Demo dựng TAY trên theme editor → kéo về repo thành preset listing + validate + test | `/sync-listing`, `yarn check-listings`, `yarn test-presets` (outbound: áp listing local / push preset env) |
| **P5** | Audit toàn theme vs Theme Store requirements → docs merchant → đóng gói submit | `/store-audit`, `/gen-docs`, `/submit-theme` |
| **P6** | Bug tester/merchant → đọc List bug trên Slack, triage, route về làn P2, update status sau khi fix land; mỗi update re-release qua `/submit-theme` | `slack-bug-list` (nói "đọc list bug / triage bug từ slack") |

## Dev nhận task Jira → gõ gì

| Task type | Lối vào |
|---|---|
| **Feature mới** (section/block/snippet, có design) | `design-to-brief` 1:1 → `.briefs/<name>.md` → `/ship-batch <type>:<name>` (hoặc `/build-batch` + `/test-batch` rời) |
| **Refactor / fixbug** file có sẵn | Mô tả tự nhiên ("fix X trong section Y") — skill `review-and-refactor` tự áp; xong thì "review my changes" (diff-reviewer) rồi mới mở PR |
| **Đụng bug ở file core** khi đang làm ở child | `/fix-core <file> "<fix>"` |
| **Thiếu/đổi key dịch** | `update-locales` tự áp khi build; quét cả 4 ngữ: `locale-auditor` |
| **Xoá section/block** | Nói "xoá section X" — skill `delete-section-block` lo cleanup refs |
| Xong task | (section/block **public** mới, hoặc đổi schema/hành vi của nó) → `/gen-docs <tên>` **đích danh** → doc merchant vào branch → Push branch → mở PR (teamlead `/review-pr` + merge). Gọi đích danh vì detector no-arg chỉ thấy schema đổi, KHÔNG bắt refactor behavior-only. |

## Quy trình chuẩn — build nhiều section/block (Phase 2)

Ba pha: **Think** (bàn + spec, có người) → **Build** (fan-out song song, tự lập) → **Test** (nghiệm thu tự động). Có thể gộp Build+Test+fix thành **một lệnh `/ship-batch`**. Chi tiết ở mục *Build song song + review tuần tự* bên dưới.

1. **Bàn + tạo brief** (skill `design-to-brief`) — 1-1 với Claude từng cái: *"thiết kế section `a`, Figma: \<link\>"* → Claude đọc Figma (desktop/mobile/variants) qua MCP, **phân tích vs project** (`*-ANATOMY.md` + section gần nhất), đề xuất **file-map (tạo/reuse) + grouped settings**, chốt → ghi `.briefs/a.md`. Lặp cho `b`, `c`. *(Section còn mơ hồ thì làm 1-1 trước, đừng vội fan-out.)*
2. **Brief là local per-dev** (gitignored, KHÔNG commit) — chỉ cần file tồn tại ở working tree; `/build-batch` đọc nội dung rồi nhúng vào builder.
3. **Build** — `/build-batch section:a, section:b, section:c` → mỗi cái 1 nhánh `feat/section-a` + 1 worktree, build theo brief (build-only, không merge/push).
4. **Test (tự động)** — `/test-batch section:a, …` → mỗi nhánh 1 `feature-tester` (L1: đủ `yarn check-*` + **compile assets** + audit **mọi setting được wire** + wiring tương tác tĩnh + đối chiếu brief); rồi **mặc định** `feature-runtime-tester` (L2: render live + settings-matrix từng cái VÀ theo cặp + **chạy thử tương tác** + đo visual vs brief/Figma + 3 viewport; `--no-l2` để bỏ). Ra **bảng triage + merge-call** (ready / needs-fixes / needs-runtime-check). Read-only.
   > **Gộp cả 3 pha:** `/ship-batch section:a, …` = build → L1 → **có lỗi thì builder tự sửa → test lại**, lặp tới xanh (tối đa `--max`, mặc định 2) → L2 (mặc định; `--no-l2` để bỏ). Ném brief → nhận nhánh **đã nghiệm thu**, không confirm tay.
5. **Review** — `yarn wt:dev` (chọn worktree → build assets → `theme dev` port riêng + **development theme riêng**, nên chạy song song nhiều worktree được; quản lý theme: `yarn wt:theme`). Nhờ sửa: `/revise section:a "<feedback>"` — builder sửa trong worktree + tester verify lại (đừng tự sửa, xem mục *Feedback sau khi build*). Audit tĩnh: `/review-pr feat/section-a`.
6. **Ship** — `git push origin feat/section-a` → mở PR → merge từng cái.

> Tiền tố `section:`/`block:`/`snippet:` = **type** truyền cho `feature-builder` (1 builder chung, tự chọn `create-liquid-*` theo type) + đặt tên nhánh. Builder tự viết → `--agent=<tên>` (item là tên trần).

## Có gì trong `.claude/`

| Thư mục | Là gì |
|---|---|
| `skills/` | 14 skill — Claude **tự áp** theo task (**design-to-brief** [Think], tạo section/block/snippet/js/scss, update-locales, cart, animation, SRA, review-refactor, delete-section-block, **propose-core** / **harvest-proposals** [up-channel]). Skill build có deep reference `*-ANATOMY.md`. |
| `agents/` | 6 subagent — `fork-sync-resolver`, `diff-reviewer`, `locale-auditor`, `feature-builder` (build 1 thứ từ brief, self-review; template để clone), `feature-tester` (L1: static + compile + settings-wiring + wiring tương tác tĩnh + brief conformance — trả `settingSinks` cho L2), `feature-runtime-tester` (L2: render live + settings-matrix đơn & theo cặp + chạy thử tương tác + đo visual vs brief/Figma + 3 viewport + seed data qua Shopify CLI). Builder + tester **auto-approve trong worktree** (chạy nền không hỏi). |
| `commands/` | `/sync-core [version]` — sync core vào child. `/review-pr [branch… \| số PR \| all] [--l1] [--l2]` — review PR trong worktree riêng, menu PR thật qua Bitbucket API (read-only). `/build-batch <list>` — fan-out builder build **song song** (build-only). `/test-batch <list> [--no-l2]` — nghiệm thu nhánh đã build (L1 mỗi nhánh + L2 mặc định), read-only. `/ship-batch <list> [--no-l2] [--max=N]` — **vòng khép kín** build→test→fix→xanh, orchestrate bằng **Agent tool** (auto-approve → 0 prompt; tester model nhẹ cho rẻ). `/revise <item> "<feedback>" [--no-l2] [--max=N]` — bạn xem kết quả, nêu feedback; Claude dịch thành change-list, **cập nhật brief**, rồi builder sửa + L1/L2 test lại. `/fix-core <file> "<fix>" [--no-graft]` — sửa 1 file **code core** khi đang build feature (worktree off `upstream/main` → build+check → PR core → graft vào nhánh feature để unblock ngay). `/audit-toolkit` — audit ngữ nghĩa định kỳ toàn bộ `.claude/` (4 auditor song song, read-only). **Vòng đời:** `/init-child` [P0] — bootstrap child fork mới. `/break-design` [P1] — cả theme design → đề xuất task breakdown. `/sync-listing` [P4] — demo store → `listings/<preset>/`. `/store-audit` [P5] — audit toàn theme vs Theme Store requirements. `/gen-docs` [P5] — docs merchant từ schema. `/submit-theme` [P5] — đóng gói submit. Tất cả: không merge/push (trừ `/fix-core` push nhánh fix lên core sau confirm). |
| `hooks/` | 4 hook — auto-approve subagent (PreToolUse), chặn vi phạm lúc sửa, bơm git-context đầu phiên, validate lúc Stop |
| `settings.json` | Đăng ký hooks + permissions (committed, core-owned) — **gồm cả PreToolUse auto-approve**, nên child fork nhận được ngay sau `core:sync` |
| `settings.local.json` | Override **per-dev**, **không commit** (gitignored) — MCP servers, allow-list riêng của máy bạn. |
| `CHILD.md` | Điểm mở rộng **child-owned** (`merge=ours`) — quy ước riêng của store + builder agent dev tự viết. Core ship template, sync không ghi đè. |
| *(`.briefs/` — repo root, NGOÀI `.claude/`)* | Spec mỗi section/block cho `/build-batch` (Pha 1 — Think). **Per-dev, gitignored** (chỉ `_TEMPLATE.md` được commit làm mẫu). Co-author với Claude; khi feature merge, `wt:clean` **archive** brief vào `.briefs/archive/` (**được commit** — spec thật cho `/revise` sau này) thay vì xoá. Nằm ngoài `.claude/` **có chủ đích**: Claude Code bắt confirm "edit its own settings" cho mọi edit dưới `.claude/` (allow-rule không tắt được) — chuyển ra ngoài thì `design-to-brief`/`/revise` ghi brief im lặng đúng như thiết kế. |
| `core-proposals/` | **Up-channel** — bài học generic từ fork gửi NGƯỢC lên core (skill/agent sync *xuống*; folder này đi *lên*). File proposal **được commit** (khác brief), maintainer duyệt + land. Xem `README.md` trong đó. |

## Cách dùng — chủ yếu là nói chuyện bình thường

- **Tạo/sửa/xoá/review:** chỉ cần mô tả task bằng ngôn ngữ tự nhiên ("tạo section hero có carousel", "review thay đổi của tôi", "xoá section X"). Claude **tự nạp skill / spawn agent** phù hợp — **không cần slash**.
- **Slash commands** (14 — phần còn lại gọi bằng câu nói). One-liner dưới đây để tra nhanh; **hướng dẫn dùng chi tiết từng lệnh (cú pháp, ví dụ, từng bước, lỗi thường gặp): [`COMMANDS.md`](./COMMANDS.md)**:
  - `/sync-core [version]` — sync core vào child (2 confirm): (stash WIP→) main mới → tạo `sync/core-<v>` → preview → **confirm** → merge + resolve → check → **confirm** → **land vào main + push + xoá sync branch** → về branch gốc. Bỏ trống = core tag mới nhất (nếu core main có commit untagged vượt tag → nó hỏi: tag stable hay `upstream/main` latest). Có thể chỉ định ref: `/sync-core upstream/main` = lấy bleeding-edge **chưa tag** (core chỉ tag khi có feat/fix; docs/chore không tag). Cần remote `upstream` (FORK-WORKFLOW §4). *(main protected → fallback push sync + PR.)*
  - `/review-pr [branch… | số PR | all] [--l1] [--l2]` — review PR trước khi merge, **mỗi PR một worktree riêng** (cây làm việc của bạn không bị đụng — hết stash/checkout đè): menu **PR thật** qua Bitbucket API (`ATLASSIAN_*` token per-dev; không có → fallback branch chưa merge kèm tuổi/tác giả) → `yarn wt:add` per branch → diff-reviewer (mặc định) → `--l1` thêm feature-tester chế độ no-brief → `--l2` thêm runtime pass (theme `wt/*` riêng). Report kèm `yarn wt:dev <slug>` để xem bằng mắt; worktree để lại, `wt:clean` thu hồi sau merge. **Không comment, không merge** (bạn tự làm); >5 PR phải confirm.
  - `/build-batch <list>` — build nhiều section/block **song song**: từ main sạch → fan-out builder agent, mỗi item 1 nhánh `feat/<type>-<name>` trong **worktree riêng** → bảng báo cáo. **Build-only, không merge/push.** Xem mục *Build song song* bên dưới.
  - `/test-batch <list> [--no-l2]` — nghiệm thu các nhánh đã build **trước khi merge**: fan-out `feature-tester` (L1: đủ check + compile + audit mọi setting được wire + wiring tương tác tĩnh + đối chiếu brief) mỗi nhánh; rồi **mặc định** `feature-runtime-tester` (L2: render live + settings-matrix từng setting và theo cặp + chạy thử tương tác + đo visual vs brief/Figma + seed data test qua Shopify CLI nếu store thiếu; `--no-l2` để chỉ chạy tĩnh). Ra **bảng triage + merge-call**. **Read-only, không merge/push.**
  - `/ship-batch <list> [--no-l2] [--max=N]` — **vòng khép kín tự-sửa:** mỗi item build → L1 → có blocker thì `feature-builder` sửa → test lại, lặp tới xanh (tối đa `--max`, mặc định 2) → L2 mặc định (`--no-l2` để bỏ; thiếu auth thì L2 tự báo `L2-blocked`, không fail). Orchestrate bằng **Agent tool**: subagent auto-approve trong worktree → **0 prompt, không cần auto mode**; tester chạy model nhẹ (sonnet) cho rẻ. Ném brief → nhận nhánh đã nghiệm thu. **Không merge/push.**
  - `/fix-core <file> "<fix>" [--no-graft]` — đang build feature mà đụng **bug ở file code core** (cấm sửa ở child: `src/js/modules`, `mixins`, snippet dùng chung)? Lệnh này land fix vào core **không rời repo child**: worktree off `upstream/main` → áp fix → build + `check-*` → **confirm** → push PR core → **graft** commit fix vào nhánh feature để build/test tiếp ngay (không chờ merge+sync). Trước tiên nó lọc: né được bằng additive? hay chỉ là visual child-owned (sửa thẳng ở child)? Ràng buộc: PR feature chỉ sạch sau khi core-fix đã sync về (lúc đó file hết "bị sửa" vs main). Đây là **làn code** (build+test+PR); `propose-core` là **làn docs** (paste). Dev không có quyền core → dừng ở tạo nhánh fix, bàn giao maintainer.
  - `/audit-toolkit [focus]` — audit **ngữ nghĩa** toàn bộ `.claude/` (định kỳ 1-2 tháng, hoặc sau một đợt refactor toolkit lớn): 4 auditor read-only chạy song song, đối chiếu skills/agents/commands/settings với **code thật**, tổng hợp 1 báo cáo xếp hạng 🔴/🟠/🟡 + đề xuất sửa. Lớp máy móc (`yarn check-toolkit-refs`) đã có CI gác — lệnh này bắt phần CI không thấy: mâu thuẫn giữa file, claim về code đã lỗi thời, lời khuyên bị thực tế phủ nhận. **Read-only, không tự sửa.**
  - `/init-child [tên-theme]` — **[P0]** bootstrap child fork MỚI (chạy trong clone mới): remotes đúng chiều (origin=child, upstream=core), `setup-merge-drivers.sh`, `CHILD.md`, `theme_name`, `shopify.theme.toml` envs, `yarn map` + checks xanh. Idempotent; in checklist phần tay còn lại (Bitbucket CI, tạo store). Fork có sẵn thì dùng `/sync-core`.
  - `/break-design <figma>` — **[P1]** đọc **cả theme design** qua MCP → đối chiếu base (PROJECT-MAP + sections/blocks) → bảng đề xuất task: tên · type (feature/refactor/fix) · reuse/refactor/new · size S/M/L · dependency · route toolkit. **Task-0 (skin: schema defaults + color schemes + typography) luôn đứng đầu.** Chỉ đề xuất — teamlead sửa bảng rồi tự tạo Jira issue; brief từng item viết sau qua `design-to-brief`.
  - `/sync-listing <preset> [store]` — **[P4]** demo dựng tay xong trên theme editor → kéo VỀ repo: `shopify theme pull` (chỉ JSON, vào scratch) → diff report → tách vào `listings/<preset>/` + entry `presets` trong `settings_data.json` → **clean ngay lúc sync** (`clean-data-json` có scope — repo luôn ship được; `shopify://` hoặc credential (`api_key`, key `AIza…`) còn sót là ERROR ở `check-listings`; riêng `list-collections.json` được đưa về dạng reviewer cần: chỉ section main bật, các section khác tắt — demo store giữ nguyên thiết kế; `clean-data-json:release` lúc zip chỉ là safety net) + `yarn check-listings`. **Preset trùng `theme_name` = demo mặc định** → ghi thêm vào root `templates/` + `sections/` + `settings_data.current` (install state); `check-listings` báo lỗi khi listing default và root lệch nhau. Sau khi thêm preset chạy `yarn listings:pad-schemes` — mỗi demo có số `color_schemes` khác nhau nhưng mọi preset phải cùng tập id (template tham chiếu theo id): thiếu id nào bù từ preset nhiều scheme nhất, chỉ thêm không sửa. Sync lại bất kỳ lúc nào (idempotent, mỗi lần là một snapshot). Chiều ngược là `yarn test-presets [<preset>]` — preview preset trong **worktree riêng** (`.worktrees/preview-<preset>` + dev theme `wt/*` + port riêng), không đụng working tree; `--no-dev`, `--port N`, dọn bằng `--clean [<preset>|--all]`. Confirm trước khi ghi; không commit.
  - `/store-audit [all | mechanical settings a11y features lighthouse coverage] [demo-url] [--password=<pw>]` — **[P5]** audit **toàn theme** vs Theme Store requirements: mechanical checks + 3 auditor song song (settings compliance · a11y tĩnh · ma trận mandatory features) + Lighthouse trên demo (perf ≥60, a11y ≥90) nếu có URL — chạy bằng `yarn audit:url <url>` (median 3 lần; **mỗi finding gắn chủ sở hữu** theme / Shopify-inject / bên thứ 3 / merchant, kèm ≈ điểm perf + metric bị ảnh hưởng; `--theme-repo=<path>` map fix theme về file source; mỗi trang chạy thêm 1 lượt **chặn font** để bắt lỗi font preload giữ first paint; `--preview-theme=<id>` audit theme unpublished để so before/after; store có password vẫn chạy). Dùng được cho **bất kỳ store live** nào — khi khách nhờ check performance, `yarn audit:url https://store-khach.com --runs=3 --desktop` là đủ, không cần repo. Phần `coverage` (`yarn audit:coverage`) render **mọi** section + block ở preset trên fixture tự sinh (`?view=audit-NN`, dev theme `wt/audit-coverage`, layout không header/footer) — bù cho Lighthouse chỉ thấy những gì demo builder kéo vào. Không truyền gì → menu chọn chạy all hay từng phần; phần bỏ qua hiện ⏭ trong bảng. Ra bảng pass/fail theo mục + **manual checklist** (browser matrix, keyboard nav, Bogus Gateway…). Read-only.
  - `/gen-docs [tên | all]` — **[P5]** sinh/cập nhật **docs merchant** từ `{% schema %}` + `en.default.schema.json` → `docs/merchant/` (mỗi section/block public 1 trang, ngôn ngữ merchant, không từ ngữ dev) + index + FAQ skeleton (không đè FAQ tay). Incremental: mặc định chỉ regen trang có schema đổi. Confirm write plan trước.
  - `/submit-theme <version> [--update]` — **[P5]** đóng gói submit: gate (`/store-audit` đã xanh?, checks, `check-listings`) → `clean-data-json:release` → `theme:bump-store-version` (lockstep) → **draft release notes cho merchant từ git log** → `yarn zip` → checklist submit tay (demo stores, listing form, docs). Mỗi bước mutate đều confirm. *(Khác `yarn release` — release git/version của repo.)*
- **Validation tay:** `yarn check-liquid` (Liquid/theme-check), `yarn check-js-contract`, `yarn check-missing-translate`, `yarn check-template-refs`.

## Gửi bài học ngược lên core (`propose-core` → `harvest-proposals`)

Core skill/agent sync **xuống** mọi fork; nhưng bài học học được lúc build trong fork thì kẹt ở **memory local per-dev**, không lên tới core. `.claude/core-proposals/` là **kênh đi lên**:

```
 fork build → rút ra bài học        /propose-core          ghi file proposal (ĐƯỢC commit) vào .claude/core-proposals/
        │                               │                              │
        └───────────────────────────────┘                              ▼
                                                        /harvest-proposals  (maintainer, có quyền push core)
                                                                 │  duyệt · nhận/loại · áp vào core skill/agent thật
                                                                 ▼
                                                    PR lên foxtheme-base → merge → core:sync → MỌI fork
```

- **`/propose-core "<bài học>"`** — *bất kỳ dev nào*, không cần quyền core. Chỉ nhận bài học **generic** (thiếu sót của skill/agent, gotcha tái dùng — KHÔNG phải quyết định thiết kế riêng của store → cái đó là memory). Claude chưng cất thành file **apply-ready** (Target · Anchor · Content) rồi commit. Không bao giờ push upstream.
- **`/harvest-proposals`** — *maintainer có quyền push core*. Đọc các proposal `status: pending`, duyệt (nhận/loại/hoãn), áp cái được nhận vào core skill/agent thật trong worktree off `upstream/main`, mở PR lên foxtheme-base, đánh dấu `landed`/`rejected`. Bước duyệt này = cổng kiểm — bài học của fork không tự động thành chân lý của core.

> Quy ước file + format proposal: `.claude/core-proposals/README.md`.

## Hooks (chặn cứng) — và cách TẮT

Hook tự chạy khi **Claude** sửa file (không chạy khi bạn gõ tay trong IDE):
- Sửa `src/js/modules/*.js` có class selector mới → **block** (JS contract).
- Sửa schema/locale thiếu key → **block**.
- Kết thúc turn với `.liquid` lỗi → Claude được yêu cầu fix.
- Đầu phiên → bơm `git log` gần đây vào context (thay claude-mem).

**Tắt khi cần** (vd debug gấp) — đặt env trước khi chạy `claude`:
```bash
FOX_HOOKS=off claude                       # tắt toàn bộ hook
FOX_DISABLED_HOOKS=js-contract,missing-translate claude   # tắt từng check
FOX_MEMORY_CONTEXT=off claude              # tắt git-context đầu phiên
```
Hook **fail-open**: nếu script hook tự lỗi, nó KHÔNG chặn việc của bạn.

## Build song song + review tuần tự (`/build-batch`)

Build nhiều section/block cùng lúc, mỗi cái một agent — rồi review/merge **từng cái** theo nhịp của bạn.

**Hai pha — vì sao tách:** fan-out song song = agent chạy tự lập, **không hỏi-đáp giữa chừng được**. Nên dồn hết phần "suy nghĩ" ra trước, đóng băng thành **brief**:

- **Pha 1 — Think (tương tác, có người + MCP):** bạn bảo Claude *"thiết kế section hero, Figma đây <link>"* → Claude **đọc Figma qua MCP**, đề xuất settings, bạn bàn/chốt → Claude **ghi `.briefs/hero.md`** (theo `_TEMPLATE.md`). Brief là **local per-dev** (gitignored, không commit — chỉ là spec đầu vào tạm). Lặp cho vài section.
- **Pha 2 — Build (tự lập, song song):** `/build-batch section:hero, …` — mỗi builder **đọc brief của nó** rồi implement, không cần hỏi.

> ⚠️ Section nào còn **mơ hồ, phải vừa code vừa bàn** thì **đừng fan-out** — làm 1-1 với Claude trước. `/build-batch` chỉ để cày song song những thứ **đã spec rõ trong brief**. Thiếu brief → `/build-batch` dừng và bảo bạn viết brief trước (không build mò).

**Vì sao cần worktree:** một repo chỉ có **một HEAD**, nên nhiều agent không thể cùng `checkout` các nhánh khác nhau trong cùng thư mục. `/build-batch` cho mỗi agent một **git worktree riêng** (thư mục riêng + nhánh riêng, chung `.git`) → chúng build song song không giẫm chân nhau.

```
/build-batch section:hero-slider, block:logo-list, section:faq
      │  từ main sạch, tạo worktree TÊN THEO NHÁNH + symlink shopify.theme.toml
      ▼
 builder ─► .worktrees/feat-section-hero-slider  (feat/section-hero-slider)  ┐
 builder ─► .worktrees/feat-block-logo-list      (feat/block-logo-list)      ├─ độc lập, SOURCE only
 builder ─► .worktrees/feat-section-faq          (feat/section-faq)          ┘
      ▼
 bảng báo cáo: worktree path · nhánh · files · locale keys · checks · TODO   (KHÔNG merge/push)
```

**Hợp đồng builder (vì sao fan-out an toàn):** mỗi builder **đọc brief** (+ design qua MCP nếu có link) rồi implement đúng spec · chỉ ghi trong worktree path của nó (git op qua `git -C`) · thêm locale key **chỉ `en.default` + `en.default.schema`** (KHÔNG đụng de/es/fr/it — file dùng chung, để `locale-auditor` lấp sau merge) · **không build, không commit `assets/*`** (rebuild trên main sau merge) · self-review: `check-liquid` + `lint:css` + `check-missing-translate` + trace **mọi setting có consumer** + wiring tương tác cặp đôi + build theo bảng Edge cases · commit `feat(<type>): <name>` · trả manifest.

**Worktree đặt tên theo nhánh** (không còn ngẫu nhiên) → `cd` phát biết ngay là section nào. `shopify.theme.toml` được **auto-symlink** vào (env store/auth). `.worktrees/` đã gitignored. **Lưu ý: `assets/` cũng gitignored** → worktree mới **rỗng assets** → `theme dev` trần sẽ render theme **vỡ toàn bộ** (thiếu css/js). Phải **build assets trước** — `yarn wt:dev` lo việc này.

**Tạo worktree — `yarn wt:add` (các `/build-batch`, `/ship-batch`, `/test-batch`, `/revise`, `/fix-core` đều gọi cái này):**
```bash
yarn wt:add feat/block-hero                      # tạo nhánh off main + .worktrees/feat-block-hero + symlink deps
yarn wt:add feat/block-hero                      # chạy lại = dùng lại, không lỗi; nhánh có sẵn thì attach
yarn wt:add revise/block-hero --base origin/main # base khác
```
Gọi lại được nhiều lần (idempotent), tự symlink `node_modules` + `shopify.theme.toml`, in đường dẫn tuyệt đối ở dòng cuối. Agent **bị chặn** chạy lệnh này — worktree do phiên chính tạo.

**Muốn worktree tự hiện trong Source Control?** Đặt `FOX_WT_EDITOR=cursor` (hoặc `code`) — `wt:add` sẽ `--add` folder vào cửa sổ editor, `wt:clean` `--remove` khi dọn. **Mặc định TẮT**, vì CLI tác động lên "last active window": mở đồng thời core + child thì worktree có thể vào nhầm cửa sổ. Chỉ bật khi làm một cửa sổ một lúc. Không bật thì thêm tay: **File → Add Folder to Workspace…**

**Preview — `yarn wt:dev` (build + serve):**
```bash
yarn wt:dev            # liệt kê worktree → chọn số → build assets → shopify theme dev trên port riêng
yarn wt:dev --list     # chỉ liệt kê
yarn wt:dev demo-hero  # chọn thẳng (theo tên/slug/số); --port 9300 để ép port; --no-build nếu đã build
```
Chạy `yarn wt:dev` ở **repo gốc** (tool chạy `shopify theme dev --path <worktree>` từ root — cố ý KHÔNG cd vào worktree, vì chạy từ trong đó có thể không surface file mới lên Theme Editor). Port mặc định `9292 + index`, mỗi worktree một port.

**Chạy song song được.** Mỗi worktree preview trên **development theme riêng** tên `wt/<tên-worktree>`, `wt:dev` tự tạo ở lần preview đầu (`shopify theme push -d -c`, create-or-reuse) rồi `theme dev -t <id>` lên đúng theme đó. Lý do phải làm vậy: `theme dev` **không render local** — nó upload lên theme rồi proxy về localhost, nên nếu dùng chung theme thì file **dùng chung** (`assets/theme.css`, `assets/theme.js`, `layout/theme.liquid`, snippet chung, `locales/*.json`) bị last-write-wins, bạn xem preview A nhưng CSS đang là bản build của B. Localhost **không** miễn nhiễm.

Dùng **development theme** chứ không phải unpublished/draft vì nó (a) **không tính vào quota ~20 theme** của store, nên `/ship-batch` fan-out rộng không làm hết chỗ, và (b) **tự hết hạn sau ~7 ngày** không dùng, nên worktree bị xoá tay hay tiến trình chết cũng không rò theme vĩnh viễn.

**Quản lý theme — `yarn wt:theme`:**
```bash
yarn wt:theme                    # liệt kê theme wt/* + worktree còn hay đã mất
yarn wt:theme --delete           # liệt kê có đánh số rồi CHỌN (chỉ khi có TTY)
yarn wt:theme --delete <slug>    # xoá 1 (slug = tên thư mục worktree)
yarn wt:theme --delete-orphans   # xoá những cái worktree đã mất
yarn wt:theme --delete-all       # xoá sạch;  --force để bỏ qua xác nhận
```
Picker nhận `1`, `1,3`, `a` (all), `o` (orphans), Enter để không xoá gì — chọn tay chính là xác nhận nên nó không hỏi `yes` lần nữa. Không có TTY (agent, CI, pipe) thì `--delete` trần vẫn báo lỗi đòi slug, không treo trước một prompt không ai thấy.

**Không có auto-xoá ở bất kỳ đâu** — `wt:clean` không đụng tới theme, nhưng **có nhắc**: dọn xong worktree nào thì nó in một dòng bảo bạn thu hồi theme (chỉ in chữ — `wt:clean` không cần store credentials và không nên gọi API mỗi lần chạy). Xoá là khi bạn bảo xoá, hoặc để 7-day expiry lo. Delete có 2 chốt chặn: chỉ xoá theme `role == development` **và** tên bắt đầu bằng `wt/`; `--delete-orphans` còn từ chối chạy nếu không thấy `.worktrees/` ở cwd (chạy từ trong worktree thì mọi theme trông như orphan).

*Ghi chú kỹ thuật: `wt:dev`/`wt:theme` đọc `store`+`password` từ `[environments.development]` rồi truyền `-s`/`--password` tường minh, **không** dùng `-e development` — vì env đó ghim `theme = <id>`, mà CLI từ chối `--theme` đi kèm `--development-context`.*

**Audit tĩnh + thao tác từng nhánh:**
- `/review-pr feat/section-hero` (diff-reviewer + checks trong worktree riêng của branch đó; thêm `--l1`/`--l2` khi muốn test sâu).
- **Nhờ sửa:** `/revise <type>:<name> "<feedback của bạn>"` — feedback được dịch thành change-list, fold vào brief, builder áp trong worktree rồi L1/L2 verify lại. Fix chỉ rơi vào nhánh đó. (Đừng bảo Claude "sửa thẳng đi" — main session không qua vòng audit per-agent; xem mục *Feedback sau khi build* bên dưới.)
- **Ship:** `git push origin feat/section-hero-slider` → mở PR.
- **Dọn khi xong:** `yarn wt:clean` — tự xoá các worktree **đã merged vào origin/main** + nhánh; brief tương ứng được **archive vào `.briefs/archive/`** (commit nó để share spec — `/revise` đọc lại từ đó). Cái chưa merged thì giữ lại. `--dry-run` xem trước, `--all` ép xoá hết. *(Thủ công 1 cái: `git worktree remove .worktrees/<slug>` + `git branch -d`.)*

**Bắt locale thiếu:** `diff-reviewer`/`/review-pr` báo **trước merge**; sau khi land cả lô, `yarn check-missing-translate` trên main là lưới an toàn; `locale-auditor` quét de/es/fr/it một lần cuối.

**Builder chạy không hỏi quyền — auto-approve THEO AGENT (không phải global):** fan-out nhiều agent thì mỗi con cứ hỏi `Write`/`Edit`/git lặp lại. Claude Code không có field permission per-agent, nên dùng **PreToolUse hook đọc `agent_type`** → chỉ approve khi đúng agent + đúng tool an toàn; agent khác + main session vẫn hỏi như thường.

- **Map quyền theo agent type:** `.claude/agent-permissions.json` (committed) — hook hỗ trợ **2 mô hình**: (a) **`autoApprove` + deny-list** cho agent chạy trong worktree cô lập (approve mọi thứ TRỪ prefix trong `deny`/`denySkills` — deny thắng, chặn không hỏi); (b) **allowlist `{tools, bash}`** cho agent read-only chạy ở main tree (vd `diff-reviewer`: chỉ approve đúng các lệnh audit — `git diff`/`log`, `yarn check*` — mọi thứ khác vẫn prompt; có thể kèm `deny` riêng). Thêm agent type mới = thêm một entry, không sửa code:
  ```jsonc
  { "feature-builder": { "autoApprove": true, "deny": ["git push", "yarn deploy", "rm ", …], "denySkills": ["sync-core", "fix-core", …] } }
  ```
- **Kích hoạt = core-owned, tự động:** hook được wire sẵn ở `PreToolUse` trong **`.claude/settings.json`** (committed) → mọi child fork **inherit qua `core:sync`**, không phải copy gì. *(Trước đây nó nằm ở `settings.local.json` gitignored — child fork không bao giờ nhận được, nên subagent vẫn hỏi quyền. Nếu file `settings.local.json` của bạn còn block `hooks` cũ này thì xoá đi, kẻo hook chạy 2 lần.)*
- **An toàn:** hook chỉ quyết định khi payload có `agent_type` khớp một entry trong map — **main session và agent lạ luôn fall-through về prompt bình thường**. `push`/`deploy`/`rm`/`shopify publish`… nằm trong `deny` nên bị **chặn thẳng, không prompt**; lệnh ghép được tách theo từng segment (`&&`/`;`/`|`) và `git -C <path> <sub>` được normalize → `git <sub>` nên `git -C … push` **không** lách qua được. `Write`/`Edit` vẫn bị **PostToolUse hook** kiểm (JS-contract/locale). Fail-open + tắt bằng `FOX_HOOKS=off`.
- **Sau `core:sync`:** thoát & mở lại `claude` (hook nạp lúc khởi động) và approve hook khi Claude Code hỏi lần đầu.

**Feedback sau khi build xong → đừng tự sửa trong worktree, dùng `/revise`.** Chính cái "an toàn" ở trên là con dao hai lưỡi: main session **không** có `agent_type` nên không qua hook → mọi `Edit`/`Write`/`Bash` mà nó gõ trong worktree đều bật popup. (`Read`/`Grep` thì không — main agent cứ soi code thoải mái.)

- **Đúng cách:** `/revise block:<name> "feedback của bạn"` (L2 chạy mặc định — `--no-l2` nếu muốn tĩnh thôi). Main agent đọc code + brief, dịch feedback thành change-list cụ thể (hỏi lại nếu mơ hồ), **cập nhật `.briefs/<name>.md`**, rồi ném cho `feature-builder` sửa và `feature-tester` test lại. Bạn không chạm file nào. Bước cập nhật brief là bắt buộc — bỏ qua thì vòng L1 kế tiếp sẽ coi thay đổi của bạn là "lệch brief" và builder sẽ hoàn tác nó.
- **Lối thoát hiểm** (debug nhanh, chấp nhận mất vòng test tự động): `.claude/settings.json` đã allow sẵn `Read/Edit/Write(.worktrees/**)` + `Bash(yarn --cwd .worktrees:*)` cho main session. Git trong worktree **vẫn hỏi** — cố ý, vì `git -C … push`/`reset --hard` không nên tự động.
- **Brief cũng được allow sẵn** (`Read/Edit/Write(.briefs/**)`) → bước cập nhật brief của `/revise` (và pha Think của `design-to-brief`) chạy im lặng ở **mọi permission mode**, không phụ thuộc bạn có bật `acceptEdits` hay không. An toàn: briefs là scratch per-dev, gitignored, chỉ main agent ghi. *(Lưu ý: `allowed-tools:` trong frontmatter của command **không cấp quyền** — nó chỉ giới hạn command được dùng tool nào. Quyền do `permissions` quyết.)*

### Viết builder agent của riêng bạn

`feature-builder` là **template**. Để có builder riêng của store (rule đặc thù):

1. Copy `.claude/agents/feature-builder.md` → `.claude/agents/<tên>-builder.md`. Ở child **nên prefix** (vd `motrix-promo-builder`) → file mới, **an toàn qua `core:sync`**.
2. Sửa `name` + `description`, chỉnh rule build cho đúng thứ bạn tạo.
3. **Giữ nguyên Builder Contract + self-review** — `/build-batch` dựa vào chúng.
4. Chạy: `/build-batch --agent=<tên>-builder name-a, name-b`.
5. Liệt kê builder tự viết vào `.claude/CHILD.md` để cả team child biết.

## Mở rộng toolkit — quy ước (đọc trước khi thêm tool mới)

Toolkit chỉ "dễ mở rộng" khi tool mới vào **đúng ngăn theo đúng luật**:

1. **Thuộc phase nào?** Mọi tool mới phải trả lời được câu này trước khi viết — và ghi phase ngay đầu `description` (vd `"Phase 4 — ..."`). Không xếp được vào phase/lane nào = dấu hiệu chưa nghĩ kỹ nhu cầu.
2. **Đặt tên theo loại:**
   - *Agent* = danh-từ-vai-trò: `feature-builder`, `diff-reviewer`, `locale-auditor`. Tên nói đúng scope thật (bài học rename `theme-reviewer` → `diff-reviewer`: tên hứa nhiều hơn scope gây hiểu nhầm).
   - *Command* = động-từ-hành-động: `/break-design`, `/sync-listing`, `/submit-theme`.
   - *Validator cơ học* (vào CI được) = `yarn check-*` + script trong `scripts/`.
3. **Build khi có nhu cầu thật, không build đón đầu** — bài học `ship-feature` (build xong phải xoá vì suy luận sai tần suất dùng). Slot còn trống trên bản đồ phase cứ để trống tới khi phase đó tới thật.
4. **Checklist khi thêm 1 tool:** `description` chuẩn (trigger rõ + "Not for..." disambiguation) · agent mới → entry trong `agent-permissions.json` · thêm dòng vào bảng phase của `CLAUDE.md` + bản đồ trong file này · `yarn check-toolkit-refs` xanh (mọi yarn-script/file-path nhắc tới phải tồn tại) · restart `claude` để nạp.
5. **Tool riêng của child** → file mới prefix tên child (vd `motrix-*`), khai báo trong `CHILD.md` — đừng sửa file core (conflict mỗi lần sync). Bài học generic → `propose-core` để lên core cho mọi theme hưởng.

## Setup cho dev mới

1. **Cài plugin** `shopify-ai-toolkit` (gõ `/plugin`) — cung cấp skill `shopify-liquid` để tra cứu docs Liquid (validation thì đã có sẵn `yarn check-liquid`, không cần plugin).
2. **MCP servers:**
   - **Chrome DevTools** — đã cấu hình sẵn ở `.mcp.json` (project scope, pinned; `--isolated` mỗi session một Chrome riêng, `--headless` chạy ngầm không cướp focus). Chỉ cần **approve** khi Claude Code hỏi lần đầu. Cần `npx` + Chrome. Không token. *Muốn NHÌN browser lúc debug (tạm thời):* override trên máy mình bằng `claude mcp add --scope local chrome-devtools -- npx -y chrome-devtools-mcp@1.6.0 --experimentalPageIdRouting --isolated` (không `--headless`; `claude mcp remove --scope local chrome-devtools` để quay về mặc định) — đừng sửa `.mcp.json` chung.
     **Dọn rác định kỳ — `yarn chrome:agents`:** browser của server này **không phải lúc nào cũng chết theo session** — instance headless không có cửa sổ nên rò rỉ hoàn toàn vô hình, chỉ âm thầm ăn RAM (thực tế đã bắt gặp 3 cái tồn 4 ngày). Script lọc theo `--user-data-dir=<TMPDIR>/puppeteer_dev_chrome_profile-*`, cờ mà puppeteer luôn đặt còn Chrome thường của bạn không bao giờ có — nên nó **không thể** liệt kê nhầm browser của bạn.

     | Lệnh | Giết |
     |---|---|
     | `yarn chrome:agents` | không gì cả — chỉ liệt kê |
     | `yarn chrome:agents --kill` | **hỏi** — in danh sách rồi bạn chọn |
     | `yarn chrome:agents --kill <pid>` | đúng instance đó (phẩy để chọn nhiều) |
     | `yarn chrome:agents --kill --orphans` | chỉ những cái không còn tiến trình nào giữ |
     | `yarn chrome:agents --kill --all` | tất cả |

     Mỗi dòng cho biết **MCP server nào** mở nó (`chrome-devtools` headless, hay một launcher `--browserUrl` kiểu `chrome-attached` cũ) và **session Claude nào** đang giữ — pid, app, và **cwd của session**, tức là repo/worktree nào. Cwd mới là thứ tách được hai lần chạy song song. Cái nào launcher đã chết thì gắn nhãn `ORPHAN` — đó là mục tiêu của `--orphans`.

     Prompt chỉ hiện khi **có người trả lời được**. Với stdin bị redirect (agent, CI, pipe) thì không hỏi: một instance là shorthand giết luôn, nhiều instance thì từ chối kèm danh sách flag — agent không bao giờ được để treo trước câu hỏi không ai nhìn thấy. Nó cũng báo các thư mục profile còn nằm lại trên đĩa sau khi tiến trình đã chết (~100MB mỗi cái).

     *(Đừng dùng `pkill -f puppeteer_dev_chrome_profile`: nó giết sạch mọi instance của mọi session, kể cả một L2 run đang chạy dở của đồng nghiệp — bên đó nhìn y như crash.)*
   - **Claude in Chrome (extension)** — cho mọi việc cần **đăng nhập**: theme editor, admin, một demo store có password. Nó điều khiển đúng Chrome hằng ngày của bạn (đã login sẵn), mở tab trong một *tab group* riêng, và **bạn nhìn thấy nó làm gì**. Cài extension "Claude in Chrome" là xong — không `claude mcp add`, không Chrome thứ hai, không debug port. Tool xuất hiện dưới tên `mcp__claude-in-chrome__*` (`read_page`/`find` = snapshot a11y có `ref`, `computer` = click/gõ/screenshot/hover, `javascript_tool`, `read_console_messages`, `read_network_requests`, `gif_creator` để quay lại một luồng thao tác cho người khác xem).
     **Chỉ dùng trong phiên chính, có bạn ngồi cùng.** Extension được thiết kế để hỏi bạn trước mỗi hành động có hậu quả (submit form, chấp nhận banner, đăng nhập…), và nó là *một* browser thật — không cô lập, không chạy song song được — nên **agent không được grant tool này** (`feature-runtime-tester` báo `L2-blocked: theme editor` kèm danh sách check, bạn chạy các check đó bằng extension). Đo đạc (Lighthouse, trace, throttling, emulate) vẫn là việc của server headless ở trên — extension không có.
     **Công thức kiểm editor bằng extension** (chuyển từ agent sang, vẫn đúng): lấy id theme của worktree bằng `yarn wt:theme` → mở `https://admin.shopify.com/store/<store>/themes/<id>/editor` → sửa fixture trong `templates/*.json` của worktree (`wt:dev` đang chạy tự sync; khởi động với `-- -- --live-reload off` để một lần sync không tự điều hướng giữa chừng) → reload → thao tác. Chọn đúng block **bằng URL** — `…/editor?previewMode=mobile&section=<section-id>&block=<block-id>` — ổn định hơn dò sidebar. Preview là iframe cross-origin lồng hai tầng nên **`javascript_tool` không với được DOM preview**; snapshot/click/screenshot thì được — **kiểm bằng hành vi, đừng đếm DOM** (slide nào đang active, outline chọn rơi vào đâu, panel settings có mở). `block.shopify_attributes` rỗng ngoài design mode nên mọi check kiểu "đếm `data-shopify-editor-block`" chỉ tồn tại trong editor; `request.visual_preview_mode` thì với được qua `?view=` preview, không cần editor. Xong việc **đóng các tab đã mở** và trả fixture về, `git status` phải sạch.
     *Lịch sử:* trước đây vai này do server **`chrome-attached`** đảm nhận (một `chrome-devtools-mcp` thứ hai trỏ vào Chrome debug port 9222). Nó cần Chrome riêng, hay cướp link bạn bấm sang profile trắng, và phải kill tay — extension làm cùng việc mà không có ba phiền toái đó, nên **đã bỏ** (08/09/2026). Nếu máy bạn còn: `claude mcp remove --scope local chrome-attached` và tắt Chrome debug (`lsof -nP -iTCP:9222 -sTCP:LISTEN -t | xargs kill`). `yarn chrome:agents` vẫn nhận ra một launcher `--browserUrl` nếu ai đó còn chạy.
   - **Figma** (tuỳ chọn, chỉ ai dùng Figma) — server **`figma-api`** (Framelink `figma-developer-mcp`; đúng tên này — các agent `feature-builder`/`feature-runtime-tester` grant tool theo tên `mcp__figma-api__*`, đặt tên khác là builder không đọc được Figma). **User scope** (không commit), tự thêm 1 lần trên máy:
     ```bash
     claude mcp add --scope user figma-api -e FIGMA_API_KEY=<personal-access-token> -- npx -y figma-developer-mcp@0.13.2 --stdio
     ```
     Cần **Figma personal access token** (Figma → Settings → Security → Personal access tokens).
3. **Shopify CLI** — repo đã **pin `@shopify/cli`** (devDependency, exact): `yarn install` xong là các script toolkit (`wt:dev`/`wt:theme`/seeding…) tự dùng đúng version đó — cả team đồng nhất, script không bao giờ gặp "Nonexistent flag" vì CLI máy ai đó cũ. Muốn gõ `shopify` tay ngoài script: cài global bằng **npm** (`npm install -g @shopify/cli`) — tránh brew, đường upgrade brew hay kẹt Xcode CLT trên macOS mới. CLI global cũ hơn bản pin → script báo đúng một dòng remedy thay vì lỗi giữa chừng.
4. **Mở cửa seeding cho L2** (1 lần, cho máy + store của bạn — mỗi dev làm việc trên đúng 1 store):
   - Cài app **Shopify CLI connector** trên dev store của bạn (Shopify admin → Apps) — `shopify store execute` cần app này.
   - Chạy 1 lần: `shopify store auth --store <dev-store-của-bạn>.myshopify.com` (đăng nhập tương tác; auth persist theo máy+store). Xong bước này, `feature-runtime-tester` (L2) tự tìm/seed data test (products đủ trạng thái, metafield…) im lặng, lâu dài — chưa làm thì L2 vẫn chạy nhưng báo `seed-blocked` kèm đúng lệnh cần chạy.
5. **Slack bug list** (1 lần, cho máy của bạn — dùng bởi skill `slack-bug-list`, Phase 6):
   - Xin **`SLACK_BOT_TOKEN`** từ teamlead (một app workspace chung (hiện tên "DP Coder", bot @dpcoder) — scopes `lists:read`/`lists:write`/`files:read`; KHÔNG tự tạo app riêng).
   - Dán vào `.claude/settings.local.json` → `"env": { "SLACK_BOT_TOKEN": "xoxb-…" }` → restart `claude`.
   - `list_id` của fork nằm trong `.claude/CHILD.md` (dòng `Slack bug list:`); List phải được share với bot — quy ước: bot được invite vào channel của fork, List share với channel đó.
6. **Bitbucket PR menu** (tuỳ chọn — ai hay `/review-pr`, chủ yếu teamlead): tạo API token có scope tại **id.atlassian.com → Security → API tokens → Create API token with scopes** → app Bitbucket → 2 scope read: `read:pullrequest:bitbucket` + `read:repository:bitbucket` → thêm vào `env`: `"ATLASSIAN_EMAIL"` + `"ATLASSIAN_API_TOKEN"` → restart. Có token thì menu `/review-pr` hiện PR thật (#id, title, tác giả); không có vẫn dùng được (fallback branch chưa merge). Token này dùng chung cho tích hợp Jira sau này.
7. **Sau khi pull thay đổi toolkit** (skills/agents/hooks mới): **thoát và mở lại `claude`** (hoặc `claude --continue` để giữ hội thoại) — agents/hooks nạp lúc khởi động. **Approve hook** khi Claude Code hỏi.

## Child fork

- Toolkit là **core-owned** → tự cập nhật khi `yarn core:sync`. **Đừng** thêm `merge=ours` cho `.claude/` (sẽ đóng băng).
- **Quy ước riêng + agent tự viết → `.claude/CHILD.md`** (ngoại lệ `merge=ours` duy nhất trong `.claude/`): core ship template, sync **không ghi đè**; nội dung ở đây override default của core. Skill/agent core vẫn chảy xuống bình thường.
- Thêm skill/agent riêng: tạo **file mới có prefix** (vd `motrix-*`) — đừng sửa file core có sẵn (sẽ conflict mỗi lần sync). Hook riêng cần sửa `settings.json` (core-owned) → cân nhắc dùng `.claude/settings.local.json` (per-dev) hoặc resolve tay khi sync.
- Cần chỉnh riêng cho fork/máy → để ở `.claude/settings.local.json` (không commit).
- Sau mỗi lần sync: restart `claude` + approve hook.

## Theme độc lập (không phải child fork)

Theme cũ không cùng gốc code (Hyper/Sleek/Pebble/Zest…) vẫn dùng chung được tầng máy móc của toolkit — nhưng nhận update qua **copy có manifest** thay vì git merge:

- **Không chạy từ repo này nữa** (đổi 06/08/2026). Cả port lẫn calibrate nằm trong plugin `foxtheme-toolkit` và chạy trong repo theme đích: `/foxtheme-toolkit:init-project`. Nó tự port khi repo chưa có `.claude/.toolkit-port.json`, rồi calibrate.
- Lợi ích: payload nằm trong plugin nên **onboard một theme không cần clone repo core này**. `scripts/port-toolkit.mjs` ở đây chỉ còn là stub chỉ đường.
- Chi tiết + lý do chuyển: `.claude/COMMANDS.md` mục "Lane C".

## Rollout (lần đầu áp toolkit cho hệ child fork)

Làm **canary trước**: chọn **1 child fork** → `yarn core:sync <version-có-toolkit>` → restart `claude` + approve hook → dùng thật vài ngày (kiểm: skill auto-route, hook block đúng, `/sync-core`, git-context đầu phiên) → ổn mới nhân rộng các child còn lại.
