/**
 * Bản ghi của sub-agent không được nhân đôi văn bản.
 *
 * Lỗi người dùng gặp: khung "Sub-agent" in lại toàn bộ câu trả lời một lần cho mỗi
 * token, vì harness cũ phát `assistant_delta`/`thought` dạng TÍCH LUỸ còn panel chỉ
 * biết cộng chuỗi (`output += text`). Bản sửa: panel ghép theo tiền tố
 * (`lib/streamText.appendStreamText`), nên đúng cho cả event tích luỹ lẫn mảnh rời.
 *
 * Kiểm kèm: `tool_end` phải khớp đúng tool call đã mở. Harness phát khoá `id`,
 * không phải `tool_call_id`; trước đây panel đọc sai khoá nên kết quả công cụ
 * không bao giờ gắn vào dòng của nó và mọi dòng đứng ở trạng thái "đang chạy".
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useHarnessChatStore } from '../../store/harnessChatStore'
import { useUiStore } from '../../store/uiStore'
import { SubagentInspectorPanel } from './SubagentInspectorPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHAT_ID = 'chat-subagents-stream'
const CHILD_ID = 'child-stream'

let roots: Root[] = []
const fetchMock = vi.fn()

function child(seq: number, sessionId: string) {
  return {
    seq,
    type: 'child',
    data: { sessionId, role: 'Research', status: 'started', goal: 'việc của research' },
    created: seq,
  }
}

/** Event do harness phát: `text` là văn bản TÍCH LUỸ (hành vi cũ vẫn còn trong DB). */
function cumulativeEvents() {
  return [
    { seq: 1, type: 'assistant_delta', data: { text: 'Kế hoạch chi' }, created: 1 },
    { seq: 2, type: 'assistant_delta', data: { text: 'Kế hoạch chi tiết cho' }, created: 2 },
    { seq: 3, type: 'assistant_delta', data: { text: 'Kế hoạch chi tiết cho Medical Record Retrieval Agent' }, created: 3 },
  ]
}

async function renderWith(events: unknown[]): Promise<HTMLElement> {
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ events }) }))
  useHarnessChatStore.setState({
    sessions: {
      [CHAT_ID]: { id: 'sess-1', status: 'running', events: [child(1, CHILD_ID)], error: null },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <I18nProvider>
        <SubagentInspectorPanel />
      </I18nProvider>,
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  useAgentStore.setState({ activeSessionId: CHAT_ID })
  useUiStore.setState({ tabIntentTargets: {}, openTabs: ['subagents'], activeTab: 'subagents' })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useHarnessChatStore.setState({ sessions: {} })
  vi.unstubAllGlobals()
})

describe('SubagentInspectorPanel — văn bản streaming', () => {
  it('event tích luỹ chỉ hiện câu trả lời một lần', async () => {
    const host = await renderWith(cumulativeEvents())
    const text = host.textContent ?? ''
    const occurrences = text.split('Kế hoạch chi').length - 1
    expect(occurrences).toBe(1)
    expect(text).toContain('Kế hoạch chi tiết cho Medical Record Retrieval Agent')
  })

  it('event từng mảnh rời được ghép lại đầy đủ', async () => {
    const host = await renderWith([
      { seq: 1, type: 'assistant_delta', data: { text: 'Kế hoạch chi' }, created: 1 },
      { seq: 2, type: 'assistant_delta', data: { text: ' tiết cho' }, created: 2 },
      { seq: 3, type: 'assistant_delta', data: { text: ' agent' }, created: 3 },
    ])
    expect(host.textContent ?? '').toContain('Kế hoạch chi tiết cho agent')
  })

  it('luồng suy nghĩ tích luỹ không bị lặp khi mở khối Thinking', async () => {
    const host = await renderWith([
      { seq: 1, type: 'thought', data: { text: 'Cần đọc file' }, created: 1 },
      { seq: 2, type: 'thought', data: { text: 'Cần đọc file rồi tóm tắt' }, created: 2 },
    ])
    const toggle = [...host.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('Thinking'),
    )
    expect(toggle, 'khối Thinking phải có nút mở').toBeTruthy()
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const text = host.textContent ?? ''
    expect(text.split('Cần đọc file').length - 1).toBe(1)
    expect(text).toContain('Cần đọc file rồi tóm tắt')
  })

  it('bản ghi chuẩn `assistant` sau các delta không in câu trả lời lần hai', async () => {
    const host = await renderWith([
      { seq: 1, type: 'assistant_delta', data: { text: 'Kế hoạch chi' }, created: 1 },
      { seq: 2, type: 'assistant_delta', data: { text: ' tiết cho agent' }, created: 2 },
      { seq: 3, type: 'assistant', data: { text: 'Kế hoạch chi tiết cho agent', final: true }, created: 3 },
    ])
    const text = host.textContent ?? ''
    expect(text.split('Kế hoạch chi').length - 1).toBe(1)
  })

  it('notice thử lại xoá bộ đệm, không dán câu trả lời mới vào phần đã bỏ', async () => {
    // Harness đứt socket giữa câu trả lời rồi thử lại: phần văn bản của lần thử hỏng bị bỏ.
    const host = await renderWith([
      { seq: 1, type: 'assistant_delta', data: { text: 'Kế hoạch chi tiết cho agent ghi hồ sơ' }, created: 1 },
      { seq: 2, type: 'notice', data: { code: 'UPSTREAM_RETRY', reset: true, message: 'thử lại' }, created: 2 },
      { seq: 3, type: 'assistant_delta', data: { text: 'Xin chào' }, created: 3 },
      { seq: 4, type: 'assistant', data: { text: 'Xin chào, đây là kế hoạch mới' }, created: 4 },
    ])
    const text = host.textContent ?? ''
    expect(text).toContain('Xin chào, đây là kế hoạch mới')
    expect(text).not.toContain('ghi hồ sơXin chào')
    expect(text).not.toContain('Kế hoạch chi tiết cho agent ghi hồ sơ')
  })

  it('tool_end gắn đúng tool call theo khoá `id` của harness', async () => {
    const host = await renderWith([
      { seq: 1, type: 'tool_start', data: { id: 'call_1', name: 'terminal_exec', args: { command: 'ls' } }, created: 1 },
      { seq: 2, type: 'tool_end', data: { id: 'call_1', name: 'terminal_exec', result: { stdout: 'ok' } }, created: 2 },
    ])
    const text = host.textContent ?? ''
    expect(text).toContain('terminal_exec')
    // `tool_end` khớp được theo `id` ⇒ dòng rời trạng thái "running" và hiện "exit 0".
    // Trước bản sửa, panel đọc khoá `tool_call_id` (không tồn tại) nên dòng đứng mãi ở "running".
    expect(text).toContain('exit 0')
  })
})
