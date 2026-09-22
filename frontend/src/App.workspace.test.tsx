/**
 * Công tắc bảng Workspace trên thanh trên (Kế hoạch E2, việc 6 + 7).
 *
 * Bảng Workspace và màn Máy là MỘT cột phải, nên công tắc này ẩn/hiện đúng cột
 * đó: cả thanh tab lẫn tab đang chọn đi theo, cột chat giãn hết (`flex 1 1 0%`),
 * và `splitRatio` không bị đụng — hiện lại là về đúng tỉ lệ cũ.
 *
 * Vẽ nguyên `App` với mạng đã chặn, đúng khuôn `TabBar.intents.test.tsx`.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { I18nProvider } from './i18n'
import { useAgentStore } from './store/agentStore'
import { useHarnessChatStore } from './store/harnessChatStore'
import { useUiStore, WORKSPACE_HIDDEN_KEY } from './store/uiStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { agentApiMock, providerApiMock } = vi.hoisted(() => ({
  agentApiMock: vi.fn(),
  providerApiMock: vi.fn(),
}))

vi.mock('./lib/agentApi', () => ({ agentApi: agentApiMock }))
vi.mock('./lib/providerApi', () => ({
  api: providerApiMock,
  ProviderApiError: class ProviderApiError extends Error {},
}))

/** Bề rộng cửa sổ mà bài test đang giả lập; `0` = chưa đo được (bố cục đầy đủ). */
const viewport = { width: 1440 }

vi.mock('./components/shell/useViewportWidth', () => ({
  NARROW_VIEWPORT_MAX_PX: 1024,
  COMPACT_VIEWPORT_MAX_PX: 768,
  isNarrowViewport: (width: number) => width > 0 && width < 1024,
  isCompactViewport: (width: number) => width > 0 && width < 768,
  useViewportWidth: () => viewport.width,
}))

const EMPTY_SNAPSHOT = {
  providers: [],
  connections: [],
  providerConfigs: [],
  aliases: [],
  defaultRoute: { connectionId: null, modelId: null, aliasId: null },
  keys: [],
  usage: [],
  health: { status: 'ok', version: '0.1.0' },
}

let roots: Root[] = []
let host: HTMLElement

function render(): void {
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )
  })
}

function toggle(): HTMLElement | null {
  return host.querySelector('[data-testid="workspace-toggle"]')
}

function pane(): HTMLElement | null {
  return host.querySelector('[data-testid="workspace-pane"]')
}

function resizer(): HTMLElement | null {
  return host.querySelector('[role="separator"]')
}

function chatColumn(): HTMLElement {
  return host.querySelector('[data-testid="chat-column"]')!
}

function openMenuTab(label: string): void {
  const menuButton = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('Open Workspace') && button.title === 'Open Workspace View',
  )
  act(() => menuButton?.click())
  const item = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.includes(label) && button !== menuButton,
  )
  act(() => item?.click())
}

beforeEach(() => {
  viewport.width = 1440
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
  agentApiMock.mockReset()
  agentApiMock.mockImplementation(async () => ({ sessions: [] }))
  providerApiMock.mockReset()
  providerApiMock.mockImplementation(async () => EMPTY_SNAPSHOT)
  useHarnessChatStore.setState({ sessions: {}, decisions: {} })
  useAgentStore.setState({ activeSessionId: '', requests: {} })
  useUiStore.setState({
    openTabs: ['plan'],
    activeTab: 'plan',
    pendingIntents: [],
    pinnedTab: null,
    lastUserActivityAt: 0,
    autoOpenTabs: true,
    autoOpenOnlyWhenIdle: false,
    tabIntentTargets: {},
    planRevision: 0,
    workspaceHidden: false,
    splitRatio: 0.46,
  })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('công tắc có mặt trên thanh trên', () => {
  it('mặc định bảng đang hiện ⇒ aria-pressed true, cột phải và Resizer đều có', () => {
    render()

    expect(toggle()).not.toBeNull()
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true')
    expect(toggle()!.getAttribute('aria-label')).toBe('Hide workspace pane')
    expect(pane()).not.toBeNull()
    expect(resizer()).not.toBeNull()
  })

  it('không có ý định nào xếp hàng thì không có huy hiệu', () => {
    render()
    expect(host.querySelector('[data-testid="workspace-toggle-badge"]')).toBeNull()
  })
})

describe('bấm công tắc ⇒ ẩn bảng, cột chat giãn hết', () => {
  it('cột phải và Resizer biến mất, khoá localStorage được ghi, cột chat `flex 1 1 0%`', () => {
    render()
    expect(chatColumn().style.flex).toBe('0.46 0 0%')

    act(() => toggle()!.click())

    expect(pane()).toBeNull()
    expect(resizer()).toBeNull()
    expect(localStorage.getItem(WORKSPACE_HIDDEN_KEY)).toBe('1')
    expect(chatColumn().style.flex).toBe('1 1 0%')
    expect(chatColumn().style.width).toBe('auto')
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false')
    expect(toggle()!.getAttribute('aria-label')).toBe('Show workspace pane')
  })

  it('hiện lại ⇒ về đúng tỉ lệ cũ và khoá localStorage bị xoá', () => {
    render()

    act(() => toggle()!.click())
    act(() => toggle()!.click())

    expect(pane()).not.toBeNull()
    expect(resizer()).not.toBeNull()
    expect(useUiStore.getState().splitRatio).toBe(0.46)
    expect(chatColumn().style.flex).toBe('0.46 0 0%')
    expect(localStorage.getItem(WORKSPACE_HIDDEN_KEY)).toBeNull()
  })
})

describe('huy hiệu đếm view đang xếp hàng', () => {
  it('có ý định xếp hàng thì huy hiệu hiện và tên đọc nêu tên view', () => {
    useUiStore.setState({ workspaceHidden: true })
    render()

    act(() => {
      const result = useUiStore
        .getState()
        .requestTabIntent({ tab: 'plan', target: { identity: 'agent-box-plan' }, reason: 'plan_written' })
      expect(result).toBe('queued')
    })

    const badge = host.querySelector('[data-testid="workspace-toggle-badge"]')
    expect(badge?.textContent).toBe('1')
    expect(toggle()!.getAttribute('aria-label')).toBe(
      'Show workspace pane · 1 queued view(s): Plan Document',
    )
  })

  it('bảng đang hiện thì huy hiệu không dựng (không có gì bị chặn)', () => {
    useUiStore.setState({
      pendingIntents: [{ tab: 'plan', target: null, reason: 'plan_written' }],
    })
    render()

    expect(host.querySelector('[data-testid="workspace-toggle-badge"]')).toBeNull()
    expect(toggle()!.getAttribute('aria-label')).toBe('Hide workspace pane')
  })
})

describe('màn hẹp (<768px)', () => {
  it('nút vẫn ở đó nhưng `disabled`, và `title` nói lý do', () => {
    viewport.width = 700
    render()

    expect(toggle()).not.toBeNull()
    expect(toggle()!.hasAttribute('disabled')).toBe(true)
    expect(toggle()!.getAttribute('title')).toBe(
      'Workspace pane is unavailable on this screen width',
    )
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false')
    // Cột phải vẫn ẩn theo luật bề rộng như trước.
    expect(pane()).toBeNull()
  })
})

describe('đường người dùng tự bấm', () => {
  it('bấm menu `Open Workspace` ⇒ bảng hiện lại và tab được mở', () => {
    useUiStore.setState({ workspaceHidden: true, openTabs: ['plan'], activeTab: 'plan' })
    render()
    expect(pane()).toBeNull()

    // Không dùng tab Terminal ở đây: xterm cần `matchMedia`, thứ jsdom không có,
    // và bài test này chỉ quan tâm công tắc — không quan tâm panel nào được mở.
    openMenuTab('Decisions & Approvals')

    expect(pane()).not.toBeNull()
    expect(useUiStore.getState().workspaceHidden).toBe(false)
    expect(useUiStore.getState().activeTab).toBe('decisions')
    expect(useUiStore.getState().pinnedTab).toBe('decisions')
  })
})
