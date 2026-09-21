import { describe, expect, it } from 'vitest'
import { THINKING_ORDER, resolveThinkingLevel, thinkingLevelIsPublished } from './harnessThinking'

describe('resolveThinkingLevel', () => {
  it('giữ nguyên mức khi model không công bố mức nào', () => {
    expect(resolveThinkingLevel(undefined, 'medium')).toBe('medium')
    expect(resolveThinkingLevel([], 'medium')).toBe('medium')
  })

  it('trả đúng cách viết của provider khi mức đã nằm trong danh sách', () => {
    expect(resolveThinkingLevel(['max', 'high', 'low'], 'high')).toBe('high')
    expect(resolveThinkingLevel(['LOW', 'HIGH'], 'low')).toBe('LOW')
  })

  it('kéo "medium" về mức gần nhất — DeepSeek Pro chỉ công bố max/high/low', () => {
    // Cùng khoảng cách tới low và high → chọn mức thấp hơn, rẻ hơn và dễ đoán.
    expect(resolveThinkingLevel(['max', 'high', 'low'], 'medium')).toBe('low')
    expect(resolveThinkingLevel(['max', 'high', 'xhigh'], 'medium')).toBe('high')
  })

  it('mức lạ ngoài thứ tự đã biết thì lấy mức đầu tiên provider công bố', () => {
    expect(resolveThinkingLevel(['max', 'high', 'low'], 'turbo')).toBe('max')
  })

  it('không yêu cầu gì thì lấy mức đầu tiên provider công bố', () => {
    expect(resolveThinkingLevel(['xhigh', 'high'], '')).toBe('xhigh')
    expect(resolveThinkingLevel(['xhigh', 'high'], undefined)).toBe('xhigh')
  })

  it('thứ tự mức bao đủ các mức provider đang dùng', () => {
    expect(THINKING_ORDER).toContain('medium')
    expect(THINKING_ORDER).toContain('xhigh')
    expect(THINKING_ORDER).toContain('max')
  })
})

describe('thinkingLevelIsPublished', () => {
  it('model không công bố mức nào thì mọi mức đều chấp nhận', () => {
    expect(thinkingLevelIsPublished(undefined, 'medium')).toBe(true)
    expect(thinkingLevelIsPublished([], 'medium')).toBe(true)
  })

  it('so khớp không phân biệt hoa thường và bỏ qua khoảng trắng', () => {
    expect(thinkingLevelIsPublished(['max', 'high', 'low'], 'MAX')).toBe(true)
    expect(thinkingLevelIsPublished([' max '], 'max')).toBe(true)
  })

  it('mức không có trong danh sách là false — chính là lỗi của DeepSeek Pro với "medium"', () => {
    expect(thinkingLevelIsPublished(['max', 'high', 'low'], 'medium')).toBe(false)
    expect(thinkingLevelIsPublished(['xhigh', 'high'], 'low')).toBe(false)
  })
})
