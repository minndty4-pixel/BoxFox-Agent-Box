/**
 * Duyệt kế hoạch thật — hợp đồng §2 (container): `POST /__box/plans/review`
 * với `{identity, decision, note}` và header `X-BoxFox-Api-Key`, manifest tải
 * lại sau khi ghi, `review` đọc từ chính manifest (`selectedReview`).
 *
 * Trước đây nút Duyệt của tab Plan chạy hoàn toàn trên `mode_switch_confirm`
 * cục bộ và danh sách version bịa `['v3 (latest)', 'v2', 'v1']`.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBoxApiKey, resolveBoxApiUrl } from '../lib/boxApi'
import type { PlanDocument, PlanManifest, PlanRepository } from '../lib/plans'
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
      // `review` đi kèm mỗi bản ghi của `GET /__box/plans` (có thể là null).
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

const fetchMock = vi.fn()

async function mount(repository: PlanRepository) {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let latest: PlanFilesState | null = null

  function Probe() {
    latest = usePlanFiles(repository)
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
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
  useUiStore.setState({ planRevision: 0, tabIntentTargets: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePlanFiles — duyệt kế hoạch (§2)', () => {
  it('ghi quyết định xuống container rồi đọc lại `review` từ manifest', async () => {
    const repository: PlanRepository = {
      list: vi
        .fn()
        .mockResolvedValueOnce(manifestWith('agent-box-plan', [2, 1]))
        .mockResolvedValueOnce(
          manifestWith('agent-box-plan', [2, 1], {
            identity: 'agent-box-plan',
            decision: 'approved',
            note: 'chốt',
            updatedAt: 1_758_300_000,
          }),
        ),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository)
    expect(hook.state.selectedReview).toBeNull()

    await act(async () => {
      await hook.state.submitReview('approved', 'chốt')
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${resolveBoxApiUrl(import.meta.env)}/__box/plans/review`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-BoxFox-Api-Key']).toBe(resolveBoxApiKey(import.meta.env))
    expect(JSON.parse(String(init.body))).toEqual({
      identity: 'agent-box-plan',
      decision: 'approved',
      note: 'chốt',
    })

    expect(repository.list).toHaveBeenCalledTimes(2)
    expect(hook.state.reviewStatus).toBe('idle')
    expect(hook.state.selectedReview).toMatchObject({ decision: 'approved', note: 'chốt' })
    await hook.unmount()
  })

  it('route 404 hiện lỗi thật và KHÔNG giả vờ đã duyệt', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'unknown plan identity' }),
    })
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository)

    await act(async () => {
      await hook.state.submitReview('changes_requested', 'thiếu phần rollback')
    })

    expect(hook.state.reviewStatus).toBe('error')
    expect(hook.state.reviewError).toContain('unknown plan identity')
    expect(hook.state.selectedReview).toBeNull()
    expect(repository.list).toHaveBeenCalledTimes(1) // không tải lại khi ghi hỏng
    await hook.unmount()
  })

  it('chưa chọn bản nào thì báo rõ, không gọi mạng', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => ({ plans: [], ignoredCount: 0, warnings: [] }) as PlanManifest),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository)

    await act(async () => {
      await hook.state.submitReview('approved')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(hook.state.reviewError).toContain('PLAN_REVIEW_NO_SELECTION')
    await hook.unmount()
  })

  it('`planRevision` tăng (agent vừa ghi kế hoạch) thì tải lại manifest', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository)
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
    const hook = await mount(repository)
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
    const hook = await mount(repository)

    await act(async () => {
      hook.state.selectIdentity('agent-box-plan', 2)
    })

    expect(hook.state.selection).toEqual({ identity: 'agent-box-plan', version: 4 })
    await hook.unmount()
  })
})
