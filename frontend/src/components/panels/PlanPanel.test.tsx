/**
 * PlanPanel — bỏ dữ liệu giả, nối vào dữ liệu thật.
 *
 * Trước đây `const PLAN_VERSIONS = ['v3 (latest)', 'v2', 'v1']` là nguồn version
 * của dropdown, và nút Duyệt chỉ chạy trên `mode_switch_confirm`. Test này đi
 * qua repository thật (`SandboxPlanRepository`) với `fetch` được giả lập, nên nó
 * khoá cả ba đường: manifest → dropdown, manifest → nút Duyệt ghi
 * `POST /__box/plans/review`, và lỗi của route hiện ra ở dải cảnh báo.
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

function planRecord(identity: string, versions: number[], review: ReviewRecord | null = null) {
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
    })),
    review,
  }
}

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload }
}

/** fetch giả theo đúng hai endpoint đọc + một endpoint ghi của container. */
function installPlanFetch(options: { review?: ReviewRecord | null; reviewFails?: boolean } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const target = String(url)
    if (target.endsWith('/__box/plans')) {
      return jsonResponse({ plans: [planRecord('agent-box-plan', [3, 2, 1], options.review ?? null)], ignoredCount: 0, warnings: [] })
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
    if (target.endsWith('/__box/plans/review') && init?.method === 'POST') {
      if (options.reviewFails) {
        return jsonResponse({ error: 'unknown plan identity' }, false, 404)
      }
      const body = JSON.parse(String(init.body)) as ReviewRecord
      return jsonResponse({ ...body, updatedAt: 1_758_300_000 }, true, 200)
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

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
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

  it('nút Duyệt ghi thật xuống container rồi phản ánh lại từ manifest', async () => {
    const host = render(<PlanPanel />)
    await flush()

    const approve = host.querySelector('[data-testid="plan-approve"]')
    expect(approve).toBeTruthy()
    click(approve)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const reviewCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith('/__box/plans/review') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(reviewCall).toBeTruthy()
    expect(JSON.parse(String((reviewCall?.[1] as RequestInit).body))).toEqual({
      identity: 'agent-box-plan',
      decision: 'approved',
      note: '',
    })
    expect(host.querySelector('[data-testid="plan-review-error"]')).toBeNull()
  })

  it('nút Yêu cầu sửa gửi đúng quyết định `changes_requested`', async () => {
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-request-changes"]'))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const reviewCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/__box/plans/review'))
    expect(JSON.parse(String((reviewCall?.[1] as RequestInit).body))).toMatchObject({
      identity: 'agent-box-plan',
      decision: 'changes_requested',
    })
  })

  it('route ghi 404 thì hiện dải lỗi thật, không giả vờ đã duyệt', async () => {
    installPlanFetch({ reviewFails: true })
    const host = render(<PlanPanel />)
    await flush()

    click(host.querySelector('[data-testid="plan-approve"]'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const strip = host.querySelector('[data-testid="plan-review-error"]')
    expect(strip).toBeTruthy()
    expect(strip?.textContent).toContain('unknown plan identity')
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
    expect(host.textContent).not.toContain('v3 (latest)')
  })
})
