/**
 * Bài kiểm luồng đầy đủ của chế độ `/research` (điều kiện nghiệm thu §7 P4):
 *
 *   bật mode → trả lời phỏng vấn nhiều câu trong MỘT lần gọi → sửa thẻ phạm vi → tắt mode chọn
 *   "Tạm dừng" → bật lại → tắt mode chọn "Tiếp tục chạy nền" → thấy chỉ báo run chạy nền → thẻ báo
 *   cáo hiện khi run xong.
 *
 * Phụ thêm: mỗi `kind` của `research_prompt` đều vẽ được, và pha của run đổi thì dòng thời gian đổi.
 *
 * Không dùng @testing-library (dự án không có): raw `createRoot` + `act`, đúng khuôn
 * `ChatInputBar.test.tsx`.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import { useResearchStore } from '../../../store/researchStore'
import { readJob, RESEARCH_MODE_OFF } from '../../../lib/researchMode'
import { ResearchPromptCard } from './ResearchPromptCard'
import { ScopeCard } from './ScopeCard'
import { ResearchComposerStatus } from './ResearchComposerStatus'
import { ResearchConversationCards } from './ResearchConversationCards'
import { ResearchToggle } from './ResearchToggle'
import { RunTimeline } from './RunTimeline'
import { ResearchPanel } from '../ResearchPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

function click(host: HTMLElement, selector: string): void {
  const node = host.querySelector<HTMLButtonElement>(selector)
  if (!node) throw new Error(`không thấy ${selector}`)
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const scopePayload = {
  revision: 1,
  goal: { text: 'Data augmentation bằng diffusion cho ảnh y tế', status: 'assumed', source: { kind: 'agent' } },
  purpose: { text: '', status: 'assumed' },
  questions: [{ id: 'q1', text: 'Nhóm phương pháp dẫn đầu?', importance: 'high', status: 'unexplored' }],
  timePolicy: { velocity: 'fast', foundational: 'any', reason: '', status: 'assumed' },
  window: { velocity: 'fast', days: 630, start: '2025-01-01', end: '2026-09-25' },
  sourceKinds: [],
  exclusions: [{ text: 'Không dùng ảnh tự nhiên nói chung', status: 'confirmed', source: { kind: 'user' } }],
  outputs: ['Báo cáo cấu trúc + bảng so sánh'],
  depth: 'standard',
  tier: 2,
  budget: { proposedSeconds: 1680, hardCeilingSeconds: 1800, bigJob: false, approved: false },
  openQuestions: [
    { id: 'oq1', text: 'Bạn cần kết quả để chọn phương án hay bản đồ nghiên cứu?', blocking: true, affects: ['đầu ra'], answer: null, promptId: 'rp-interview' },
    { id: 'oq2', text: 'Phạm vi thời gian nào đúng?', blocking: true, affects: ['cửa sổ'], answer: null, promptId: 'rp-interview' },
  ],
}

const interviewPrompt = {
  promptId: 'rp-interview',
  researchId: 'R1',
  kind: 'interview',
  revision: 2,
  blocking: true,
  status: 'open',
  questions: [
    {
      id: 'oq1', text: 'Bạn cần kết quả để chọn phương án dùng ngay hay bản đồ nghiên cứu?', why: 'đổi hướng khảo sát',
      options: [{ id: 'o1', label: 'Chọn phương án dùng ngay' }, { id: 'o2', label: 'Bản đồ nghiên cứu' }],
      allowFreeText: true, affects: ['đầu ra'], required: true, blocking: true, answer: null,
    },
    {
      id: 'oq2', text: 'Phạm vi thời gian nào đúng với nhu cầu?', why: '',
      options: [{ id: 'o3', label: '24 tháng + nguồn nền tảng' }],
      allowFreeText: true, affects: ['cửa sổ'], required: true, blocking: true, answer: null,
    },
  ],
  actions: ['start', 'editScope'],
  note: '',
}

function jobPayload(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      research_id: 'R1', session_id: 's1', revision: 7, status: 'needs_user',
      phase: 'clarifying', background: false, usedSeconds: 754, budgetSeconds: 1800,
      state: {
        goal: 'Data augmentation bằng diffusion cho ảnh y tế', tier: 2, budgetSeconds: 1800,
        phase: 'clarifying', scope: scopePayload, prompts: [interviewPrompt],
        questions: [{ id: 'q1', text: 'Nhóm phương pháp dẫn đầu?', importance: 'high', status: 'unexplored' }],
        findings: [], blockedSources: [], methods: ['web_search', 'paper_citations'],
      },
      evidence: [], branches: [], dossier: null, reviews: [],
    },
    scope: scopePayload,
    prompts: [interviewPrompt],
    questions: [],
    findings: [],
    blockedSources: [],
    evidence: [],
    dossier: null,
    reviews: [],
    ...overrides,
  }
}

const listPayload = { jobs: [jobPayload().job] }

/** Router giả cho toàn bộ API research: ghi lại lời gọi, trả payload theo tuyến. */
function stubApi(overrides: { modeResponse?: () => Response } = {}) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    calls.push({ url: target, body })
    if (target.includes('/research-mode')) {
      if (overrides.modeResponse) return overrides.modeResponse()
      const on = Boolean(body?.on)
      if (!on && !body?.exitChoice) {
        return jsonResponse({
          error: 'Run đang chạy', code: 'RESEARCH_EXIT_CHOICE_REQUIRED',
          prompt: {
            promptId: 'rp-exit', researchId: 'R1', kind: 'exit-choice', revision: 3, status: 'open',
            questions: [{ id: 'exit', text: 'Bạn muốn run này thế nào?', allowFreeText: false, required: true, blocking: true,
              options: [{ id: 'pause', label: 'Tạm dừng run' }, { id: 'background', label: 'Tiếp tục chạy nền' }] }],
          },
        }, 409)
      }
      return jsonResponse({ mode: { on, activeRunId: 'R1', revision: 4 } })
    }
    if (target.includes('/research/jobs?sessionId=')) return jsonResponse(listPayload)
    if (target.includes('/research/jobs/R1')) return jsonResponse(jobPayload())
    if (target.includes('/research/prompts/')) return jsonResponse({ ok: true })
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

beforeEach(() => {
  useResearchStore.setState({
    sessionId: 's1',
    mode: { ...RESEARCH_MODE_OFF, on: true, activeRunId: 'R1', revision: 3 },
    jobs: [],
    detail: null,
    detailId: '',
    loading: false,
    error: null,
    lastEventSeq: 0,
    exitChoice: null,
  })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('luồng chế độ Research', () => {
  it('chạy trọn đường: bật → trả lời phỏng vấn một lần → sửa thẻ → tắt Tạm dừng → bật lại → tắt chạy nền → chỉ báo nền → thẻ báo cáo', async () => {
    const api = stubApi()
    // 1. Dải trạng thái khi chế độ đang bật, kèm nhãn run + bước.
    const strip = render(<ResearchComposerStatus />)
    expect(strip.querySelector('[data-testid="research-mode-strip"]')).toBeTruthy()
    act(() => { strip.remove() })

    // 2. Trả lời HAI câu của phỏng vấn trong MỘT lần gọi.
    const interview = render(<ResearchPromptCard prompt={interviewPrompt as never} />)
    const submit = interview.querySelector<HTMLButtonElement>('[data-testid="research-prompt-submit"]')
    expect(submit?.disabled).toBe(true) // còn câu chặn chưa trả lời thì nút Bắt đầu khoá
    click(interview, 'button[aria-pressed="false"]')
    const optionButtons = interview.querySelectorAll('button[aria-pressed]')
    act(() => { (optionButtons[optionButtons.length - 1] as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {
      interview.querySelector<HTMLButtonElement>('[data-testid="research-prompt-submit"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const answerCalls = api.calls.filter((call) => call.url.includes('/research/prompts/rp-interview/answer'))
    expect(answerCalls).toHaveLength(1)
    expect(answerCalls[0].body?.answers).toHaveLength(2)
    expect(answerCalls[0].body?.start).toBe(true)
    act(() => { interview.remove() })

    // 3. Sửa một dòng của thẻ phạm vi ⇒ PATCH kèm `revision` đang thấy.
    const scope = render(<ScopeCard job={readJob(jobPayload().job)} scope={{ ...scopePayload } as never} prompt={interviewPrompt as never} />)
    click(scope, '[data-testid="research-scope-edit"]')
    const input = scope.querySelector<HTMLInputElement>('input[aria-label]')!
    act(() => {
      input.value = '40'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      scope.querySelector<HTMLButtonElement>('[data-testid="research-scope-save"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const patchCalls = api.calls.filter((call) => call.body?.action === 'scope')
    expect(patchCalls).toHaveLength(1)
    expect(patchCalls[0].body?.revision).toBe(1)
    act(() => { scope.remove() })

    // 4. Tắt chế độ, run còn chạy ⇒ server đòi chọn; người dùng chọn "Tạm dừng".
    const toggle = render(<ResearchToggle />)
    await act(async () => {
      toggle.querySelector<HTMLButtonElement>('[data-testid="composer-research-toggle"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const exit = render(<ResearchComposerStatus />)
    expect(exit.querySelector('[data-testid="research-exit-prompt"]')).toBeTruthy()
    expect(useResearchStore.getState().mode.on).toBe(true) // mode chưa đổi khi chưa chọn
    await act(async () => {
      exit.querySelector<HTMLButtonElement>('[data-testid="research-exit-pause"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const pauseCall = api.calls.find((call) => call.body?.exitChoice === 'pause')
    expect(pauseCall).toBeTruthy()
    expect(useResearchStore.getState().mode.on).toBe(false)
    act(() => { exit.remove(); toggle.remove() })

    // 5. Bật lại rồi tắt chọn "Tiếp tục chạy nền".
    await act(async () => { await useResearchStore.getState().setMode(true, 'toggle') })
    expect(useResearchStore.getState().mode.on).toBe(true)
    await act(async () => { await useResearchStore.getState().setMode(false, 'toggle') })
    expect(useResearchStore.getState().exitChoice).not.toBeNull()
    await act(async () => { await useResearchStore.getState().resolveExit('background') })
    expect(api.calls.some((call) => call.body?.exitChoice === 'background')).toBe(true)

    // 6. Run chạy nền: chỉ báo nền hiện trong ô soạn tin.
    useResearchStore.setState({
      jobs: [{
        researchId: 'R1', sessionId: 's1', revision: 8, status: 'researching', phase: 'searching',
        origin: 'mode', background: true, scopeRevision: 2, usedSeconds: 900, remainingSeconds: 900,
        budgetSeconds: 1800, tier: 2, goal: 'g', output: '', methods: [], questions: [],
        findings: [], blockedSources: [], branches: [], evidence: [], dossier: null, reviews: [],
        coverage: { counts: {}, unexplored: [], facets: [] }, prompts: [], scope: null,
      }],
    })
    const background = render(<ResearchComposerStatus />)
    expect(background.querySelector('[data-testid="research-background-strip"]')).toBeTruthy()
    act(() => { background.remove() })

    // 7. Run xong ⇒ thẻ báo cáo trong hội thoại.
    const doneJob = {
      ...jobPayload().job,
      status: 'completed',
      state: { ...jobPayload().job.state, background: true, prompts: [] },
      prompts: [],
      dossier: { relative_path: '.research/diffusion-med-imaging-20260925-0942/v3-8f21c4.md', version: 3, gate: 'pass', critique: 'accept-with-conditions' },
      reviews: [{ version: 1, mode: 'critique', verdict: 'revise' }, { version: 2, mode: 'critique', verdict: 'accept-with-conditions' }],
      evidence: [{ rowId: 'S12', claim: 'Bước lọc mẫu quan trọng hơn kích thước mô hình', url: 'https://x', accessLevel: 'fulltext', relation: 'supports', confidence: 'high' }],
    }
    useResearchStore.setState({ jobs: [readJob(doneJob)] })
    const cards = render(<ResearchConversationCards suggest={null} />)
    const report = cards.querySelector('[data-testid="research-report-card"]')
    expect(report).toBeTruthy()
    expect(cards.textContent).toContain('.research/diffusion-med-imaging-20260925-0942/v3-8f21c4.md')
    expect(report?.getAttribute('data-background')).toBe('true')
    act(() => { cards.remove() })
  })

  it('mỗi `kind` của research_prompt vẽ được; exit-choice chỉ có hai lựa chọn, không mặc định', () => {
    for (const kind of ['interview', 'scope-change', 'budget', 'out-of-scope'] as const) {
      const host = render(<ResearchPromptCard prompt={{ ...interviewPrompt, kind } as never} />)
      expect(host.querySelector(`[data-testid="research-prompt-card"][data-kind="${kind}"]`)).toBeTruthy()
      act(() => { host.remove() })
    }
    const exit = render(<ResearchPromptCard prompt={{
      promptId: 'rp-exit', researchId: 'R1', kind: 'exit-choice', revision: 3, status: 'open', blocking: false,
      questions: [{ id: 'exit', text: 'Bạn muốn run này thế nào?', allowFreeText: false, required: true, blocking: true,
        options: [{ id: 'pause', label: 'Tạm dừng run' }, { id: 'background', label: 'Tiếp tục chạy nền' }] }],
      actions: ['chooseExit'], note: '',
    } as never} />)
    expect(exit.querySelector('[data-testid="research-prompt-card"]')?.getAttribute('data-kind')).toBe('exit-choice')
    expect(exit.querySelectorAll('button[data-testid^="research-exit-"]').length).toBe(0)
    expect(exit.textContent).toContain('Tạm dừng run')
    expect(exit.textContent).toContain('Tiếp tục chạy nền')
    expect(exit.textContent).not.toMatch(/mặc định.*đã chọn/i)
  })


  it('tab Research đọc từ store và KHÔNG tự hỏi mạng (đã bỏ vòng 5000 ms)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(jobPayload()))
    vi.stubGlobal('fetch', fetchMock)
    useResearchStore.setState({ jobs: [readJob(jobPayload().job)] })
    const host = render(<ResearchPanel />)
    // Sáu mục của `research-panel.html`.
    for (const tab of ['scope', 'plan', 'sources', 'claims', 'review', 'report']) {
      expect(host.querySelector(`[data-testid="research-tab-${tab}"]`)).toBeTruthy()
    }
    // Chờ quá một "chu kỳ" của vòng hỏi cũ: nếu còn `setInterval(…, 5000)` thì đã có lời gọi.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
    expect(fetchMock).not.toHaveBeenCalled()
    act(() => { host.remove() })
  })

  it('run chạy nền hiện dòng riêng ở tab Research khi mode đã tắt', async () => {
    useResearchStore.setState({
      sessionId: 's1',
      mode: { ...RESEARCH_MODE_OFF, on: false, activeRunId: '' },
      jobs: [readJob({ ...jobPayload().job, status: 'researching', phase: 'searching', background: true })],
    })
    const host = render(<ResearchPanel />)
    expect(host.querySelector('[data-testid="research-background-line"]')).toBeTruthy()
    act(() => { host.remove() })
  })

  it('dòng thời gian đổi theo pha của run', () => {
    const searching = render(<RunTimeline job={readJob({ ...jobPayload().job, status: 'researching', phase: 'searching' })} />)
    const active = searching.querySelector('[data-step="search"]')
    expect(active?.getAttribute('data-active')).toBe('true')
    act(() => { searching.remove() })
    const done = render(<RunTimeline job={readJob({ ...jobPayload().job, status: 'completed', phase: 'completed' })} />)
    expect(done.querySelector('[data-step="done"]')?.getAttribute('data-active')).toBe('true')
    act(() => { done.remove() })
  })
})
