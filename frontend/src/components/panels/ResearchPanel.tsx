import { useCallback, useEffect, useState } from 'react'
import { useAgentStore } from '../../store/agentStore'

type Question = { id: string; text: string; importance: string; status: string; note?: string }
type Job = {
  research_id: string
  revision: number
  status: string
  usedSeconds: number
  remainingSeconds: number
  evidence: { rowId: string; claim: string; url: string; excerpt: string; status: string }[]
  evidenceGraph: { row_id: string; claim: string; assessments: { relation: string; rationale: string }[] }[]
  dependentPlans: { identity: string; version: number; dependencies: { stale: boolean }[] }[]
  branches: { session_id: string; role: string; status: string; goal: string; questionId?: string }[]
  dossier: { relative_path: string; version: number; gate: string; critique: string } | null
  reviews: { version: number; mode: string; verdict: string }[]
  state: {
    goal: string
    output: string
    methods: string[]
    questions: Question[]
    findings: string[]
    blockedSources: { url: string; impact: string }[]
    budgetSeconds: number
  }
}

const headers = { 'X-BoxFox-Admin': '1', 'Content-Type': 'application/json' }

export function ResearchPanel() {
  const sessionId = useAgentStore((s) => s.activeSessionId)
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!sessionId) { setJobs([]); return }
    try {
      const response = await fetch(`/api/agent/research/jobs?sessionId=${encodeURIComponent(sessionId)}`, { headers })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as { jobs: Job[] }
      setJobs(payload.jobs)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function update(job: Job, action: string, fields: Record<string, unknown> = {}) {
    setBusy(true)
    try {
      const response = await fetch(`/api/agent/research/jobs/${encodeURIComponent(job.research_id)}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ action, revision: job.revision, ...fields }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <section className="h-full overflow-y-auto p-4 text-sm text-fg" aria-label="Research jobs">
    <h2 className="mb-3 text-base font-semibold">Research</h2>
    {error && <p className="mb-3 rounded bg-red-500/10 p-2 text-red-400" role="alert">{error}</p>}
    {!jobs.length && <p className="text-muted">Chưa có research job trong phiên này.</p>}
    {jobs.map((job) => <article key={job.research_id} className="mb-4 rounded-lg border border-line bg-panel2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{job.state.goal}</h3>
          <p className="text-xs text-muted">{job.research_id} · {job.status}</p>
        </div>
        <div className="flex gap-1">
          {job.status === 'paused' || job.status === 'partial'
            ? <button disabled={busy} onClick={() => void update(job, 'resume')} className="rounded border border-line px-2 py-1">Tiếp tục</button>
            : <button disabled={busy || job.status === 'completed' || job.status === 'cancelled'} onClick={() => void update(job, 'pause')} className="rounded border border-line px-2 py-1">Tạm dừng</button>}
          <button disabled={busy || job.status === 'cancelled'} onClick={() => void update(job, 'cancel')} className="rounded border border-line px-2 py-1">Hủy</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Ngân sách: {Math.round(job.usedSeconds)} / {job.state.budgetSeconds} giây · còn {Math.round(job.remainingSeconds)} giây</p>
      <div className="mt-2 flex items-center gap-2">
        <label htmlFor={`budget-${job.research_id}`} className="text-xs">Đổi ngân sách</label>
        <input id={`budget-${job.research_id}`} type="number" min={60} max={86400} defaultValue={job.state.budgetSeconds}
          className="w-24 rounded border border-line bg-bg px-1 py-0.5"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void update(job, 'budget', { budgetSeconds: Number(event.currentTarget.value) })
          }} />
        <span className="text-xs text-muted">Enter để lưu</span>
      </div>
      {!!job.state.methods.length && <p className="mt-2 text-xs">Cách tìm: {job.state.methods.join(', ')}</p>}
      {!!job.branches?.length && <p className="mt-2 text-xs">Nhánh: {job.branches.filter((branch) => branch.role === 'research').map((branch) => `${branch.questionId || '?'}: ${branch.goal} (${branch.status})`).join(' · ')}</p>}
      <h4 className="mt-3 font-medium">Câu hỏi</h4>
      <ul className="mt-1 space-y-2">
        {job.state.questions.map((question) => <li key={question.id} className="rounded border border-line p-2">
          <div className="flex items-start justify-between gap-2">
            <span>{question.text}</span>
            <span className="whitespace-nowrap text-xs text-muted">{question.status} · {question.importance}</span>
          </div>
          {question.note && <p className="mt-1 text-xs text-muted">{question.note}</p>}
          <div className="mt-1 flex gap-2 text-xs">
            <button disabled={busy} onClick={() => void update(job, 'prioritize', { questionId: question.id, importance: 'high' })} className="underline">Ưu tiên</button>
            <button disabled={busy} onClick={() => void update(job, 'skip', { questionId: question.id })} className="underline">Bỏ nhánh</button>
          </div>
        </li>)}
      </ul>
      {!!job.state.findings.length && <><h4 className="mt-3 font-medium">Phát hiện</h4><ul className="list-disc pl-5 text-xs">{job.state.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul></>}
      {!!job.state.blockedSources.length && <><h4 className="mt-3 font-medium">Nguồn bị chặn</h4><ul className="list-disc pl-5 text-xs">{job.state.blockedSources.map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.url}</a> — {source.impact}</li>)}</ul></>}
      {!!job.evidence?.length && <><h4 className="mt-3 font-medium">Bằng chứng</h4><ul className="mt-1 space-y-1 text-xs">{job.evidence.map((row) => <li key={row.rowId} className="rounded border border-line p-2">{/^https?:\/\//i.test(row.url) ? <a href={row.url} target="_blank" rel="noreferrer" className="underline">{row.rowId}: {row.claim}</a> : <span>{row.rowId}: {row.claim} · {row.url}</span>}<p className="mt-1 text-muted">{row.excerpt}</p><span>{row.status}</span></li>)}</ul></>}
      {!!job.evidenceGraph?.some((item) => item.assessments.length) && <><h4 className="mt-3 font-medium">Đánh giá quan hệ nguồn–khẳng định</h4><ul className="mt-1 space-y-1 text-xs">{job.evidenceGraph.filter((item) => item.assessments.length).map((item, index) => <li key={`${item.row_id}-${index}`} className="rounded border border-line p-2">{item.row_id}: {item.claim}<span className="ml-2 font-medium">{item.assessments.at(-1)?.relation}</span><p className="text-muted">{item.assessments.at(-1)?.rationale}</p></li>)}</ul></>}
      {job.dossier && <p className="mt-3 text-xs">Hồ sơ v{job.dossier.version}: {job.dossier.relative_path} · {job.dossier.gate} · {job.dossier.critique}</p>}
      {!!job.reviews?.length && <p className="mt-1 text-xs">Review: {job.reviews.map((review) => `v${review.version} ${review.mode}: ${review.verdict}`).join(' · ')}</p>}
      {!!job.dependentPlans?.length && <p className="mt-1 text-xs">Plan phụ thuộc: {job.dependentPlans.map((plan) => `${plan.identity}@v${plan.version}${plan.dependencies.some((dep) => dep.stale) ? ' (cần review lại)' : ''}`).join(' · ')}</p>}
    </article>)}
  </section>
}
