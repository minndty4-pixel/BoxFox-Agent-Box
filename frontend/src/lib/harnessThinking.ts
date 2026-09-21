/**
 * Mức thinking: UI chỉ được gửi mức mà model đã công bố.
 *
 * Router trả `thinkingLevels` đọc thẳng từ provider, ví dụ DeepSeek Pro là
 * `['max', 'high', 'low']` — không có `medium`. Bản cũ của composer lấy mức
 * toàn cục trong `useHarnessStore` (mặc định `medium`) và gửi nguyên văn ở mỗi
 * lượt, nên phiên với DeepSeek Pro chết ngay ở lượt đầu bằng
 * `THINKING_LEVEL_UNSUPPORTED: model publishes max/high/low; requested medium`.
 * Hàm ở đây kéo mức đang chọn về mức gần nhất mà model thật sự nhận.
 */

/** Thứ tự mức thinking dùng chung cho OpenRouter, Anthropic và Gemini. */
export const THINKING_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function rank(level: string): number | null {
  const index = THINKING_ORDER.indexOf(level.trim().toLowerCase() as (typeof THINKING_ORDER)[number])
  return index === -1 ? null : index
}

/**
 * Mức gửi đi cho một model.
 *
 * - Model không công bố mức nào (danh sách rỗng hoặc thiếu): giữ nguyên yêu cầu.
 *   Harness tự bỏ giá trị này khi provider không có điều khiển thinking.
 * - Mức yêu cầu nằm trong danh sách: trả đúng cách viết của provider.
 * - Mức yêu cầu không nằm trong danh sách: chọn mức gần nhất theo thứ tự trên;
 *   hai mức cùng khoảng cách thì chọn mức **thấp hơn** (rẻ hơn và dễ đoán).
 * - Mức yêu cầu không thuộc thứ tự đã biết: lấy mức đầu tiên provider công bố.
 */
export function resolveThinkingLevel(published: string[] | undefined, requested: string | undefined): string | undefined {
  const levels = (published ?? []).map((level) => String(level).trim()).filter((level) => level.length > 0)
  if (levels.length === 0) return requested
  if (!requested || !requested.trim()) return levels[0]
  const wanted = requested.trim()
  const exact = levels.find((level) => level.toLowerCase() === wanted.toLowerCase())
  if (exact) return exact
  const wantedRank = rank(wanted)
  if (wantedRank === null) return levels[0]
  let best = levels[0]
  let bestDistance = Number.POSITIVE_INFINITY
  let bestRank = Number.POSITIVE_INFINITY
  for (const level of levels) {
    const levelRank = rank(level)
    if (levelRank === null) continue
    const distance = Math.abs(levelRank - wantedRank)
    if (distance < bestDistance || (distance === bestDistance && levelRank < bestRank)) {
      best = level
      bestDistance = distance
      bestRank = levelRank
    }
  }
  return best
}

/** True khi mức đang chọn chạy được trên model này (hoặc model không công bố mức nào). */
export function thinkingLevelIsPublished(published: string[] | undefined, level: string | undefined): boolean {
  const levels = (published ?? []).filter((item) => String(item).trim().length > 0)
  if (levels.length === 0) return true
  if (!level || !level.trim()) return false
  return levels.some((item) => item.trim().toLowerCase() === level.trim().toLowerCase())
}
