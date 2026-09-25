/**
 * Thẻ phạm vi (mockup `scope-card-blocking.html` và `scope-card-proceeding.html`).
 *
 * Hai biến thể, cùng một dữ liệu `scope` (store ở `research_jobs.state.scope`):
 * - **chặn**: còn câu hỏi chặn chưa trả lời (run ở `needs_user`) ⇒ tiêu đề "Chờ bạn trả lời — N điểm
 *   mơ hồ", kèm lời hỏi nhiều câu và hai nút "Bắt đầu" / "Sửa phạm vi";
 * - **đang chạy**: tiêu đề "Yêu cầu đủ rõ — research đã bắt đầu, không chờ xác nhận", mỗi dòng có "Sửa".
 *
 * Hai danh sách LUÔN tách bạch: "Bạn đã xác nhận" lấy mục `status='confirmed'`, "Giả định của agent"
 * lấy mục `status='assumed'` (bảng 4.8). Mỗi lần sửa gửi kèm `revision` đang thấy để server từ chối
 * khi thẻ đã đổi dưới chân người dùng.
 */
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useT, type TKey } from '../../../i18n/context'
import { useResearchStore } from '../../../store/researchStore'
import {
  assumedItems,
  blockingOpenQuestions,
  confirmedItems,
  jobIsActive,
  runLabel,
  type ResearchJob,
  type ResearchPrompt,
  type ResearchScope,
} from '../../../lib/researchMode'
import { formatClock, formatMinutes } from './format'
import { ResearchPromptCard } from './ResearchPromptCard'

/** Một dòng sửa được: nhãn + giá trị + nút "Sửa" mở ô nhập ngay tại chỗ. */
function EditableRow({
  label,
  value,
  multiline,
  onSave,
}: {
  label: string
  value: string
  multiline?: boolean
  onSave: (next: string) => Promise<boolean>
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const ok = await onSave(draft)
    setBusy(false)
    if (ok) setEditing(false)
  }

  return (
    <div className="flex items-start gap-2 border-b border-line/60 py-1 last:border-b-0">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      {editing ? (
        <div className="min-w-0 flex-1">
          {multiline ? (
            <textarea
              aria-label={label}
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="w-full rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-fg outline-hidden focus:border-brand"
            />
          ) : (
            <input
              aria-label={label}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="w-full rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-fg outline-hidden focus:border-brand"
            />
          )}
          <div className="mt-0.5 flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              data-testid="research-scope-save"
              onClick={() => void save()}
              className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-900 transition hover:bg-white disabled:opacity-40 cursor-pointer"
            >
              {t('research.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(value)
                setEditing(false)
              }}
              className="rounded border border-line px-2 py-0.5 text-muted transition hover:text-fg cursor-pointer"
            >
              {t('research.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <span className="min-w-0 flex-1 text-fg">{value || '—'}</span>
      )}
      {!editing && (
        <button
          type="button"
          data-testid="research-scope-edit"
          onClick={() => {
            setDraft(value)
            setEditing(true)
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-muted transition hover:text-fg cursor-pointer"
        >
          <Pencil className="size-2.5" />
          {t('research.edit')}
        </button>
      )}
    </div>
  )
}

function ScopeEntryList({ title, hint, items, empty }: {
  title: string
  hint?: string
  items: { text: string; status: string }[]
  empty: string
}) {
  return (
    <section className="mt-1.5">
      <h4 className="text-[10px] font-medium tracking-wide text-muted uppercase">
        {title}
        {hint && <span className="ml-1 normal-case">{hint}</span>}
      </h4>
      {items.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5">
          {items.map((item, index) => (
            <li key={`${item.text}-${index}`} className="flex items-start gap-1.5 text-fg">
              <span className="text-muted">•</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function depthLabel(t: (key: TKey, vars?: Record<string, string | number>) => string, tier: number, depth: string): string {
  const key: TKey = depth === 'quick' ? 'research.depthQuick' : depth === 'deep' ? 'research.depthDeep' : 'research.depthStandard'
  return `${t('research.depthValue', { tier, depth: t(key) })}${tier >= 2 ? ` · ${t('research.critiqueFromTier2')}` : ''}`
}

function windowLabel(t: (key: TKey, vars?: Record<string, string | number>) => string, scope: ResearchScope): string {
  const days = scope.window?.days ?? null
  if (!days) return t('research.timeUnlimited')
  return t('research.timeRecent', { months: Math.max(1, Math.round(days / 30)) })
}

export function ScopeCard({
  job,
  scope,
  prompt,
}: {
  job: ResearchJob
  scope: ResearchScope
  /** Lời hỏi chặn đang mở của run (nếu có) — hiện ngay trong thẻ khi thẻ đang chặn. */
  prompt?: ResearchPrompt | null
}) {
  const t = useT()
  const updateJob = useResearchStore((s) => s.updateJob)
  const blocking = blockingOpenQuestions(scope)
  const blocked = blocking.length > 0 || job.status === 'needs_user'
  const budget = scope.budget
  const budgetText = budget?.proposedSeconds
    ? `${t('research.budgetProposed', { minutes: formatMinutes(budget.proposedSeconds) })}${
        budget.hardCeilingSeconds
          ? ` ${t('research.budgetCeiling', { tier: scope.tier, minutes: formatMinutes(budget.hardCeilingSeconds) })}`
          : ''
      }`
    : '—'
  const used = job.usedSeconds > 0 ? ` ${t('research.budgetUsed', { used: formatClock(job.usedSeconds) })}` : ''

  const patch = (scopePatch: Record<string, unknown>) =>
    updateJob(job.researchId, { action: 'scope', revision: scope.revision, scope: scopePatch })

  return (
    <section
      data-testid="research-scope-card"
      data-variant={blocked ? 'blocking' : 'proceeding'}
      className="rounded-lg border border-line bg-panel p-2 text-[11px]"
    >
      <header className="flex items-center gap-2">
        <span className="font-medium text-fg">{t('research.scopeTitle', { id: runLabel(job.researchId) })}</span>
        <span className="rounded border border-line px-1 py-px text-[10px] text-muted">
          {t('research.rev', { n: scope.revision })}
        </span>
        <span
          className={`ml-auto shrink-0 rounded px-1 py-px text-[10px] font-medium ${
            job.status === 'needs_user'
              ? 'bg-amber-500/15 text-amber-300'
              : jobIsActive(job)
                ? 'bg-brand/15 text-brand'
                : 'bg-emerald-500/15 text-emerald-300'
          }`}
        >
          {job.status === 'needs_user'
            ? t('research.statusNeedsUser')
            : jobIsActive(job)
              ? t('research.statusRunning')
              : t('research.statusDone')}
        </span>
      </header>
      <p className="mt-0.5 text-muted">
        {blocked
          ? t('research.scopeBlocking', { count: Math.max(1, blocking.length) })
          : t('research.scopeProceeding')}
      </p>

      <div className="mt-1.5" data-testid="research-scope-rows">
        <EditableRow
          label={t('research.fieldGoal')}
          value={scope.goal?.text ?? ''}
          multiline
          onSave={(text) => patch({ goal: { text, status: 'confirmed' } })}
        />
        <EditableRow
          label={t('research.fieldQuestions')}
          value={`${t('research.questionsCount', { count: scope.questions.length })}${
            scope.questions.length ? `: ${scope.questions.map((item) => item.text).join(' · ')}` : ''
          }`}
          multiline
          onSave={(text) => patch({ questions: text.split('\n').map((line) => line.trim()).filter(Boolean) })}
        />
        <EditableRow
          label={t('research.fieldTime')}
          value={windowLabel(t, scope)}
          onSave={(text) => patch({ timePolicy: { velocity: text.trim().toLowerCase(), status: 'confirmed' } })}
        />
        <EditableRow
          label={t('research.fieldDepth')}
          value={depthLabel(t, scope.tier, scope.depth)}
          onSave={(text) => patch({ depth: text.trim().toLowerCase() })}
        />
        <EditableRow
          label={t('research.fieldBudget')}
          value={`${budgetText}${used}`}
          onSave={(text) => {
            const minutes = Number(text.replace(/[^0-9]/g, ''))
            return Number.isFinite(minutes) && minutes > 0
              ? patch({ budget: { proposedSeconds: minutes * 60, approved: true } })
              : Promise.resolve(false)
          }}
        />
        <EditableRow
          label={t('research.fieldOutputs')}
          value={scope.outputs.join(' · ')}
          multiline
          onSave={(text) => patch({ outputs: text.split('\n').map((line) => line.trim()).filter(Boolean) })}
        />
      </div>

      {scope.timePolicy?.note && <p className="mt-1 text-amber-300">{scope.timePolicy.note}</p>}

      <ScopeEntryList
        title={t('research.confirmedTitle')}
        items={confirmedItems(scope)}
        empty={t('research.confirmedEmpty')}
      />
      <ScopeEntryList
        title={t('research.assumedTitle')}
        hint={t('research.assumedHint')}
        items={assumedItems(scope)}
        empty={t('research.assumedEmpty')}
      />

      {blocked && (
        <div className="mt-1.5">
          {prompt && prompt.status === 'open' ? (
            <ResearchPromptCard prompt={prompt} />
          ) : (
            <p className="text-muted">{t('research.promptNote')}</p>
          )}
        </div>
      )}

      <footer className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
        <span>{t('research.applyNextWave')}</span>
        {!blocked && (
          <>
            <button
              type="button"
              data-testid="research-run-pause"
              onClick={() => void updateJob(job.researchId, { action: 'pause', revision: job.revision })}
              className="rounded border border-line px-1.5 py-0.5 transition hover:text-fg cursor-pointer"
            >
              {t('research.pauseRun')}
            </button>
            <span>{t('research.scopeOnly')}</span>
          </>
        )}
      </footer>
    </section>
  )
}
