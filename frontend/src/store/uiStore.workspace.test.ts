/**
 * Công tắc bảng Workspace trong `uiStore` (Kế hoạch E2).
 *
 * Khoá lại bốn thứ: cờ `workspaceHidden` + khoá lưu `boxfox_workspace_hidden`,
 * luật xếp hàng khi bảng đang ẩn, đường `showTab` của người dùng, và việc hiện
 * bảng thì xả hàng đợi cũ-trước theo đúng luật §3 (không cướp tab đã ghim).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PENDING_TAB_INTENTS,
  useUiStore,
  WORKSPACE_HIDDEN_KEY,
} from './uiStore'

function resetStore() {
  useUiStore.setState({
    openTabs: [],
    activeTab: null,
    pinnedTab: null,
    pendingIntents: [],
    tabIntentTargets: {},
    workspaceHidden: false,
    autoOpenTabs: true,
    autoOpenOnlyWhenIdle: false,
    lastUserActivityAt: 0,
  })
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cờ workspaceHidden + khoá lưu', () => {
  it('mặc định là false và không ghi khoá nào', () => {
    expect(useUiStore.getState().workspaceHidden).toBe(false)
    expect(localStorage.getItem(WORKSPACE_HIDDEN_KEY)).toBeNull()
  })

  it('toggle: ẩn ⇒ ghi "1", hiện lại ⇒ XOÁ khoá', () => {
    useUiStore.getState().toggleWorkspace()
    expect(useUiStore.getState().workspaceHidden).toBe(true)
    expect(localStorage.getItem(WORKSPACE_HIDDEN_KEY)).toBe('1')

    useUiStore.getState().toggleWorkspace()
    expect(useUiStore.getState().workspaceHidden).toBe(false)
    expect(localStorage.getItem(WORKSPACE_HIDDEN_KEY)).toBeNull()
  })

  it('khoá được đọc lại lúc khởi tạo store', async () => {
    localStorage.setItem(WORKSPACE_HIDDEN_KEY, '1')
    vi.resetModules()
    const fresh = await import('./uiStore')
    expect(fresh.useUiStore.getState().workspaceHidden).toBe(true)
  })
})

describe('luật ý định khi bảng đang ẩn', () => {
  it('requestTabIntent ⇒ luôn "queued", activeTab không đổi, hàng đợi dài thêm', () => {
    useUiStore.getState().setWorkspaceHidden(true)

    expect(
      useUiStore.getState().requestTabIntent({ tab: 'plan', target: null, reason: 'test' }),
    ).toBe('queued')

    const state = useUiStore.getState()
    expect(state.activeTab).toBeNull()
    expect(state.openTabs).toEqual([])
    expect(state.pendingIntents).toHaveLength(1)
    expect(state.pendingIntents[0].tab).toBe('plan')
  })

  it('tab đang ghim vẫn bị xếp hàng (không cướp tab người dùng đã chọn)', () => {
    useUiStore.getState().setWorkspaceHidden(true)
    useUiStore.getState().pinTab('audit')

    expect(
      useUiStore.getState().requestTabIntent({ tab: 'audit', reason: 'ghim' }),
    ).toBe('queued')
    expect(useUiStore.getState().activeTab).toBeNull()
    expect(useUiStore.getState().pendingIntents).toHaveLength(1)
  })

  it('trần 20 ý định giữ nguyên, ý định cũ nhất bị bỏ trước', () => {
    useUiStore.getState().setWorkspaceHidden(true)

    for (let i = 0; i < MAX_PENDING_TAB_INTENTS + 3; i++) {
      useUiStore.getState().requestTabIntent({ tab: 'files', reason: `ý định ${i}` })
    }

    const state = useUiStore.getState()
    expect(state.pendingIntents).toHaveLength(MAX_PENDING_TAB_INTENTS)
    expect(state.pendingIntents[0].reason).toBe('ý định 3')
    expect(state.pendingIntents[state.pendingIntents.length - 1].reason).toBe('ý định 22')
  })

  it('flushPendingIntents bị đóng băng khi đang ẩn', () => {
    useUiStore.getState().setWorkspaceHidden(true)
    useUiStore.getState().requestTabIntent({ tab: 'terminal', reason: 'test' })

    useUiStore.getState().flushPendingIntents()

    expect(useUiStore.getState().activeTab).toBeNull()
    expect(useUiStore.getState().pendingIntents).toHaveLength(1)
  })

  it('hiện bảng lại ⇒ xả hàng đợi CŨ-TRƯỚC, tab ghim vẫn ở lại hàng đợi', () => {
    const store = useUiStore.getState()
    store.setWorkspaceHidden(true)
    store.requestTabIntent({ tab: 'plan', reason: 'a' })
    store.requestTabIntent({ tab: 'terminal', reason: 'b' })
    store.pinTab('audit')
    store.requestTabIntent({ tab: 'audit', reason: 'ghim' })

    useUiStore.getState().setWorkspaceHidden(false)

    const state = useUiStore.getState()
    expect(state.openTabs).toEqual(['plan', 'terminal'])
    expect(state.activeTab).toBe('terminal')
    // Ý định của tab bị ghim chưa bị tiêu thụ.
    expect(state.pendingIntents.map((intent) => intent.tab)).toEqual(['audit'])
  })
})

describe('showTab — đường người dùng vừa bấm một thứ cần bảng', () => {
  it('hiện bảng + ghim + mở đúng tab', () => {
    useUiStore.getState().setWorkspaceHidden(true)
    useUiStore.getState().showTab('plan', { identity: 'x' })

    const state = useUiStore.getState()
    expect(state.workspaceHidden).toBe(false)
    expect(localStorage.getItem(WORKSPACE_HIDDEN_KEY)).toBeNull()
    expect(state.pinnedTab).toBe('plan')
    expect(state.activeTab).toBe('plan')
    expect(state.openTabs).toEqual(['plan'])
    expect(state.tabIntentTargets.plan).toEqual({ identity: 'x' })
  })

  it('showTab tiêu thụ luôn ý định đang xếp hàng của chính tab đó', () => {
    useUiStore.getState().setWorkspaceHidden(true)
    useUiStore.getState().requestTabIntent({ tab: 'plan', target: { identity: 'p1' }, reason: 'a' })
    useUiStore.getState().requestTabIntent({ tab: 'files', reason: 'b' })

    useUiStore.getState().showTab('plan')

    const state = useUiStore.getState()
    expect(state.activeTab).toBe('plan')
    expect(state.pinnedTab).toBe('plan')
    // `setWorkspaceHidden(false)` xả 'files' trước (hàng đợi cũ-trước), rồi tới
    // lượt 'plan' của người dùng; hàng đợi phải sạch cho cả hai.
    expect(state.pendingIntents).toHaveLength(0)
    expect(state.openTabs).toEqual(['plan', 'files'])
    expect(state.tabIntentTargets.plan).toEqual({ identity: 'p1' })
  })
})

describe('openTab khi bảng đang ẩn', () => {
  it('chỉ dựng sẵn trạng thái, KHÔNG tự hiện bảng', () => {
    useUiStore.getState().setWorkspaceHidden(true)
    useUiStore.getState().openTab('sandbox')

    const state = useUiStore.getState()
    expect(state.workspaceHidden).toBe(true)
    expect(state.openTabs).toEqual(['sandbox'])
    expect(state.activeTab).toBe('sandbox')
  })
})

/**
 * Lỗi b18-review #2: nút [👁 View] trong chat gọi `selectFile` → `openTab`, nên
 * khi bảng Workspace đang ẩn thì cú bấm KHÔNG hiện gì (tab Files đổi ngầm). Nút
 * View là một cú bấm của người dùng, nên nó phải đi qua `showTab`.
 */
describe('selectFile — cú bấm của người dùng', () => {
  it('hiện bảng Workspace đang ẩn rồi kích hoạt tab Files', () => {
    useUiStore.getState().setWorkspaceHidden(true)
    expect(useUiStore.getState().workspaceHidden).toBe(true)

    useUiStore.getState().selectFile('src/parser.py')

    const state = useUiStore.getState()
    expect(state.workspaceHidden).toBe(false)
    expect(localStorage.getItem(WORKSPACE_HIDDEN_KEY)).toBeNull()
    expect(state.selectedFilePath).toBe('src/parser.py')
    expect(state.activeTab).toBe('files')
    expect(state.openTabs).toEqual(['files'])
    expect(state.pinnedTab).toBe('files')
  })

  it('bảng đang hiện: giữ nguyên đường đi cũ (chọn file + tab Files)', () => {
    useUiStore.getState().selectFile('a.ts')

    const state = useUiStore.getState()
    expect(state.workspaceHidden).toBe(false)
    expect(state.selectedFilePath).toBe('a.ts')
    expect(state.activeTab).toBe('files')
    expect(state.openTabs).toEqual(['files'])
  })

  it('xả hàng đợi đang đóng băng của tab khác khi bảng hiện lại', () => {
    useUiStore.getState().setWorkspaceHidden(true)
    useUiStore.getState().requestTabIntent({ tab: 'audit', reason: 'agent' })

    useUiStore.getState().selectFile('src/main.ts')

    const state = useUiStore.getState()
    // 'audit' xả trước (cũ-trước) rồi tab Files của người dùng thắng ở `activeTab`.
    expect(state.openTabs).toEqual(['audit', 'files'])
    expect(state.activeTab).toBe('files')
    expect(state.pendingIntents).toHaveLength(0)
  })
})
