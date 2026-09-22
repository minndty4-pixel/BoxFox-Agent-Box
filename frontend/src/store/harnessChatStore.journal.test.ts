/**
 * P4.1 — store đọc khối `journal` của `GET /sessions/{sid}`.
 *
 * Ba chuyện phải đúng, và cả ba đều là chuyện THẬT đã xảy ra ở vòng poll 1200 ms:
 *  1. lần poll đầu dựng được nhật ký + bản đồ hàng `E:` theo lượt;
 *  2. lần poll sau KHÔNG nhân đôi hàng (API luôn trả 50 hàng cuối, nên lần nào cũng chồng lên phần
 *     đã có — gộp theo `seq` là cách duy nhất để không đếm hai lần);
 *  3. `degraded` không bị nuốt: nhật ký bền trong box hỏng thì người đọc phải thấy cảnh báo, vì
 *     "không có hàng `E:`" và "không ghim được hàng `E:`" là hai chuyện khác nhau.
 *
 * Và một chuyện phải KHÔNG đổi: lượt cũ (hàng `E:` không có `turn`) không được gán bừa vào lượt 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
/** Nhật ký mà harness trả ở lần poll kế tiếp — đổi được giữa các ca. */
let journal: Record<string, unknown> | null = null
let events: Array<{ seq: number; type: string; data: Record<string, unknown>; created: number }> = []

vi.mock('../lib/agentApi', () => ({
  agentApi: async (path: string) => {
    calls.push(path)
    if (path === '/sessions') return { id: 'sid-journal-1' }
    return {
      id: 'sid-journal-1',
      status: 'completed',
      events,
      ...(journal ? { journal } : {}),
    }
  },
}))

vi.mock('./skillsStore', () => ({
  useSkillsStore: { getState: () => ({ load: async () => undefined, skills: [] }) },
}))

import { useHarnessChatStore } from './harnessChatStore'

const CHAT = 'chat-journal'

/** Một hàng `E:` đúng hình dạng backend ghi (`session_journal.record_view` + `pin_evidence`). */
const evidenceRow = (overrides: Record<string, unknown> = {}) => ({
  seq: 3,
  kind: 'evidence',
  text: 'lượt 1: đã kiểm chứng — 1 mảnh bằng chứng',
  id: 'E:sid-journal-1-3',
  status: 'info',
  data: {
    verdict: 'sufficient',
    checked: 1,
    mode: 'warn',
    missing: [],
    changedFiles: ['src/app.py'],
  },
  turn: 1,
  step: 2,
  evidence: [{ type: 'file', path: '.generated_artifacts/captures/evidence/x/x_1_changes.diff', note: 'diff' }],
  ...overrides,
})

beforeEach(() => {
  calls.length = 0
  events = []
  journal = { records: [evidenceRow()], lastSeq: 3, degraded: false }
  localStorage.clear()
  useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-journal-1', status: 'running', events: [], error: null } } })
})

afterEach(() => {
  useHarnessChatStore.setState({ sessions: {} })
  localStorage.clear()
})

const refresh = () => useHarnessChatStore.getState().refresh(CHAT)
const run = () => useHarnessChatStore.getState().sessions[CHAT]

describe('refresh — khối journal', () => {
  it('dựng nhật ký và bản đồ hàng `E:` theo lượt', async () => {
    await refresh()

    const state = run()
    expect(state.journal?.records).toHaveLength(1)
    expect(state.journal?.lastSeq).toBe(3)
    expect(state.journal?.degraded).toBe(false)
    expect(state.journal?.evidenceByTurn[1]).toMatchObject({ seq: 3, kind: 'evidence' })
    expect(state.journal?.evidenceByTurn[1].evidence).toEqual([
      { type: 'file', path: '.generated_artifacts/captures/evidence/x/x_1_changes.diff', command: null, note: 'diff' },
    ])
  })

  it('gộp theo `seq` — hai vòng poll không nhân đôi hàng', async () => {
    await refresh()
    // Vòng poll sau: API trả LẠI 50 hàng cuối (hàng cũ nằm trong đó) + một hàng `E:` mới của lượt 2.
    journal = {
      records: [
        evidenceRow(),
        evidenceRow({
          seq: 9,
          id: 'E:sid-journal-1-9',
          turn: 2,
          text: 'lượt 2: chưa kiểm chứng — 0 mảnh bằng chứng',
          data: { verdict: 'insufficient', checked: 0, mode: 'warn', missing: [{ reason: 'no_evidence_for_tools', detail: '2 tool' }] },
          evidence: [{ type: 'command', command: 'pytest -q', note: 'exit 1' }],
        }),
      ],
      lastSeq: 9,
      degraded: false,
    }
    await refresh()

    const state = run()
    expect(state.journal?.records.map((row) => row.seq)).toEqual([3, 9])
    expect(state.journal?.lastSeq).toBe(9)
    expect(Object.keys(state.journal?.evidenceByTurn ?? {})).toEqual(['1', '2'])
    expect(state.journal?.evidenceByTurn[2].data).toMatchObject({ verdict: 'insufficient' })
  })

  it('giữ một chiều cờ `degraded` — nhật ký hỏng thì nói thật là đã từng hỏng', async () => {
    journal = { records: [evidenceRow()], lastSeq: 3, degraded: true }
    await refresh()
    expect(run().journal?.degraded).toBe(true)

    // Vòng poll sau box ghi lại được, nhưng phiên này đã có lúc không ghim được: cờ không tự tắt.
    journal = { records: [evidenceRow()], lastSeq: 4, degraded: false }
    await refresh()
    expect(run().journal?.degraded).toBe(true)
  })

  it('hàng không có `turn` không vào bản đồ theo lượt (lượt cũ không bị gán bừa số 0)', async () => {
    journal = {
      records: [
        { seq: 1, kind: 'evidence', text: 'hàng cũ', id: 'E:1', status: 'info', data: {}, evidence: [], turn: null, step: null },
        evidenceRow(),
      ],
      lastSeq: 3,
      degraded: false,
    }
    await refresh()

    expect(Object.keys(run().journal?.evidenceByTurn ?? {})).toEqual(['1'])
  })

  it('hàng méo bị bỏ, không làm hỏng cả khối', async () => {
    journal = {
      records: [
        'không phải object',
        { kind: 'evidence', text: 'thiếu seq' },
        { ...evidenceRow(), evidence: [{ note: 'thiếu type' }, { type: 'file', path: 'a.diff' }] },
      ],
      lastSeq: 'không phải số',
      degraded: 'có',
    }
    await refresh()

    const state = run()
    expect(state.journal?.records).toHaveLength(1)
    expect(state.journal?.records[0].evidence).toEqual([{ type: 'file', path: 'a.diff', command: null, note: null }])
    // `lastSeq` méo thì lấy `seq` của hàng cuối — thà kém chính xác còn hơn `NaN`.
    expect(state.journal?.lastSeq).toBe(3)
    expect(state.journal?.degraded).toBe(false)
  })

  it('harness không trả khối `journal` thì nhật ký đang giữ vẫn nguyên', async () => {
    await refresh()
    const before = run().journal
    journal = null
    await refresh()

    expect(run().journal).toBe(before)
  })
})
