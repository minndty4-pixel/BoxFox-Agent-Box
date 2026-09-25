/**
 * Thẻ báo cáo (mockup `report-handoff.html`, và biến thể trong `background-run-indicator.html`).
 *
 * Dùng cho cả hai đường: run hoàn tất khi chế độ đang bật, và run chạy nền kết thúc sau khi người
 * dùng đã tắt chế độ. Đường dẫn hồ sơ in ĐÚNG dạng `.research/<slug>-<yyyymmdd-hhmm>/v<N>-<id>.md`
 * do server trả về — không tự dựng lại (bảng 4.8).
 *
 * "Dùng cho plan" chuyển sang tab Kế hoạch với ngữ cảnh run; các nút Đào sâu/Cập nhật đi qua
 * `PATCH /research/jobs/{id}` (`deepen`/`refresh`, hợp đồng §5.12).
 */
import { useT } from '../../../i18n/context'
import { useUiStore } from '../../../store/uiStore'
import { useResearchStore } from '../../../store/researchStore'
import { runLabel, type ResearchJob } from '../../../lib/researchMode'
import { formatClock } from './format'
import { critiqueLabel } from './RunTimeline'

export function ResearchReportCard({ job, inBackground }: { job: ResearchJob; inBackground?: boolean }) {
  const t = useT()
  const showTab = useUiStore((s) => s.showTab)
  const updateJob = useResearchStore((s) => s.updateJob)

  const dossier = job.dossier
  if (!dossier && job.status !== 'completed') return null
  const latestReview = job.reviews.at(-1)
  const incomplete = latestReview?.verdict === 'revise' || latestReview?.verdict === 'rejected'
  // `deepen` bắt buộc có đích: facet của run, hoặc câu hỏi. Không có đích thì không gửi (server 400).
  const deepenTarget = job.coverage.facets[0]?.id ?? job.questions[0]?.id ?? ''

  return (
    <section
      data-testid="research-report-card"
      data-background={inBackground ? 'true' : 'false'}
      className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2 text-[11px]"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-emerald-300">{t('research.reportTitle', { goal: job.goal || runLabel(job.researchId) })}</span>
        {dossier && (
          <span className="rounded border border-line px-1 py-px text-[10px] text-muted">
            {t('research.reportVersion', { n: dossier.version })}
          </span>
        )}
        <span className="ml-auto rounded bg-emerald-500/15 px-1 py-px text-[10px] font-medium text-emerald-300">
          {t('research.statusDone')}
        </span>
      </header>
      <p className="mt-0.5 text-muted" data-testid="research-report-meta">
        {t('research.reportMeta', {
          id: runLabel(job.researchId),
          tier: job.tier,
          branches: job.branches.length,
          sources: job.evidence.length,
          used: formatClock(job.usedSeconds),
          budget: formatClock(job.budgetSeconds),
        })}
      </p>
      {dossier && (
        <p className="mt-0.5 font-mono text-[10px] text-muted" data-testid="research-report-path">
          {t('research.reportPath', { version: dossier.version, path: dossier.relativePath })}
        </p>
      )}
      {latestReview && (
        <p className="mt-0.5 text-muted" data-testid="research-report-critique">
          {t('research.reportCritique', { verdict: incomplete ? t('research.reportFailedCritique') : latestReview.verdict })}
        </p>
      )}

      {job.findings.length > 0 && (
        <div className="mt-1.5">
          <h4 className="text-[10px] font-medium tracking-wide text-muted uppercase">
            {t('research.reportConclusions')}
          </h4>
          <ol className="mt-0.5 space-y-0.5">
            {job.findings.slice(0, 3).map((finding, index) => (
              <li key={`${finding}-${index}`} className="flex gap-1.5 text-fg">
                <span className="text-muted">{index + 1}</span>
                <span>{finding}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {job.reviews.length > 0 && (
        <div className="mt-1.5">
          <h4 className="text-[10px] font-medium tracking-wide text-muted uppercase">{t('research.reportReviews')}</h4>
          <ul className="mt-0.5 space-y-0.5 text-muted">
            {job.reviews.map((review) => (
              <li key={`${review.version}-${review.mode}`}>{critiqueLabel(t, review)}</li>
            ))}
          </ul>
        </div>
      )}
      {job.blockedSources.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-300">
          {t('research.conflicts', { count: job.blockedSources.length })}
        </p>
      )}

      <footer className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="research-report-use-for-plan"
          onClick={() => showTab('plan', { researchId: job.researchId })}
          className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-900 transition hover:bg-white cursor-pointer"
        >
          {t('research.reportUseForPlan')}
        </button>
        <button
          type="button"
          data-testid="research-report-deepen"
          disabled={!deepenTarget}
          onClick={() => void updateJob(job.researchId, {
            action: 'deepen', revision: job.revision,
            ...(job.coverage.facets[0]?.id ? { facetId: job.coverage.facets[0].id } : { questionId: deepenTarget }),
          })}
          className="rounded border border-line px-2 py-0.5 text-muted transition hover:text-fg disabled:opacity-40 cursor-pointer"
        >
          {t('research.reportDeepen')}
        </button>
        <button
          type="button"
          onClick={() => void updateJob(job.researchId, { action: 'refresh', revision: job.revision })}
          className="rounded border border-line px-2 py-0.5 text-muted transition hover:text-fg cursor-pointer"
        >
          {t('research.reportUpdate')}
        </button>
        <button
          type="button"
          data-testid="research-report-open"
          onClick={() => showTab('research', { researchId: job.researchId })}
          className="rounded border border-line px-2 py-0.5 text-muted transition hover:text-fg cursor-pointer"
        >
          {t('research.openReport')}
        </button>
      </footer>
    </section>
  )
}
