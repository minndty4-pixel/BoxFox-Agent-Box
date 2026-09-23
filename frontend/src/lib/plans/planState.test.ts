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
  PlanReviewBlockedError,
  readPlanEvaluation,
  readPlanStatus,
  readPlanStatusReview,
  readPlanVerification,
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

describe('readPlanVerification', () => {
  it('đọc mặt phản biện: phiên nào đọc bản này, lúc nào, lỗi kèm cách sửa', () => {
    const verification = readPlanVerification({
      state: 'revise',
      at: '2026-09-23T03:12:00Z',
      criticSessionId: '5cc2b0cf',
      issues: [
        {
          severity: 'high',
          text: 'M3 gộp hai việc vào một bước — không đo được là đã xong hay chưa.',
          fix: 'Tách M3a (chạy migrate) và M3b (đọc manifest).',
          code: 'step-not-measurable',
        },
        { severity: 'low', text: 'M8 không nói chạy trong conda env nào.' },
      ],
    })

    expect(verification).toMatchObject({ state: 'revise', criticSessionId: '5cc2b0cf' })
    expect(verification.at).toBe('2026-09-23T03:12:00Z')
    expect(verification.issues).toHaveLength(2)
    expect(verification.issues[0]).toEqual({
      severity: 'high',
      text: 'M3 gộp hai việc vào một bước — không đo được là đã xong hay chưa.',
      fix: 'Tách M3a (chạy migrate) và M3b (đọc manifest).',
      code: 'step-not-measurable',
    })
    // Thiếu `fix`/`code` thì trường VẮNG MẶT — giao diện ẩn dòng đó thay vì bịa mã lỗi.
    expect(verification.issues[1]).toEqual({ severity: 'low', text: 'M8 không nói chạy trong conda env nào.' })
    expect('fix' in verification.issues[1]).toBe(false)
  })

  it('harness cũ không trả `verification` thì là "chưa biết", KHÔNG suy ra `none`', () => {
    const verification = readPlanVerification(undefined)

    expect(verification).toMatchObject({ state: 'unknown', at: null, criticSessionId: null })
    expect(verification.issues).toEqual([])
    expect(readPlanVerification({ state: 'weird' }).state).toBe('unknown')
  })

  it('lỗi thiếu mức thì mức là `unknown` (không hạ xuống `low`); `issues` không phải mảng thì rỗng', () => {
    expect(
      readPlanVerification({ state: 'ok', issues: [{ text: 'không có mức' }, 'rác', null] }).issues,
    ).toEqual([{ severity: 'unknown', text: 'không có mức' }])
    expect(readPlanVerification({ state: 'ok', issues: 'không phải mảng' }).issues).toEqual([])
  })
})

describe('readPlanStatus — mặt phản biện + chủ phiên', () => {
  it('đọc thêm `verification` và `ownership.sessionId` của đúng bản đang hỏi', () => {
    const report = readPlanStatus({
      state: 'draft',
      verification: { state: 'ok', at: '2026-09-23T03:12:00Z', criticSessionId: 'critic-1', issues: [] },
      ownership: { sessionId: '9481bf87' },
    })

    expect(report?.verification.state).toBe('ok')
    expect(report?.verification.criticSessionId).toBe('critic-1')
    expect(report?.ownership.sessionId).toBe('9481bf87')
  })

  it('harness cũ (thiếu cả hai trường) thì nói đúng "chưa biết", không đoán', () => {
    const report = readPlanStatus({ state: 'draft' })

    expect(report?.verification).toMatchObject({ state: 'unknown', criticSessionId: null })
    expect(report?.ownership).toEqual({ sessionId: null })
  })
})

describe('HarnessPlanStatusClient — kết quả quyết định', () => {
  it('đọc `recorded`/`resumed`/`turnId`; thiếu `resumed` thì là `null`, không mặc định `false`', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        recorded: true,
        forwarded: true,
        resumed: true,
        turnId: 'turn-7',
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', decidedAt: 1_758_300_000 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const outcome = await new HarnessPlanStatusClient().submitReview('agent-box-plan', 3, 'approved', '')
      expect(outcome).toMatchObject({ recorded: true, forwarded: true, resumed: true, turnId: 'turn-7' })

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ forwarded: true, review: { decision: 'approved' } }),
      })
      const older = await new HarnessPlanStatusClient().submitReview('agent-box-plan', 3, 'approved', '')
      // Harness cũ không nói gì về lượt chạy: ba trạng thái, `null` = "không biết" — KHÔNG phải "không mở".
      expect(older.resumed).toBeNull()
      expect(older.recorded).toBeNull()
      expect(older.turnId).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('409 + `blocked: true` ném `PlanReviewBlockedError` giữ NGUYÊN chữ của harness', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        blocked: true,
        code: 'PLAN_APPROVAL_UNVERIFIED',
        reason: 'Bản v3 chưa có phiên phản biện nào đọc.',
        remedy: 'Chạy phiên plan-review cho bản v3 rồi duyệt lại.',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const failure = await new HarnessPlanStatusClient()
        .submitReview('agent-box-plan', 3, 'approved', '')
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(PlanReviewBlockedError)
      expect(failure).toMatchObject({
        name: 'PlanReviewBlockedError',
        code: 'PLAN_APPROVAL_UNVERIFIED',
        reason: 'Bản v3 chưa có phiên phản biện nào đọc.',
        remedy: 'Chạy phiên plan-review cho bản v3 rồi duyệt lại.',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('409 KHÔNG kèm `blocked: true` (lỗi khác) vẫn là lỗi thường, không thành thẻ "bị khoá"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Ledger busy', code: 'REVIEW_BUSY' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const failure = await new HarnessPlanStatusClient()
        .submitReview('agent-box-plan', 3, 'approved', '')
        .catch((error: unknown) => error)

      expect(failure).not.toBeInstanceOf(PlanReviewBlockedError)
      expect((failure as Error).message).toBe('REVIEW_BUSY: Ledger busy')
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
