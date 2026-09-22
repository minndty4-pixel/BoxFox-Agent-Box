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
    ...overrides,
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
    if (target === '/api/agent/plans/review' && init?.method === 'POST') {
      if (options.reviewFails) {
        return jsonResponse({ error: 'unknown plan identity' }, false, 404)
      }
      const body = JSON.parse(String(init.body)) as ReviewRecord
      if (options.statusAfterReview) current = options.statusAfterReview
      return jsonResponse({
        ...body,
        forwarded: options.reviewForwarded ?? true,
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
  useAgentStore.setState({ mode: 'PLAN', planWorkspace: null, planEndorsed: null, proposal: null })
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

  it('nút Yêu cầu sửa gửi đúng quyết định `changes_requested`', async () => {
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-request-changes"]'))
    await flush()

    const reviewCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/agent/plans/review')
    expect(JSON.parse(String((reviewCall?.[1] as RequestInit).body))).toMatchObject({
      identity: 'agent-box-plan',
      version: 3,
      decision: 'changes_requested',
    })
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
