import { resolveBoxApiUrl } from '../boxApi'
import { SandboxPlanRepository } from './http'
import { MockPlanRepository } from './mock'
import type { PlanRepository } from './types'

export * from './types'
export { PlanRepositoryHttpError } from './http'

// Trạng thái duyệt thật + bản chấm P1–P8: đọc từ sổ của harness, không phải từ box.
export {
  EVAL_DIMENSIONS,
  HarnessPlanStatusClient,
  PLAN_MAX_CHARS,
  PLAN_REVIEW_STATES,
  PLAN_VERIFICATION_STATES,
  PLAN_WARN_CHARS,
  PlanReviewBlockedError,
  createPlanStatusClient,
  planCount,
  planMeasure,
  planMeasureText,
  planStamp,
  readPlanEvaluation,
  readPlanStatus,
  readPlanStatusReview,
  readPlanVerification,
} from './planState'
export type {
  PlanDecision,
  PlanEvalDimension,
  PlanEvalLayer,
  PlanEvalLevel,
  PlanEvalVerdict,
  PlanEvaluation,
  PlanIssueSeverity,
  PlanOwnership,
  PlanReviewOutcome,
  PlanReviewState,
  PlanStatusClient,
  PlanStatusReport,
  PlanStatusReview,
  PlanVerification,
  PlanVerificationIssue,
  PlanVerificationState,
} from './planState'
export { planRejection } from './rejection'
export type { PlanRejection } from './rejection'

export type PlanSource = 'sandbox' | 'mock'

/** Sandbox là mặc định; mock chỉ bật tường minh trong test hoặc demo. */
export function createPlanRepository(env: ImportMetaEnv = import.meta.env): PlanRepository {
  const source = env.VITE_PLAN_SOURCE?.trim().toLowerCase()
  if (source === 'mock') return new MockPlanRepository()
  return new SandboxPlanRepository(resolveBoxApiUrl(env))
}
