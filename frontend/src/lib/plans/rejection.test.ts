/**
 * Câu từ chối của lần ghi bị cổng cứng chặn: payload của `plan_eval.py` cố tình không mang chuỗi
 * tiếng Việt nào, nên giao diện phải ghép câu từ `rejected` + `measures`. Test này khoá hai việc:
 * số đo lấy từ payload (không bịa), và mã `QUALITY` giữ đúng tiền tố cũ của `plan_quality.py`.
 */
import { describe, expect, it } from 'vitest'
import { interpolate, lookup } from '../../i18n/context'
import type { TKey, TVars } from '../../i18n/context'
import vi from '../../i18n/vi'
import en from '../../i18n/en'
import { planRejection } from './rejection'
import type { PlanEvaluation } from './planState'
import { readPlanEvaluation } from './planState'

function translate(dict: unknown) {
  return (key: TKey, vars?: TVars) => interpolate(lookup(dict, key) ?? key, vars)
}

const t = translate(vi)

function evaluationOf(payload: Record<string, unknown>): PlanEvaluation {
  const evaluation = readPlanEvaluation({ ...payload, payload })
  if (!evaluation) throw new Error('payload không đọc được')
  return evaluation
}

describe('planRejection', () => {
  it('bản dài quá trần: số đo thật + câu sửa, giữ nguyên mã của harness', () => {
    const evaluation = evaluationOf({
      identity: 'agent-box-plan',
      version: 2,
      parentVersion: 1,
      written: false,
      levels: { P1: 1, P2: 0, P3: 2, P4: 0, P5: 2, P6: 2, P7: 0, P8: 2 },
      total: 9,
      maxTotal: 16,
      hardGate: false,
      gatesFailed: ['P2', 'P4', 'P7'],
      verdict: 'fail',
      rejected: 'plan-too-long',
      measures: { chars: 306_721 },
      evidence: [],
      warnings: [],
      evaluatedAt: '2026-09-21T23:52:00Z',
    })

    const rejection = planRejection(evaluation, t)
    expect(rejection?.code).toBe('plan-too-long')
    expect(rejection?.version).toBe(2)
    expect(rejection?.prefix).toBe('PLAN_EVAL_REJECTED')
    expect(rejection?.measure).toBe('306.721 ký tự > 150.000')
    expect(rejection?.remedy).toContain('tách thành bản tóm tắt')
    expect(rejection?.stamp).not.toBeNull()
  })

  it('`QUALITY` giữ tiền tố PLAN_QUALITY_REJECTED (luật cũ của `plan_quality.py`)', () => {
    const evaluation = evaluationOf({
      identity: 'agent-box-plan',
      version: 1,
      written: false,
      levels: { P1: 2, P2: 2, P3: 0, P4: 1, P5: 1, P6: 2, P7: 1, P8: 2 },
      total: 11,
      maxTotal: 16,
      hardGate: false,
      gatesFailed: ['P3'],
      verdict: 'fail',
      rejected: 'QUALITY',
      measures: {},
      evidence: [{ code: 'P3', excerpt: '(missing-section)' }],
      warnings: [],
      evaluatedAt: '2026-09-21T23:52:00Z',
    })

    const rejection = planRejection(evaluation, t)
    expect(rejection?.prefix).toBe('PLAN_QUALITY_REJECTED')
    expect(rejection?.measure).toBeNull()
    expect(rejection?.remedy).toContain('mục bắt buộc')
  })

  it('bản đã ghi được thì không có câu từ chối nào, và khoá tiếng Anh cũng đủ', () => {
    const written = evaluationOf({
      identity: 'agent-box-plan',
      version: 1,
      written: true,
      levels: { P1: 2, P2: 2, P3: 2, P4: 2, P5: 2, P6: 2, P7: 2, P8: 2 },
      total: 16,
      maxTotal: 16,
      hardGate: true,
      gatesFailed: [],
      verdict: 'pass',
      rejected: null,
      measures: {},
      evidence: [],
      warnings: [],
      evaluatedAt: '2026-09-20T20:56:00Z',
    })

    expect(planRejection(written, t)).toBeNull()
    expect(planRejection(null, t)).toBeNull()

    const blocked = evaluationOf({
      identity: 'agent-box-plan',
      version: 2,
      parentVersion: 1,
      written: false,
      levels: { P1: 2, P2: 0, P3: 2, P4: 1, P5: 2, P6: 2, P7: 1, P8: 2 },
      total: 12,
      maxTotal: 16,
      hardGate: false,
      gatesFailed: ['P2'],
      verdict: 'fail',
      rejected: 'revision-untraceable',
      measures: { parentVersion: 1 },
      evidence: [],
      warnings: [],
      evaluatedAt: '2026-09-21T23:52:00Z',
    })
    // Khoá `remedy` có biến: `vi` và `en` phải điền cùng một số version.
    expect(planRejection(blocked, t)?.remedy).toContain('v1')
    expect(planRejection(blocked, translate(en))?.remedy).toContain('v1')
  })

  it('mã lạ vẫn có câu sửa dự phòng, không hiện `undefined`', () => {
    const evaluation = evaluationOf({
      identity: 'agent-box-plan',
      version: 3,
      written: false,
      levels: {},
      total: 0,
      maxTotal: 16,
      hardGate: false,
      gatesFailed: [],
      verdict: 'fail',
      rejected: 'ma-loi-moi',
      measures: {},
      evidence: [],
      warnings: [],
      evaluatedAt: '2026-09-21T23:52:00Z',
    })

    const rejection = planRejection(evaluation, t)
    expect(rejection?.remedy).toBe('sửa theo mã từ chối ở trên rồi gọi lại write_plan')
    expect(rejection?.remedy).not.toContain('undefined')
  })
})
