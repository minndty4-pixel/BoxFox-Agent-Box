/**
 * Sổ đăng ký panel của App — bảng Nhật ký hệ thống là tab DEV (kế hoạch §3.6).
 *
 * Bảng đọc `~/BoxFox/logs` trên host: hữu ích cho dev, nhưng không phải thứ người
 * dùng cuối nên thấy trong menu "Open Workspace". Test này khoá lại đúng luật đó:
 * có `import.meta.env.DEV` thì tab xuất hiện, bản dựng sản phẩm thì không — kể cả
 * khi trạng thái tab còn sót lại từ trước (việc lọc `openTabs` trong `App`).
 */
import { describe, expect, it } from 'vitest'
import { ALL_PANEL_TABS } from './store/uiStore'
import { availablePanelTabs, isPanelTabAvailable } from './App'

const DEV = { DEV: true } as ImportMetaEnv
const PROD = { DEV: false } as ImportMetaEnv

describe('tab Nhật ký hệ thống chỉ có trong chế độ dev', () => {
  it('nằm trong sổ đăng ký tab của ứng dụng', () => {
    expect(ALL_PANEL_TABS).toContain('system_log')
  })

  it('hiện trong menu khi bật chế độ dev', () => {
    expect(isPanelTabAvailable('system_log', DEV)).toBe(true)
    const ids = availablePanelTabs(DEV).map((tab) => tab.id)
    expect(ids).toContain('system_log')
    expect(ids).toEqual(ALL_PANEL_TABS)
  })

  it('biến mất khỏi menu ở bản dựng sản phẩm, các tab khác giữ nguyên', () => {
    expect(isPanelTabAvailable('system_log', PROD)).toBe(false)
    const ids = availablePanelTabs(PROD).map((tab) => tab.id)
    expect(ids).not.toContain('system_log')
    expect(ids).toEqual(ALL_PANEL_TABS.filter((id) => id !== 'system_log'))
  })

  it('mọi tab khác không bị chế độ dev chi phối', () => {
    for (const id of ALL_PANEL_TABS.filter((value) => value !== 'system_log')) {
      expect(isPanelTabAvailable(id, PROD)).toBe(true)
    }
  })
})
