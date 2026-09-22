/**
 * Duyệt kế hoạch thật — hợp đồng §2 (harness): `POST /api/agent/plans/review` với
 * `{identity, version, decision, note}`, rồi `GET /api/agent/plans/status` là nguồn duy nhất của
 * trạng thái duyệt.
 *
 * Vì sao đổi đường: `.reviews/` trong box rỗng mà giao diện vẫn hiện hai nhóm "approved" — nhãn cũ
 * gán theo VỊ TRÍ trong danh sách version. Test cuối cùng trong file này khoá đúng điều đó: manifest
 * của box nói "approved" mà sổ harness nói "changes_requested" thì giao diện phải theo sổ harness.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDocument, PlanManifest, PlanRepository, PlanStatusClient, PlanStatusReport } from '../lib/plans'
import { usePlanFiles } from './usePlanFiles'
import type { PlanFilesState } from './usePlanFiles'
import { useUiStore } from '../store/uiStore'

const modifiedAt = '2026-08-27T00:00:00Z'

type ReviewRecord = { identity: string; decision: string; note: string; updatedAt: number }

function manifestWith(identity: string, versions: number[], review: ReviewRecord | null = null): PlanManifest {
  const entry = {
    identity,
    relativeDirectory: identity.includes('/') ? identity.split('/').slice(0, -1).join('/') : '',
    slug: identity.split('/').pop() as string,
    versions: versions.map((version, index) => ({
      version,
      label: `v${version}`,
      relativePath: `${identity}/v${version}-${identity.split('/').pop()}.md`,
      sizeBytes: version,
      modifiedAt,
      status: 'approved',
      // `review` đi kèm mỗi bản ghi của `GET /__box/plans` (có thể là null). Từ vòng 20 giao diện
      // KHÔNG còn lấy trường này làm kết luận.
      review,
      index,
    })),
    review,
  }
  return { plans: [entry], ignoredCount: 0, warnings: [] } as unknown as PlanManifest
}

function documentFor(identity: string, version: number): PlanDocument {
  return {
    identity,
    version,
    label: `v${version}`,
    relativePath: `${identity}/v${version}.md`,
    markdown: `# ${identity} v${version}`,
    sizeBytes: version,
    modifiedAt,
    status: 'approved',
  }
}

function reportFor(overrides: Partial<PlanStatusReport> = {}): PlanStatusReport {
  return {
    identity: 'agent-box-plan',
    version: 2,
    state: 'draft',
    stateVersion: 2,
    review: null,
    reviewStale: false,
    indexAvailable: true,
    evaluation: null,
    ...overrides,
  }
}

const fetchMock = vi.fn()

async function mount(repository: PlanRepository, statusClient: PlanStatusClient) {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let latest: PlanFilesState | null = null

  function Probe() {
    latest = usePlanFiles(repository, statusClient)
    return null
  }

  await act(async () => {
    root.render(<Probe />)
  })

  return {
    get state() {
      if (!latest) throw new Error('Hook did not render.')
      return latest
    },
    async unmount() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  useUiStore.setState({ planRevision: 0, tabIntentTargets: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePlanFiles — duyệt kế hoạch (§2)', () => {
  it('ghi vào sổ harness kèm số version, rồi đọc lại trạng thái thật', async () => {
    const submitReview = vi
      .fn()
      .mockResolvedValue({
        review: {
          identity: 'agent-box-plan',
          version: 2,
          decision: 'approved',
          note: 'chốt',
          source: 'plan-tab',
          decidedAt: 1_758_300_000,
        },
        forwarded: true,
      })
    const read = vi
      .fn()
      .mockResolvedValueOnce(reportFor())
      .mockResolvedValue(
        reportFor({
          state: 'approved',
          review: {
            identity: 'agent-box-plan',
            version: 2,
            decision: 'approved',
            note: 'chốt',
            source: 'plan-tab',
            decidedAt: 1_758_300_000,
          },
        }),
      )
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [2, 1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read, submitReview })
    expect(hook.state.selectedReview).toBeNull()
    expect(hook.state.planState).toBe('draft')
    expect(read).toHaveBeenCalledWith('agent-box-plan', 2)

    await act(async () => {
      await hook.state.submitReview('approved', 'chốt')
    })

    expect(submitReview).toHaveBeenCalledWith('agent-box-plan', 2, 'approved', 'chốt')
    expect(hook.state.reviewStatus).toBe('idle')
    expect(hook.state.reviewForwarded).toBe(true)
    expect(hook.state.selectedReview).toMatchObject({ decision: 'approved', note: 'chốt' })
    expect(hook.state.planState).toBe('approved')
    // Đọc lại trạng thái sau khi ghi: lượt mount + lượt sau khi ghi, không dùng lại bản cũ.
    expect(read).toHaveBeenCalledTimes(2)
    await hook.unmount()
  })

  it('route harness 404 hiện lỗi thật và KHÔNG giả vờ đã duyệt', async () => {
    const submitReview = vi.fn().mockRejectedValue(new Error('unknown plan identity'))
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor({ version: 1 })), submitReview })

    await act(async () => {
      await hook.state.submitReview('changes_requested', 'thiếu phần rollback')
    })

    expect(hook.state.reviewStatus).toBe('error')
    expect(hook.state.reviewError).toContain('unknown plan identity')
    expect(hook.state.selectedReview).toBeNull()
    expect(hook.state.reviewForwarded).toBeNull()
    expect(repository.list).toHaveBeenCalledTimes(1) // không tải lại khi ghi hỏng
    await hook.unmount()
  })

  it('harness nhận quyết định nhưng chưa chuyển được sang box → `forwarded: false` nói thật', async () => {
    const submitReview = vi.fn().mockResolvedValue({
      review: {
        identity: 'agent-box-plan',
        version: 1,
        decision: 'approved',
        note: '',
        source: 'plan-tab',
        decidedAt: 1_758_300_000,
      },
      forwarded: false,
    })
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor({ version: 1 })), submitReview })

    await act(async () => {
      await hook.state.submitReview('approved')
    })

    expect(hook.state.reviewForwarded).toBe(false)
    expect(hook.state.reviewStatus).toBe('idle')
    await hook.unmount()
  })

  it('chưa chọn bản nào thì báo rõ, không gọi mạng', async () => {
    const submitReview = vi.fn()
    const repository: PlanRepository = {
      list: vi.fn(async () => ({ plans: [], ignoredCount: 0, warnings: [] }) as PlanManifest),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor()), submitReview })

    await act(async () => {
      await hook.state.submitReview('approved')
    })

    expect(submitReview).not.toHaveBeenCalled()
    expect(hook.state.reviewError).toContain('PLAN_REVIEW_NO_SELECTION')
    await hook.unmount()
  })

  it('sổ harness là nguồn duy nhất: manifest của box nói "approved" cũng không tính', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () =>
        manifestWith('agent-box-plan', [2, 1], {
          identity: 'agent-box-plan',
          decision: 'approved',
          note: 'box tự ghi',
          updatedAt: 1_758_300_000,
        }),
      ),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, {
      read: vi.fn(async () =>
        reportFor({
          state: 'changes_requested',
          review: {
            identity: 'agent-box-plan',
            version: 2,
            decision: 'changes_requested',
            note: 'tách phần kiểm thử khỏi bước 2',
            source: 'plan-tab',
            decidedAt: 1_758_300_600,
          },
        }),
      ),
      submitReview: vi.fn(),
    })

    expect(hook.state.planState).toBe('changes_requested')
    expect(hook.state.selectedReview).toMatchObject({
      decision: 'changes_requested',
      note: 'tách phần kiểm thử khỏi bước 2',
    })
    await hook.unmount()
  })

  it('đổi version thì đọc trạng thái của đúng version đó', async () => {
    const read = vi.fn(async (_identity: string, version: number | null) =>
      reportFor({
        version,
        state: version === 2 ? 'approved' : 'draft',
        review:
          version === 2
            ? {
                identity: 'agent-box-plan',
                version: 2,
                decision: 'approved',
                note: '',
                source: 'plan-tab',
                decidedAt: 1_758_300_000,
              }
            : null,
      }),
    )
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [2, 1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read, submitReview: vi.fn() })
    expect(hook.state.planState).toBe('approved')

    await act(async () => {
      hook.state.selectVersion(1)
    })

    expect(read).toHaveBeenLastCalledWith('agent-box-plan', 1)
    expect(hook.state.planState).toBe('draft')
    expect(hook.state.selectedReview).toBeNull()
    await hook.unmount()
  })

  it('chỉ mục không đọc được → `unknown` + `indexAvailable: false`, không có điểm ảo', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, {
      read: vi.fn().mockRejectedValue(new Error('PLAN_STATUS_INVALID: version phải là số nguyên dương')),
      submitReview: vi.fn(),
    })

    expect(hook.state.planState).toBe('unknown')
    expect(hook.state.indexAvailable).toBe(false)
    expect(hook.state.evaluation).toBeNull()
    expect(hook.state.selectedReview).toBeNull()
    expect(hook.state.statusError).toContain('PLAN_STATUS_INVALID')
    await hook.unmount()
  })

  it('`planRevision` tăng (agent vừa ghi kế hoạch) thì tải lại manifest', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor({ version: 1 })), submitReview: vi.fn() })
    expect(repository.list).toHaveBeenCalledTimes(1)

    await act(async () => {
      useUiStore.getState().bumpPlanRevision()
    })

    expect(repository.list).toHaveBeenCalledTimes(2)
    expect(hook.state.selection).toEqual({ identity: 'agent-box-plan', version: 1 })
    await hook.unmount()
  })

  it('`selectIdentity` nhận identity trần và chọn đúng version mà ý định chỉ định', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('docs/rollout', [3, 2, 1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor()), submitReview: vi.fn() })
    expect(hook.state.selection).toEqual({ identity: 'docs/rollout', version: 3 })

    await act(async () => {
      hook.state.selectIdentity('docs/rollout', 1)
    })

    expect(hook.state.selection).toEqual({ identity: 'docs/rollout', version: 1 })
    expect(hook.state.document?.version).toBe(1)
    await hook.unmount()
  })

  it('version không còn trong manifest thì lấy bản mới nhất, không vỡ', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [4])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor()), submitReview: vi.fn() })

    await act(async () => {
      hook.state.selectIdentity('agent-box-plan', 2)
    })

    expect(hook.state.selection).toEqual({ identity: 'agent-box-plan', version: 4 })
    await hook.unmount()
  })
})
