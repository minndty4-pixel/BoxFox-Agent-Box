/**
 * Bài kiểm cho `researchStore`.
 *
 * Điều quan trọng: `sync` KHÔNG được gọi mạng khi không có gì mới. Đây chính là chỗ thay cho vòng hỏi
 * 5000 ms của `ResearchPanel` cũ: chi tiết run chỉ tải lại khi có sự kiện `research_*` MỚI (hoặc khi
 * chế độ/phiên vừa đổi).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResearchStore } from './researchStore'
import { RESEARCH_MODE_OFF } from '../lib/researchMode'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const jobsPayload = { jobs: [{ research_id: 'R1', status: 'researching', state: { phase: 'searching', budgetSeconds: 1800 } }] }

beforeEach(() => {
  useResearchStore.setState({
    sessionId: '', mode: RESEARCH_MODE_OFF, jobs: [], detail: null, detailId: '', loading: false,
    error: null, lastEventSeq: 0, exitChoice: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('researchStore.sync', () => {
  it('phiên trống ⇒ xoá trạng thái, không gọi mạng', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useResearchStore.getState().sync('', RESEARCH_MODE_OFF, [])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('chưa có sự kiện research nào và chế độ không đổi ⇒ KHÔNG gọi mạng', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(jobsPayload))
    vi.stubGlobal('fetch', fetchMock)
    const sync = useResearchStore.getState().sync
    // Lần đầu của phiên: `switched` ⇒ có tải một lần để dựng trạng thái.
    sync('s1', { researchMode: { on: false } }, [{ seq: 1, type: 'tool_start', data: { name: 'web_search' } }])
    await Promise.resolve()
    const callsAfterFirst = fetchMock.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)
    // Vòng hỏi sau đó chỉ mang lại ĐÚNG những sự kiện cũ ⇒ không được gọi thêm.
    sync('s1', { researchMode: { on: false } }, [
      { seq: 1, type: 'tool_start', data: { name: 'web_search' } },
      { seq: 2, type: 'tool_end', data: { name: 'web_search' } },
    ])
    await Promise.resolve()
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('sự kiện `research_*` mới ⇒ tải lại đúng một lần', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(jobsPayload))
    vi.stubGlobal('fetch', fetchMock)
    const listCalls = () =>
      fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes('/research/jobs?sessionId='))
        .length
    const sync = useResearchStore.getState().sync
    sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [])
    await new Promise((resolve) => setTimeout(resolve, 0))
    const callsAfterFirst = listCalls()
    sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [
      { seq: 5, type: 'research_scope', data: { researchId: 'R1', revision: 2 } },
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listCalls()).toBe(callsAfterFirst + 1)
    expect(useResearchStore.getState().lastEventSeq).toBe(5)
  })
})

describe('researchStore luồng mode', () => {
  it('tắt chế độ khi server đòi chọn ⇒ giữ `exitChoice`, chế độ KHÔNG đổi', async () => {
    useResearchStore.setState({ sessionId: 's1', mode: { ...RESEARCH_MODE_OFF, on: true, activeRunId: 'R1' } })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'chọn đi', code: 'RESEARCH_EXIT_CHOICE_REQUIRED',
      prompt: { promptId: 'rp-x', researchId: 'R1', kind: 'exit-choice', questions: [{ id: 'exit', text: 'thế nào?', options: [{ id: 'pause', label: 'p' }, { id: 'background', label: 'b' }] }] },
    }, 409)))
    const outcome = await useResearchStore.getState().setMode(false, 'toggle')
    expect(outcome).toBe('exit-choice')
    expect(useResearchStore.getState().mode.on).toBe(true)
    expect(useResearchStore.getState().exitChoice?.prompt.promptId).toBe('rp-x')
  })

  it('resolveExit("background") gửi cả `exitChoice` lẫn `activeRun` và tắt chế độ', async () => {
    useResearchStore.setState({
      sessionId: 's1',
      mode: { ...RESEARCH_MODE_OFF, on: true, activeRunId: 'R1' },
      exitChoice: { code: 'RESEARCH_EXIT_CHOICE_REQUIRED', message: 'm', prompt: { promptId: 'rp-x', researchId: 'R1' } as never },
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('research-mode')) return jsonResponse({ mode: { on: false, activeRunId: 'R1' } })
      return jsonResponse(jobsPayload)
    })
    vi.stubGlobal('fetch', fetchMock)
    await useResearchStore.getState().resolveExit('background')
    const putCall = fetchMock.mock.calls.find((call: unknown[]) => String(call[0]).includes('research-mode'))
    expect(putCall).toBeTruthy()
    const body = JSON.parse(String(((putCall as unknown[] | undefined)?.[1] as RequestInit | undefined)?.body))
    expect(body).toMatchObject({ on: false, exitChoice: 'background', activeRun: 'background' })
    expect(useResearchStore.getState().mode.on).toBe(false)
    expect(useResearchStore.getState().exitChoice).toBeNull()
  })
})
