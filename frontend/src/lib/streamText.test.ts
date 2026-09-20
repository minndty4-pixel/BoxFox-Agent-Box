import { describe, expect, it } from 'vitest'
import { appendStreamText } from './streamText'

describe('appendStreamText', () => {
  it('nối các mảnh rời (delta thật)', () => {
    let text = ''
    for (const piece of ['Kế hoạch chi', ' tiết cho', ' agent']) {
      text = appendStreamText(text, piece)
    }
    expect(text).toBe('Kế hoạch chi tiết cho agent')
  })

  it('thay thế khi event mang văn bản tích luỹ, không lặp tiền tố', () => {
    let text = ''
    for (const piece of ['Kế hoạch chi', 'Kế hoạch chi tiết cho', 'Kế hoạch chi tiết cho agent']) {
      text = appendStreamText(text, piece)
    }
    expect(text).toBe('Kế hoạch chi tiết cho agent')
    expect(text.match(/Kế hoạch/g)).toHaveLength(1)
  })

  it('bỏ qua mảnh rỗng và giữ nguyên văn bản hiện có', () => {
    expect(appendStreamText('đang viết', '')).toBe('đang viết')
    expect(appendStreamText('', 'mới')).toBe('mới')
  })

  it('không nhân đôi khi bản ghi chuẩn của lượt tới sau các delta', () => {
    const deltas = ['Cần đọc', ' file', ' trước']
    let text = ''
    for (const piece of deltas) text = appendStreamText(text, piece)
    const canonical = 'Cần đọc file trước'
    text = appendStreamText(text, canonical)
    expect(text).toBe(canonical)
  })

  it('ghép đúng khi mảnh mới tình cờ trùng tiền tố của văn bản cũ', () => {
    // Văn bản hiện có 'ab', mảnh mới 'b' là delta ⇒ phải thành 'abb'.
    expect(appendStreamText('ab', 'b')).toBe('abb')
    // Văn bản hiện có 'ab', mảnh mới 'abc' bao trùm ⇒ thay thế.
    expect(appendStreamText('ab', 'abc')).toBe('abc')
  })
})
