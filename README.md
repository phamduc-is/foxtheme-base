# FoxTheme Base

Shopify theme core — reusable infrastructure for FoxEcom child projects.

## Overview

`foxtheme-base` là core theme được dùng làm upstream cho tất cả child project (fork). Mọi bug fix và tính năng mới được phát triển tại đây và propagate xuống child thông qua git merge.

- **JS contract**: JS chỉ truy cập DOM qua `ref=""` / `data-*` — không dùng CSS class selector
- **Child projects**: tự do thay đổi design (CSS/markup) mà không lo JS bị vỡ
- **Auto release**: mỗi push vào `main` tự động tạo tag + CHANGELOG qua Bitbucket Pipelines

## Quick Start

```bash
yarn install
yarn start        # dev server + watchers + shopify theme dev
```

## Build Commands

| Lệnh | Mô tả |
|---|---|
| `yarn start` | Full dev: build + watchers + Shopify theme dev |
| `yarn build:css` | Compile SCSS → assets |
| `yarn copy:js` | Copy JS modules → assets |
| `yarn build:js-vite` | Build library JS via Vite |
| `yarn zip` | Production build + package |
| `yarn format` | Prettier toàn bộ files |
| `yarn lint:css` | Stylelint SCSS |

## Deploy

```bash
yarn deploy:dev    # development environment
yarn deploy:test   # test environment
yarn deploy:intro  # intro environment
```

## Release

Release được tự động tạo khi push vào `main` — Bitbucket Pipelines detect version tiếp theo từ commit history và tạo tag.

| Commit type | Version bump |
|---|---|
| `fix(scope): ...` | PATCH |
| `feat(scope): ...` | MINOR |
| `breaking(scope): ...` | MAJOR |

Manual release nếu cần:
```bash
yarn release v1.2.0
```

## Fork Workflow

Xem [FORK-WORKFLOW.md](FORK-WORKFLOW.md) để biết cách:
- Setup child project mới từ core
- Kéo update từ core về child
- Xử lý conflict khi merge
- Quản lý optional features qua feature branches

## Commit Convention

Dùng [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `breaking`

Commit sai format sẽ bị Husky chặn lại.

## File Structure

```
blocks/         # Theme blocks
sections/       # Page sections
snippets/       # Reusable Liquid fragments
templates/      # JSON page templates
assets/         # Built output — không edit trực tiếp
src/
  js/modules/   # Custom elements → yarn copy:js
  js/library/   # Third-party libs → yarn build:js-vite
  scss/         # SCSS source → yarn build:css
```

## Documentation

- [FORK-WORKFLOW.md](FORK-WORKFLOW.md) — core/fork workflow
- [CHANGELOG.md](CHANGELOG.md) — release history
- [CLAUDE.md](CLAUDE.md) — conventions cho AI assistant
