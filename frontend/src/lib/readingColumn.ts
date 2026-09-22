/**
 * Lớp đo của cột đọc khi bảng Workspace đang ẩn (vòng 18, việc 7).
 *
 * Bảng ẩn thì cột chat giãn hết bề rộng, nhưng nội dung đọc được gom vào cột
 * `max-w-3xl` (768 px) ở giữa — đúng nấc Tailwind mà khối transcript đang dùng.
 * Ba chỗ dùng chung một hằng để không nơi nào lệch: thân cuộn, hộp soạn tin, và
 * hàng của thanh ngữ cảnh.
 *
 * Chỉ là `margin`/`max-width`: không sinh `containing block` cho modal
 * `fixed inset-0` (khác `container-type`), nên khung xem lớn vẫn phủ đúng cửa sổ;
 * và ở 768 px thì hàng mang `@container` vẫn rộng hơn mốc `@lg` (512 px) nên biến
 * thể đầy đủ/condensed của thanh ngữ cảnh không đổi.
 */
export const READING_COLUMN_CLASS = 'mx-auto w-full max-w-3xl'

/** Lớp đo, hoặc chuỗi rỗng khi bảng Workspace đang hiện (cột chat giữ nguyên). */
export function readingColumnClass(workspaceHidden: boolean): string {
  return workspaceHidden ? READING_COLUMN_CLASS : ''
}
