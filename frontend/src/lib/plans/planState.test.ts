/**
 * Đọc trạng thái duyệt + bản chấm P1–P8 từ harness: dữ liệu tới từ mạng nên mọi trường phải đọc
 * phòng thủ. Điều quan trọng nhất ở đây là **không** biến chỗ thiếu dữ liệu thành một lời khẳng
 * định: thiếu mức thì mức là `null` (không phải 0), thiếu điểm thì điểm là `null` (không phải 0/16),
 * chỉ mục không đọc được thì `indexAvailable: false` (không phải một bản "đã duyệt").
 */
import { describe, expect, it, vi } from 'vitest'
import {
  HarnessPlanStatusClient,
  PLAN_MAX_CHARS,
  planCount,
  planStamp,
  readPlanEvaluation,
  readPlanStatus,
  readPlanStatusReview,
} from './planState'

/** Payload thật của `Evaluation.to_payload`, rút gọn còn các trường giao diện dùng. */
const evaluationPayload = {
  identity: 'agent-box-plan',
  version: 2,
  parentVersion: 1,
  written: true,
  rubric: 'P1-P8/1',
  levels: { P1: 2, P2: 2, P3: 2, P4: 1, P5: 2, P6: 2, P7: 2, P8: 1 },
  layer: { P1: 'oracle', P5: 'judge' },
  total: 14,
  maxTotal: 16,
  hardGate: true,
  gatesFailed: [],
  verdict: 'pass',
  rejected: null,
  measures: {
    chars: 5120,
    repetition: 0.02,
    steps: 5,
    stepsAnchored: 5,
    externalFacts: 4,
    externalFactsSourced: 4,
    noteKeywords: 7,
    noteKeywordsEchoed: 2,
    headerSource: 'model',
  },
  evidence: [{ code: 'P5', excerpt: 'nêu giới hạn kèm cách kiểm' }],
  judge: { score: 1 },
  warnings: [],
  evaluatedAt: '2026-09-20T20:56:00Z',
}

describe('readPlanStatus', () => {
  it('đọc hàng sổ duyệt + bản chấm, giữ nguyên số version của quyết định', () => {
    const report = readPlanStatus({
      identity: 'agent-box-plan',
      version: 4,
      state: 'approved',
      stateVersion: 4,
      review: {
        identity: 'agent-box-plan',
        version: 4,
        decision: 'approved',
        note: 'chốt',
        source: 'plan-tab',
        decidedAt: 1_758_300_000,
      },
      reviewStale: true,
      indexAvailable: true,
      evaluation: { ...evaluationPayload, payload: evaluationPayload },
    })

    expect(report).toMatchObject({
      state: 'approved',
      version: 4,
      stateVersion: 4,
      reviewStale: true,
      indexAvailable: true,
    })
    expect(report?.review).toMatchObject({ decision: 'approved', note: 'chốt', version: 4 })
    expect(report?.evaluation?.levels).toEqual({
      P1: 2, P2: 2, P3: 2, P4: 1, P5: 2, P6: 2, P7: 2, P8: 1,
    })
    expect(report?.evaluation?.total).toBe(14)
    expect(report?.evaluation?.verdict).toBe('pass')
    expect(report?.evaluation?.layer.P5).toBe('judge')
  })

  it('chỉ mục không đọc được thì nói đúng thế, không bịa điểm hay quyết định', () => {
    const report = readPlanStatus({ state: 'unknown', indexAvailable: false, review: null })

    expect(report).toMatchObject({ state: 'unknown', indexAvailable: false, review: null })
    expect(report?.evaluation).toBeNull()
    expect(report?.reviewStale).toBe(false)
  })

  it('trạng thái lạ (harness khác bản giao diện) quy về `unknown`, không đoán thành `draft`', () => {
    expect(readPlanStatus({ state: 'weird-state' })?.state).toBe('unknown')
    expect(readPlanStatus('không phải object')).toBeNull()
  })
})

describe('readPlanEvaluation', () => {
  it('thiếu payload thì mức là `null` và điểm là `null`, không mặc định về 0', () => {
    const evaluation = readPlanEvaluation({ identity: 'x', version: 3, total: null, verdict: null })

    expect(evaluation).not.toBeNull()
    expect(Object.values(evaluation?.levels ?? {})).toEqual([null, null, null, null, null, null, null, null])
    expect(evaluation?.total).toBeNull()
    expect(evaluation?.verdict).toBeNull()
    expect(evaluation?.written).toBe(false)
  })

  it('bản bị cổng cứng chặn: đọc `gatesFailed`/`rejected`, còn `hardGate` chỉ là số đo thô', () => {
    const blocked = {
      identity: 'agent-box-plan',
      version: 2,
      parentVersion: 1,
      written: false,
      rubric: 'P1-P8/1',
      levels: { P1: 1, P2: 0, P3: 2, P4: 0, P5: 2, P6: 2, P7: 0, P8: 2 },
      layer: { P5: 'oracle' },
      total: 9,
      maxTotal: 16,
      // `hardGate: true` = MỌI cổng cứng đều đạt (cùng cực với `scripts/eval/rubric.py`), nên một
      // bản bị chặn vẫn có thể mang `hardGate: false` và luôn có `gatesFailed` khác rỗng.
      hardGate: false,
      gatesFailed: ['P2', 'P4', 'P7'],
      verdict: 'fail',
      rejected: 'plan-too-long',
      measures: { chars: 306_721, steps: 5, stepsAnchored: 0 },
      evidence: [],
      warnings: [],
      evaluatedAt: '2026-09-21T23:52:00Z',
    }
    const evaluation = readPlanEvaluation({ ...blocked, payload: blocked })

    expect(evaluation?.written).toBe(false)
    expect(evaluation?.verdict).toBe('fail')
    expect(evaluation?.rejected).toBe('plan-too-long')
    expect(evaluation?.gatesFailed).toEqual(['P2', 'P4', 'P7'])
    expect(evaluation?.hardGate).toBe(false)
    expect(evaluation?.measures.chars).toBe(306_721)
  })
})

describe('readPlanStatusReview', () => {
  it('quyết định lạ hoặc hàng sổ thiếu thì trả `null` thay vì đoán', () => {
    expect(readPlanStatusReview({ decision: 'maybe', identity: 'x' })).toBeNull()
    expect(readPlanStatusReview(null)).toBeNull()
    expect(readPlanStatusReview({ decision: 'changes_requested' })).toMatchObject({
      decision: 'changes_requested',
      note: '',
      decidedAt: null,
    })
  })
})

describe('HarnessPlanStatusClient', () => {
  it('gọi đúng route harness kèm `version`, và ném lỗi khi thân không đọc được', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'draft' }) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const report = await new HarnessPlanStatusClient().read('agent-box-plan', 3)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/agent/plans/status?identity=agent-box-plan&version=3')
      expect(init.method).toBe('GET')
      expect((init.headers as Record<string, string>)['X-BoxFox-Admin']).toBe('1')
      expect(report).toMatchObject({ state: 'draft' })

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => 'không phải object' })
      await expect(new HarnessPlanStatusClient().read('agent-box-plan', 3)).rejects.toThrow(
        /unreadable plan status/,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ghi quyết định vào sổ harness và trả `forwarded` nguyên trạng', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        identity: 'agent-box-plan',
        version: 3,
        decision: 'approved',
        note: '',
        forwarded: false,
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', decidedAt: 1_758_300_000 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const outcome = await new HarnessPlanStatusClient().submitReview('agent-box-plan', 3, 'approved', '')
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/agent/plans/review')
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({
        identity: 'agent-box-plan',
        version: 3,
        decision: 'approved',
        note: '',
      })
      expect(outcome.forwarded).toBe(false)
      expect(outcome.review).toMatchObject({ decision: 'approved', version: 3 })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('định dạng số đo', () => {
  it('`planCount` nhóm nghìn kiểu Việt Nam, `planStamp` ra `dd/mm HH:MM`', () => {
    expect(planCount(306_721)).toBe('306.721')
    expect(planCount(PLAN_MAX_CHARS)).toBe('150.000')
    expect(planCount(null)).toBeNull()
    expect(planStamp('2026-09-20T20:56:00Z')).toMatch(/^\d\d\/\d\d \d\d:\d\d$/)
    expect(planStamp('không phải ngày')).toBeNull()
  })
})
