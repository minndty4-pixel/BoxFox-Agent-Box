/**
 * F2 (đợt 7): phiên `failed` từng hiện chip IDLE như phiên rảnh, vì nhánh ánh xạ
 * gộp mọi trạng thái không phải running/completed thành `idle`.
 */
import { describe, expect, it } from 'vitest'
import { mapSavedSessionStatus } from './Sidebar'

describe('mapSavedSessionStatus', () => {
  it('giữ đúng trạng thái thật của phiên đã lưu', () => {
    expect(mapSavedSessionStatus('running')).toBe('dang_chay')
    expect(mapSavedSessionStatus('completed')).toBe('xong')
    expect(mapSavedSessionStatus('failed')).toBe('loi')
    expect(mapSavedSessionStatus('awaiting_decision')).toBe('cho_nguoi_dung')
  })

  it('các trạng thái còn lại vẫn là phiên rảnh', () => {
    expect(mapSavedSessionStatus('idle')).toBe('idle')
    expect(mapSavedSessionStatus('cancelled')).toBe('idle')
    expect(mapSavedSessionStatus('interrupted')).toBe('idle')
  })

  it('nhãn lỗi có khoá i18n riêng, không dùng nhãn IDLE', async () => {
    const en = (await import('../../i18n/en')).default
    expect(en.sidebar.status.loi).toBe('ERROR')
    expect(en.sidebar.status.loi).not.toBe(en.sidebar.status.idle)
  })
})
