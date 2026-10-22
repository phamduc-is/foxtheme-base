# Feature: Product Grid Density Control

Cho phép user switch số cột hiển thị trong product grid (default / zoom-out) trực tiếp trên trang collection/search.

Tính năng này **không active** trong codebase hiện tại. Bật lại theo đúng thứ tự bên dưới.

> Lưu ý: `enable_grid_density` và `enable_card_layout_switch` **không dùng đồng thời** — chỉ bật một trong hai trên mỗi section.

---

## Cách hoạt động

- Snippet `product-grid-control.liquid` hỗ trợ `mode: 'density'`
- Khi user chọn, JS gọi `results-list/updateDataLayout` → `updateLayout` → set `product-grid-view` attribute trên `<ul class="product-grid">`
- CSS đọc `product-grid-view` để điều chỉnh `--f-columns-lg/xl`
- Giá trị persist qua `sessionStorage` key `product-grid-view`

---

## Cài đặt

### Bước 1 — Thêm CSS

Lấy nội dung file `features/product-grid-density/scss/_grid-density.scss`, paste vào `src/scss/global/template-collection.scss` (sau phần `.collection__wrapper`).

Chạy `yarn build:css`.

### Bước 2 — Thêm schema setting vào section

Trong `sections/main-collection.liquid` và/hoặc `sections/search-results.liquid`, thêm vào `"settings"` array (cạnh `enable_card_layout_switch`, không dùng cả hai cùng lúc):

```json
{
  "type": "checkbox",
  "id": "enable_grid_density",
  "label": "t:settings.enable_grid_density",
  "default": true
}
```

### Bước 3 — Render attribute trên `<ul class="product-grid">`

Trong `sections/main-collection.liquid` và `sections/search-results.liquid`, thêm attribute vào thẻ `<ul class="product-grid">`:

```liquid
{% if section.settings.enable_grid_density %}product-grid-view="{{ columns }}-columns"{% endif %}
```

### Bước 4 — Restore từ sessionStorage

Trong inline `<script>` của mỗi section (khối `{% unless request.design_mode %}`), thêm đoạn restore trước hoặc sau block `data-layout` hiện có:

```js
const storedDensity = sessionStorage.getItem('product-grid-view');
if (storedDensity) {
  grid.setAttribute('product-grid-view', storedDensity);
  for (const option of document.querySelectorAll('input[type="radio"][name="grid"]')) {
    option.checked = option.value === storedDensity;
  }
}
```

### Bước 5 — Preserve attribute khi section re-render

Trong `src/js/modules/morph.js`, tìm dòng:

```js
const attributes = ["data-layout"];
```

Thêm `"product-grid-view"`:

```js
const attributes = ["product-grid-view", "data-layout"];
```

Chạy `yarn copy:js`.

### Bước 6 — Render snippet trong filters

Trong `snippets/filters.liquid`, thêm nhánh `enable_grid_density` (dùng `if/elsif` để đảm bảo chỉ hiện một trong hai):

```liquid
{% if section_settings.enable_grid_density %}
  {% render 'product-grid-control', mode: 'density' %}
{% elsif section_settings.enable_card_layout_switch %}
  {% render 'product-grid-control', mode: 'layout', default_layout: section_settings.default_card_layout %}
{% endif %}
```

---

## Verify

1. Bật `enable_grid_density` trong section settings (tắt `enable_card_layout_switch` nếu đang bật)
2. Truy cập trang collection — toolbar phải hiện 2 nút icon grid
3. Click nút zoom-out → grid tăng số cột
4. Reload trang → layout vẫn giữ nguyên (sessionStorage restore)
5. Filter/sort → `product-grid-view` attribute không bị mất (morph.js preserve)

---

## Files liên quan

```
features/product-grid-density/
├── scss/
│   └── _grid-density.scss     ← CSS cần paste vào template-collection.scss
└── FEATURE.md

snippets/product-grid-control.liquid   ← mode: 'density' đã có sẵn
src/js/modules/results-list.js         ← updateLayout + #setLayout đã có sẵn
locales/en.default.schema.json         ← key "enable_grid_density" đã có sẵn
```
