/**
 * PlanPanel — bỏ dữ liệu giả, nối vào dữ liệu thật.
 *
 * Ba đường phải khoá:
 *
 * 1. manifest → dropdown version + nội dung file trong sandbox (không còn danh sách bịa);
 * 2. sổ duyệt của harness → chip trạng thái + dải quyết định (nhãn cũ gán "approved" theo vị trí
 *    trong dropdown, còn `.reviews/` thì rỗng — xem `usePlanFiles.review.test.tsx`);
 * 3. bản chấm P1–P8 → thẻ checklist, và bản bị cổng cứng chặn phải hiện `written: false` +
 *    `gatesFailed` (KHÔNG suy từ `hardGate`, vì `true` nghĩa là mọi cổng đều đạt).
 *
 * `I18nProvider` mặc định tiếng Anh, nên câu chữ dưới đây là bản `en`; khoá `vi` có song song
 * (TypeScript ép hai từ điển cùng shape).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useHarnessChatStore } from '../../store/harnessChatStore'
import { useUiStore } from '../../store/uiStore'
import { PlanPanel } from './PlanPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
const fetchMock = vi.fn()

type ReviewRecord = { identity: string; decision: string; note: string; updatedAt: number }

function planRecord(
  identity: string,
  versions: number[],
  review: ReviewRecord | null = null,
  headers: Record<number, Record<string, unknown>> = {},
) {
  return {
    identity,
    relativeDirectory: '',
    slug: identity,
    versions: versions.map((version) => ({
      version,
      label: `v${version}`,
      relativePath: `v${version}-${identity}.md`,
      sizeBytes: 120 * version,
      modifiedAt: '2026-08-27T00:00:00Z',
      ...(headers[version] ?? {}),
    })),
    review,
  }
}

/** Hàng sổ duyệt thật (`GET /api/agent/plans/status`), mặc định: chưa ai quyết định gì. */
function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    identity: 'agent-box-plan',
    version: 3,
    state: 'draft',
    stateVersion: 3,
    review: null,
    reviewStale: false,
    indexAvailable: true,
    evaluation: null,
    // Cổng duyệt harness đang chạy. Ca cần `warn`/`off` thì tự khai; bỏ HẲN khoá này = harness cũ,
    // mà hành vi cũ của nó là `enforce` — nên phép thử "thiếu khoá" vẫn phải khoá nút.
    gate: { verifyMode: 'enforce', verifyUnknown: null, sourcesMode: 'enforce', sourcesUnknown: null },
    ...overrides,
  }
}

/** Phiên ở thanh bên — chỉ đủ trường để `useAgentStore.sessions` dùng được trong ca M9. */
function sessionSummary(sessionId: string) {
  return {
    session_id: sessionId,
    initials: sessionId.slice(0, 2).toUpperCase(),
    title: sessionId,
    relative_time: 'vừa xong',
    status: 'idle' as const,
    mode: 'PLAN' as const,
    active_lease_count: 0,
  }
}

const APPROVED_EVALUATION = {
  identity: 'agent-box-plan',
  version: 3,
  parentVersion: 2,
  written: true,
  rubric: 'P1-P8/1',
  levels: { P1: 2, P2: 2, P3: 2, P4: 2, P5: 2, P6: 2, P7: 1, P8: 1 },
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
  evidence: [],
  warnings: [],
  evaluatedAt: '2026-09-20T20:56:00Z',
}

/** Ca sống: bản 306 KB bị `plan-too-long` chặn, P2/P4/P7 đều 0. */
const BLOCKED_EVALUATION = {
  identity: 'agent-box-plan',
  version: 3,
  parentVersion: 2,
  written: false,
  rubric: 'P1-P8/1',
  levels: { P1: 1, P2: 0, P3: 2, P4: 0, P5: 2, P6: 2, P7: 0, P8: 2 },
  layer: { P1: 'oracle', P5: 'oracle' },
  total: 9,
  maxTotal: 16,
  hardGate: false,
  gatesFailed: ['P2', 'P4', 'P7'],
  verdict: 'fail',
  rejected: 'plan-too-long',
  measures: { chars: 306_721, repetition: 0.02, steps: 5, stepsAnchored: 0, externalFacts: 0, externalFactsSourced: 0 },
  evidence: [{ code: 'P2', excerpt: 'thân bài không nhắc v2' }],
  warnings: [],
  evaluatedAt: '2026-09-21T23:52:00Z',
}

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload }
}

/** fetch giả theo đúng hai endpoint đọc của box, một endpoint đọc và một endpoint ghi của harness. */
function installPlanFetch(
  options: {
    review?: ReviewRecord | null
    reviewFails?: boolean
    /** Payload trạng thái ban đầu. */
    status?: Record<string, unknown>
    /** Payload trạng thái sau khi ghi quyết định thành công. */
    statusAfterReview?: Record<string, unknown>
    /** Làm hỏng đường đọc sổ duyệt (thiếu quyền 403, mất mạng…). */
    statusFails?: { error: string; code?: string; status: number }
    reviewForwarded?: boolean
    /** Trả 409 `blocked: true` cho lần ghi quyết định (harness chặn duyệt bản chưa phản biện). */
    reviewBlocked?: { reason: string; remedy: string }
    /** `resumed`/`turnId` harness khai ở lần ghi thành công; `null` = harness cũ không khai. */
    reviewResumed?: boolean | null
    reviewTurnId?: string | null
    /** `wake` harness kể lại chuyện mở lượt (`opened|busy|duplicate|missing|failed`). */
    reviewWake?: Record<string, unknown> | null
    /** `approvalWarning` của cổng `warn`: harness cho qua một bản chưa đạt phản biện. */
    approvalWarning?: string | null
    /** Làm hỏng đường nhờ harness mở phiên phản biện. */
    verifyFails?: { error: string; code?: string; status: number }
    /** Thân trả về của `POST /api/agent/plans/verify`. */
    verify?: Record<string, unknown>
    /** Trạng thái sổ phản biện sau khi phiên phản biện được nhờ chạy. */
    statusAfterVerify?: Record<string, unknown>
    /** Thay payload `GET /__box/plans` (dùng cho ca header cha–con). */
    plans?: unknown
  } = {},
) {
  let current = options.status ?? statusPayload()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const target = String(url)
    if (target.endsWith('/__box/plans')) {
      return jsonResponse(
        options.plans ?? {
          plans: [planRecord('agent-box-plan', [3, 2, 1], options.review ?? null)],
          ignoredCount: 0,
          warnings: [],
        },
      )
    }
    if (target.includes('/__box/plans/content')) {
      const version = Number(new URLSearchParams(target.split('?')[1]).get('version'))
      return jsonResponse({
        identity: 'agent-box-plan',
        version,
        label: `v${version}`,
        relativePath: `v${version}-agent-box-plan.md`,
        markdown: `# Kế hoạch v${version}`,
        sizeBytes: 120 * version,
        modifiedAt: '2026-08-27T00:00:00Z',
      })
    }
    if (target.startsWith('/api/agent/plans/status')) {
      if (options.statusFails) {
        return jsonResponse(
          { error: options.statusFails.error, code: options.statusFails.code },
          false,
          options.statusFails.status,
        )
      }
      return jsonResponse(current)
    }
    if (target === '/api/agent/plans/verify' && init?.method === 'POST') {
      if (options.verifyFails) {
        return jsonResponse(
          { error: options.verifyFails.error, code: options.verifyFails.code },
          false,
          options.verifyFails.status,
        )
      }
      if (options.statusAfterVerify) current = options.statusAfterVerify
      return jsonResponse(options.verify ?? { recorded: false, resumed: true, turnId: '9' })
    }
    if (target === '/api/agent/plans/review' && init?.method === 'POST') {
      if (options.statusAfterReview) current = options.statusAfterReview
      if (options.reviewFails) {
        return jsonResponse({ error: 'unknown plan identity' }, false, 404)
      }
      if (options.reviewBlocked) {
        return jsonResponse(
          { blocked: true, code: 'PLAN_APPROVAL_UNVERIFIED', ...options.reviewBlocked },
          false,
          409,
        )
      }
      const body = JSON.parse(String(init.body)) as ReviewRecord
      return jsonResponse({
        ...body,
        forwarded: options.reviewForwarded ?? true,
        recorded: true,
        resumed: options.reviewResumed === undefined ? true : options.reviewResumed,
        turnId: options.reviewTurnId === undefined ? '7' : options.reviewTurnId,
        ...(options.reviewWake ? { wake: options.reviewWake } : {}),
        ...(options.approvalWarning ? { approvalWarning: options.approvalWarning } : {}),
        review: { ...body, source: 'plan-tab', decidedAt: 1_758_300_000 },
      })
    }
    throw new Error(`Unexpected fetch: ${target}`)
  })
}

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

function click(el: Element | null) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** React gắn onChange trên setter gốc của DOM nên phải gọi qua setter gốc thì `onChange` mới chạy. */
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    nativeSetter.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Hai mặt phản biện dùng lại nhiều lần: chưa phiên nào đọc, và đã đọc xong không lỗi. */
const NONE_VERIFICATION = { state: 'none', at: null, criticSessionId: null, issues: [] }
const OK_VERIFICATION = { state: 'ok', at: '2026-09-23T03:12:00Z', criticSessionId: 'critic-1', issues: [] }

function reviewBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/agent/plans/review')
  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body ?? '{}')) as Record<string, unknown>
}

function reviewRequested(): boolean {
  return fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/plans/review')
}

/** Đủ nhịp vi nhỏ cho chuỗi list → read → status (và cho lượt ghi quyết định). */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
  })
}

function text(host: HTMLElement, testId: string): string {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  installPlanFetch()
  useAgentStore.setState({
    mode: 'PLAN',
    planWorkspace: null,
    planEndorsed: null,
    proposal: null,
    activeSessionId: '',
    sessions: [],
  })
  useHarnessChatStore.setState({ sessions: {} })
  useUiStore.setState({ planRevision: 0, tabIntentTargets: {}, planViewMode: 'plan', planSubTab: 'overview' })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('PlanPanel — kế hoạch thật (§2 + đợt 2)', () => {
  it('dropdown version chỉ lấy từ manifest, không còn danh sách bịa', async () => {
    const host = render(<PlanPanel />)
    await flush()

    const versionToggle = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('v3'),
    )
    expect(versionToggle).toBeTruthy()
    expect(versionToggle?.textContent).toContain('v3')
    // Khung Overview hiện metadata thật của file trong sandbox.
    expect(host.textContent).toContain('.plans/v3-agent-box-plan.md')

    click(versionToggle ?? null)
    expect(host.textContent).toContain('v2')
    expect(host.textContent).toContain('v1')
    // Không còn nhãn "(latest)" do giao diện tự gắn.
    expect(host.textContent).not.toContain('(latest)')
  })

  it('nút Duyệt ghi xuống SỔ HARNESS kèm số version rồi phản ánh lại từ đó', async () => {
    installPlanFetch({
      statusAfterReview: statusPayload({
        state: 'approved',
        review: {
          identity: 'agent-box-plan',
          version: 3,
          decision: 'approved',
          note: '',
          source: 'plan-tab',
          decidedAt: 1_758_300_000,
        },
      }),
    })
    const host = render(<PlanPanel />)
    await flush()
    // Trước khi duyệt: chip nói đúng sự thật của sổ duyệt, không theo vị trí trong dropdown.
    expect(text(host, 'plan-state-chip')).toContain('Not approved')

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    const reviewCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === '/api/agent/plans/review' && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(reviewCall).toBeTruthy()
    expect(JSON.parse(String((reviewCall?.[1] as RequestInit).body))).toEqual({
      identity: 'agent-box-plan',
      version: 3,
      decision: 'approved',
      note: '',
    })
    expect(text(host, 'plan-state-chip')).toContain('Approved')
    expect(text(host, 'plan-review-strip')).toContain('The decision is stored in the harness review book.')
    expect(host.querySelector('[data-testid="plan-review-error"]')).toBeNull()
  })

  it('nút Yêu cầu sửa mở hộp lý do rồi gửi `changes_requested` KÈM lý do', async () => {
    const host = render(<PlanPanel />)
    await flush()

    // Lần bấm đầu KHÔNG gửi gì: mở hộp lý do (BUG-3 — trước đây gửi đi một quyết định rỗng chữ).
    click(host.querySelector('[data-testid="plan-request-changes"]'))
    await flush()
    expect(reviewRequested()).toBe(false)
    expect(text(host, 'plan-changes-form')).toContain('Reason for changes — sent straight into the next turn')
    expect(text(host, 'plan-changes-form')).toContain('version under review: v3')

    typeInto(host.querySelector('[data-testid="plan-changes-note"]') as HTMLTextAreaElement, 'tách M3 thành hai bước')
    click(host.querySelector('[data-testid="plan-changes-submit"]'))
    await flush()

    expect(reviewBody()).toEqual({
      identity: 'agent-box-plan',
      version: 3,
      decision: 'changes_requested',
      note: 'tách M3 thành hai bước',
    })
    expect(host.querySelector('[data-testid="plan-changes-form"]')).toBeNull()
    expect(text(host, 'plan-decision-sent')).toContain('the agent is opening the plan-fix turn for v3')
  })

  it('route ghi 404 thì hiện dải lỗi thật, không giả vờ đã duyệt', async () => {
    installPlanFetch({ reviewFails: true })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    const strip = host.querySelector('[data-testid="plan-review-error"]')
    expect(strip).toBeTruthy()
    expect(strip?.textContent).toContain('unknown plan identity')
    expect(text(host, 'plan-state-chip')).toContain('Not approved')
  })

  it('harness nhận quyết định nhưng chưa chuyển được sang box thì nói thẳng ra', async () => {
    installPlanFetch({ reviewForwarded: false })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    expect(text(host, 'plan-review-not-forwarded')).toContain(
      'was NOT forwarded to the sandbox',
    )
  })

  it('bản đã duyệt: thẻ checklist đủ 8 chiều + tổng điểm + verdict', async () => {
    installPlanFetch({
      status: statusPayload({
        state: 'approved',
        review: {
          identity: 'agent-box-plan',
          version: 3,
          decision: 'approved',
          note: '',
          source: 'plan-tab',
          decidedAt: 1_758_300_000,
        },
        evaluation: APPROVED_EVALUATION,
      }),
    })
    const host = render(<PlanPanel />)
    await flush()

    expect(host.querySelector('[data-testid="plan-eval-card"]')).toBeTruthy()
    for (let index = 1; index <= 8; index += 1) {
      expect(host.querySelector(`[data-testid="plan-eval-p${index}"]`)).toBeTruthy()
    }
    // Mỗi chiều có nhãn + mức + số đo, không phải chỉ một con số tổng.
    expect(text(host, 'plan-eval-p1')).toContain('Version header')
    expect(text(host, 'plan-eval-p1')).toContain('2/2')
    expect(text(host, 'plan-eval-p1')).toContain('versionHeader · header matches the file name')
    expect(text(host, 'plan-eval-p4')).toContain('5/5 steps with command + expected result')
    expect(text(host, 'plan-eval-p7')).toContain('5.120 characters')
    expect(text(host, 'plan-verdict-chip')).toBe('Pass')
    expect(text(host, 'plan-eval-card')).toContain('14/16 · P1-P8/1')
    expect(text(host, 'plan-eval-card')).toContain('Note keywords: 2/7 echoed back')
    // Chuỗi cha–con của bản đang xem lấy từ chính bản chấm.
    expect(host.textContent).toContain('Previous version:')
    expect(host.textContent).toContain('v2')
    expect(host.querySelector('[data-testid="plan-eval-measures"]')).toBeNull()
  })

  it('cổng cứng chặn: `written: false` + `gatesFailed`, không mượn `hardGate` để kết luận', async () => {
    installPlanFetch({ status: statusPayload({ state: 'submitted', evaluation: BLOCKED_EVALUATION }) })
    const host = render(<PlanPanel />)
    await flush()

    const strip = host.querySelector('[data-testid="plan-eval-rejected"]')
    expect(strip).toBeTruthy()
    // Thông báo từ chối chỉ hiện đúng một lần, kèm số đo thật và cách sửa.
    expect(host.querySelectorAll('[data-testid="plan-eval-rejected"]')).toHaveLength(1)
    expect(strip?.textContent).toContain('v3 was not written')
    expect(strip?.textContent).toContain('PLAN_EVAL_REJECTED: (plan-too-long)')
    expect(strip?.textContent).toContain('306.721 characters > 150.000')
    expect(strip?.textContent).toContain('split into a summary')

    expect(text(host, 'plan-verdict-chip')).toBe('Fail')
    const measures = host.querySelector('[data-testid="plan-eval-measures"]')
    expect(measures?.textContent).toContain('written: false')
    expect(measures?.textContent).toContain('gatesFailed: P2, P4, P7')
    // `hardGate: false` là giá trị thật của payload (true = MỌI cổng đều đạt), không phải cờ "bị chặn".
    expect(measures?.textContent).toContain('hardGate: false')
    expect(text(host, 'plan-eval-card')).toContain('Not written')
  })

  it('`reviewStale: true`: chip "Stale" cạnh nhãn "Approved" và nút Duyệt trở về nhãn trung tính', async () => {
    installPlanFetch({
      status: statusPayload({
        state: 'approved',
        reviewStale: true,
        review: {
          identity: 'agent-box-plan',
          version: 3,
          decision: 'approved',
          note: '',
          source: 'plan-tab',
          decidedAt: 1_758_300_000,
        },
      }),
    })
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-state-chip')).toContain('Approved')
    expect(text(host, 'plan-state-stale')).toBe('Stale')
    expect(text(host, 'plan-review-stale')).toContain('the endorsement no longer applies')
    // Chuẩn thuận cũ không còn hiệu lực nên nút không được nói "đã lưu".
    expect(text(host, 'plan-approve')).toContain('Approve plan')
    expect(text(host, 'plan-approve')).not.toContain('Approved (saved)')
  })

  it('chỉ mục box không đọc được: `unknown` + dòng nhắc, không hiện điểm ảo', async () => {
    installPlanFetch({
      status: statusPayload({ state: 'unknown', indexAvailable: false, stateVersion: null }),
    })
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-state-chip')).toContain('Unreadable')
    expect(host.querySelector('[data-testid="plan-eval-unavailable"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="plan-eval-card"]')).toBeNull()
    expect(host.querySelector('[data-testid="plan-eval-p1"]')).toBeNull()
    expect(host.textContent).not.toContain('/16')
  })

  it('bản cũ chưa từng được chấm: một dòng nhắc mờ + chip `legacy`, không khung rỗng', async () => {
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-eval-empty')).toContain('no P1–P8 evaluation')
    expect(text(host, 'plan-eval-empty')).toContain('legacy')
    expect(host.querySelector('[data-testid="plan-eval-card"]')).toBeNull()
    expect(host.querySelector('[data-testid="plan-eval-p1"]')).toBeNull()
  })

  it('thiếu quyền đọc sổ duyệt: dải cảnh báo cũ, không rơi về nhãn "đã duyệt"', async () => {
    installPlanFetch({ statusFails: { error: 'admin header required', code: 'FORBIDDEN', status: 403 } })
    const host = render(<PlanPanel />)
    await flush()

    const strip = host.querySelector('[data-testid="plan-status-error"]')
    expect(strip).toBeTruthy()
    expect(strip?.textContent).toContain('Could not read the harness review book')
    expect(strip?.textContent).toContain('FORBIDDEN: admin header required')
    expect(text(host, 'plan-state-chip')).toContain('Unreadable')
  })

  it('ý định mở tab chỉ đích danh version thì chọn đúng version đó', async () => {
    const host = render(<PlanPanel />)
    await flush()

    await act(async () => {
      useUiStore.getState().openTab('plan', { identity: 'agent-box-plan', version: 1 })
    })
    await flush()

    expect(host.textContent).toContain('.plans/v1-agent-box-plan.md')
    click(Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Detailed Plan')) ?? null)
    expect(host.textContent).toContain('Kế hoạch v1')
    const contentCall = fetchMock.mock.calls.find(
      ([url]) => String(url).includes('/__box/plans/content') && String(url).includes('version=1'),
    )
    expect(contentCall).toBeTruthy()
  })

  it('`planRevision` tăng khi agent ghi kế hoạch → tải lại manifest', async () => {
    const host = render(<PlanPanel />)
    await flush()
    const listCallsBefore = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/__box/plans')).length

    await act(async () => {
      useUiStore.getState().bumpPlanRevision()
    })
    await flush()

    const listCallsAfter = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/__box/plans')).length
    expect(listCallsAfter).toBeGreaterThan(listCallsBefore)
    expect(host.textContent).toContain('.plans/v3-agent-box-plan.md')
  })

  /**
   * Trạng thái (f) của mock f20: chuỗi cha–con đọc từ **header của file**, không phải từ bản chấm
   * P1–P8. Mọi bản hôm nay đều `evaluation: null` (bản chấm chưa nối vào đường ghi), nên nếu dòng
   * `Bản trước:` chỉ phụ thuộc `evaluation.parentVersion` thì nó vĩnh viễn không hiện.
   */
  it('dòng “Bản trước:” lấy từ header file khi bản đó chưa có bản chấm P1–P8', async () => {
    installPlanFetch({
      plans: {
        plans: [
          planRecord('agent-box-plan', [2, 1], null, {
            2: { headerStatus: 'ok', headerVersion: 2, declaredParent: 1, declaredSlug: 'agent-box-plan' },
            1: { headerStatus: 'ok', headerVersion: 1, declaredParent: null, declaredSlug: 'agent-box-plan' },
          }),
        ],
        ignoredCount: 0,
        warnings: [],
      },
    })
    const host = render(<PlanPanel />)
    await flush()

    expect(host.textContent).toContain('Previous version:')
    expect(host.textContent).toContain('v1')
    expect(text(host, 'plan-eval-empty')).toContain('no P1–P8 evaluation')
  })

  it('hàng dropdown hiện “Parent” của chính version đó: v2 → v1, bản gốc → none', async () => {
    installPlanFetch({
      plans: {
        plans: [
          planRecord('agent-box-plan', [2, 1], null, {
            2: { headerStatus: 'ok', headerVersion: 2, declaredParent: 1, declaredSlug: 'agent-box-plan' },
            1: { headerStatus: 'ok', headerVersion: 1, declaredParent: null, declaredSlug: 'agent-box-plan' },
          }),
        ],
        ignoredCount: 0,
        warnings: [],
      },
    })
    const host = render(<PlanPanel />)
    await flush()

    const versionToggle = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('v2'),
    )
    click(versionToggle ?? null)
    await flush()

    const rows = Array.from(host.querySelectorAll('button')).map((button) => button.textContent ?? '')
    expect(rows.some((row) => row.includes('Parent: v1'))).toBe(true)
    expect(rows.some((row) => row.includes('Parent: none'))).toBe(true)
  })

  it('file legacy không có header thì KHÔNG hiện dòng cha–con (không đoán `Parent: none`)', async () => {
    installPlanFetch({
      plans: {
        plans: [planRecord('agent-box-plan', [2, 1])],
        ignoredCount: 0,
        warnings: [],
      },
    })
    const host = render(<PlanPanel />)
    await flush()

    const versionToggle = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('v2'),
    )
    click(versionToggle ?? null)
    await flush()

    expect(host.textContent).not.toContain('Parent:')
    expect(host.textContent).not.toContain('Previous version:')
  })

  it('container chưa có kế hoạch nào thì hiện trạng thái rỗng thật, không bịa version', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/__box/plans')) {
        return jsonResponse({ plans: [], ignoredCount: 0, warnings: [] })
      }
      throw new Error(`Unexpected fetch: ${String(url)}`)
    })
    const host = render(<PlanPanel />)
    await flush()

    expect(host.querySelector('[data-testid="plan-empty"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="plan-approve"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="plan-state-chip"]')).toBeNull()
    expect(host.textContent).not.toContain('v3 (latest)')
  })
})

describe('PlanPanel — vòng 25: chưa phản biện thì chưa duyệt được (§vòng 25)', () => {
  it('`state = none`: chip vàng, nút Duyệt khoá kèm lý do, bấm cũng không gửi gì', async () => {
    installPlanFetch({ status: statusPayload({ verification: NONE_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-review-chip')).toBe('Not reviewed')
    const approve = host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.getAttribute('data-disabled-reason')).toBe('plan-not-reviewed')
    expect(approve.getAttribute('aria-label')).toBe('Approve plan — locked')
    expect(approve.getAttribute('aria-describedby')).toBe('plan-approve-blocked')
    expect(text(host, 'plan-approve-blocked')).toContain(
      'A plan-review session must review version v3 before you approve',
    )
    expect(text(host, 'plan-review-card')).toMatch(/no review session has read version v3 yet/u)

    // Bấm được bằng đường khác (bàn phím, script) cũng không có gì đi ra mạng.
    click(approve)
    await flush()
    expect(reviewRequested()).toBe(false)
  })

  it('`state = ok`: chip xanh, nút Duyệt mở, thẻ phản biện đứng ĐẦU cột Overview', async () => {
    installPlanFetch({ status: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-review-chip')).toContain('Reviewed · plan-review')
    expect((host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement).disabled).toBe(false)
    expect(host.querySelector('[data-testid="plan-approve-blocked"]')).toBeNull()

    const body = host.textContent ?? ''
    expect(body.indexOf('Independent review')).toBeGreaterThan(-1)
    expect(body.indexOf('Independent review')).toBeLessThan(body.indexOf('Plan Metadata & Status'))
  })

  it('`state = revise`: chip đỏ + từng lỗi một hàng, chữ lỗi nguyên văn harness', async () => {
    installPlanFetch({
      status: statusPayload({
        verification: {
          state: 'revise',
          at: '2026-09-23T03:12:00Z',
          criticSessionId: 'critic-2',
          issues: [
            { severity: 'high', text: 'M3 gộp hai việc vào một bước.', fix: 'Tách M3a và M3b.', code: 'step-not-measurable' },
            { severity: 'low', text: 'M8 không nói chạy trong conda env nào.' },
          ],
        },
      }),
    })
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-review-chip')).toBe('Needs changes')
    const rows = Array.from(host.querySelectorAll('[data-testid^="plan-review-finding-"]'))
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('M3 gộp hai việc vào một bước.')
    expect(rows[0].textContent).toContain('step-not-measurable')
    expect(rows[1].textContent).toContain('M8 không nói chạy trong conda env nào.')

    // Cổng mặc định `enforce`: verdict `revise` thì harness từ chối duyệt, nên nút bị KHOÁ kèm lý do
    // nói rõ verdict + hai cách gỡ — giao diện không mời một cú bấm mà nó biết chắc sẽ hỏng.
    const approve = host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.getAttribute('data-disabled-reason')).toBe('plan-not-reviewed')
    const reason = text(host, 'plan-approve-blocked')
    expect(reason).toContain('verdict: revise')
    expect(reason).toContain('v3')
    expect(reason).toContain('plan-review')
    expect(reason).toContain('send a change request')

    // Bấm được bằng đường khác cũng không đi đâu: không có cú ghi nào được gửi.
    click(approve)
    await flush()
    expect(reviewRequested()).toBe(false)
  })

  it('harness cũ thiếu hẳn `verification`: không chip, không dòng khoá, nút Duyệt vẫn bật', async () => {
    installPlanFetch()
    const host = render(<PlanPanel />)
    await flush()

    expect(host.querySelector('[data-testid="plan-review-chip"]')).toBeNull()
    expect(host.querySelector('[data-testid="plan-approve-blocked"]')).toBeNull()
    expect((host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement).disabled).toBe(false)
    expect(text(host, 'plan-review-card')).toMatch(/could not be read, so whether this version has been reviewed is unknown/u)
  })

  it('nút `plan-review-run` nhờ harness mở phiên phản biện rồi đọc lại sổ', async () => {
    installPlanFetch({ status: statusPayload({ verification: NONE_VERIFICATION }), statusAfterVerify: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-review-run"]'))
    await flush()

    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/agent/plans/verify')
    expect(call).toBeTruthy()
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ identity: 'agent-box-plan', version: 3 })
    // Mặt phản biện chỉ đổi khi SỔ đổi, không suy từ thân trả về của lệnh chạy.
    expect(text(host, 'plan-review-chip')).toContain('Reviewed · plan-review')
    expect((host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('Duyệt kèm điều kiện: một mũi tên mở popup, ô trống vẫn là duyệt thường', async () => {
    installPlanFetch({ status: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    expect(host.querySelector('[data-testid="plan-approve-note-popover"]')).toBeNull()
    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    expect(text(host, 'plan-approve-note-popover')).toContain(
      'travels with the next turn as an attached requirement',
    )

    // Huỷ: không gửi gì cả.
    click(host.querySelector('[data-testid="plan-approve-note-cancel"]'))
    await flush()
    expect(host.querySelector('[data-testid="plan-approve-note-popover"]')).toBeNull()
    expect(reviewRequested()).toBe(false)

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    click(host.querySelector('[data-testid="plan-approve-with-note"]'))
    await flush()

    expect(reviewBody()).toEqual({ identity: 'agent-box-plan', version: 3, decision: 'approved', note: '' })
    expect(host.querySelector('[data-testid="plan-approve-note-popover"]')).toBeNull()
  })

  it('Duyệt kèm điều kiện có chữ: điều kiện đi nguyên văn vào `note`', async () => {
    installPlanFetch({ status: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    typeInto(
      host.querySelector('[data-testid="plan-approve-note"]') as HTMLTextAreaElement,
      'M8 chỉ xong khi chạy trong conda activate ld',
    )
    click(host.querySelector('[data-testid="plan-approve-with-note"]'))
    await flush()

    expect(reviewBody()).toEqual({
      identity: 'agent-box-plan',
      version: 3,
      decision: 'approved',
      note: 'M8 chỉ xong khi chạy trong conda activate ld',
    })
    expect(text(host, 'plan-decision-sent')).toContain('the condition goes into the review ledger')
  })

  it('hộp lý do để trống vẫn gửi được: lượt sửa vẫn mở, chỉ là không có lý do', async () => {
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-request-changes"]'))
    click(host.querySelector('[data-testid="plan-changes-submit"]'))
    await flush()

    expect(reviewBody()).toMatchObject({ decision: 'changes_requested', note: '' })
    // Lượt sửa vẫn mở dù lý do trống — đúng ý chốt "ô trống không chặn quyết định".
    expect(text(host, 'plan-decision-sent')).toContain('the agent is opening the plan-fix turn for v3')
  })

  it('huỷ hộp lý do: không gửi quyết định nào', async () => {
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-request-changes"]'))
    click(host.querySelector('[data-testid="plan-changes-cancel"]'))
    await flush()

    expect(reviewRequested()).toBe(false)
    expect(host.querySelector('[data-testid="plan-changes-form"]')).toBeNull()
  })

  it('409 `blocked: true`: dải đỏ giữ NGUYÊN VĂN code/reason/remedy và nút Duyệt lại bị khoá', async () => {
    installPlanFetch({
      status: statusPayload(),
      statusAfterReview: statusPayload({ verification: NONE_VERIFICATION }),
      reviewBlocked: {
        reason: 'Bản v3 chưa có phiên phản biện nào đọc.',
        remedy: 'Chạy phiên plan-review cho bản v3 rồi duyệt lại.',
      },
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    const strip = text(host, 'plan-review-blocked')
    expect(strip).toContain('Harness blocked the approval')
    expect(strip).toContain('PLAN_APPROVAL_UNVERIFIED')
    expect(strip).toContain('Bản v3 chưa có phiên phản biện nào đọc.')
    expect(strip).toContain('Chạy phiên plan-review cho bản v3 rồi duyệt lại.')
    // Dòng dưới nút lấy nguyên văn `remedy` của harness, không dịch lại.
    expect(text(host, 'plan-approve-blocked')).toBe('Chạy phiên plan-review cho bản v3 rồi duyệt lại.')
    expect((host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('[data-testid="plan-review-error"]')).toBeNull()
  })

  it('`resumed: false`: dòng kết quả nói thật là chưa mở được lượt nào', async () => {
    installPlanFetch({
      statusAfterReview: statusPayload({
        state: 'approved',
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', note: '', source: 'plan-tab', decidedAt: 1_758_300_000 },
      }),
      reviewResumed: false,
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    expect(text(host, 'plan-decision-sent')).toContain('no new turn was opened')
  })

  it('thiếu `resumed` (harness cũ): câu trung tính, không hứa đã mở lượt', async () => {
    installPlanFetch({
      statusAfterReview: statusPayload({
        state: 'approved',
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', note: '', source: 'plan-tab', decidedAt: 1_758_300_000 },
      }),
      reviewResumed: null,
      reviewTurnId: null,
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    expect(text(host, 'plan-decision-sent')).toContain('did not say whether a turn was opened')
  })

  it('nhãn version bỏ chữ trạng thái gán theo vị trí của box (BUG-5)', async () => {
    installPlanFetch()
    const host = render(<PlanPanel />)
    await flush()

    const versionToggle = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('v3'),
    )
    expect(versionToggle?.textContent).toBe('v3')
    expect(host.textContent).not.toContain('(draft)')
    expect(host.textContent).not.toContain('v3 •')

    click(versionToggle ?? null)
    await flush()
    expect(host.textContent).toContain('v2')
    expect(host.textContent).not.toContain('v2 (undefined)')
  })

  it('`revise` + cổng `warn`: harness VẪN cho qua nên nút Duyệt mở, bấm là quyết định đi thật', async () => {
    installPlanFetch({
      status: statusPayload({
        verification: {
          state: 'revise',
          at: null,
          criticSessionId: 'critic-2',
          issues: [{ severity: 'high', text: 'M3 gộp hai việc.', fix: null }],
        },
        gate: { verifyMode: 'warn', verifyUnknown: null, sourcesMode: 'enforce', sourcesUnknown: null },
      }),
    })
    const host = render(<PlanPanel />)
    await flush()

    // Khoá ở đây là mời một cú bấm mà harness không hề chặn.
    expect((host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement).disabled).toBe(false)
    expect(host.querySelector('[data-testid="plan-approve-blocked"]')).toBeNull()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()
    expect(reviewBody()).toMatchObject({ decision: 'approved', version: 3 })
  })

  it('payload KHÔNG có khoá `gate` (harness cũ): đọc là `enforce` — hành vi cũ của nó, không phải cổng mở', async () => {
    installPlanFetch({
      status: statusPayload({
        verification: { state: 'revise', at: null, criticSessionId: 'critic-2', issues: [] },
        gate: undefined,
      }),
    })
    const host = render(<PlanPanel />)
    await flush()

    expect((host.querySelector('[data-testid="plan-approve"]') as HTMLButtonElement).disabled).toBe(true)
    expect(text(host, 'plan-approve-blocked')).toContain('verdict: revise')
  })

  it('`wake.state = busy`: KHÔNG hứa đã mở lượt, và in nguyên văn câu harness giải thích', async () => {
    installPlanFetch({
      statusAfterReview: statusPayload({
        state: 'approved',
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', note: '', source: 'plan-tab', decidedAt: 1_758_300_000 },
      }),
      reviewResumed: false,
      reviewWake: {
        state: 'busy',
        code: 'PLAN_WAKE_BUSY',
        message: 'phiên 9481bf87 đang chạy một lượt — quyết định đã ghi sổ, lượt mới chưa mở',
        sessionId: '9481bf87',
      },
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    expect(text(host, 'plan-decision-sent')).toContain('no new turn was opened')
    expect(text(host, 'plan-decision-wake')).toContain('đang chạy một lượt')
    expect(text(host, 'plan-decision-wake')).toContain('PLAN_WAKE_BUSY')
  })

  it('`wake.state = missing`: nói thật là chưa mở lượt nào, câu của harness nói rõ vì sao', async () => {
    installPlanFetch({
      statusAfterReview: statusPayload({
        state: 'approved',
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', note: '', source: 'plan-tab', decidedAt: 1_758_300_000 },
      }),
      reviewResumed: false,
      reviewWake: {
        state: 'missing',
        code: 'PLAN_WAKE_NO_OWNER',
        message: 'harness chưa biết phiên nào sở hữu kế hoạch agent-box-plan — hãy mở phiên và yêu cầu trực tiếp',
        sessionId: null,
      },
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    expect(text(host, 'plan-decision-sent')).toContain('no new turn was opened')
    expect(text(host, 'plan-decision-wake')).toContain('chưa biết phiên nào sở hữu')
  })

  it('`wake.state = opened`: lượt mới mở thật — câu "đang mở lượt" giữ nguyên, không có dòng wake nào thừa', async () => {
    installPlanFetch({
      statusAfterReview: statusPayload({
        state: 'approved',
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', note: '', source: 'plan-tab', decidedAt: 1_758_300_000 },
      }),
      reviewResumed: true,
      reviewWake: { state: 'opened', sessionId: '9481bf87' },
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    expect(text(host, 'plan-decision-sent')).toContain('the agent is opening the next turn')
    // Harness không kèm câu giải thích nào thì không có dòng nào để in — không bịa.
    expect(host.querySelector('[data-testid="plan-decision-wake"]')).toBeNull()
  })

  it('cổng `warn`: `approvalWarning` của harness hiện thành dải riêng, không bị nuốt', async () => {
    installPlanFetch({
      statusAfterReview: statusPayload({
        state: 'approved',
        review: { identity: 'agent-box-plan', version: 3, decision: 'approved', note: '', source: 'plan-tab', decidedAt: 1_758_300_000 },
      }),
      approvalWarning: 'bản v3 chưa đạt phản biện nhưng BOXFOX_PLAN_VERIFY=warn',
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await flush()

    expect(text(host, 'plan-approval-warning')).toContain('The harness approved it anyway')
    expect(text(host, 'plan-approval-warning')).toContain('BOXFOX_PLAN_VERIFY=warn')
  })

  it('nhờ chạy phiên phản biện mà hỏng: câu lỗi hiện ngay dưới nút, không im lặng như đang chạy', async () => {
    installPlanFetch({
      status: statusPayload({ verification: NONE_VERIFICATION }),
      verifyFails: { error: 'no reviewer session', code: 'PLAN_VERIFY_FAILED', status: 502 },
    })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-review-run"]'))
    await flush()

    expect(text(host, 'plan-verify-error')).toContain('Could not start the review session')
    expect(text(host, 'plan-verify-error')).toContain('PLAN_VERIFY_FAILED: no reviewer session')
    // Mặt phản biện vẫn là mặt của SỔ: lệnh hỏng thì không tự vẽ "đã phản biện".
    expect(text(host, 'plan-review-chip')).toBe('Not reviewed')
  })

  it('đổi version: điều kiện / lý do sửa gõ cho bản cũ KHÔNG sống sang bản mới', async () => {
    installPlanFetch({ status: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    typeInto(
      host.querySelector('[data-testid="plan-approve-note"]') as HTMLTextAreaElement,
      'M8 chỉ xong khi chạy trong conda activate ld',
    )
    click(host.querySelector('[data-testid="plan-request-changes"]'))
    typeInto(
      host.querySelector('[data-testid="plan-changes-note"]') as HTMLTextAreaElement,
      'tách M3 thành hai bước',
    )

    // Đổi bản: v3 → v2 (menu version chỉ có nhãn, không có testid riêng).
    click(Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'v3') ?? null)
    await flush()
    click(Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'v2') ?? null)
    await flush()

    // Hộp lý do phải đóng, và chữ của bản cũ biến mất — không có chuyện gửi kèm quyết định của v2.
    expect(host.querySelector('[data-testid="plan-changes-form"]')).toBeNull()
    expect(host.querySelector('[data-testid="plan-approve-note-popover"]')).toBeNull()

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    expect((host.querySelector('[data-testid="plan-approve-note"]') as HTMLTextAreaElement).value).toBe('')

    click(host.querySelector('[data-testid="plan-approve-note-cancel"]'))
    click(host.querySelector('[data-testid="plan-request-changes"]'))
    expect((host.querySelector('[data-testid="plan-changes-note"]') as HTMLTextAreaElement).value).toBe('')
  })

  it('hai ô mới trỏ vào NHÃN NHÌN THẤY (`aria-labelledby`), không chỉ có `placeholder`', async () => {
    installPlanFetch({ status: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    const conditions = host.querySelector('[data-testid="plan-approve-note"]') as HTMLTextAreaElement
    const conditionsLabelId = conditions.getAttribute('aria-labelledby')
    expect(conditionsLabelId).toBeTruthy()
    expect(document.getElementById(conditionsLabelId as string)?.textContent).toBe('Condition')

    click(host.querySelector('[data-testid="plan-request-changes"]'))
    const changes = host.querySelector('[data-testid="plan-changes-note"]') as HTMLTextAreaElement
    const changesLabelId = changes.getAttribute('aria-labelledby')
    expect(changesLabelId).toBeTruthy()
    expect(document.getElementById(changesLabelId as string)?.textContent).toContain('Reason for changes')
  })

  it('Escape đóng popup điều kiện mà KHÔNG xoá chữ đã gõ; mở lại vẫn còn', async () => {
    installPlanFetch({ status: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    typeInto(
      host.querySelector('[data-testid="plan-approve-note"]') as HTMLTextAreaElement,
      'chỉ duyệt khi M8 ghi rõ conda env',
    )

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('[data-testid="plan-approve-note-popover"]')).toBeNull()

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    expect((host.querySelector('[data-testid="plan-approve-note"]') as HTMLTextAreaElement).value).toBe(
      'chỉ duyệt khi M8 ghi rõ conda env',
    )
  })

  it('bấm ra ngoài đóng popup điều kiện — cùng luật với hai menu kia', async () => {
    installPlanFetch({ status: statusPayload({ verification: OK_VERIFICATION }) })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve-note-toggle"]'))
    expect(host.querySelector('[data-testid="plan-approve-note-popover"]')).toBeTruthy()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="plan-approve-note-popover"]')).toBeNull()
  })
})

describe('PlanPanel — phiên sở hữu kế hoạch và khung chat (M9)', () => {
  it('đang xem phiên khác: chỉ ra phiên sở hữu và mở được phiên đó', async () => {
    useAgentStore.setState({
      activeSessionId: 's-viewing',
      sessions: [sessionSummary('s-owner'), sessionSummary('s-viewing')],
    })
    installPlanFetch({ status: statusPayload({ ownership: { sessionId: 's-owner' } }) })
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-owner-hint')).toContain('belongs to session s-owner')
    const open = host.querySelector('[data-testid="plan-owner-open"]') as HTMLButtonElement
    expect(open.disabled).toBe(false)
    expect(open.getAttribute('aria-describedby')).toBe('plan-owner-hint-text')

    click(open)
    await flush()
    // Nút chỉ đổi phiên đang mở bằng hàm có sẵn: không tạo phiên mới, không gọi mạng.
    expect(useAgentStore.getState().activeSessionId).toBe('s-owner')
    expect(useAgentStore.getState().sessions).toHaveLength(2)
  })

  it('phiên sở hữu không có trong danh sách harness: nói thật là không mở được, nút bị khoá', async () => {
    useAgentStore.setState({ activeSessionId: 's-viewing', sessions: [sessionSummary('s-viewing')] })
    installPlanFetch({ status: statusPayload({ ownership: { sessionId: 's-gone' } }) })
    const host = render(<PlanPanel />)
    await flush()

    expect(text(host, 'plan-owner-hint')).toContain('not in the session list the harness returns')
    const open = host.querySelector('[data-testid="plan-owner-open"]') as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(open.getAttribute('data-disabled-reason')).toBe('session-not-in-list')

    click(open)
    await flush()
    expect(useAgentStore.getState().activeSessionId).toBe('s-viewing')
  })

  it('đang mở đúng phiên sở hữu: không vẽ dòng nhắc nào', async () => {
    useAgentStore.setState({ activeSessionId: 's-owner', sessions: [sessionSummary('s-owner')] })
    installPlanFetch({ status: statusPayload({ ownership: { sessionId: 's-owner' } }) })
    const host = render(<PlanPanel />)
    await flush()

    expect(host.querySelector('[data-testid="plan-owner-hint"]')).toBeNull()
  })

  it('harness cũ thiếu hẳn `ownership`: không đoán phiên nào, không vẽ dòng nhắc', async () => {
    useAgentStore.setState({ activeSessionId: 's-viewing', sessions: [sessionSummary('s-viewing')] })
    installPlanFetch({ status: statusPayload() })
    const host = render(<PlanPanel />)
    await flush()

    expect(host.querySelector('[data-testid="plan-owner-hint"]')).toBeNull()
  })
})
