# FoxTheme Base — Fork Workflow

Tài liệu mô tả cách **core** (`foxtheme-base`) và các **child project** (fork) phối hợp với nhau.

---

## Mục lục

1. [Tổng quan & Triết lý](#1-tổng-quan--triết-lý)
2. [Kiến trúc](#2-kiến-trúc)
3. [Phân loại tính năng: Core, Optional, Child-specific](#3-phân-loại-tính-năng-core-optional-child-specific)
4. [Thiết lập child project mới](#4-thiết-lập-child-project-mới)
5. [Workflow hàng ngày trên child project](#5-workflow-hàng-ngày-trên-child-project)
6. [Workflow hàng ngày trên core](#6-workflow-hàng-ngày-trên-core)
7. [Kéo update từ core vào child](#7-kéo-update-từ-core-vào-child)
8. [Xử lý conflict](#8-xử-lý-conflict)
9. [Versioning](#9-versioning)
10. [Bảng phân loại file](#10-bảng-phân-loại-file)
11. [Các tình huống thường gặp](#11-các-tình-huống-thường-gặp)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Tổng quan & Triết lý

**Core (`foxtheme-base`)** cung cấp:
- Hạ tầng Shopify theme tái sử dụng (custom elements, refs system, morph, section rendering, cart, product card, variant picker…)
- **JS contract**: mọi JS module chỉ truy cập DOM qua `ref="name"`, `data-*` attribute, hoặc custom element tag — không bao giờ dùng CSS class selector.

**Child project** là Bitbucket fork của core, được tuỳ chỉnh cho một Shopify store cụ thể:
- **Design khác nhau**: mỗi store có UI/UX riêng — markup, class, SCSS khác nhau.
- **Functionality giống nhau**: bug fix và cải tiến tính năng nằm ở core và được propagate xuống tất cả child.

**Lợi ích của kiến trúc này:**
1. Fix bug **một lần** ở core → lan xuống tất cả child khi merge.
2. Child tự do thay đổi CSS/markup mà không lo JS bị vỡ — JS chỉ hook vào `data-*` / `ref`, không phụ thuộc class.
3. Child chỉ chứa design + nội dung riêng; mọi thứ tái sử dụng nằm ở upstream.

---

## 2. Kiến trúc

### JS Contract

Bên trong `src/js/modules/*.js`, truy cập DOM **bắt buộc** dùng:

| Trường hợp | Cơ chế |
|---|---|
| Element đơn bên trong một Component | `ref="name"` → `this.refs.name` |
| Element đơn xuyên qua Component boundaries | `data-some-key` attribute |
| Nhiều element cùng vai trò | `data-some-key` attribute |
| Xác định component | Custom element tag (`product-card`, `swatches-variant-picker`) |
| Utility / state class | `.hidden`, `.is-loading` — dùng được vì là trạng thái, không phải design |

**Không bao giờ**: `querySelector('.theme-component-class')`. Child thay đổi class tự do; class là presentation, không phải contract.

### Phân loại file

| Chiến lược | Ý nghĩa | Ví dụ |
|---|---|---|
| **Core-locked** | Child không được sửa; luôn sync từ core | Engine JS (`component.js`, `morph.js`, `events.js`…) |
| **Sync from core** | Child có thể override nhưng nên kéo update | Phần lớn snippets, sections, blocks, locales; **`.claude/` toolkit** (skills, agents, commands, hooks, `settings.json`) |
| **Per-project** | Child sở hữu; bỏ qua khi merge từ core | `templates/*.json`, `config/settings_data.json`, custom features, **`.claude/settings.local.json`** (per-dev, gitignored) |

Chi tiết đầy đủ ở [Bảng phân loại file](#10-bảng-phân-loại-file).

### Claude Code toolkit

Bộ công cụ Claude Code (`.claude/`: skills, agents, commands, hooks, `settings.json`) là **core-owned**, **inherit** xuống child qua `yarn core:sync` (cố ý KHÔNG `merge=ours` trong `.gitattributes` — đừng thêm, sẽ đóng băng toolkit ở child). Override riêng per-dev đặt ở `.claude/settings.local.json` (gitignored, ngoài sync). Thay đổi toolkit đi theo CHANGELOG/release của theme. **Sau mỗi `core:sync`: thoát & mở lại `claude` (agents/hooks nạp lúc khởi động) + approve hook khi được hỏi.** Hướng dẫn dùng: [`.claude/USAGE.md`](.claude/USAGE.md).

---

## 3. Phân loại tính năng: Core, Optional, Child-specific

Đây là điểm quan trọng nhất trong kiến trúc này.

### Core/main — tính năng phổ quát (100% child dùng)

```
core/main
├── cart-drawer
├── product-card
├── variant-picker
├── search
├── filter
└── ...
```

Tất cả child đều nhận những tính năng này khi merge. Không có exception.

### Feature branches — tính năng tuỳ chọn (một số child dùng)

```
core/main                   ← base ổn định
core/feat/lookbook          ← tính năng optional
core/feat/bundle-picker     ← tính năng optional
core/feat/mega-menu         ← tính năng optional
```

Child **chọn merge những gì cần**:

```bash
# Child A cần lookbook
git merge upstream/main
git merge upstream/feat/lookbook

# Child B không cần lookbook
git merge upstream/main     # chỉ vậy thôi
```

**Nguyên tắc bắt buộc cho feature branch**: Feature branch **chỉ được ADD file mới**, không được sửa file có sẵn của core.

```
✅ Được phép:
   sections/lookbook.liquid          (file mới)
   src/scss/modules/_lookbook.scss   (file mới)
   src/js/modules/lookbook.js        (file mới)
   locales/ — thêm key mới           (additive)

❌ Không được:
   Sửa snippets/price.liquid         (core file)
   Sửa src/js/modules/variant-picker.js
   Sửa sections/product-information.liquid
```

Nếu feature cần extend behaviour của core component → thêm extension point vào core/main, feature branch chỉ lắng nghe:

```js
// core/main: product-card.js — thêm event (merge vào main)
this.dispatchEvent(new CustomEvent("product-card:ready", { bubbles: true }));

// core/feat/lookbook: lookbook.js — lắng nghe, không chạm core
document.addEventListener("product-card:ready", (e) => { ... });
```

**Cập nhật feature branch khi main thay đổi:**

```bash
git checkout feat/lookbook
git merge main   # gần như không conflict vì không đụng cùng file
git push origin feat/lookbook
```

Đây là thao tác thủ công nhưng rất nhanh nếu feature branch tuân thủ nguyên tắc trên.

**Enforced bởi CI**: Mỗi push vào branch `feat/**`, pipeline chạy `scripts/check-additive-feature.sh` so sánh với `origin/main` và fail nếu có `.liquid`/`.js`/`.scss` bị modify/delete/rename. Reproduce local:

```bash
git checkout feat/your-branch
./scripts/check-additive-feature.sh
```

> **Quan trọng**: `feat/**` **phải xuất phát từ `main`**, không bao giờ từ một sync-branch (`sync-core-*`) hay branch chứa merge upstream. Lý do: guard so với `origin/main...HEAD`, nên nếu nhánh feat/* được tạo trên một base có sẵn các file core đã sửa, chúng sẽ bị báo là vi phạm cho dù bản thân feat branch không động vào.

### Child-specific — tính năng chỉ 1 child dùng

Giữ ở child repo, không đưa vào core. Khi tính năng được **≥ 2 child dùng** → extract lên core thành feature branch.

```
Rule: tính năng chỉ vào core khi có ≥ 2 child cần.
```

---

## 4. Thiết lập child project mới

### Một lần trên Bitbucket

1. Mở core repo: `https://bitbucket.org/foxecom/foxtheme-base`
2. Click **Create fork** → đặt tên `foxtheme-<store-name>` (ví dụ: `foxtheme-acme-shop`)
3. Set default branch là `main`

### Một lần trên máy

```bash
# Clone fork về
git clone git@bitbucket.org:foxecom/foxtheme-acme-shop.git
cd foxtheme-acme-shop

# Thêm upstream remote trỏ về core
git remote add upstream git@bitbucket.org:foxecom/foxtheme-base.git
git fetch upstream --tags

# Kiểm tra
git remote -v
# origin    git@bitbucket.org:foxecom/foxtheme-acme-shop.git (fetch)
# origin    git@bitbucket.org:foxecom/foxtheme-acme-shop.git (push)
# upstream  git@bitbucket.org:foxecom/foxtheme-base.git (fetch)
# upstream  git@bitbucket.org:foxecom/foxtheme-base.git (push)

# Nếu muốn bắt đầu từ một release tag cụ thể (khuyến nghị)
git checkout v1.0.0 -b main
git push -u origin main --force-with-lease

# Cài deps + build lần đầu
yarn install
yarn build:css && yarn copy:js
```

### Cấu hình `.gitattributes`

`.gitattributes` đã có sẵn trong core (sync từ upstream khi merge). Child không cần sửa file này — chỉ cần register merge drivers một lần:

```bash
./scripts/setup-merge-drivers.sh
```

Script tự register 2 driver:
- `merge.ours.driver` (global) — cho các file dùng `merge=ours`.
- `merge.foxlocale.driver` (per-repo) — JSON-aware 3-way merge cho `locales/*.json`.

**Giải thích các merge rule:**
- `merge=ours`: khi merge, git tự động giữ nguyên version của child — không có conflict dialog, không can thiệp thủ công. Áp dụng cho `templates/*.json`, `config/settings_data.json`, `src/scss/modules/*`, `src/js/custom/*`…
- `merge=foxlocale`: driver Node script (`scripts/merge-drivers/locale-merge.mjs`) làm 3-way deep merge — core thêm key mới → child auto nhận, core đổi wording mà child chưa dịch → adopt core, child đã dịch → giữ child + warn. Đảm bảo locales JSON luôn valid.
- `settings_schema.json` và tất cả Liquid files **không có rule** — manual merge khi conflict (safety net, xem [Section 8](#8-xử-lý-conflict)).

### Scaffolding code riêng của child

Code child-specific nằm ngoài thư mục của core:

```
src/js/custom/                      # JS module riêng của child
src/js/global/custom.js             # Hướng dẫn thêm JS custom (đã có sẵn trong core)
src/scss/modules/<your-design>/     # SCSS riêng của child
```

`src/js/global/custom.js` đã có sẵn trong core, mở ra để đọc hướng dẫn. Workflow thêm JS mới:

1. Tạo `src/js/custom/<feature>.js`
2. `yarn copy:js` tự copy vào `assets/`
3. Thêm script tag vào `snippets/scripts.liquid`:

```liquid
<script src="{{ 'feature.js' | asset_url }}" type="module"></script>
```

### Set theme identity (làm 1 lần khi fork)

Mỗi child fork có tên + Shopify Theme Store version riêng. Sửa 3 chỗ:

1. **`snippets/theme-name.liquid`** — đổi `echo 'FoxTheme Base'` → `echo 'Tên Theme Của Bạn'`. File này `merge=ours`, sync upstream không động.
2. **`config/settings_schema.json`** — sửa `theme_info[0].theme_name` cùng giá trị.
3. **`package.json`** — đổi `"name": "foxtheme-base"` → tên slug của child.

Store version sống ở **3 chỗ** (snippet rendered vào console banner, settings_schema theme_info nhìn thấy trong admin, package.json đọc bởi `scripts/zip.js` để đặt tên zip release). Bump cả 3 đồng bộ qua helper khi ship Shopify Theme Store release:

```bash
yarn theme:bump-store-version 2.5.0
```

Helper patch 3 file qua targeted regex (preserve format). Cadence 1-2 tháng/lần, **độc lập** với internal git-tag version (`v*` tags + CHANGELOG.md) auto-bump mỗi commit trên CI.

> **Quy tắc**: chỉ chạy `yarn theme:bump-store-version` trên child. Core repo phải giữ store version ở placeholder `1.0.0` để không tạo conflict cho child khi sync (3-way merge ưu tiên bên nào thay đổi — nếu chỉ child bump, child wins).

### Tuỳ chỉnh ban đầu

- **Markup**: Sửa `snippets/product-card-markup.liquid`, `sections/*.liquid`, `blocks/*.liquid` theo design. **Giữ nguyên `ref="…"` và `data-…` attributes** — JS phụ thuộc vào chúng.
- **SCSS**: Sửa `src/scss/modules/*.scss`. Không đụng `src/scss/mixins/`.
- **Templates**: Build cấu trúc theme cho store như bình thường.

```bash
yarn deploy:dev    # hoặc :test / :intro tuỳ môi trường
```

---

## 5. Workflow hàng ngày trên child project

### Đặt code mới ở đâu

| Nhu cầu | Vị trí |
|---|---|
| Block / section / snippet riêng của store | File mới trong `blocks/`, `sections/`, `snippets/` với prefix riêng (ví dụ: `_acme-hero.liquid`) |
| JS feature riêng | `src/js/custom/<feature>.js` + thêm script tag vào `snippets/scripts.liquid` |
| Re-skin visual component có sẵn | Sửa thẳng SCSS của nó (`src/scss/global/_component-*` / `_block-*` / `_section-*`) — child design layer, sync giữ bản child |
| Tinh chỉnh foundation/token | Sửa thẳng `src/scss/global/_typography` / `_base` / `_spacing`… — cũng child-owned |
| Feature CSS độc lập (bundle riêng) | `src/scss/modules/<feature>.scss` |
| Override markup core component | Sửa file `.liquid` có sẵn — giữ `{% liquid %}` logic + `ref` / `data-*` của core |

### Tuyệt đối không được sửa

- `src/js/modules/component.js`, `events.js`, `utilities.js`, `morph.js`, `motion-coordinator.js`, `image-coordinator.js`, `section-renderer.js` — engine của core.
- `src/js/library/` — third-party libs.
- Bất kỳ file nào trong `src/js/modules/` nếu có thể tránh được.

Nếu **bắt buộc phải extend core JS module**: copy sang `src/js/custom/<name>-extended.js`, import bản gốc, override phần cần. Không sửa trực tiếp file trong `src/js/modules/`.

---

## 6. Workflow hàng ngày trên core

### Branching

- `main` là nhánh integration — luôn deployable.
- Tính năng mới/fix phức tạp: tạo feature branch, merge qua PR.
- Fix nhỏ: push thẳng vào `main`.

```bash
# Tạo feature branch
git checkout -b feat/new-section

# ... phát triển, test ...

# Merge vào main
git checkout main
git merge feat/new-section --no-ff
git branch -d feat/new-section
```

### Format commit message (Conventional Commits)

```
<type>(<scope>): <subject>
```

| `type` | Dùng khi |
|---|---|
| `feat` | Tính năng mới (component mới, param mới) |
| `fix` | Bug fix |
| `refactor` | Tái cấu trúc nội bộ, không thay đổi behavior |
| `chore` | Tooling, dependencies, formatting |
| `docs` | Chỉ thay đổi documentation |

`scope` là module/khu vực bị ảnh hưởng: `cart-drawer`, `product-card`, `morph`, `liquid`, `scss`…

**Breaking change** (bump MAJOR): thêm footer `BREAKING CHANGE: <mô tả migration>` vào commit body. Footer mô tả rõ child cần làm gì để migrate — nội dung này flow thẳng vào `CHANGELOG.md`.

**Ví dụ:**
```
fix(morph): preserve media attribute on lazy stylesheet links
feat(product-card): add data-quick-add-trigger for external access
```

```
feat(price): rename sale amount attribute

BREAKING CHANGE: `data-sale-amount` renamed to `data-sale-value`.
Child themes với custom price markup phải đổi tên attribute.
```

Trong terminal:
```bash
git commit -m "feat(price): rename sale amount attribute" \
           -m "BREAKING CHANGE: data-sale-amount renamed to data-sale-value. Child themes với custom price markup phải đổi tên attribute."
```

### Release một version mới

**Tự động (mặc định):** Mỗi khi push hoặc merge PR vào `main`, Bitbucket Pipelines tự động:
1. Đọc commit history kể từ tag cuối
2. Dùng `git-cliff` detect version tiếp theo (PATCH / MINOR / MAJOR) dựa vào commit type
3. Generate `CHANGELOG.md`
4. Tạo commit `chore(release): vX.X.X` + tag + push

Developer không cần làm gì thêm ngoài commit đúng format và push.

```bash
# Làm việc bình thường
git commit -m "fix(cart): handle empty cart on checkout"
git push origin main
# → Pipeline tự chạy, release tự động
```

Sau khi pipeline chạy xong, pull về để sync CHANGELOG:
```bash
git pull origin main
```

**Thủ công (khi cần release ngay mà không push thêm commit):**
```bash
yarn release v1.1.0
```

> `git-cliff` tự động suy ra version tiếp theo: có `BREAKING CHANGE:` footer → MAJOR, có `feat` → MINOR, chỉ có `fix` → PATCH. Commit dạng `chore`, `Merge` bị bỏ qua khi tính version.

### CI gates trước release

Pipeline chạy các check sau trên mỗi push vào `main`. Fail bất kỳ check nào → block release. Reproduce local:

```bash
yarn check-js-contract        # No NEW class selectors in src/js/modules/* (ratchet vs baseline)
yarn check-settings-schema    # config/settings_schema.json valid + no dup IDs
```

Trên `feat/**` branches có thêm guard riêng:

```bash
./scripts/check-additive-feature.sh    # Branch chỉ được ADD .liquid/.js/.scss mới
```

Các script khác (`check-template-refs`, `check-missing-translate`, `check-unused-translate`) là dev tools — không gate CI, dùng khi cần audit thủ công.

---

## 7. Kéo update từ core vào child

Mỗi lần upstream release một tag mới (vd `v1.1.0`), child theo các bước sau. Ba lệnh `yarn core:diff` / `core:dry-merge` / `core:sync` gói gọn 90% công việc; phần còn lại là đọc changelog và resolve conflict.

### Hình dung quy trình

Một chu kỳ sync di chuyển code từ upstream tag → sync branch ngắn hạn → child main. Sync branch là "vùng đệm" để test/resolve, không bao giờ merge thẳng tag vào main.

```
                                            time →

upstream     ●──●──● [v1.1.0]──●──●──● [v1.2.0]
                                       │
                            git fetch  │ fetch tag mới
                            upstream   │
                            --tags     ▼
sync branch                         ●──●──●──●
                                    ▲        │
                                    │        │
                          git checkout -b    │ yarn core:sync
                          sync-core-v1.2.0   │ (resolve nếu cần,
                                             │  build, smoke test)
                                             │
                                             ▼  git merge --no-ff
child/main   ●──●──●──●  (work của child)  ──●──●──→
                                              │
                                              └── đã có v1.2.0
                                                  + giữ nguyên work
                                                  của child
```

- **Mũi tên thời gian** chảy sang phải.
- **Upstream** chỉ chứa tag chính thức — không bao giờ sync `upstream/main` trực tiếp.
- **Sync branch** sống ngắn (vài phút đến vài giờ), bị xoá sau khi merge ngược vào main.
- **Child/main** luôn deployable; mọi merge sync đều là `--no-ff` để giữ ranh giới rollback.

### Bước 1 — Setup `upstream` remote (chỉ làm lần đầu)

```bash
git remote add upstream <foxtheme-base-url>
git remote -v   # verify
```

### Bước 2 — Đọc changelog upstream

```bash
git fetch upstream --tags
git log v1.0.0..v1.1.0 --oneline   # commit titles
git show v1.1.0                    # CHANGELOG.md mới
```

Lưu ý các footer `BREAKING CHANGE:` — đó là tín hiệu phải lên plan migration thay vì merge thẳng.

### Bước 3 — Preview impact

```bash
yarn core:diff v1.1.0
```

Output chia file core đã đổi thành:
- **Tier 1** — child chưa đụng file → git tự merge, không cần làm gì.
- **Tier 2** — child cũng đã sửa file đó (file-level overlap) → **có thể** conflict thật, hoặc git auto-merge được nếu hai bên sửa khác vùng dòng.

> Tier 2 là cảnh báo về risk ở mức file, không phải khẳng định sẽ conflict. Source of truth về conflict thật là `core:dry-merge` (Bước 4) — nó chạy merge thật rồi abort, chỉ báo file thực sự không gộp được tự động.

Nếu muốn so với một version cũ hơn version git tự detect:

```bash
yarn core:diff v1.2.0 --from v1.0.4
```

### Bước 4 — Preview conflicts (tuỳ chọn)

```bash
yarn core:dry-merge v1.1.0
```

Lệnh này thử merge rồi abort ngay; chỉ liệt kê các file sẽ conflict thật (line-level overlap). Hữu ích để biết trước resolve có nhiều không trước khi commit thời gian cho merge thật.

### Bước 5 — Tạo sync branch

**Không bao giờ merge trực tiếp vào `main`.** Tạo branch riêng để có chỗ test và rollback dễ:

```bash
git checkout main
git pull
git checkout -b sync-core-v1.1.0
```

### Bước 6 — Chạy merge thật

```bash
yarn core:sync v1.1.0
```

Lệnh này yêu cầu working tree sạch và branch hiện tại không phải `main`/`master`. Nếu không có conflict → chuyển sang Bước 8. Nếu có conflict → Bước 7.

### Bước 7 — Resolve conflict (nếu có)

Xem [Section 8](#8-xử-lý-conflict) — chia theo loại file. Khi xong:

```bash
git add <files-đã-resolve>
git commit          # hoàn tất merge commit
```

Muốn huỷ và làm lại từ đầu: `git merge --abort`.

### Bước 8 — Build và smoke test

```bash
yarn install              # nếu package.json/yarn.lock thay đổi
yarn build:css && yarn copy:js
yarn shopify theme dev    # smoke test local
```

### Bước 9 — Merge sync branch vào main và deploy

```bash
git checkout main
git merge --no-ff sync-core-v1.1.0
git push
git branch -d sync-core-v1.1.0
yarn deploy:test          # verify trước khi production
```

---

### Reference: flowchart 9 bước

Sơ đồ quyết định cho cả chu kỳ — bám sát Bước 1-9 ở trên:

```
                ┌────────────────────────────┐
                │ git fetch upstream --tags  │   Bước 1-2
                │ git log/show tag           │
                └────────────┬───────────────┘
                             │
                  ┌──────────▼──────────┐
                  │ BREAKING CHANGE?    │
                  └──────┬──────────┬───┘
                       no│        ye│s
                         │          └──→  Hoãn, plan migration
                         ▼
                ┌────────────────────────┐
                │ yarn core:diff <ver>   │   Bước 3
                │ → Tier 1 / Tier 2      │
                └────────────┬───────────┘
                             ▼
                ┌────────────────────────┐
                │ yarn core:dry-merge    │   Bước 4 (tuỳ chọn)
                │ → liệt kê conflict     │
                └────────────┬───────────┘
                             ▼
                ┌────────────────────────┐
                │ git checkout -b        │   Bước 5
                │   sync-core-<ver>      │
                └────────────┬───────────┘
                             ▼
                ┌────────────────────────┐
                │ yarn core:sync <ver>   │   Bước 6
                └────────────┬───────────┘
                             │
                   ┌─────────▼─────────┐
                   │ Có conflict?      │
                   └─────┬─────────┬───┘
                       no│       ye│s
                         │         └──→  §8 resolve theo loại file → git add + commit   Bước 7
                         ▼                                                                │
                ┌────────────────────────┐  ◀──────────────────────────────────────────────┘
                │ yarn install           │   Bước 8
                │ build:css && copy:js   │
                │ shopify theme dev      │
                └────────────┬───────────┘
                             ▼
                ┌────────────────────────┐
                │ checkout main          │   Bước 9
                │ merge --no-ff sync-... │
                │ push + deploy          │
                └────────────────────────┘
```

---

### Chiến lược thay thế cho từng tình huống

| Tình huống | Chiến lược |
|---|---|
| Muốn tất cả thay đổi trong `v1.1.0` | `yarn core:sync v1.1.0` (Bước 6 ở trên) |
| Chỉ muốn một commit cụ thể (vd PATCH fix gấp) | `git cherry-pick <sha>` thay cho Bước 6 |
| Release lớn có breaking changes chưa sẵn sàng | Hoãn, giữ tag hiện tại, lên kế hoạch migration |

> **Luôn merge tag cụ thể, không merge `upstream/main` trực tiếp.** `upstream/main` có thể chứa work-in-progress chưa stable.

---

## 8. Xử lý conflict

### Trước hết — kiểm tra file nào conflict

```bash
git diff --name-only --diff-filter=U
```

Với mỗi file, tra theo path pattern ở các subsection bên dưới để biết áp rule nào. Cheatsheet git ở [cuối section](#cheatsheet-git-cho-conflict).

---

### `templates/*.json`, `config/settings_data.json`

**Luôn giữ version của child.** Đã có `merge=ours` trong `.gitattributes` nên tự động. Nếu hiếm khi vẫn conflict:

```bash
git checkout --ours templates/product.json
git add templates/product.json
```

### `locales/*.json`

**Tự resolve qua driver `merge=foxlocale`** (`scripts/merge-drivers/locale-merge.mjs`). 3-way deep merge với rule:

| Tình huống | Kết quả |
|---|---|
| Core thêm key mới | Child auto nhận |
| Core đổi wording, child chưa dịch | Adopt core |
| Child đã dịch key đó | Giữ child + warn ra stderr |
| Core đổi và child đã dịch khác nhau | Giữ child (child wins), warn cụ thể key nào |

Output luôn là JSON valid. Sau merge:

```bash
yarn check-missing-translate
```

### `config/settings_schema.json`

File này **manual merge** (không dùng `merge=ours` vì child cần nhận settings mới từ core; không dùng JSON-aware driver vì semantic phức tạp — xem ghi chú cuối section).

#### Cấu trúc cần nhớ trước khi resolve

- File là **array** ở top level, không phải object.
- Element [0] luôn là `theme_info` (Shopify yêu cầu).
- Mỗi element còn lại là một **section**: `{ "name": "...", "settings": [...] }`.
- Mỗi `settings[]` item là một control (text, color, checkbox, header, paragraph…); items có `id` được identify bằng `id` (duplicates = data loss).

#### Khi conflict xảy ra — workflow chuẩn

1. **Backup trước khi resolve**:
   ```bash
   cp config/settings_schema.json /tmp/schema-conflict.json
   ```

2. **Mở file, định danh từng conflict block**. Mỗi `<<<<<<<` / `=======` / `>>>>>>>` cụm cho biết:
   - Phần `<<< HEAD` / `=== ours`: version hiện tại của child
   - Phần `=== theirs` / `>>>`: version từ core mới merge vào
   - Tìm `name` / `id` gần nhất phía trên để biết đang trong section/setting nào.

3. **Áp dụng rules**:
   - **Section mới chỉ có ở core** → giữ. Đặt vào vị trí semantic phù hợp (theme editor sẽ render theo array order).
   - **Section mới chỉ có ở child** → giữ nguyên vị trí child đã đặt.
   - **Setting mới (cùng section) chỉ có ở core** → giữ. Đặt sau setting trước nó trong core version.
   - **Setting mới chỉ có ở child** → giữ.
   - **Cùng setting `id`, label/default khác nhau** → **giữ child wording** (child đã localize cho store). Nếu core đổi tên `id` (rare, breaking), align với core và update template refs.
   - **Setting bị remove ở core, child giữ nguyên** → hỏi: core có lý do gì (deprecated)? Nếu yes, follow core. Nếu child cần giữ → keep.
   - **Setting bị remove ở child, core giữ nguyên** → hỏi: child có intentional disable? Nếu yes, keep removed. Nếu không, restore.

4. **Validate trước khi commit**:
   ```bash
   yarn check-settings-schema       # JSON valid, theme_info[0], no dup IDs
   yarn shopify theme dev           # smoke test theme editor render
   ```

5. **Commit**:
   ```bash
   git add config/settings_schema.json
   git merge --continue
   ```

#### Common pitfalls

- **JSON trailing comma**: dễ xảy ra sau khi xoá element trong conflict block. `yarn check-settings-schema` sẽ catch.
- **Duplicate setting `id` trong cùng section**: cả 2 phía cùng thêm setting với `id` giống nhau (vô tình). Shopify sẽ chỉ giữ 1, mất data setting kia. `yarn check-settings-schema` catch case này.
- **Settings bị "đào" mất khi resolve nhanh**: dùng backup ở bước 1 + diff so sánh thủ công các section count trước/sau.

> **Hardening tương lai (Phase 2.3-B, deferred)**: viết `merge=foxschema` driver tương tự `foxlocale` để auto-resolve case "additive on both sides + non-overlapping". Sẽ implement khi conflicts trở thành pain point thực sự (sau khi có ≥ 3 child hoặc khi motrix bắt đầu customize schema). Pattern + spec lưu trong memory entry `project_fork_hardening.md`.

### `sections/*.liquid`, `blocks/*.liquid`, `snippets/*.liquid`

Child được phép sửa bất kỳ file Liquid nào để đáp ứng design. Conflict ở đây là **có chủ ý** — buộc dev nhìn diff và quyết định apply phần nào.

Cách resolve:

1. Mở file, xem từng conflict block.
2. **Giữ markup structure của child** (HTML tags, classes, styling).
3. **Áp dụng Liquid logic changes của core** (object/filter mới, param mới, `ref`/`data-*` attributes mới — JS phụ thuộc).
4. Test tính năng JS liên quan sau merge.

**Cherry-pick cho critical bug fix** (chỉ lấy một commit thay vì cả version):

```bash
git log upstream/main --oneline -- snippets/product-card-markup.liquid
git cherry-pick <sha>
```

Nếu fix ở vùng khác với chỗ child sửa design → tự merge được. Nếu trùng vùng → conflict nhỏ, resolve theo cùng 4 bước trên.

### `src/scss/global/_component-*`, `_block-*`, `_section-*` + token

Visual thuần → **child design layer**. Child sửa trực tiếp là bình thường (theme thật cần restyle). Conflict ở đây = cả hai cùng sửa một vùng.

Cách resolve:

1. **Giữ bản của child** (`git checkout --ours <file>` → `git add`).
2. **KHÔNG bỏ core trong câm lặng** — xem diff core mang vào để không lỡ một bug fix / feature:
   ```bash
   git diff HEAD...MERGE_HEAD -- src/scss/global/_component-collection-card.scss
   ```
3. Nếu diff đó là CSS bug fix / cải tiến thật → fold tay vào bản child. Nếu chỉ là đổi style của skin mẫu core → bỏ qua.

> File child **chưa** đụng sẽ không conflict — git 3-way tự merge thay đổi core vào (child nhận fix/feature miễn phí).
>
> **Manifest** (`theme.scss`, `_blocks.scss`, `_sections.scss`): giữ **cả hai** dòng `@use` (core + child) như `settings_schema.json` → child nhận component mới của core.
>
> `src/scss/mixins/*`: core infra → lấy core (`--theirs`).

### `src/js/modules/*.js`

**Không bao giờ nên có conflict ở đây** — đây là core JS, child không được phép sửa. Nếu có conflict nghĩa là child đã lỡ tay sửa.

Cách resolve:

1. Discard phần child đã sửa → lấy version core:
   ```bash
   git checkout --theirs src/js/modules/product-card.js
   git add src/js/modules/product-card.js
   ```
2. Di chuyển customisation đó sang `src/js/custom/` (đúng layer cho code child).

### Cheatsheet git cho conflict

```bash
# Xem danh sách file đang conflict
git diff --name-only --diff-filter=U

# Giữ version của child cho một file
git checkout --ours path/to/file

# Lấy version của core cho một file
git checkout --theirs path/to/file

# Hủy merge, quay lại trạng thái trước
git merge --abort

# Sau khi resolve tất cả
git add -A && git commit
```

---

## 9. Versioning

Dùng **Semantic Versioning**: `MAJOR.MINOR.PATCH`.

```
v1.2.3
  │ │ └── PATCH: fix bug, không thay đổi contract
  │ └──── MINOR: thêm tính năng mới, backward compatible
  └────── MAJOR: breaking change (đổi ref, xoá data-*, đổi event name)
```

| Bump | Trigger | Child cần làm gì |
|---|---|---|
| **PATCH** (`1.0.1`) | Bug fix, không thay đổi contract | Merge ngay, không cần review kỹ |
| **MINOR** (`1.1.0`) | Tính năng mới, `data-*`/`ref` mới optional | Merge khi sẵn sàng; không có gì vỡ nếu chưa merge |
| **MAJOR** (`2.0.0`) | Đổi tên/xoá `data-*`, `ref`, custom element tag, snippet param | Lên kế hoạch migration, review CHANGELOG kỹ trước khi merge |

**Ví dụ thực tế:**

| Thay đổi | Bump |
|---|---|
| Fix race condition trong `cart-drawer.js` | PATCH |
| Thêm `data-cart-bubble-count` attribute mới (optional) | MINOR |
| Thêm component `<wishlist-component>` mới | MINOR |
| Đổi `data-swatch-show-more` → `data-swatch-overflow` | MAJOR |
| Xoá `<old-cart>`, thay bằng `<cart-drawer>` | MAJOR |
| Refactor nội bộ `morph.js`, behavior giữ nguyên | PATCH |

**Pre-1.0:** Trong giai đoạn contract chưa ổn định, dùng `0.x.0` cho mọi thay đổi. Chuyển sang `1.0.0` khi public surface đã stable.

---

## 10. Bảng phân loại file

| Path | Chiến lược | Ghi chú |
|---|---|---|
| `src/js/modules/component.js`, `events.js`, `utilities.js`, `morph.js`, `motion-coordinator.js`, `image-coordinator.js`, `section-renderer.js` | **Core-locked** | Engine — không bao giờ sửa ở child |
| `src/js/modules/<feature>.js` (cart, product, variant…) | **Sync from core** | Child không nên sửa. Muốn extend: dùng `src/js/custom/` |
| `src/js/library/*` | **Sync from core** | Third-party libs |
| `src/js/global/theme.js`, `modules.js` | **Sync from core** | Bootstrap |
| `src/js/global/custom.js` | **Per-project** | File hướng dẫn thêm JS custom cho child. `merge=ours` |
| `src/js/custom/*` | **Per-project** | Code JS riêng của child |
| `src/scss/mixins/*` | **Sync from core** | Breakpoints, utilities — core infra, child không sửa |
| `src/scss/global/_component-*`, `_block-*`, `_section-*` + token (`_typography`, `_base`, `_layout`, `_spacing`, `_helpers`, `_resets`, `_keyframes`) | **Per-project (review)** | Visual thuần = child design layer. Sửa trực tiếp OK (đây là theme thật). Sync **giữ bản child** (`--ours`) + resolver in diff core để soi bug fix / feature. File chưa đụng → tự nhận thay đổi core |
| `src/scss/global/theme.scss`, `_blocks.scss`, `_sections.scss` | **Append-merge** | Manifest `@use` index — giữ CẢ HAI dòng (core + child) để child nhận component mới của core. Không `merge=ours` |
| `src/scss/modules/*` | **Per-project** | Feature CSS độc lập (bundle riêng như `cart-drawer`). `merge=ours` |
| `snippets/*-markup.liquid` | **Sync from core (review)** | Core cung cấp baseline; child override design nhưng giữ `ref`/`data-*` |
| `snippets/*` (utilities: `responsive-image`, `spacing-style`…) | **Sync from core** | Tiện ích tái sử dụng |
| `sections/*.liquid` | **Sync from core (review)** | Override theo design |
| `blocks/*.liquid` | **Sync from core (review)** | Override theo design |
| `layout/theme.liquid`, `password.liquid` | **Sync from core (review)** | Thường dùng chung, child có thể tuỳ chỉnh |
| `templates/*.json` | **Per-project** | Cấu trúc page của store. `merge=ours` |
| `config/settings_schema.json` | **Sync from core (review)** | Define theme settings. Manual merge — giữ cả hai phía |
| `config/settings_data.json` | **Per-project** | Dữ liệu store (màu, font…). `merge=ours` |
| `locales/*.json` | **Sync from core + child additions** | `merge=foxlocale` (3-way deep merge). Core thêm key mới → auto nhận; child đã dịch → giữ child |
| `assets/*` | **Built output** | Không commit nếu build khi deploy |
| `scripts/*` | **Sync from core** | Build, lint, release, merge drivers, core-sync wrappers. Child không nên sửa — đó là tooling chung. |
| `.gitattributes`, `bitbucket-pipelines.yml` | **Per-project** | Pipeline & merge rules. `merge=ours` cho `bitbucket-pipelines.yml`; `.gitattributes` sync from core. |
| `CLAUDE.md`, `PROJECT-MAP.md`, `CHANGELOG.md`, `FORK-WORKFLOW.md` | **Sync from core** | Documentation |

---

## 11. Các tình huống thường gặp

### Tình huống 1: Core fix JS bug. Child muốn lấy fix.

```bash
# Core: pipeline tự release sau khi push commit fix(…) vào main
# → tag PATCH v1.0.1 được tạo tự động

# Child: dùng full workflow §7 (Bước 1-9), hoặc shortcut sau:
git fetch upstream --tags
git checkout -b sync-core-v1.0.1
yarn core:sync v1.0.1               # gói gọn merge + post-merge hints
yarn copy:js && yarn shopify theme dev   # smoke test
git checkout main && git merge --no-ff sync-core-v1.0.1
git push && yarn deploy:test
```

> Cách cũ `git cherry-pick <sha>` vẫn dùng được khi chỉ muốn 1 commit cụ thể (xem [bảng chiến lược thay thế §7](#chiến-lược-thay-thế-cho-từng-tình-huống)).

### Tình huống 2: Child cần section riêng cho một store.

```bash
# Tạo với prefix riêng để không đụng với core
# sections/_acme-loyalty-banner.liquid
# src/js/custom/acme-loyalty.js  → thêm script tag vào snippets/scripts.liquid
# src/scss/modules/_acme-loyalty.scss

# Commit bình thường trên child. Không đụng core.
```

### Tình huống 3: Core có tính năng optional. Child A muốn dùng, Child B không.

```bash
# Trên core: phát triển trên feature branch
git checkout -b feat/lookbook
# ... build feature, chỉ add files mới ...
git push origin feat/lookbook

# Child A:
git fetch upstream
git merge upstream/feat/lookbook

# Child B:
# Không làm gì — Child B không bao giờ thấy section này
```

### Tình huống 4: Core update, feature branch cần sync.

```bash
# Sau khi core/main có tag v1.1.0
git checkout feat/lookbook
git merge v1.1.0     # gần như không conflict nếu feature branch chỉ add files
git push origin feat/lookbook
```

### Tình huống 5: Core đổi tên `data-*` attribute (breaking change).

Core bump MAJOR, CHANGELOG liệt kê rõ:
```
### Breaking
- Đổi `data-sale-amount` → `data-sale-value` (snippets/price.liquid).
  Child có custom price markup phải đổi tên attribute.
```

Child cần làm:
```bash
# Không merge tự động. Kiểm tra trước.
grep -r "data-sale-amount" snippets/ blocks/ sections/

# Đổi tên trong custom Liquid của child
# Sau đó merge
git merge v2.0.0
# Test kỹ tính năng liên quan
```

### Tình huống 6: Child muốn extend core JS class.

Không sửa `src/js/modules/product-card.js`. Thay vào đó:

```js
// src/js/custom/acme-product-card.js
import { ProductCard } from "@theme/product-card";

class AcmeProductCard extends ProductCard {
  connectedCallback() {
    super.connectedCallback();
    // thêm logic của child ở đây
  }
}

if (!customElements.get("acme-product-card")) {
  customElements.define("acme-product-card", AcmeProductCard);
}
```

Trong Liquid: dùng `<acme-product-card>` thay vì `<product-card>`.

### Tình huống 7: Child C muốn dùng tính năng của Child A.

```
Rule: tính năng được dùng ở ≥ 2 child → extract lên core.
```

```bash
# Bước 1: Extract tính năng từ Child A lên core thành feature branch
git checkout core
git checkout -b feat/the-feature
# Copy + refactor code từ Child A vào đây
# Đảm bảo chỉ add files mới, không sửa core files

# Bước 2: Child A và Child C đều merge feature branch
git merge upstream/feat/the-feature
```

### Tình huống 8: Core fix Liquid bug (dùng sai object, thêm param). Child muốn lấy fix.

Chạy preview để biết file fix có overlap với customization của child không:

```bash
git fetch upstream --tags
yarn core:diff v1.0.1            # file fix nằm Tier 1 hay Tier 2?
yarn core:dry-merge v1.0.1       # có conflict thật không?
```

- **Tier 1 / dry-merge clean** → sync bình thường: `yarn core:sync v1.0.1`.
- **Tier 2 / dry-merge báo conflict** → sync rồi resolve theo [§8 Liquid block](#sectionsliquid-blocksliquid-snippetsliquid): giữ markup của child, apply logic fix của core.

Cherry-pick chỉ 1 commit (khi không muốn merge cả version):

```bash
git log upstream/main --oneline -- snippets/product-card-markup.liquid
git cherry-pick <fix-sha>
yarn shopify theme dev   # smoke test
```

**Convention cho core** — giúp child dễ scan:

```
fix(product-card-markup): correct selected_or_first_available_variant usage
fix(responsive-image): add missing loading param passthrough
```

Commit message ghi rõ scope = tên file → child chạy `git diff v1.0.0..v1.0.1 --name-only -- '*.liquid'` là thấy ngay cần review file nào.

---

## 12. Troubleshooting

### "Conflict trong `templates/product.json` dù đã set `merge=ours`."

Merge driver chưa được register trên máy. Chạy script setup (idempotent, an toàn chạy nhiều lần):

```bash
./scripts/setup-merge-drivers.sh
```

Script tự register `merge.ours.driver` (global) và `merge.foxlocale.driver` (per-repo). Sau đó `git merge --abort` rồi merge lại.

### "Child SCSS bị overwrite sau khi merge từ core."

SCSS visual (`_component-*` / `_block-*` / `_section-*` + token như `_base`, `_typography`) là **child design layer** — child sửa trực tiếp là đúng, và khi sync phải **giữ bản child**. Nếu bị overwrite nghĩa là conflict đã được resolve nhầm bằng `--theirs`. Lấy lại bản child:
```bash
git checkout --ours src/scss/global/_base.scss
```
Để fork-sync-resolver xử các file này theo đúng policy (giữ `--ours` + in diff core để soi bug fix). Chỉ `src/scss/mixins/*` và manifest `@use` mới lấy/merge từ core.

### "JS feature vỡ sau khi merge — element không tìm được."

Core đã đổi tên `data-*` attribute. Kiểm tra CHANGELOG → Breaking section. Tìm và đổi tên trong custom Liquid của child:
```bash
grep -r "data-old-attribute" snippets/ blocks/ sections/
```

### "Sau khi merge, theme editor hiện duplicate sections/blocks."

Core đổi tên section/block file nhưng `templates/*.json` vẫn reference tên cũ:
```bash
yarn check-template-refs     # tìm reference lỗi thời
yarn clean-template-refs     # xoá chúng
```

### "Muốn quay về core version cũ hơn."

```bash
git revert -m 1 <merge-commit-sha>   # revert merge commit
```

### "Kiểm tra child đang dùng core version nào."

```bash
git log --oneline | grep -E "release v|Merge tag 'v"
# hoặc
git describe --tags
```

---

## Tài liệu tham khảo

- `CHANGELOG.md` — release notes theo version.
- `CLAUDE.md` — project conventions và hướng dẫn cho AI.
- `PROJECT-MAP.md` — map toàn bộ usages (regenerate bằng `yarn map`).
- `bitbucket-pipelines.yml` — CI/CD config: auto release khi push vào main.
- `scripts/ci-release.sh` — script được pipeline gọi để generate CHANGELOG + tag + push.
- `scripts/release.mjs` — script thủ công: `yarn release v1.x.x`.
- `cliff.toml` — cấu hình git-cliff (commit parser, CHANGELOG template).
- File này — workflow core/fork.

---

> **Nguyên tắc vàng**: Khi có nghi ngờ, chọn hướng ít xâm lấn nhất — cherry-pick fix nhỏ, audit diff trước khi merge release lớn, giữ customisation của child trong `src/js/custom/`, `src/scss/modules/`, và Liquid files có prefix riêng.
>
> Child không bao giờ merge `upstream/main` trực tiếp — luôn merge qua tag cụ thể (`v1.0.1`, `v1.1.0`…).
