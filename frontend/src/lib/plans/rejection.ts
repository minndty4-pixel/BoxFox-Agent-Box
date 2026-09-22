/**
 * Câu từ chối của `plan_eval.py`, ghép lại trên giao diện từ mã + số đo.
 *
 * Payload cố tình **không** mang chuỗi tiếng Việt nào (`Evaluation.to_payload`), nên tab Plan dựng
 * câu từ `rejected` + `measures` + từ điển `plan.eval.remedy.*`. Giữ chữ của harness cho mã
 * (`PLAN_EVAL_REJECTED: (plan-too-long)`) vì đó là thứ tra được trong sổ và trong tài liệu, còn
 * phần diễn giải thì dịch được.
 */
import type { TKey, TVars } from '../../i18n/context'
import { PLAN_MAX_CHARS, planCount, planMeasure, planStamp } from './planState'
import type { PlanEvaluation } from './planState'

type Translate = (key: TKey, vars?: TVars) => string

const REMEDY_KEYS: Record<string, TKey> = {
  'plan-too-long': 'plan.eval.remedy.plan-too-long',
  'plan-repetitive': 'plan.eval.remedy.plan-repetitive',
  'plan-no-steps': 'plan.eval.remedy.plan-no-steps',
  'steps-unanchored': 'plan.eval.remedy.steps-unanchored',
  'header-mismatch': 'plan.eval.remedy.header-mismatch',
  'revision-untraceable': 'plan.eval.remedy.revision-untraceable',
  'identity-unhygienic': 'plan.eval.remedy.identity-unhygienic',
  QUALITY: 'plan.eval.remedy.QUALITY',
}

export interface PlanRejection {
  code: string
  /** Số version mà lần ghi này nhắm tới (`null` khi payload không mang `version`). */
  version: number | null
  /** `PLAN_EVAL_REJECTED` hoặc `PLAN_QUALITY_REJECTED` — giữ nguyên chữ của harness. */
  prefix: string
  /** Số đo đứng trước câu sửa, ví dụ `306.721 ký tự > 150.000`; `null` khi mã không có số đo. */
  measure: string | null
  remedy: string
  /** Thời điểm chấm, `dd/mm HH:MM`, `null` khi payload không mang `evaluatedAt`. */
  stamp: string | null
}

/** `null` khi bản này không bị từ chối (đã ghi được) — người gọi không phải tự đoán. */
export function planRejection(evaluation: PlanEvaluation | null, t: Translate): PlanRejection | null {
  if (!evaluation) return null
  const code = evaluation.rejected
  if (!code) return null
  const measures = evaluation.measures
  const chars = planMeasure(measures, 'chars')
  const anchored = planMeasure(measures, 'stepsAnchored')
  const steps = planMeasure(measures, 'steps')
  const repetition = planMeasure(measures, 'repetition')
  let measure: string | null = null
  if (code === 'plan-too-long' && chars !== null) {
    measure = t('plan.eval.charsOverMax', {
      chars: planCount(chars) ?? `${chars}`,
      max: planCount(PLAN_MAX_CHARS) ?? '',
    })
  } else if (code === 'steps-unanchored' && steps !== null) {
    measure = t('plan.eval.stepsAnchored', { anchored: anchored ?? 0, steps })
  } else if (code === 'plan-repetitive' && repetition !== null) {
    measure = t('plan.eval.repetition', { ratio: repetition.toFixed(2) })
  }
  const version = evaluation.parentVersion ?? evaluation.version ?? ''
  return {
    code,
    version: evaluation.version,
    prefix: code === 'QUALITY' ? t('plan.eval.qualityPrefix') : t('plan.eval.rejectedPrefix'),
    measure,
    remedy: t(REMEDY_KEYS[code] ?? 'plan.eval.remedy.other', { version }),
    stamp: planStamp(evaluation.evaluatedAt),
  }
}
