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
    error: null, lastEventSeq: 0, exitChoice: null, statusCard: null, seenSeqBySession: {},
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

  it('F7: đang có exitChoice thì bấm nút tắt lần nữa KHÔNG gửi thêm PUT (không dựng thêm lời hỏi)', async () => {
    useResearchStore.setState({
      sessionId: 's1',
      mode: { ...RESEARCH_MODE_OFF, on: true, activeRunId: 'R1' },
      exitChoice: { code: 'RESEARCH_EXIT_CHOICE_REQUIRED', message: 'm', prompt: { promptId: 'rp-x', researchId: 'R1' } as never },
    })
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await useResearchStore.getState().setMode(false, 'toggle')
    expect(outcome).toBe('exit-choice')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useResearchStore.getState().exitChoice?.prompt.promptId).toBe('rp-x')
  })

  it('F7: resolveExit gửi lại chính lời hỏi đã nhận (server dùng lại, không tạo lời hỏi mới)', async () => {
    const prompt = { promptId: 'rp-x', researchId: 'R1', kind: 'exit-choice' }
    useResearchStore.setState({
      sessionId: 's1',
      mode: { ...RESEARCH_MODE_OFF, on: true, activeRunId: 'R1' },
      exitChoice: { code: 'RESEARCH_EXIT_CHOICE_REQUIRED', message: 'm', prompt: prompt as never },
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('research-mode')) return jsonResponse({ mode: { on: false, activeRunId: 'R1' } })
      return jsonResponse(jobsPayload)
    })
    vi.stubGlobal('fetch', fetchMock)
    await useResearchStore.getState().resolveExit('pause')
    const putCall = fetchMock.mock.calls.find((call: unknown[]) => String(call[0]).includes('research-mode'))
    const body = JSON.parse(String(((putCall as unknown[] | undefined)?.[1] as RequestInit | undefined)?.body))
    expect(body.prompt).toMatchObject({ promptId: 'rp-x' })
    // Server không tự đóng lời hỏi sau khi đã chọn ⇒ giao diện phải đóng, nếu không badge đếm dư và
    // lần `refresh` sau lại dựng thẻ thoát trở lại (F5 + F7).
    expect(fetchMock.mock.calls.some((call: unknown[]) => String(call[0]).includes('/prompts/rp-x/dismiss'))).toBe(true)
  })

  it('F8: PUT thoát thất bại ⇒ trả lại lời hỏi cũ, không nuốt lựa chọn', async () => {
    const prompt = { promptId: 'rp-x', researchId: 'R1', kind: 'exit-choice' }
    useResearchStore.setState({
      sessionId: 's1',
      mode: { ...RESEARCH_MODE_OFF, on: true, activeRunId: 'R1' },
      exitChoice: { code: 'RESEARCH_EXIT_CHOICE_REQUIRED', message: 'm', prompt: prompt as never },
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'mạng lỗi' }, 500)))
    await useResearchStore.getState().resolveExit('pause')
    expect(useResearchStore.getState().exitChoice?.prompt.promptId).toBe('rp-x')
    expect(useResearchStore.getState().mode.on).toBe(true)
  })
})

describe('researchStore thẻ trạng thái /research status (D-4)', () => {
  const statusEvent = (seq: number, message: string) => ({
    seq,
    type: 'research_run',
    data: { kind: 'status', message, researchId: 'R1', status: 'researching', phase: 'searching', background: true },
  })

  it('sự kiện `research_run` kiểu `status` có `message` MỚI ⇒ điền `statusCard`', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(jobsPayload)))
    // Lịch sử của phiên (trước lần đồng bộ đầu) KHÔNG dựng thẻ: chỉ bản phát lại MỚI mới dựng.
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [
      statusEvent(6, 'thẻ cũ từ tuần trước'),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard).toBeNull()

    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [
      statusEvent(6, 'thẻ cũ từ tuần trước'),
      statusEvent(7, 'R1 · researching · pha searching · chạy nền'),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    const card = useResearchStore.getState().statusCard
    expect(card?.message).toContain('pha searching')
    expect(card?.researchId).toBe('R1')
    expect(card?.phase).toBe('searching')
    expect(card?.background).toBe(true)
    expect(card?.seq).toBe(7)
  })

  it('nhiều sự kiện mới ⇒ thẻ mới nhất (seq lớn nhất) thắng', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(jobsPayload)))
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [])
    await new Promise((resolve) => setTimeout(resolve, 0))
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [
      statusEvent(3, 'cũ'),
      statusEvent(9, 'mới'),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard?.message).toBe('mới')
    expect(useResearchStore.getState().statusCard?.seq).toBe(9)
  })

  it('dismissStatusCard xoá thẻ; sự kiện CŨ (`seq` không tăng) không dựng lại nó', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(jobsPayload)))
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [])
    await new Promise((resolve) => setTimeout(resolve, 0))
    const events = [statusEvent(7, 'R1 · researching')]
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, events)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard).not.toBeNull()

    useResearchStore.getState().dismissStatusCard()
    expect(useResearchStore.getState().statusCard).toBeNull()

    // Vòng sau mang lại ĐÚNG sự kiện cũ: `seq` không tăng ⇒ không còn "mới" ⇒ thẻ nằm im.
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, events)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard).toBeNull()
  })

  it('đổi phiên ⇒ xoá thẻ trạng thái', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(jobsPayload)))
    useResearchStore.setState({
      sessionId: 's1',
      statusCard: { researchId: 'R1', message: 'cũ', status: 'researching', phase: 'searching', background: false, seq: 7 },
    })
    useResearchStore.getState().sync('s2', { researchMode: { on: false } }, [])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard).toBeNull()
  })

  it('quay lại phiên cũ: sự kiện lịch sử đã tiêu thụ KHÔNG dựng lại thẻ đã đóng (mốc seq theo phiên)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(jobsPayload)))
    const events = [statusEvent(7, 'R1 · researching')]
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, [])
    await new Promise((resolve) => setTimeout(resolve, 0))
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, events)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard).not.toBeNull()
    useResearchStore.getState().dismissStatusCard()

    // Sang phiên khác rồi quay về s1 với ĐÚNG sự kiện cũ: mốc `seq` của s1 đã tiêu thụ ⇒ không mọc lại.
    useResearchStore.getState().sync('s2', { researchMode: { on: false } }, [])
    await new Promise((resolve) => setTimeout(resolve, 0))
    useResearchStore.getState().sync('s1', { researchMode: { on: true, activeRunId: 'R1' } }, events)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard).toBeNull()
    expect(useResearchStore.getState().seenSeqBySession.s1).toBe(7)
  })

  it('phiên chưa từng thấy khi đổi phiên KHÔNG nhận thẻ trạng thái từ lịch sử', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(jobsPayload)))
    useResearchStore.setState({ sessionId: 's1' })
    useResearchStore.getState().sync('s2', { researchMode: { on: true, activeRunId: 'R1' } }, [statusEvent(7, 'R1 · researching')])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useResearchStore.getState().statusCard).toBeNull()
  })
})

describe('researchStore.refreshDetail (F2)', () => {
  const exitPrompt = {
    promptId: 'rp-exit', researchId: 'R1', kind: 'exit-choice', revision: 3, status: 'open', blocking: false,
    questions: [{ id: 'exit', text: 'thế nào?', allowFreeText: false, required: true, blocking: true, affects: [],
      options: [{ id: 'pause', label: 'p' }, { id: 'background', label: 'b' }] }],
  }

  it('tuyến chi tiết trả evidence/dossier/reviews ở CẤP TRÊN ⇒ gộp lại, tab không rỗng', async () => {
    useResearchStore.setState({ sessionId: 's1' })
    const payload = {
      job: {
        research_id: 'R1', session_id: 's1', status: 'researching',
        state: { phase: 'reading', scope: { revision: 2 }, findings: ['kết luận'], prompts: [exitPrompt] },
      },
      scope: { revision: 2 },
      prompts: [exitPrompt],
      questions: [],
      findings: ['kết luận'],
      blockedSources: [],
      evidence: [{ rowId: 'S1', claim: 'c', url: 'https://x', accessLevel: 'fulltext' }],
      dossier: { relative_path: '.research/x/v2.md', version: 2, gate: 'pass', critique: '' },
      reviews: [{ version: 2, mode: 'critique', verdict: 'revise' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)))
    await useResearchStore.getState().refreshDetail('R1')
    const detail = useResearchStore.getState().detail
    expect(detail?.researchId).toBe('R1')
    expect(detail?.evidence).toHaveLength(1)
    expect(detail?.dossier?.version).toBe(2)
    expect(detail?.reviews).toHaveLength(1)
    expect(detail?.findings).toEqual(['kết luận'])
    // Lời hỏi có ở CẢ hai chỗ (cấp trên + `state.prompts`) ⇒ khử trùng, không đếm gấp đôi badge.
    expect(detail?.prompts.filter((item) => item.promptId === 'rp-exit')).toHaveLength(1)
  })
})

describe('researchStore suy lời hỏi thoát (F5)', () => {
  it('suy `exitChoice` từ lời hỏi exit-choice còn MỞ trong danh sách job (đường /research off)', async () => {
    useResearchStore.setState({ sessionId: 's1', exitChoice: null })
    const payload = {
      jobs: [{
        research_id: 'R1', status: 'researching', phase: 'searching',
        state: { phase: 'searching', prompts: [{ promptId: 'rp-exit', researchId: 'R1', kind: 'exit-choice', status: 'open', questions: [] }] },
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('?sessionId=') ? jsonResponse(payload) : jsonResponse({})))
    await useResearchStore.getState().refresh()
    expect(useResearchStore.getState().exitChoice?.prompt.promptId).toBe('rp-exit')
  })
})
