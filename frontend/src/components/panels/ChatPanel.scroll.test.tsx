/**
 * Đợt 5 — hoàn thiện cuộn chat:
 *  • nút "xuống cuối" nói đúng số mục mới đang chờ (`data-unseen-count`);
 *  • `End` / `Shift+G` nhảy xuống cuối và bám lại đáy, nhưng không cướp phím khi
 *    con trỏ đang ở ô nhập;
 *  • mở tab khác không làm mất vị trí đọc của transcript;
 *  • quay lại một phiên thì về đúng chỗ đã nhớ (theo từng phiên).
 *
 * Cùng khuôn với `ChatPanel.test.tsx`: raw `createRoot` + `act`. jsdom không có
 * layout engine nên số đo cuộn được giả lập ở cấp prototype (`HTMLElement`),
 * nhờ vậy cả lần khôi phục vị trí lúc mount cũng đo được.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useHarnessChatStore } from '../../store/harnessChatStore'
import { useHarnessStore } from '../../store/harnessStore'
import { useRouterChatStore } from '../../store/routerChatStore'
import { useUiStore } from '../../store/uiStore'
import { ChatPanel } from './ChatPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { agentApiMock, providerApiMock } = vi.hoisted(() => ({ agentApiMock: vi.fn(), providerApiMock: vi.fn() }))

vi.mock('../../lib/agentApi', () => ({ agentApi: agentApiMock }))
vi.mock('../../lib/providerApi', () => ({
  api: providerApiMock,
  ProviderApiError: class ProviderApiError extends Error {},
}))

const CHAT_ID = 'chat-scroll-1'
const OTHER_CHAT = 'chat-scroll-2'

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
let metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }
const scrollIntoViewMock = vi.fn()

/** Số đo cuộn giả cho mọi phần tử (jsdom không có layout). */
function installScrollMetrics() {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => metrics.scrollTop,
    set: (value: number) => {
      metrics.scrollTop = value
    },
  })
}

function setMetrics(next: { scrollHeight?: number; clientHeight?: number; scrollTop?: number }) {
  metrics = { ...metrics, ...next }
}

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

function event(seq: number) {
  return { seq, type: 'thinking', data: { text: `bước ${seq}` }, created: seq }
}

function seedEvents(count: number, chatId = CHAT_ID, sessionId = 'sess-1') {
  useHarnessChatStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [chatId]: {
        id: sessionId,
        status: 'running',
        events: Array.from({ length: count }, (_, index) => event(index + 1)),
        error: null,
      },
    },
  }))
}

function scrollHost(host: HTMLElement): HTMLElement {
  const scroller = host.querySelector('[data-testid="chat-scroll"]') as HTMLElement | null
  if (!scroller) throw new Error('Không tìm thấy khung cuộn của ChatPanel')
  return scroller
}

function jumpButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector('[data-testid="chat-jump-to-latest"]')
}

/** Người dùng kéo lên: đổi số đo rồi bắn sự kiện `scroll` như trình duyệt. */
function userScrollsTo(el: HTMLElement, scrollTop: number) {
  el.scrollTop = scrollTop
  act(() => {
    el.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}

/**
 * `scrollToLatest` mở cửa sổ "cuộn do chương trình" 400ms; các sự kiện `scroll`
 * trong cửa sổ đó bị bỏ qua nên test phải đợi hết trước khi giả lập người dùng.
 */
async function waitForProgrammaticScrollWindow() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420))
  })
}

beforeEach(() => {
  localStorage.clear()
  metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }
  installScrollMetrics()
  useAgentStore.setState({ activeSessionId: CHAT_ID, messages: [], isBusy: false })
  useHarnessStore.setState({ activeType: 'harness' })
  useRouterChatStore.setState({ turns: [], selection: null, isSending: false, activeTurnId: null })
  useHarnessChatStore.setState({ sessions: {} })
  useUiStore.setState({
    openTabs: [],
    activeTab: null,
    pendingIntents: [],
    pinnedTab: null,
    lastUserActivityAt: 0,
    tabIntentTargets: {},
    planRevision: 0,
    sessionScrollOffsets: {},
  })

  agentApiMock.mockReset()
  agentApiMock.mockImplementation(async (path: string) => {
    if (String(path).includes('/sessions')) return { id: 'sess-1', status: 'running', events: [] }
    return {}
  })
  providerApiMock.mockReset()
  providerApiMock.mockImplementation(async () => EMPTY_SNAPSHOT)

  scrollIntoViewMock.mockReset()
  Element.prototype.scrollIntoView = scrollIntoViewMock as unknown as Element['scrollIntoView']
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useHarnessChatStore.setState({ sessions: {} })
  useUiStore.setState({ sessionScrollOffsets: {}, tabIntentTargets: {} })
  delete (HTMLElement.prototype as unknown as { scrollHeight?: unknown }).scrollHeight
  delete (HTMLElement.prototype as unknown as { clientHeight?: unknown }).clientHeight
  delete (HTMLElement.prototype as unknown as { scrollTop?: unknown }).scrollTop
  vi.restoreAllMocks()
})

describe('ChatPanel — bộ đếm mục mới (đợt 5)', () => {
  it('ở đáy thì không có nút "xuống cuối"', () => {
    setMetrics({ scrollTop: 600 }) // cách đáy 0px
    const host = render(<ChatPanel />)

    act(() => {
      seedEvents(3)
    })

    expect(jumpButton(host)).toBeNull()
  })

  it('kéo lên đọc: mục mới được đếm chứ không giật khung nhìn', async () => {
    seedEvents(2)
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()

    // Người dùng kéo lên (cách đáy 480px).
    userScrollsTo(scroller, 120)
    const before = jumpButton(host)
    expect(before).toBeTruthy()
    expect(before?.getAttribute('data-unseen-count')).toBe('0')

    act(() => {
      seedEvents(5)
    })

    expect(metrics.scrollTop).toBe(120) // không bị kéo về đáy
    const after = jumpButton(host)
    expect(after?.getAttribute('data-unseen-count')).toBe('3')
    expect(after?.textContent).toContain('3')
    expect(after?.getAttribute('aria-label')).toContain('3')
  })

  it('bấm nút xuống cuối thì đếm về 0, nút biến mất và bám lại đáy', async () => {
    seedEvents(2)
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    userScrollsTo(scroller, 120)
    act(() => {
      seedEvents(6)
    })
    expect(jumpButton(host)?.getAttribute('data-unseen-count')).toBe('4')

    act(() => {
      jumpButton(host)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(jumpButton(host)).toBeNull()
    expect(scrollIntoViewMock).toHaveBeenCalled()

    // Sau khi bám lại, mục mới không làm nút quay lại.
    act(() => {
      seedEvents(8)
    })
    expect(jumpButton(host)).toBeNull()
  })
})

describe('ChatPanel — phím tắt xuống cuối (đợt 5)', () => {
  it('`End` nhảy xuống cuối và bám lại đáy', async () => {
    seedEvents(2)
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    userScrollsTo(scroller, 100)
    act(() => {
      seedEvents(5)
    })
    expect(jumpButton(host)).toBeTruthy()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })

    expect(jumpButton(host)).toBeNull()
    act(() => {
      seedEvents(7)
    })
    // Đã bám lại đáy → mục mới không mọc thêm nút.
    await waitForProgrammaticScrollWindow()
    expect(jumpButton(host)).toBeNull()
  })

  it('`Shift+G` cũng nhảy xuống cuối', async () => {
    seedEvents(2)
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    userScrollsTo(scroller, 100)
    act(() => {
      seedEvents(4)
    })
    expect(jumpButton(host)).toBeTruthy()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', shiftKey: true, bubbles: true }))
    })

    expect(jumpButton(host)).toBeNull()
  })

  it('đang gõ trong ô nhập thì phím tắt không cướp chỗ', async () => {
    seedEvents(2)
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    userScrollsTo(scroller, 100)
    act(() => {
      seedEvents(4)
    })
    expect(jumpButton(host)?.getAttribute('data-unseen-count')).toBe('2')

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })

    // Sự kiện nổi lên `window` nhưng xuất phát từ textarea → bỏ qua.
    expect(jumpButton(host)?.getAttribute('data-unseen-count')).toBe('2')
  })
})

describe('ChatPanel — vị trí đọc theo từng phiên (đợt 5)', () => {
  it('mở tab khác không làm mất vị trí đọc của transcript', async () => {
    seedEvents(2)
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    userScrollsTo(scroller, 200)

    act(() => {
      useUiStore.getState().openTab('plan', { identity: 'agent-box-plan', version: 2 })
    })

    expect(metrics.scrollTop).toBe(200)
    expect(jumpButton(host)).toBeTruthy()
    // Vị trí đọc cũng được nhớ cho phiên này.
    expect(useUiStore.getState().sessionScrollOffsets[CHAT_ID]).toBe(200)
  })

  it('quay lại phiên đã đọc thì về đúng chỗ, không tự nhảy xuống đáy', async () => {
    useUiStore.setState({ sessionScrollOffsets: { [CHAT_ID]: 180 } })
    seedEvents(4, CHAT_ID, 'sess-1')
    seedEvents(3, OTHER_CHAT, 'sess-2')
    setMetrics({ scrollHeight: 1200, clientHeight: 400, scrollTop: 0 })
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)

    // Sang phiên khác rồi quay lại — đây là đường thật của "mở lại phiên".
    act(() => {
      useAgentStore.setState({ activeSessionId: OTHER_CHAT })
    })
    act(() => {
      useAgentStore.setState({ activeSessionId: CHAT_ID })
    })

    expect(metrics.scrollTop).toBe(180)
    // Cách đáy 620px → vẫn đang đọc dở, nút xuống cuối hiện ra.
    expect(jumpButton(host)).toBeTruthy()
    void scroller
  })

  it('phiên chưa từng đọc thì vẫn bám đáy như cũ', () => {
    seedEvents(3)
    const host = render(<ChatPanel />)

    expect(scrollIntoViewMock).toHaveBeenCalled()
    expect(jumpButton(host)).toBeNull()
    expect(useUiStore.getState().sessionScrollOffsets[CHAT_ID]).toBeUndefined()
  })

  it('vị trí đọc thuộc về từng phiên riêng biệt', async () => {
    seedEvents(2, CHAT_ID, 'sess-1')
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    userScrollsTo(scroller, 240)

    act(() => {
      useAgentStore.setState({ activeSessionId: OTHER_CHAT })
    })
    // Đổi phiên cũng mở cửa sổ cuộn tự động 400ms → đợi rồi mới cuộn thật.
    await waitForProgrammaticScrollWindow()
    userScrollsTo(scroller, 500)

    const offsets = useUiStore.getState().sessionScrollOffsets
    expect(offsets[CHAT_ID]).toBe(240)
    expect(offsets[OTHER_CHAT]).toBe(500)
  })
})
