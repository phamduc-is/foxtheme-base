# Nhiều chat — mỗi chat một file summary (local, không commit)

Thư mục **`.cursor/chat-summaries/`** đã nằm trong `.gitignore`: mọi file bạn tạo bên trong **không** lên git; phù hợp khi **mở nhiều chat song song** hoặc **mỗi phiên một thread** và muốn **mỗi chat một summary riêng**.

## Cách làm

1. **Tạo thư mục** (một lần trên máy):  
   `.cursor/chat-summaries/`

2. **Trước khi đóng chat / hết context**, tạo hoặc sửa **một file `.md` mới** trong thư mục đó — **một chat = một file** (không ghi đè lên file của chat khác).

3. **Đặt tên gợi nhớ** (khuyến nghị):  
   `YYYYMMDD-topic-ngan.md`  
   Ví dụ: `20260417-pdp-below-media.md`, `20260418-cart-drawer.md`

4. **Chat mới** tiếp tục **đúng** thread đó:  
   `@.cursor/chat-summaries/20260417-pdp-below-media.md`  
   rồi mới đưa yêu cầu tiếp (agent đọc overview trong file).

5. **Nhiều chat cùng lúc:** mỗi cửa sổ chat gắn với **một file** riêng; không dùng chung `chat-summary-latest.md` trừ khi bạn chủ động muốn một file “luôn mới nhất” cho mọi thứ.

## So sánh nhanh

| Cách | Đường dẫn | Khi nào dùng |
|------|-----------|----------------|
| Một file, ghi đè | `.cursor/chat-summary-latest.md` | Một luồng việc tuần tự, không song song nhiều chat. |
| Một file / chat | `.cursor/chat-summaries/<tên>.md` | Nhiều chat hoặc nhiều nhánh việc song song. |
| Handoff có commit (tùy team) | Tự đặt tên dưới `docs/` (vd. `docs/handoff-feature-x.md`) | Chỉ khi team muốn lưu trong git — **không** có file mặc định bắt buộc. |

Nội dung mỗi file: cùng khung gọn — Goal, Done, Next, Files/lệnh, Lưu ý (xem `.cursor/rules/context-handoff.mdc`).
