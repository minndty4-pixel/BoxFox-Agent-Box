/**
 * Các thẻ Research xuất hiện TRONG hội thoại (không phải trong tab Research):
 * thẻ gợi ý, lời hỏi nhiều câu, thẻ ngoài phạm vi, thẻ báo cáo khi run xong (kể cả run chạy nền).
 *
 * Vì sao gom một chỗ: chúng cùng đọc `researchStore`, cùng nằm ngay trên ô soạn tin, và thứ tự hiển
 * thị phải ổn định (lời hỏi chặn trước, rồi thẻ ngoài phạm vi, rồi báo cáo). Mockup:
 * `composer-toggle-toolbar-pill.html`, `out-of-scope.html`, `report-handoff.html`,
 * `background-run-indicator.html`.
 */
import { type ReactNode } from 'react'
import { BrainCircuit } from 'lucide-react'
import { useT } from '../../../i18n/context'
import { useResearchStore } from '../../../store/researchStore'
import { jobIsRunningInBackground, type ResearchJob, type ResearchPrompt } from '../../../lib/researchMode'
import { OutOfScopeCard } from './OutOfScopeCard'
import { ResearchModeBanner } from './ResearchComposerStatus'
import { ResearchPromptCard } from './ResearchPromptCard'
import { ResearchReportCard } from './ResearchReportCard'

/** Thẻ gợi ý của main: `research_suggest` KHÔNG bật chế độ, chỉ hỏi (§4.5, M-06). */
export function ResearchSuggestCard({ reason, draftGoal }: { reason: string; draftGoal: string }) {
  const t = useT()
  const setMode = useResearchStore((s) => s.setMode)
  const mode = useResearchStore((s) => s.mode)
  if (mode.on) return null
  return (
    <section
      data-testid="research-suggest-card"
      className="rounded-lg border border-brand/30 bg-brand/5 p-2 text-[11px] text-brand"
    >
      <header className="flex items-center gap-1.5">
        <BrainCircuit className="size-3" />
        <span className="font-medium">{t('research.suggestTitle')}</span>
        <span className="ml-auto text-[10px] text-muted">{t('research.suggestFrom')}</span>
      </header>
      {draftGoal && <p className="mt-0.5 text-fg">{draftGoal}</p>}
      <p className="mt-0.5 text-muted">{reason || t('research.suggestReason')}</p>
      <p className="mt-0.5 text-muted">{t('research.suggestNoAuto')}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          data-testid="research-suggest-enable"
          onClick={() => void setMode(true, 'toggle')}
          className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-900 transition hover:bg-white cursor-pointer"
        >
          {t('research.suggestEnable')}
        </button>
        <span className="text-muted">{t('research.suggestDecline')} · {t('research.suggestOrType')}</span>
      </div>
    </section>
  )
}

function pickPrompt(job: ResearchJob, kinds: ResearchPrompt['kind'][]): ResearchPrompt | null {
  return job.prompts.find((prompt) => prompt.status === 'open' && kinds.includes(prompt.kind)) ?? null
}

/**
 * Khối thẻ trong hội thoại của phiên đang mở. Chỉ vẽ khi có việc để nói; không tốn chỗ khi rảnh.
 */
export function ResearchConversationCards({
  suggest,
}: {
  /** Gợi ý gần nhất trên luồng sự kiện (`research_suggested`) — `null` khi không có. */
  suggest: { reason: string; draftGoal: string } | null
}) {
  const mode = useResearchStore((s) => s.mode)
  const jobs = useResearchStore((s) => s.jobs)

  const foreground = jobs.find((job) => job.researchId === mode.activeRunId) ?? jobs.find((job) => !jobIsRunningInBackground(job))
  const background = jobs.find(jobIsRunningInBackground)
  const jobsToShow = [foreground, background].filter((job, index, list): job is ResearchJob => !!job && list.indexOf(job) === index)

  const blocks: { key: string; node: ReactNode }[] = []
  for (const job of jobsToShow) {
    const outOfScope = pickPrompt(job, ['out-of-scope'])
    const interview = pickPrompt(job, ['interview', 'scope-change', 'budget'])
    if (outOfScope) {
      blocks.push({ key: `${job.researchId}-oos`, node: <OutOfScopeCard key={`${job.researchId}-oos`} job={job} prompt={outOfScope} /> })
    }
    if (interview && !outOfScope) {
      blocks.push({ key: `${job.researchId}-ask`, node: <ResearchPromptCard key={`${job.researchId}-ask`} prompt={interview} /> })
    }
    const finished = job.status === 'completed'
    const showReport = finished && !!job.dossier
    if (showReport) {
      blocks.push({
        key: `${job.researchId}-report`,
        node: <ResearchReportCard key={`${job.researchId}-report`} job={job} inBackground={jobIsRunningInBackground(job) || !mode.on} />,
      })
    }
  }

  if (blocks.length === 0 && !suggest && !mode.on) return null
  return (
    <div className="space-y-2 pb-1" data-testid="research-conversation-cards">
      <ResearchModeBanner />
      {blocks.map((block) => block.node)}
      {suggest && <ResearchSuggestCard reason={suggest.reason} draftGoal={suggest.draftGoal} />}
    </div>
  )
}
