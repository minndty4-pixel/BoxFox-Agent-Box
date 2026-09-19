/**
 * Bề rộng viewport cho các luật responsive của vỏ ứng dụng (BUG-23).
 *
 * Vì sao không dùng CSS media query thuần: Sidebar phải đổi *cấu trúc* (thanh
 * biểu tượng thay vì cột 260px) và trạng thái đó còn phải kiểm thử được trong
 * jsdom — nơi không có layout engine. Đọc `window.innerWidth` + lắng nghe
 * `resize` cho ra cùng một quyết định ở cả trình duyệt lẫn test.
 *
 * Trả về `0` khi chưa đo được (SSR, jsdom không có innerWidth). `0` KHÔNG được
 * coi là "hẹp" — nếu coi là hẹp thì lần render đầu sẽ nháy thanh biểu tượng rồi
 * mới bung ra cột đầy đủ.
 */
import { useEffect, useState } from 'react'

/** Dưới ngưỡng này Sidebar tự thu về thanh biểu tượng (plan §D-U4). */
export const NARROW_VIEWPORT_MAX_PX = 1024
/** Dưới ngưỡng này cột chat chiếm trọn bề ngang, panel phải tạm ẩn. */
export const COMPACT_VIEWPORT_MAX_PX = 768

function readViewportWidth(): number {
  if (typeof window === 'undefined') return 0
  const width = Number(window.innerWidth)
  return Number.isFinite(width) && width > 0 ? width : 0
}

/** `width === 0` (chưa đo được) → false: giữ nguyên bố cục đầy đủ. */
export function isNarrowViewport(width: number): boolean {
  return width > 0 && width < NARROW_VIEWPORT_MAX_PX
}

export function isCompactViewport(width: number): boolean {
  return width > 0 && width < COMPACT_VIEWPORT_MAX_PX
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(readViewportWidth)

  useEffect(() => {
    const onResize = () => setWidth(readViewportWidth())
    // Đọc lại ngay sau khi mount: test đổi `window.innerWidth` trước khi render
    // vẫn phải thấy giá trị đúng, không phụ thuộc vào lần `resize` nào.
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return width
}
