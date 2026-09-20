import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { FINAL_ANSWER_EXPAND_LABEL, HarnessStepView } from './HarnessStepView'
import { I18nProvider } from '../../i18n'
import type { HarnessEvent } from '../../store/harnessChatStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let seq = 0

function ev(type: string, data: Record<string, unknown> = {}, created?: number): HarnessEvent {
  seq += 1
  return { seq, type, data, created: created ?? 1000 + seq }
}

function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

function renderSession(events: HarnessEvent[]): HTMLElement {
  return render(<HarnessStepView events={events} status="idle" error={null} />)
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function timelineKinds(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-timeline], [data-final-answer]')].map(
    (el) => el.getAttribute('data-timeline') ?? 'final-answer',
  )
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  seq = 0
})

describe('HarnessStepView — F2 thứ tự thời gian', () => {
  it('renders one flat timeline in event seq order: text → tool → text → tool → final answer', () => {
    const events = [
      ev('user', { text: 'Kiểm tra log' }),
      ev('assistant_delta', { text: 'Đầu tiên tôi xem log.' }),
      ev('assistant', { text: 'Đầu tiên tôi xem log.', final: false }),
      ev('tool_start', { id: 'c1', name: 'terminal_exec', args: { command: 'tail -n 20 app.log' } }),
      ev('tool_end', { id: 'c1', name: 'terminal_exec', args: { command: 'tail -n 20 app.log' }, result: { output: 'ERROR: boom' } }),
      ev('assistant_delta', { text: 'Lỗi nằm ở dòng cuối.' }),
      ev('assistant', { text: 'Lỗi nằm ở dòng cuối.', final: false }),
      ev('tool_start', { id: 'c2', name: 'file_read', args: { path: '/home/agent/workspace/app.log' } }),
      ev('tool_end', { id: 'c2', name: 'file_read', args: { path: '/home/agent/workspace/app.log' }, result: { content: 'ERROR: boom' } }),
      ev('assistant', { text: 'Xong: lỗi ở dòng cuối của app.log.', final: true }),
      ev('finish', { status: 'completed' }),
    ]

    const host = renderSession(events)

    expect(timelineKinds(host)).toEqual([
      'assistant-text',
      'tool',
      'assistant-text',
      'tool',
      'final-answer',
    ])

    // Hai hàng tool, mỗi hàng giữ đúng vị trí của nó (không gom vào accordion/gallery).
    expect(host.querySelectorAll('[data-timeline="tool"]').length).toBe(2)
    expect(host.querySelectorAll('[data-timeline="assistant-text"]').length).toBe(2)
    // Văn bản giữa lượt (final:false) hiện thật, không bị mất.
    expect(host.textContent).toContain('Đầu tiên tôi xem log.')
    expect(host.textContent).toContain('Lỗi nằm ở dòng cuối.')
  })

  it('renders the image of a tool_end directly under that tool row', () => {

    const events = [
      ev('user', { text: 'Chụp màn hình' }),
      ev('tool_start', { id: 'c9', name: 'computer_screen_capture', args: {} }),
      ev('tool_end', {
        id: 'c9',
        name: 'computer_screen_capture',
        args: {},
        result: { content: 'Sandbox screenshot 1280x800', artifact: 'shots/screen.png', mime: 'image/png', dimensions: [1280, 800] },
      }),
      ev('assistant', { text: 'Đã chụp.', final: true }),
      ev('finish', { status: 'completed' }),
    ]

    const host = renderSession(events)
    const toolRow = host.querySelector('[data-timeline="tool"]')

    expect(toolRow).toBeTruthy()
    expect(toolRow?.querySelector('[data-tool-media="image"]')).toBeTruthy()
    // Nhãn lấy từ dữ liệu thật (F4) — không còn "1280 × 720" hardcode.
    expect(host.textContent).toContain('1280 × 800')
    expect(host.textContent).not.toContain('1280 × 720')
  })

  it('keeps the live streaming behaviour and reports a missing tool result honestly', () => {
    const userEvent = ev('user', { text: 'Chạy lệnh' })
    const start = ev('tool_start', { id: 'c1', name: 'terminal_exec', args: { command: 'sleep 5' } })

    const running = render(<HarnessStepView events={[userEvent, start]} status="running" error={null} />)
    expect(running.querySelector('[data-tool-pending="true"]')).toBeTruthy()
    expect(running.textContent).toContain('Running')
    expect(running.querySelector('[data-state-indicator="thinking"]')).toBeNull()

    const streaming = render(
      <HarnessStepView
        events={[userEvent, ev('assistant_delta', { text: 'Đang trả lời dần' })]}
        status="running"
        error={null}
      />,
    )
    expect(streaming.querySelector('[data-timeline="assistant-text"]')).toBeTruthy()
    expect(streaming.querySelector('[data-state-indicator="thinking"]')).toBeTruthy()

    const finished = renderSession([
      userEvent,
      start,
      ev('finish', { status: 'cancelled' }),
    ])
    expect(finished.querySelector('[data-tool-pending="true"]')).toBeNull()
    expect(finished.querySelector('[data-tool-unfinished="true"]')).toBeTruthy()
    expect(finished.textContent).toContain('no result recorded')
  })
})

describe('HarnessStepView — F5 lượt "ma" và thời lượng', () => {
  it('does not create a turn from events that precede the first user event', () => {
    const events = [
      ev('command_resolved', { kind: 'message', command: null, invocationId: 'inv_1' }, 100),
      ev('user', { text: 'Xin chào' }, 1000),
      ev('assistant', { text: 'Chào bạn.', final: true }, 1001),
      ev('finish', { status: 'completed' }, 1001),
    ]

    const host = renderSession(events)

    expect(host.querySelectorAll('[data-turn-user="true"]').length).toBe(1)
    expect(host.querySelectorAll('[data-turn-header="true"]').length).toBe(1)
    expect(host.textContent).toContain('Xin chào')
    expect(host.textContent).toContain('Worked for 1s')
  })

  it('does not extend a finished turn with events that arrive later', () => {
    const events = [
      ev('user', { text: 'Chạy tác vụ dài' }, 1000),
      ev('assistant', { text: 'Đã dừng theo yêu cầu.', final: true }, 1010),
      ev('finish', { status: 'cancelled' }, 1036),
      // Cùng lượt nhưng tới muộn (1702s sau khi lượt đã kết thúc).
      ev('usage', { usage: { prompt_tokens: 10, completion_tokens: 2 } }, 2738),
      ev('step', { iteration: 2, contextEstimate: 1200 }, 2738),
    ]

    const host = renderSession(events)

    expect(host.textContent).toContain('Worked for 36s')
    expect(host.textContent).not.toContain('1702')
  })

  it('keeps the cancelled turn duration at the finish event, not at the late usage event', () => {
    const host = renderSession([
      ev('user', { text: 'Tác vụ bị huỷ' }, 1000),
      ev('tool_start', { id: 'c1', name: 'terminal_exec', args: { command: 'sleep 40' } }, 1005),
      ev('tool_end', { id: 'c1', name: 'terminal_exec', args: { command: 'sleep 40' }, result: { output: '' } }, 1030),
      ev('finish', { status: 'cancelled' }, 1036),
      ev('usage', { usage: { prompt_tokens: 10, completion_tokens: 2 } }, 2738),
    ])

    expect(host.textContent).toContain('Worked for 36s')
    expect(host.textContent).not.toContain('1702')
  })
})

describe('HarnessStepView — F3 suy luận trung thực', () => {
  it('shows an honest reasoning-token line instead of fabricated reasoning text', () => {
    const events = [
      ev('user', { text: 'Giải thích lỗi' }),
      ev('usage', { usage: { prompt_tokens: 1200, completion_tokens: 40, reasoning_tokens: 469 } }),
      ev('assistant', { text: 'Nguyên nhân là do thiếu biến môi trường.', final: true }),
      ev('finish', { status: 'completed' }),
    ]

    const host = renderSession(events)

    expect(host.textContent).toContain('469')
    expect(host.textContent).toContain('no streamed reasoning text')
    expect(host.textContent).not.toContain('Cryptographically')
    expect(host.textContent).not.toContain('Deep reasoning process executed successfully')
  })

  it('renders the real thought when the model streamed reasoning, and no fabrication otherwise', () => {
    const withThought = renderSession([
      ev('user', { text: 'Câu 1' }),
      ev('thought', { text: 'Tôi cần đọc app.log trước.' }),
      ev('assistant', { text: 'Xong.', final: true }),
      ev('finish', { status: 'completed' }),
    ])
    expect(withThought.textContent).not.toContain('Tôi cần đọc app.log trước.')
    click(withThought.querySelector('[data-thinking-toggle="true"]')!)
    expect(withThought.textContent).toContain('Tôi cần đọc app.log trước.')

    const withoutReasoning = renderSession([
      ev('user', { text: 'Câu 2' }),
      ev('usage', { usage: { prompt_tokens: 10, completion_tokens: 2 } }),
      ev('assistant', { text: 'Trả lời ngắn.', final: true }),
      ev('finish', { status: 'completed' }),
    ])
    expect(withoutReasoning.textContent).not.toContain('synthesized')
    expect(withoutReasoning.querySelector('[data-thinking-tokens="true"]')).toBeNull()
  })
})

describe('HarnessStepView — F6 tóm tắt câu trả lời cuối', () => {
  it('renders a short summary with an expander and keeps the turn media attached', () => {
    const full = `${'Dòng tóm tắt nội dung trả lời. '.repeat(40)}FINAL-MARKER-END`
    const events = [
      ev('user', { text: 'Chụp màn hình rồi mô tả' }),
      ev('tool_start', { id: 'c1', name: 'computer_screen_capture', args: {} }),
      ev('tool_end', {
        id: 'c1',
        name: 'computer_screen_capture',
        args: {},
        result: { content: 'Sandbox screenshot 1280x800', mime: 'image/png', image: 'AAAA', dimensions: [1280, 800] },
      }),
      ev('assistant', { text: full, final: true }),
      ev('finish', { status: 'completed' }),
    ]

    const host = renderSession(events)

    const summaryBlock = host.querySelector('[data-final-text="summary"]')
    expect(summaryBlock).toBeTruthy()
    expect(summaryBlock!.textContent!.length).toBeLessThan(full.length)
    expect(summaryBlock!.textContent).not.toContain('FINAL-MARKER-END')

    const expander = host.querySelector('[data-final-expander="true"]')
    expect(expander?.textContent).toContain(FINAL_ANSWER_EXPAND_LABEL)

    // Ảnh của lượt nằm trong khối câu trả lời cuối.
    const finalMedia = host.querySelector('[data-final-answer="true"] [data-final-media="true"]')
    expect(finalMedia).toBeTruthy()
    expect(finalMedia!.querySelectorAll('img').length).toBe(1)

    click(expander!)

    const expandedBlock = host.querySelector('[data-final-text="expanded"]')
    expect(expandedBlock).toBeTruthy()
    expect(expandedBlock!.textContent).toContain('FINAL-MARKER-END')
  })
})

describe('HarnessStepView — F7 thông báo nén context', () => {
  it('shows the compaction numbers at turn level and reveals detail on click', () => {
    const events = [
      ev('user', { text: 'Nén context' }),
      ev('compression', { kind: 'summary', beforeEstimate: 196608, afterEstimate: 394 }),
      ev('assistant', { text: 'Đã nén xong.', final: true }),
      ev('finish', { status: 'completed' }),
    ]

    const host = renderSession(events)

    const notice = host.querySelector('[data-timeline="compaction"]')
    expect(notice).toBeTruthy()
    expect(notice!.textContent).toContain('Context compacted: 196608 → 394 tokens')
    // Nằm ở cấp cao nhất của lượt (cùng danh sách với các hàng tool), không trong cây Thinking.
    expect(notice!.parentElement?.querySelector('[data-timeline="tool"]')).toBeNull()
    expect(notice!.closest('[data-thinking-toggle]')).toBeNull()
    expect(host.querySelector('[data-compaction-detail="true"]')).toBeNull()

    click(notice!.querySelector('button')!)

    const detail = host.querySelector('[data-compaction-detail="true"]')
    expect(detail).toBeTruthy()
    expect(detail!.textContent).toContain('summary')
    expect(detail!.textContent).toContain('196608')
    expect(detail!.textContent).toContain('394')
  })

  it('uses honest wording when nothing needed compaction', () => {
    const host = renderSession([
      ev('user', { text: 'Nén context' }),
      ev('compression', { kind: 'unchanged' }),
      ev('assistant', { text: 'Không cần nén.', final: true }),
      ev('finish', { status: 'completed' }),
    ])

    expect(host.querySelector('[data-timeline="compaction"]')?.textContent).toContain('No compaction needed')
  })
})
