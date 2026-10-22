// Child project — hướng dẫn thêm JS module riêng:
//
// 1. Tạo file trong src/js/custom/ (ví dụ: src/js/custom/acme-feature.js)
// 2. yarn copy:js sẽ tự copy sang assets/
// 3. Thêm script tag vào snippets/scripts.liquid:
//    <script src="{{ 'acme-feature.js' | asset_url }}" type="module"></script>
