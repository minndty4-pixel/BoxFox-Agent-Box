/**
 * Thẻ "Phản biện độc lập" của tab Plan (vòng 25).
 *
 * Vì sao phải có: trước vòng 25, bản kế hoạch CHƯA qua phiên phản biện vẫn duyệt được — không có gì
 * trong tab nói bản đang xem đã được một phiên riêng đọc hay chưa. Thẻ này đọc mặt `verification` của
 * `GET /api/agent/plans/status` (sổ phản biện của harness) và chỉ nói cái đang biết:
 *
 * - `none`  — chưa phiên nào đọc bản này: câu chỉ dẫn + yêu cầu tối thiểu (+ nút chạy phiên nếu có đường).
 * - `ok`    — đã đọc, không lỗi.
 * - `revise`— đã đọc, còn lỗi: từng lỗi một hàng, chữ lỗi là NGUYÊN VĂN của harness.
 * - `unknown` — harness cũ không khai trường, hoặc sổ không đọc được: MỘT hàng nói "chưa biết", không
 *   đoán thành "chưa phản biện", không tô đỏ.
 */
import { ShieldCheck } from 'lucide-react'
import { useT, type TKey, type TVars } from '../../i18n/context'
import { planStamp } from '../../lib/plans'
import type { PlanIssueSeverity, PlanVerification, PlanVerificationIssue } from '../../lib/plans'

interface PlanReviewCardProps {
  verification: PlanVerification
  /** Bản đang xem — vào câu chỉ dẫn của mặt `none` và mặt `ok`. */
  version: number | null
  /** Đường dẫn tương đối của bản đang xem — câu "yêu cầu tối thiểu". */
  path: string
  /** Đang chờ harness nhận yêu cầu chạy phiên phản biện. */
  runPending?: boolean
  /** Có thì mới vẽ nút chạy phiên — không hứa một đường không tồn tại. */
  onRun?: () => void
}

type Translate = (key: TKey, vars?: TVars) => string

/** `high` = chip đỏ, `medium`/`low` = chip vàng, `unknown` = chip trung tính (không hạ mức). */
const SEVERITY_CLASSES: Record<PlanIssueSeverity, string> = {
  high: 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/40',
  medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40',
  low: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40',
  unknown: 'bg-panel2 text-muted ring-1 ring-line',
}

const SEVERITY_LABELS: Record<PlanIssueSeverity, TKey> = {
  high: 'plan.verify.severity.high',
  medium: 'plan.verify.severity.medium',
  low: 'plan.verify.severity.low',
  unknown: 'plan.verify.severity.unknown',
}

const MONO_BADGE = 'rounded bg-panel px-2 py-0.5 text-[10px] font-mono text-muted border border-line'

/** Số đếm tự tính từ `issues[]` — mức nào không có lỗi thì không in ra. */
function countsText(t: Translate, issues: PlanVerificationIssue[]): string {
  const count = (severity: PlanIssueSeverity) => issues.filter((issue) => issue.severity === severity).length
  const parts = [t('plan.verify.count', { count: issues.length })]
  const high = count('high')
  const medium = count('medium')
  const low = count('low')
  if (high) parts.push(t('plan.verify.countHigh', { n: high }))
  if (medium) parts.push(t('plan.verify.countMedium', { n: medium }))
  if (low) parts.push(t('plan.verify.countLow', { n: low }))
  return parts.join(' · ')
}

function FindingRow({ issue, index }: { issue: PlanVerificationIssue; index: number }) {
  const t = useT()
  const testId = `plan-review-finding-${index + 1}`
  return (
    <div
      data-component-id={testId}
      data-testid={testId}
      className="rounded-md border border-line bg-panel p-2 space-y-1"
    >
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${SEVERITY_CLASSES[issue.severity]}`}>
          {t(SEVERITY_LABELS[issue.severity])}
        </span>
        {/* Chữ lỗi là nguyên văn của harness — không viết lại, không rút gọn. */}
        <span className="min-w-0 flex-1 text-[11px] text-fg leading-relaxed">{issue.text}</span>
        {/* Mã lỗi chỉ hiện khi harness có gửi; thiếu thì không bịa mã nào. */}
        {issue.code && <span className={MONO_BADGE}>{issue.code}</span>}
      </div>
      {issue.fix && (
        <p className="text-[11px] text-muted leading-relaxed">
          <span className="text-brand">{t('plan.verify.fix')} </span>
          {issue.fix}
        </p>
      )}
    </div>
  )
}

export function PlanReviewCard({ verification, version, path, runPending = false, onRun }: PlanReviewCardProps) {
  const t = useT()
  const label = version === null ? '—' : `v${version}`
  const stamp = planStamp(verification.at)

  // Harness cũ không khai mặt phản biện: một hàng nói đúng "chưa biết", không đoán, không tô đỏ.
  if (verification.state === 'unknown') {
    return (
      <div
        data-component-id="plan-review-card"
        data-testid="plan-review-card"
        className="flex items-center gap-2 rounded-lg border border-line bg-panel2/30 px-3.5 py-2.5 text-[11px] text-muted"
      >
        <ShieldCheck className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{t('plan.verify.cardUnreadable')}</span>
      </div>
    )
  }

  const hasReview = verification.state === 'ok' || verification.state === 'revise'
  const chipText = t(
    hasReview ? (verification.state === 'revise' ? 'plan.verify.chip.revise' : 'plan.verify.chip.ok') : 'plan.verify.chip.none',
    { critic: t('plan.verify.critic'), stamp: stamp ?? '' },
  )
  const stateClasses =
    verification.state === 'revise'
      ? 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/40'
      : hasReview
        ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40'
        : 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40'

  return (
    <div
      data-component-id="plan-review-card"
      data-testid="plan-review-card"
      className="rounded-lg border border-line bg-panel2/30 p-3.5 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold text-fg uppercase tracking-wider">{t('plan.verify.cardTitle')}</h2>
        <div className="flex items-center gap-1.5">
          <span
            data-testid="plan-review-card-state"
            className={`rounded px-1.5 py-px text-[10px] font-semibold ${stateClasses}`}
          >
            {chipText}
          </span>
          {hasReview && (
            <>
              {/* Vai của phiên phản biện — nói rõ kết quả này do phiên riêng nào đọc. */}
              <span className={MONO_BADGE}>{t('plan.verify.critic')}</span>
              <span className={MONO_BADGE}>
                {[countsText(t, verification.issues), stamp].filter(Boolean).join(' · ')}
              </span>
            </>
          )}
        </div>
      </div>

      {hasReview ? (
        <>
          {verification.state === 'ok' && verification.issues.length === 0 && (
            <p className="text-[11px] text-muted leading-relaxed">
              {t('plan.verify.cardOk', { version: label })}
            </p>
          )}
          {verification.issues.length > 0 && (
            <div className="space-y-1.5">
              {verification.issues.map((issue, index) => (
                <FindingRow key={`${issue.severity}-${index}`} issue={issue} index={index} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[11px] text-muted leading-relaxed">
            {t('plan.verify.cardEmpty', { version: label, critic: t('plan.verify.critic') })}
          </p>
          <p className="text-[11px] text-muted leading-relaxed">
            {t('plan.verify.cardEmptyMinimum', { path: path || '—', critic: t('plan.verify.critic') })}
          </p>
        </>
      )}

      {onRun && (
        <button
          type="button"
          data-component-id="plan-review-run-button"
          data-testid="plan-review-run"
          disabled={runPending}
          onClick={onRun}
          className="rounded border border-line bg-panel px-2.5 py-1 text-[11px] font-medium text-fg hover:bg-panel2 disabled:opacity-50"
        >
          {runPending ? t('plan.verify.runPending') : t('plan.verify.run')}
        </button>
      )}
    </div>
  )
}
