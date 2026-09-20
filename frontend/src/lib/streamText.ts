/**
 * Ghép một mảnh văn bản từ event stream vào văn bản đang hiển thị.
 *
 * Harness cũ phát văn bản TÍCH LUỸ: mỗi event `assistant_delta`/`thought` mang
 * toàn bộ nội dung tính đến lúc đó. Harness mới phát từng MẢNH (delta thật).
 * Hàm này đúng cho cả hai kiểu:
 *   - mảnh bao trùm phần đang có (tích luỹ) ⇒ thay thế;
 *   - mảnh là phần nối tiếp (delta) ⇒ cộng thêm.
 * Nhờ vậy bản ghi cũ trong database vẫn hiển thị đúng, và không còn hiện tượng
 * lặp tiền tố khi một consumer chỉ biết cộng chuỗi.
 */
export function appendStreamText(current: string, chunk: string): string {
  if (!chunk) return current
  if (!current) return chunk
  return chunk.startsWith(current) ? chunk : current + chunk
}
