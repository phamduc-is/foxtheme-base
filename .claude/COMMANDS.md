# Slash commands — docs chi tiết cách dùng

Tra nhanh: bản đồ phase + one-liner ở [`USAGE.md`](./USAGE.md). File này là **hướng dẫn dùng từng lệnh**: cú pháp, ví dụ gõ thật, từng bước nó làm, nó hỏi gì, và lỗi thường gặp.

## Cơ chế slash — đọc 30 giây

- Gõ `/` → menu gợi ý. **Enter trên menu = chạy ngay với args rỗng.** Muốn điền args: gõ **Tab** để autocomplete tên lệnh, gõ tiếp args, rồi mới Enter. Ví dụ: `/sync-listing horizon my-store.myshopify.com`.
- Chạy rỗng không sao: **mọi lệnh cần args đều tự hỏi** trước khi làm gì — không lệnh nào đoán mò.
- Không lệnh nào **merge hay push** hộ bạn (trừ `/sync-core` push main sau 2 lần confirm, và `/fix-core` push nhánh fix lên core sau confirm). Mọi bước mutate đều confirm trước.
- Skill/agent (tạo section, fix bug, review diff…) **không cần slash** — nói tự nhiên, Claude tự chọn (bảng phase trong `CLAUDE.md`).

---

## P0 — `/init-child [tên-theme]`

Biến một clone mới của core thành child fork của theme mới.

**Khi nào:** đúng 1 lần, lúc khởi động một theme mới. Fork có sẵn cần lấy code core → `/sync-core`, không phải lệnh này.

**Chuẩn bị trước (tay):** teamlead tạo repo child **rỗng** trên Bitbucket → dev `git clone <core-url> <tên-theme>` → mở `claude` trong folder đó.

```
/init-child horizon
```

**Nó làm:** (1) hỏi xác nhận "đây là clone mới hay core checkout của bạn?" — tree bẩn / có feature branch / có `.worktrees/` là red flag, nó dừng; (2) thu thập: URL repo child, URL core, store domains cho dev/test/intro; (3) đổi `origin` → child, thêm `upstream` → core, `git fetch upstream --tags`; (4) chạy `./scripts/setup-merge-drivers.sh` (thiếu bước này thì lần `core:sync` đầu tiên phá locale + đè `CHILD.md`); (5) điền `CHILD.md`, `theme_name` trong `settings_schema.json`, `shopify.theme.toml` envs; (6) `yarn install` + `yarn map` + chạy checks.

**Nhận về:** repo child sẵn sàng + checklist phần còn lại phải làm tay (Bitbucket CI, tạo store, push theme lần đầu).

**Lưu ý:** idempotent — chạy lại an toàn. Xong nhớ restart `claude` trong repo mới.

---

## P1 — `/break-design <link Figma FILE>`

Đọc CẢ theme design → đề xuất bảng task breakdown để bạn tạo Jira issue.

**Khi nào:** đầu chu kỳ theme mới, sau khi nhận design, TRƯỚC khi break task. Nó **đề xuất** — bạn sửa bảng và tự tạo Jira; nó không tạo issue, không viết brief.

```
/break-design https://www.figma.com/design/abc123/Horizon-Theme
/break-design <link-file-desktop> <link-file-mobile>
```

**Input đúng:** link **FILE** (`figma.com/design/<key>/…`) — cả file, mọi page. Design tách nhiều file thì gửi hết. Link 1 frame/screen là input của `design-to-brief` (spec 1 item) — gửi nhầm nó sẽ báo và hỏi lại.

**Nó làm:** (1) liệt kê **inventory màn hình** tìm thấy (home, product, collection…) → hỏi bạn đủ/thiếu → mới phân tích; (2) đối chiếu từng vùng UI với base (PROJECT-MAP + `sections/` + `blocks/`) → phân loại **reuse / refactor / new** (phân vân thì mở file base so với frame, không đoán theo tên); (3) ra bảng: task · type (feature/refactor/fix) · phân loại · file đụng · size S/M/L · dependency · route toolkit; **Task-0 (skin: schema defaults + color schemes + typography) luôn đứng đầu**; (4) chốt danh sách **câu hỏi cho designer** (thiếu frame mobile, state chưa vẽ…).

**Sau đó:** dev nhận task `feature` → chạy `design-to-brief` 1:1 trên frame của item đó → `/ship-batch`.

---

## P2 — `/build-batch [--agent=<tên>] <type>:<tên>, …`

Fan-out builder build nhiều section/block/snippet **song song**, mỗi cái một nhánh + worktree.

**Khi nào:** đã có brief chốt (`.briefs/<tên>.md`) cho TỪNG item. Item còn mơ hồ → làm 1-1 với `design-to-brief` trước, đừng fan-out. Thực tế đội mình: 2-3 item/lượt là vừa.

```
/build-batch section:hero-slider, block:logo-list
/build-batch --agent=motrix-promo-builder promo-bar
```

**Nó làm:** từ main sạch → mỗi item 1 nhánh `feat/<type>-<tên>` trong worktree riêng (`.worktrees/`) → builder đọc brief + Figma (nếu brief có link) → implement + self-review + commit source (không commit `assets/`). Thiếu brief → **dừng**, bảo bạn viết brief trước.

**Nhận về:** bảng: worktree path · nhánh · files · locale keys · checks · TODO. **Build-only** — chưa test, chưa merge.

**Lưu ý:** builder chỉ thêm locale `en.default*` (de/es/fr/it để `locale-auditor` lấp sau merge — file dùng chung, sửa song song là conflict).

---

## P2 — `/test-batch <type>:<tên>, … [--no-l2]`

Nghiệm thu các nhánh đã build, trước khi bạn review/merge.

```
/test-batch section:hero-slider, block:logo-list
/test-batch section:hero-slider --no-l2      # chỉ chạy tĩnh (L1)
```

**Nó làm:** mỗi nhánh 1 `feature-tester` (**L1**: đủ `yarn check-*` + compile assets + audit **mọi setting có consumer** + wiring tương tác tĩnh + đối chiếu brief) → pass thì **mặc định** `feature-runtime-tester` (**L2**: render live 4 fixture + settings-matrix đơn & theo cặp + chạy thử tương tác + đo visual vs brief/Figma + 3 viewport 1440/768/375; thiếu store data thì seed qua Shopify CLI, có dọn). L2 cần store preview + auth — thiếu thì báo `L2-blocked`, không fail.

**Nhận về:** bảng triage + merge-call từng item: ready / needs-fixes / needs-runtime-check. **Read-only** — không sửa, không merge.

---

## P2 — `/ship-batch <type>:<tên>, … [--no-l2] [--max=N]`

Vòng khép kín build → test → tự sửa → xanh. Gộp `/build-batch` + `/test-batch` + vòng fix.

```
/ship-batch section:hero-slider, block:logo-list
/ship-batch section:faq --max=3 --no-l2
```

**Nó làm:** per item: build → L1 → có blocker thì builder tự sửa → test lại, lặp tối đa `--max` vòng (mặc định 2) → L2 (mặc định). Toàn bộ auto-approve trong worktree — **0 prompt**, ném brief buổi sáng, nhận kết quả.

**Nhận về:** bảng triage + nhánh **đã nghiệm thu**. Bạn `yarn wt:dev` xem (mỗi worktree một dev theme riêng `wt/<tên>` — mở song song nhiều cái được; quản lý bằng `yarn wt:theme`) → `/revise` nếu cần → push + PR tự tay.

---

## P2 — `/revise <type>:<tên> "<feedback>" [--no-l2] [--max=N]`

Đưa feedback của BẠN về một feature đã build — agent sửa + test lại. **Đừng tự sửa trong worktree.**

```
/revise section:hero-slider "nút CTA mobile phải full-width, desktop giữ nguyên; giảm gap còn 24px"
```

**Nó làm:** dịch feedback thành change-list cụ thể (mơ hồ thì hỏi lại) → **cập nhật `.briefs/<tên>.md`** (bắt buộc — không update brief thì vòng L1 sau coi thay đổi là "lệch brief" và builder hoàn tác) → builder áp trong worktree → L1/L2 verify lại.

**Vì sao không tự sửa:** main session không qua vòng audit per-agent; sửa tay = mất lưới test tự động.

---

## P2 — `/fix-core <file> "<mô tả fix>" [--no-graft]`

Đang build ở child mà đụng bug ở **file code core** (cấm sửa ở child: `src/js/modules`, `mixins`, snippet dùng chung).

```
/fix-core src/js/modules/quick-view.js "productCardLink ref không được re-fetch sau morph"
```

**Nó làm:** (1) lọc trước: né được bằng cách additive? chỉ là visual child-owned? → không cần lệnh này; (2) worktree off `upstream/main` → áp fix → build + checks; (3) **confirm** → push nhánh fix + PR lên core; (4) **graft** commit fix vào nhánh feature của bạn để build/test tiếp ngay (`--no-graft` để bỏ).

**Lưu ý:** PR feature của bạn chỉ sạch sau khi core-fix được merge + sync về. Dev không có quyền push core → nó dừng ở tạo nhánh, bàn giao maintainer. Đây là làn **code**; bài học dạng docs/kiến thức → `propose-core`.

---

## P3 — `/review-pr [branch… | số PR | all] [--l1] [--l2]`

Teamlead review PR trước khi merge — **mỗi PR một worktree riêng, cây làm việc của bạn không bị đụng** (hết màn stash/checkout đè).

```
/review-pr                      # menu PR đang mở (Bitbucket API) → chọn
/review-pr 31                   # review PR #31 (theo số)
/review-pr feat/section-hero --l1
/review-pr all --l2             # cả lô, chạy đủ L1 + L2
```

**Menu:** có `ATLASSIAN_EMAIL`/`ATLASSIAN_API_TOKEN` (per-dev, xem *Setup cho dev mới*) → gọi Bitbucket API, hiện **PR thật**: `#id · title · tác giả · branch → main · cập nhật`. Không có token → fallback danh sách branch chưa merge kèm tuổi commit + tác giả.

**Nó làm:** fetch → per PR: `yarn wt:add <branch>` (idempotent — dùng lại worktree của `/build-batch` nếu có) → **`diff-reviewer`** audit trên worktree (mặc định, nhanh) → `--l1`: thêm `feature-tester` **chế độ no-brief** (PR của dev khác không có brief trên máy bạn — skip brief-conformance có khai báo, vẫn compile + audit settings-wiring + trả settingSinks) → `--l2`: thêm runtime pass (tự `wt:dev`, theme `wt/*` riêng, browser headless; phần đo px skip vì không brief — có khai báo).

**Nhận về:** verdict ✅/⚠️/❌ + findings per PR (paste được làm PR comment); nhiều PR = bảng triage worst-first; mỗi entry kèm lệnh xem bằng mắt `yarn wt:dev <slug>`. Worktree để lại cho bạn xem — merge xong `yarn wt:clean` tự thu hồi. **> 5 PR nó hỏi trước.** Không comment, không merge — bạn tự làm trên Bitbucket.

---

## P4 — `/sync-listing <preset> [store]`

Demo dựng tay xong trên theme editor → kéo VỀ repo thành preset listing.

**Khi nào:** một demo hoàn thiện trên store → cần vào `listings/<preset>/` để submit. Chiều **ngược** (áp listing local để xem / push lên preset env) là `yarn test-presets` — không phải lệnh này.

```
/sync-listing horizon
/sync-listing horizon my-demo.myshopify.com
```

**Nó làm:** (1) thiếu args → hỏi preset (luật Shopify: 1-2 từ, <30 ký tự, một preset phải trùng tên theme); store bỏ trống → đưa danh sách env từ `shopify.theme.toml` chọn; (2) `shopify theme list` → bạn chỉ định theme nào trên store là demo; (3) `shopify theme pull` **chỉ JSON** vào thư mục scratch — working tree chưa bị đụng; (4) **diff report**: file mới/đổi/y hệt, type không tồn tại trong theme (rác editor), resource đặc thù store; (5) **confirm** → tách vào `listings/<preset>/templates|sections/` + entry `presets` trong `settings_data.json`; (6) `yarn check-listings` + `yarn clean-data-json listings --dry-run`.

**Nhận về:** listing đã validate + đề xuất commit (nó không tự commit). Nên `yarn test-presets` áp lại xem bằng mắt trước khi commit.

**Cần:** Shopify CLI đã auth với store (chưa thì nó bảo bạn `shopify auth login` — nó không tự auth).

---

## P5 — `/store-audit [demo-url]`

Audit TOÀN theme vs requirements của Shopify Theme Store — chạy trước mỗi lần submit/update lớn.

```
/store-audit                                # tĩnh
/store-audit https://demo.myshopify.com     # + Lighthouse (perf ≥60, a11y ≥90)
```

**Nó làm:** (1) mechanical: mọi `yarn check-*` + probe trực tiếp (`robots.txt.liquid` phải KHÔNG tồn tại, đủ JSON templates bắt buộc, `theme_info` + version lockstep); (2) 3 auditor song song read-only: settings/editor compliance (t: keys, sentence case, `font_picker` + `font_modify`, ≥4 màu…) · a11y tĩnh (alt, label+id, focus-visible, touch ≥24px…) · **ma trận mandatory features** (predictive search, gift card, selling plans, unit price, pickup, Follow on Shop… — cái nào có/thiếu, ở file nào); (3) có URL → Lighthouse home/product/collection, desktop+mobile.

**Nhận về:** bảng pass/fail theo mục requirement + **manual checklist** nó không tự làm được (browser matrix Safari/Firefox/Edge + webviews, keyboard nav, Bogus Gateway, content demo thật) + fix plan theo owner. **Read-only.**

---

## P5 — `/gen-docs [tên… | all]`

Sinh/cập nhật docs merchant từ chính schema của theme → `docs/merchant/`.

```
/gen-docs                    # chỉ regen trang có schema đổi từ lần gen trước
/gen-docs hero-slider faq
/gen-docs all
```

**Nó làm:** per section/block public: parse `{% schema %}` + resolve `t:*` qua `en.default.schema.json` → 1 trang/cái bằng **ngôn ngữ merchant** (không code words, không file paths): mô tả + bảng settings (label · tác dụng · default, `visible_if` diễn giải "hiện khi…") + tips. Kèm index (`README.md`, regen mỗi lần) + FAQ skeleton (**chỉ tạo khi chưa có** — FAQ là hand-curated, không bao giờ đè).

**Nhận về:** write plan → bạn confirm → ghi file + danh sách trang cần người đọc lại (phần mô tả behavior là suy từ Liquid) + các lỗi text schema phát hiện được (label không sentence-case…). Đề xuất commit, không tự commit.

**Lưu ý:** hosting docs (help center) + contact form nằm ngoài repo — lệnh này chỉ giữ content mới.

---

## P5 — `/submit-theme <version> [--update]`

Đóng gói submit Theme Store (hoặc update theme đang live).

```
/submit-theme 2.1.0
/submit-theme 2.1.1 --update
```

**Nó làm:** (1) gate: main sạch + pulled, mọi check xanh, hỏi `/store-audit` đã chạy chưa (bỏ qua phải nói rõ "skip audit"); (2) `yarn clean-data-json:release` — strip resource store demo khỏi templates/sections/listings (**confirm trước**); (3) `yarn theme:bump-store-version` — lockstep **3 file**: version snippet + `settings_schema` + `package.json` (feed tên file zip; **đừng bao giờ sửa tay**); (4) **draft release notes cho merchant** từ git log kể từ lần bump trước (lọc bỏ refactor nội bộ/CI); (5) `yarn zip` → đường dẫn artifact; (6) in checklist submit tay (demo store per preset + Bogus Gateway, listing form, docs, upload Partner dashboard).

**Nhận về:** zip sẵn sàng + release notes + checklist. Nó không upload, không push; cuối cùng đề xuất commit phần bump + JSON đã clean.

**Phân biệt:** `yarn release` là release **git của repo** (tag + changelog git-cliff) — làn khác hoàn toàn.

---

## Lane A — `/sync-core [version | upstream/main]`

Child fork lấy code core về.

```
/sync-core             # tag core mới nhất (core main có commit chưa tag → nó hỏi chọn)
/sync-core v1.39.1
/sync-core upstream/main   # bleeding-edge chưa tag
```

**Nó làm:** stash WIP → main mới → tạo `sync/core-<v>` → preview (`core:diff` phân Tier 1/2) → **confirm** → merge + resolve (conflict khó → agent `fork-sync-resolver`) → checks → **confirm** → land vào main + push + xoá sync branch → về branch cũ.

**Lưu ý:** cần remote `upstream`. Main protected → fallback push sync branch + PR. **Sau sync: restart `claude`** + approve hook (agents/hooks nạp lúc khởi động).

---

## Lane B — `/audit-toolkit [focus]`

Audit ngữ nghĩa toàn bộ `.claude/` — định kỳ 1-2 tháng hoặc sau một đợt refactor toolkit lớn.

```
/audit-toolkit
/audit-toolkit "agents and commands only"
```

**Nó làm:** `yarn check-toolkit-refs` (lớp máy móc, CI đã gác) → 4 auditor song song đối chiếu skills/agents/commands/config với **code thật** (staleness, mâu thuẫn, description, gaps, bloat) → 1 báo cáo xếp hạng 🔴 hỏng thật / 🟠 gây hiểu nhầm / 🟡 bloat + phần verified-good.

**Nhận về:** báo cáo + fix plan. **Read-only** — nó đề xuất, bạn duyệt rồi mới sửa.

## Lane C — theme ĐỘC LẬP (không phải fork): **đã chuyển sang plugin**

Từ **06/08/2026**, việc đưa toolkit sang một theme không cùng gốc code (Hyper/Sleek/Pebble/Zest…) **không còn chạy từ repo này**. Nó nằm trong plugin `foxtheme-toolkit`, và chạy trọn vẹn trong repo theme đích:

```
/plugin marketplace add git@bitbucket.org:is-workspace/foxtheme-claude-toolkit.git
/plugin install foxtheme-toolkit@foxecom
/foxtheme-toolkit:init-project      # tự port nếu chưa có .claude/.toolkit-port.json, rồi calibrate
```

**Vì sao chuyển:** payload giờ nằm trong plugin (`templates/`), nên onboard một theme **không cần clone repo core này nữa** — dev không có nó vẫn làm được. Và bản `scripts/port-toolkit.mjs` ở đây đã lỗi thời theo hai cách có hậu quả thật: nó vẫn copy 7 file command (giờ dùng chung ở plugin — bản copy trong repo sẽ shadow chúng dưới tên trần rồi trôi dạt), và nó copy `check-js-contract.js` — chính thứ khiến cả Sleek lẫn Hyper có `post-edit-guard` trỏ vào script không tồn tại.

Nó cũng xếp `generate-project-map.js`, `post-edit-guard.mjs`, `diff-reviewer.md` và 8 file nữa vào lớp ghi-đè-khi-re-port. Đo giữa hai theme calibrate độc lập, chúng lệch **8–624 dòng** — re-port là xoá trọn một phiên calibration. Bản trong plugin phân loại lại bằng số đo và đã kiểm chứng: dry-run trên Sleek và Hyper **không ghi đè file nào**.

`scripts/port-toolkit.mjs` ở repo này giờ chỉ là stub in ra hướng dẫn rồi thoát.

**Lane fork không đổi:** child fork vẫn nhận cập nhật qua `core:sync`, và `propose-core` / `harvest-proposals` giữ nguyên.

**`--clean` (chỉ lần port ĐẦU):** theme cũ thường có sẵn đồ toolkit dạng lộn xộn — `--clean` xóa sạch `.claude/` + `CLAUDE.md` cũ trước khi port để dùng thuần bản mới. Giữ lại `.claude/settings.local.json` (token per-dev). Target đã calibrate rồi (`.toolkit-port.json` tồn tại) thì `--clean` bị **từ chối** — update chạy không `--clean`; reset từ đầu thật sự mới thêm `--force`.

**Calibrate** (`/init-project`): detect kiến trúc thật (src pipeline? custom elements? theme blocks?) → tắt check không áp dụng (ghi rõ lý do) → `yarn map` + chọn gold sections → viết lại tầng template theo **code thật của theme đó** → báo cáo + các câu hỏi convention để teamlead chốt. **Không tự commit.**

**Không port:** lane fork (init-child/sync-core/fix-core/propose-core/harvest), batch pipeline (build/test/ship-batch + 3 agent build/test), các skill mô tả JS core (animation-motion, cart-operations, section-rendering-api).

**Lỗi thường gặp:** quên `yarn install` bên target (check thiếu dep) · chạy `/init-project` khi chưa port (thiếu `.claude/.toolkit-port.json` — command sẽ tự dừng) · `wt:dev` build sai vì theme cũ không có `build:css`/`copy:js` của core → `/init-project` phải adapt danh sách build hoặc dev dùng `--no-build`.
