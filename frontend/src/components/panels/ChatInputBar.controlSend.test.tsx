import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useCommandsStore } from '../../store/commandsStore'
import { useComposerStore } from '../../store/composerStore'
import { ChatInputBar, CONTROL_COMMANDS, isControlCommand } from './ChatInputBar'

/**
 * §D-U5/BUG-21 của `docs/plan/fix-plan-e2e-defects.md`: khi agent đang chạy, nút
 * Gửi bị thay bằng Stop nên người dùng không gửi được `/stop`; và popup gợi ý
 * lệnh "ăn" mất phím Enter đầu tiên nên lệnh đã gõ đủ không được gửi.
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function typeInto(textarea: HTMLTextAreaElement, text: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  nativeSetter.call(textarea, text)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function pressEnter(textarea: HTMLTextAreaElement) {
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

function busyRouter(onSend: (prompt: string) => void, onStop: () => void) {
  return {
    models: [{ id: 'model:conn-1:gemini-3.8-flash-high', name: 'Gemini 3.8 Flash', provider: 'antigravity' }],
    activeModelId: 'model:conn-1:gemini-3.8-flash-high',
    isBusy: true,
    onModelChange: () => {},
    onSend,
    onStop,
  }
}

beforeEach(() => {
  useComposerStore.setState({ pendingElements: [] })
  useCommandsStore.setState({ commands: [], custom: [], error: null })
  useAgentStore.setState({ isBusy: false })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useComposerStore.setState({ pendingElements: [] })
  useCommandsStore.setState({ commands: [], custom: [], error: null })
  vi.restoreAllMocks()
})

describe('ChatInputBar — lệnh điều khiển khi agent đang chạy (§D-U5)', () => {
  it('nhận diện đúng các lệnh điều khiển đã gõ đủ', () => {
    expect(CONTROL_COMMANDS).toContain('/stop')
    expect(isControlCommand('/stop')).toBe(true)
    expect(isControlCommand('  /STOP  ')).toBe(true)
    expect(isControlCommand('/status')).toBe(true)
    expect(isControlCommand('/stop ngay')).toBe(false)
    expect(isControlCommand('xin chào')).toBe(false)
  })

  it('vẫn có nút Gửi (không chỉ Stop) khi đang chạy và ô nhập là `/stop`', () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    const host = render(<ChatInputBar router={busyRouter(onSend, onStop)} />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement

    typeInto(textarea, '/stop')

    const sendButton = host.querySelector('[data-testid="composer-send"]') as HTMLButtonElement
    expect(sendButton).toBeTruthy()
    expect(sendButton.disabled).toBe(false)

    act(() => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toBe('/stop')
    expect(onStop).not.toHaveBeenCalled()
  })

  it('văn bản thường khi đang chạy thì KHÔNG có nút Gửi (chỉ Stop)', () => {
    const host = render(<ChatInputBar router={busyRouter(vi.fn(), vi.fn())} />)
    typeInto(host.querySelector('textarea') as HTMLTextAreaElement, 'đang chạy thì không gửi thêm')
    expect(host.querySelector('[data-testid="composer-send"]')).toBeNull()
    expect(host.querySelector('button[title="Stop / Interrupt agent action (Esc)"]')).toBeTruthy()
  })

  it('Enter gửi ngay lệnh điều khiển, không bị popup gợi ý ăn mất', () => {
    // Popup chỉ mở khi có dữ liệu lệnh: đây chính là tình huống BUG-21 tái hiện.
    useCommandsStore.setState({
      commands: [
        { slug: 'stop', description: 'Dừng agent', kind: 'command', enabled: true },
        { slug: 'status', description: 'Trạng thái', kind: 'command', enabled: true },
      ],
      custom: [],
      error: null,
    })
    const onSend = vi.fn()
    const host = render(<ChatInputBar router={busyRouter(onSend, vi.fn())} />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement

    typeInto(textarea, '/stop')
    pressEnter(textarea)

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toBe('/stop')
  })

  it('gửi thất bại thì trả lại nguyên bản nháp cho người dùng', async () => {
    const onSend = vi.fn(async () => false)
    const host = render(<ChatInputBar router={{ ...busyRouter(onSend, vi.fn()), isBusy: false }} />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement

    typeInto(textarea, '/skill')
    await act(async () => {
      ;(host.querySelector('[data-testid="composer-send"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onSend).toHaveBeenCalledWith('/skill', undefined)
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('/skill')
  })
})
