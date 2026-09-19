import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useHarnessChatStore } from '../../store/harnessChatStore'
import { useHarnessStore } from '../../store/harnessStore'
import { useRouterChatStore } from '../../store/routerChatStore'
import {
  ChatPanel,
  SCROLL_FOLLOW_THRESHOLD_PX,
  distanceFromBottom,
  isNearBottom,
  parseHarnessError,
  shouldEmitMockInterrupt,
  usesHarnessChat,
} from './ChatPanel'

/**
 * ChatPanel — bốn lỗi trong plan `docs/plan/fix-plan-e2e-defects.md`:
 *  • §C-F1/BUG-17: harness trả HTTP 400 thì phải hiện lỗi inline, và bản nháp
 *    người dùng vừa gõ phải còn nguyên trong ô nhập.
 *  • §D-U1: cuộn có kiểm soát — kéo lên đọc thì khung nhìn không bị giật về đáy.
 *  • §D-U2/BUG-20: phiên harness/model không được gửi lệnh `interrupt` qua
 *    transport mock (chuỗi `Received interrupt command …` rò vào chat thật).
 *  • §D-U4/BUG-24: chuyển phiên không nháy "chưa có hội thoại".
 *
 * `ChatPanel` render qua raw `createRoot` + `act`, đúng khuôn các test sẵn có
 * (`ChatInputBar.test.tsx`) — dự án không dùng @testing-library.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { agentApiMock, providerApiMock } = vi.hoisted(() => ({
  agentApiMock: vi.fn(),
  providerApiMock: vi.fn(),
}))

// Chặn mọi truy cập mạng: `ChatPanel` mount là gọi provider snapshot + refresh
// phiên harness, jsdom không có fetch tuyệt đối hoá URL tương đối.
vi.mock('../../lib/agentApi', () => ({ agentApi: agentApiMock }))
vi.mock('../../lib/providerApi', () => ({
  api: providerApiMock,
  ProviderApiError: class ProviderApiError extends Error {},
}))

const CHAT_ID = 'chat-test-1'
const HEX_CHAT_ID = 'abcdef0123456789abcdef0123456789'

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

const originalSendCommand = useAgentStore.getState().sendCommand
const originalHarnessSend = useHarnessChatStore.getState().send
const originalHarnessStop = useHarnessChatStore.getState().stop
const originalRouterStop = useRouterChatStore.getState().stop

let roots: Root[] = []

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

function seedRun(run: Partial<{ id: string | null; status: string; events: ReturnType<typeof event>[]; error: string | null }>) {
  useHarnessChatStore.setState({
    sessions: {
      [CHAT_ID]: { id: 'sess-1', status: 'idle', events: [], error: null, ...run },
    },
  })
}

/** Giả lập số đo cuộn của một phần tử (jsdom không có layout engine). */
function setScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => metrics.clientHeight })
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => metrics.scrollTop, set: () => {} })
}

function scrollHost(host: HTMLElement): HTMLElement {
  const scroller = host.querySelector('[data-testid="chat-scroll"]') as HTMLElement | null
  if (!scroller) throw new Error('Không tìm thấy khung cuộn của ChatPanel')
  return scroller
}

/**
 * `scrollToLatest` bật cờ "cuộn do chương trình" trong 400ms để bỏ qua các sự
 * kiện `scroll` trung gian của cuộn mượt. Test phải đợi hết cửa sổ đó trước khi
 * giả lập người dùng kéo lên.
 */
async function waitForProgrammaticScrollWindow() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420))
  })
}

beforeEach(() => {
  localStorage.clear()
  useAgentStore.setState({ activeSessionId: CHAT_ID, messages: [], isBusy: false })
  useHarnessStore.setState({ activeType: 'harness' })
  useRouterChatStore.setState({ turns: [], selection: null, isSending: false, activeTurnId: null })
  useHarnessChatStore.setState({ sessions: {} })

  agentApiMock.mockReset()
  agentApiMock.mockImplementation(async (path: string) => {
    if (String(path).includes('/sessions')) return { id: 'sess-1', status: 'idle', events: [] }
    return {}
  })
  providerApiMock.mockReset()
  providerApiMock.mockImplementation(async () => EMPTY_SNAPSHOT)
  // jsdom không cài `scrollIntoView`; các test U1 tự gắn mock riêng.
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useAgentStore.setState({ sendCommand: originalSendCommand, activeSessionId: CHAT_ID, messages: [], isBusy: false })
  useHarnessChatStore.setState({ send: originalHarnessSend, stop: originalHarnessStop, sessions: {} })
  useRouterChatStore.setState({ stop: originalRouterStop, turns: [], selection: null, isSending: false })
  useHarnessStore.setState({ activeType: 'harness' })
  vi.restoreAllMocks()
})

describe('ChatPanel — bóc tách lỗi harness (§C-F1)', () => {
  it('bóc prefix `Error:`, payload JSON và mã lỗi backend', () => {
    expect(parseHarnessError('Error: SETUP_REQUIRED: claude CLI not found')).toEqual({
      message: 'SETUP_REQUIRED: claude CLI not found',
      code: 'SETUP_REQUIRED',
    })
    expect(parseHarnessError('Error: {"error":{"code":"SKILL_DISABLED","message":"Skill is disabled"}}')).toEqual({
      message: 'Skill is disabled',
      code: 'SKILL_DISABLED',
    })
    expect(parseHarnessError('Error: {"error":"Unknown skill"}')).toEqual({
      message: 'Unknown skill',
      code: null,
    })
    expect(parseHarnessError('Harness HTTP 500')).toEqual({ message: 'Harness HTTP 500', code: null })
  })

  it('hiện khối lỗi inline kèm mã lỗi và xoá được', () => {
    const host = render(<ChatPanel />)
    act(() => {
      seedRun({ status: 'failed', error: 'Error: SETUP_REQUIRED: claude CLI not found' })
    })

    const alert = host.querySelector('[data-testid="chat-error"]')
    expect(alert).toBeTruthy()
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent).toContain('claude CLI not found')
    expect(alert?.textContent).toContain('SETUP_REQUIRED')
    // Mã lỗi chỉ hiện một lần (đã cắt khỏi phần thông báo).
    expect(alert?.textContent?.match(/SETUP_REQUIRED/g)).toHaveLength(1)

    const dismiss = alert?.querySelector('button') as HTMLButtonElement
    act(() => {
      dismiss.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(useHarnessChatStore.getState().sessions[CHAT_ID]?.error).toBeNull()
    expect(host.querySelector('[data-testid="chat-error"]')).toBeNull()
  })

  it('gửi thất bại (HTTP 400) thì lỗi hiện inline và bản nháp còn nguyên trong ô nhập', async () => {
    agentApiMock.mockImplementation(async (path: string, body?: unknown) => {
      if (body && String(path).includes('/turns')) throw new Error('Unknown skill')
      return { id: 'sess-1', status: 'idle', events: [] }
    })
    seedRun({ id: 'sess-1' })
    const host = render(<ChatPanel />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement

    typeInto(textarea, '/skill')
    const sendButton = host.querySelector('[data-testid="composer-send"]') as HTMLButtonElement
    expect(sendButton).toBeTruthy()

    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const alert = host.querySelector('[data-testid="chat-error"]')
    expect(alert?.textContent).toContain('Unknown skill')
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('/skill')
  })

  it('vòng poll xoá lỗi trong store nhưng thông báo vẫn còn cho tới khi người dùng xoá', async () => {
    agentApiMock.mockImplementation(async (path: string, body?: unknown) => {
      if (body && String(path).includes('/turns')) throw new Error('Unknown skill')
      return { id: 'sess-1', status: 'idle', events: [] }
    })
    seedRun({ id: 'sess-1' })
    const host = render(<ChatPanel />)

    typeInto(host.querySelector('textarea') as HTMLTextAreaElement, '/skill')
    await act(async () => {
      ;(host.querySelector('[data-testid="composer-send"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(host.querySelector('[data-testid="chat-error"]')).toBeTruthy()

    // `refresh` chạy mỗi 1200ms và ghi lại `error: null` cho phiên không hỏng.
    act(() => {
      seedRun({ id: 'sess-1', status: 'idle', error: null })
    })
    const alert = host.querySelector('[data-testid="chat-error"]')
    expect(alert?.textContent).toContain('Unknown skill')

    act(() => {
      ;(alert!.querySelector('button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="chat-error"]')).toBeNull()
  })
})

describe('ChatPanel — cuộn có kiểm soát (§D-U1)', () => {
  it('nhận biết khoảng cách tới đáy', () => {
    const atBottom = { scrollHeight: 1000, scrollTop: 400, clientHeight: 600 }
    expect(distanceFromBottom(atBottom)).toBe(0)
    expect(isNearBottom(atBottom)).toBe(true)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 390, clientHeight: 600 })).toBe(true)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 600 })).toBe(false)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 600 }, 200)).toBe(true)
    expect(SCROLL_FOLLOW_THRESHOLD_PX).toBe(40)
  })

  it('kéo lên đọc thì không bị giật về đáy, nút nhảy xuống hoạt động', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    seedRun({ events: [event(1)] })
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    scrollIntoView.mockClear()

    // Người dùng kéo lên 600px → rời đáy.
    setScrollMetrics(scroller, { scrollHeight: 2000, clientHeight: 600, scrollTop: 400 })
    act(() => {
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="chat-jump-to-latest"]')).toBeTruthy()

    // Agent sinh thêm sự kiện: khung nhìn phải đứng yên ở vị trí đang đọc.
    act(() => {
      seedRun({ events: [event(1), event(2)], status: 'running' })
    })
    expect(scrollIntoView).not.toHaveBeenCalled()

    // Bấm nút ↓ → bám lại đáy và nút biến mất.
    act(() => {
      ;(host.querySelector('[data-testid="chat-jump-to-latest"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: 'end' })
    expect(host.querySelector('[data-testid="chat-jump-to-latest"]')).toBeNull()
  })

  it('đang ở đáy thì sự kiện mới vẫn bám theo', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    seedRun({ events: [event(1)] })
    const host = render(<ChatPanel />)
    const scroller = scrollHost(host)
    await waitForProgrammaticScrollWindow()
    scrollIntoView.mockClear()

    setScrollMetrics(scroller, { scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 })
    act(() => {
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      seedRun({ events: [event(1), event(2)], status: 'running' })
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="chat-jump-to-latest"]')).toBeNull()
  })
})

describe('ChatPanel — không rò lệnh mock vào phiên thật (§D-U2)', () => {
  it('phân loại chế độ chat', () => {
    expect(usesHarnessChat('harness')).toBe(true)
    expect(usesHarnessChat('model')).toBe(true)
    expect(shouldEmitMockInterrupt('harness')).toBe(false)
    expect(shouldEmitMockInterrupt('model')).toBe(false)
    expect(shouldEmitMockInterrupt('demo' as string)).toBe(true)
  })

  it('nút Stop trong phiên harness chỉ gọi harnessStop, không gửi `interrupt` qua transport', () => {
    const sendCommand = vi.fn()
    const harnessStop = vi.fn(async () => {})
    useAgentStore.setState({ isBusy: true, sendCommand })
    useHarnessChatStore.setState({ stop: harnessStop })

    const host = render(<ChatPanel />)
    const stopButton = host.querySelector('button[title="Stop / Interrupt agent action (Esc)"]') as HTMLButtonElement
    expect(stopButton).toBeTruthy()

    act(() => {
      stopButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(harnessStop).toHaveBeenCalledWith(CHAT_ID)
    expect(sendCommand).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Received interrupt command')
  })

  it('phím Escape cũng không phát lệnh interrupt của transport mock', () => {
    const sendCommand = vi.fn()
    useAgentStore.setState({ isBusy: true, sendCommand })
    render(<ChatPanel />)

    act(() => {
      window.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(sendCommand).not.toHaveBeenCalled()
  })
})

describe('ChatPanel — trạng thái nạp phiên (§D-U4)', () => {
  it('hiện "đang nạp phiên" thay vì nháy trạng thái rỗng khi chuyển phiên', async () => {
    let resolveSession: ((value: unknown) => void) | null = null
    agentApiMock.mockImplementation(
      () => new Promise((resolve) => { resolveSession = resolve }),
    )
    useAgentStore.setState({ activeSessionId: HEX_CHAT_ID, messages: [] })

    const host = render(<ChatPanel />)
    expect(host.querySelector('[data-testid="chat-session-loading"]')).toBeTruthy()
    expect(host.textContent).not.toContain('No conversation yet')

    await act(async () => {
      resolveSession?.({ id: HEX_CHAT_ID, status: 'idle', events: [] })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[data-testid="chat-session-loading"]')).toBeNull()
    expect(host.textContent).toContain('No conversation yet')
  })

  it('phiên đã có hội thoại thì không hiện trạng thái nạp', () => {
    useAgentStore.setState({
      messages: [
        { id: 'm1', kind: 'user_text', text: 'xin chào', created_at: new Date().toISOString() },
      ],
    })
    const host = render(<ChatPanel />)
    expect(host.querySelector('[data-testid="chat-session-loading"]')).toBeNull()
    expect(host.textContent).toContain('xin chào')
  })
})

/**
 * Gán giá trị textarea rồi bắn `input` — React theo dõi `value` bằng một tracker
 * gắn trên setter gốc của DOM nên phải gọi qua setter gốc để onChange chạy.
 */
function typeInto(textarea: HTMLTextAreaElement, text: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  nativeSetter.call(textarea, text)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
