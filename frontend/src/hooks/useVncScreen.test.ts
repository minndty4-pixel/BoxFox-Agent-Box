/**
 * Test cho hook cầu nối noVNC (`useVncScreen`).
 *
 * Chỗ này test phần KHÔNG thuộc máy trạng thái thuần: Effect B (hẹn thử lại) và
 * hai thứ Kế hoạch E1 thêm vào — thang dừng khi tab bị ẩn, và `attempt` /
 * `retryDelayMs` trả ra cho lớp phủ.
 *
 * `@novnc/novnc` được thay bằng một lớp RFB giả: lượt kết nối không mở socket
 * nào thật, và test tự phát `connect` / `securityfailure` để lái máy trạng thái.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVncScreen, type UseVncScreenResult } from './useVncScreen'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const { FakeRfb, rfbInstances } = vi.hoisted(() => {
  type Listener = (event: unknown) => void
  class FakeRfbImpl {
    viewOnly = true
    scaleViewport = false
    clipViewport = true
    resizeSession = false
    showDotCursor = false
    background = ''
    disconnected = false
    private listeners = new Map<string, Set<Listener>>()

    constructor() {
      rfbInstances.push(this)
    }

    addEventListener(type: string, listener: Listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type)?.add(listener)
    }

    removeEventListener(type: string, listener: Listener) {
      this.listeners.get(type)?.delete(listener)
    }

    disconnect() {
      this.disconnected = true
    }

    focus() {}
    blur() {}

    /** Chỉ test dùng: phát một sự kiện của noVNC. */
    emit(type: string) {
      for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type })
    }
  }
  const rfbInstances: FakeRfbImpl[] = []
  return { FakeRfb: FakeRfbImpl, rfbInstances }
})

vi.mock('@novnc/novnc', () => ({ default: FakeRfb }))

let roots: Root[] = []

interface Harness {
  result: () => UseVncScreenResult
  unmount: () => void
}

/** Dựng hook vào một container thật (Effect A cần `containerRef` có phần tử). */
function mount(): Harness {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  let latest: UseVncScreenResult | null = null

  function Probe() {
    latest = useVncScreen('novnc')
    return createElement('div', { ref: latest.containerRef })
  }

  act(() => {
    root.render(createElement(Probe))
  })

  return {
    result: () => {
      if (!latest) throw new Error('hook chưa render')
      return latest
    },
    unmount: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

/** Cho microtask của `await import('@novnc/novnc')` chạy xong. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** Tua đồng hồ và để React xử lý mọi cập nhật sinh ra. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Lượt kết nối mới nhất đã dựng RFB (giả). */
function lastRfb() {
  const instance = rfbInstances[rfbInstances.length - 1]
  if (!instance) throw new Error('chưa có RFB nào được dựng')
  return instance
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  rfbInstances.length = 0
  // jsdom không có `isSecureContext`; thiếu nó thì hook chặn ngay với
  // `insecureContext` (lý do không thể tự khỏi) và không lượt nào được mở.
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('thang thử lại (Kế hoạch E1)', () => {
  it('offline với lý do thử lại được ⇒ hẹn đúng nấc thang và mở lượt kế tiếp', async () => {
    const hook = mount()
    await flush()

    expect(hook.result().phase).toBe('connecting')
    expect(hook.result().attempt).toBe(1)
    expect(hook.result().retryAtMs).toBeNull()

    await tick(5000)
    expect(hook.result().phase).toBe('offline')
    expect(hook.result().reason).toBe('timeout')
    expect(hook.result().exhausted).toBe(false)
    expect(hook.result().retryDelayMs).toBe(3000)
    expect(hook.result().retryAtMs).toBe(Date.now() + 3000)

    // Chưa hết 3 s thì chưa có lượt nào mới.
    await tick(2999)
    expect(hook.result().attempt).toBe(1)
    expect(hook.result().phase).toBe('offline')

    await tick(1)
    expect(hook.result().attempt).toBe(2)
    expect(hook.result().phase).toBe('connecting')

    // Nấc 2: 8 s.
    await tick(5000)
    expect(hook.result().retryDelayMs).toBe(8000)
    await tick(8000)
    expect(hook.result().attempt).toBe(3)

    // Nấc 3: 20 s.
    await tick(5000)
    expect(hook.result().retryDelayMs).toBe(20000)
    await tick(20000)
    expect(hook.result().attempt).toBe(4)

    // Nấc cuối được GIỮ mãi: lượt 4 hỏng vẫn hẹn 20 s, không `exhausted`.
    await tick(5000)
    expect(hook.result().attempt).toBe(4)
    expect(hook.result().phase).toBe('offline')
    expect(hook.result().exhausted).toBe(false)
    expect(hook.result().retryDelayMs).toBe(20000)
  })

  it('lý do không thể tự khỏi ⇒ không hẹn gì và không mở lượt nào nữa', async () => {
    const hook = mount()
    await flush()

    act(() => lastRfb().emit('securityfailure'))

    expect(hook.result().phase).toBe('offline')
    expect(hook.result().reason).toBe('security')
    expect(hook.result().exhausted).toBe(true)
    expect(hook.result().retryAtMs).toBeNull()
    expect(hook.result().retryDelayMs).toBeNull()

    const sockets = rfbInstances.length
    await tick(60000)
    expect(hook.result().attempt).toBe(1)
    expect(hook.result().phase).toBe('offline')
    expect(hook.result().retryAtMs).toBeNull()
    expect(rfbInstances.length).toBe(sockets)
  })

  it('connected đặt lại attempt = 1 và tắt mọi hẹn', async () => {
    const hook = mount()
    await flush()

    await tick(5000)
    await tick(3000)
    await tick(5000)
    await tick(8000)
    expect(hook.result().attempt).toBe(3)

    act(() => lastRfb().emit('connect'))
    expect(hook.result().phase).toBe('live')
    expect(hook.result().attempt).toBe(1)
    expect(hook.result().retryAtMs).toBeNull()
    expect(hook.result().retryDelayMs).toBeNull()
  })
})

describe('tab bị ẩn (Kế hoạch E1 — trả nợ dòng đỏ console)', () => {
  it('ẩn ⇒ retryAtMs = null và tuyệt đối không mở lượt nào', async () => {
    const hook = mount()
    await flush()
    await tick(5000)
    expect(hook.result().retryAtMs).not.toBeNull()

    const sockets = rfbInstances.length
    act(() => setVisibility('hidden'))

    expect(hook.result().retryAtMs).toBeNull()
    expect(hook.result().retryDelayMs).toBeNull()

    await tick(120000)
    expect(hook.result().attempt).toBe(1)
    expect(hook.result().phase).toBe('offline')
    expect(hook.result().retryAtMs).toBeNull()
    // Không socket nào được mở trong lúc tab bị ẩn.
    expect(rfbInstances.length).toBe(sockets)
  })

  it('hiện lại ⇒ hẹn lại từ nấc 3 s và mở lượt mới', async () => {
    const hook = mount()
    await flush()
    await tick(5000)

    act(() => setVisibility('hidden'))
    await tick(120000)
    expect(hook.result().retryAtMs).toBeNull()

    act(() => setVisibility('visible'))
    expect(hook.result().retryDelayMs).toBe(3000)
    expect(hook.result().retryAtMs).toBe(Date.now() + 3000)

    await tick(3000)
    expect(hook.result().attempt).toBe(2)
    expect(hook.result().phase).toBe('connecting')
  })
})
