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
import { DEFAULT_PLAN_GATE, PlanReviewBlockedError } from '../lib/plans'
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
    // Mặc định = harness CHƯA khai mặt phản biện (bản cũ); ca nào cần thì tự khai.
    verification: { state: 'unknown', at: null, criticSessionId: null, issues: [] },
    ownership: { sessionId: null },
    // Cổng duyệt mặc định của harness là `enforce`; ca nào cần `warn`/`off` thì tự khai.
    gate: DEFAULT_PLAN_GATE,
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
        recorded: true,
        resumed: null,
        turnId: null,
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
      recorded: true,
      resumed: null,
      turnId: null,
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

describe('usePlanFiles — mặt phản biện + kết quả quyết định (vòng 25)', () => {
  it('mặt phản biện đọc từ sổ: `none` mới khoá duyệt, kèm `ownership.sessionId`', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, {
      read: vi.fn(async () =>
        reportFor({
          version: 1,
          verification: { state: 'none', at: null, criticSessionId: null, issues: [] },
          ownership: { sessionId: '9481bf87' },
        }),
      ),
      submitReview: vi.fn(),
    })

    expect(hook.state.verification?.state).toBe('none')
    expect(hook.state.ownership.sessionId).toBe('9481bf87')
    expect(hook.state.approvalLocked).toBe(true)
    await hook.unmount()
  })

  it('harness cũ không khai mặt phản biện → `unknown` và KHÔNG khoá duyệt oan', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, {
      read: vi.fn(async () => reportFor({ version: 1 })),
      submitReview: vi.fn(),
    })

    expect(hook.state.verification?.state).toBe('unknown')
    expect(hook.state.verification?.issues).toEqual([])
    expect(hook.state.approvalLocked).toBe(false)
    await hook.unmount()
  })

  it('409 "bị khoá vì chưa phản biện" → `blocked` + giữ nguyên văn harness, và VẪN đọc lại sổ', async () => {
    const blocked = new PlanReviewBlockedError(
      'PLAN_APPROVAL_UNVERIFIED',
      'Bản v1 chưa có phiên phản biện nào đọc.',
      'Chạy phiên plan-review cho bản v1 rồi duyệt lại.',
    )
    const submitReview = vi.fn().mockRejectedValue(blocked)
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, {
      read: vi.fn(async () =>
        reportFor({ version: 1, verification: { state: 'none', at: null, criticSessionId: null, issues: [] } }),
      ),
      submitReview,
    })

    await act(async () => {
      await hook.state.submitReview('approved', '')
    })

    expect(hook.state.reviewStatus).toBe('blocked')
    expect(hook.state.reviewBlocked).toMatchObject({
      code: 'PLAN_APPROVAL_UNVERIFIED',
      reason: 'Bản v1 chưa có phiên phản biện nào đọc.',
      remedy: 'Chạy phiên plan-review cho bản v1 rồi duyệt lại.',
    })
    expect(hook.state.reviewError).toBeNull()
    expect(hook.state.reviewResult).toBeNull()
    // Sổ harness là nguồn sự thật kể cả khi quyết định không vào được: đọc lại đúng một lần nữa.
    expect(repository.list).toHaveBeenCalledTimes(2)
    await hook.unmount()
  })

  it('200: `resumed`/`turnId` vào dòng kết quả; thiếu `resumed` (harness cũ) thì là `null`', async () => {
    const submitReview = vi
      .fn()
      .mockResolvedValueOnce({
        review: null,
        forwarded: true,
        recorded: true,
        resumed: true,
        turnId: 'turn-7',
      })
      .mockResolvedValue({ review: null, forwarded: true, recorded: null, resumed: null, turnId: null })
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor({ version: 1 })), submitReview })

    await act(async () => {
      await hook.state.submitReview('approved', 'kèm điều kiện: chạy trong conda ld')
    })

    expect(hook.state.reviewResult).toMatchObject({
      decision: 'approved',
      version: 1,
      note: 'kèm điều kiện: chạy trong conda ld',
      resumed: true,
      turnId: 'turn-7',
    })

    await act(async () => {
      await hook.state.submitReview('changes_requested', 'tách M3 thành hai bước')
    })

    expect(hook.state.reviewResult).toMatchObject({
      decision: 'changes_requested',
      note: 'tách M3 thành hai bước',
      resumed: null,
      turnId: null,
    })
    await hook.unmount()
  })

  it('đổi version thì dòng kết quả của bản cũ biến mất, không dán sang bản mới', async () => {
    const submitReview = vi.fn().mockResolvedValue({
      review: null,
      forwarded: true,
      recorded: true,
      resumed: true,
      turnId: 'turn-7',
    })
    const read = vi.fn(async (_identity: string, version: number | null) =>
      reportFor({
        version,
        verification: { state: 'ok', at: null, criticSessionId: 'critic-1', issues: [] },
      }),
    )
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [2, 1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read, submitReview })

    await act(async () => {
      await hook.state.submitReview('approved', '')
    })
    expect(hook.state.reviewResult).not.toBeNull()

    await act(async () => {
      hook.state.selectVersion(1)
    })

    expect(read).toHaveBeenLastCalledWith('agent-box-plan', 1)
    expect(hook.state.reviewResult).toBeNull()
    expect(hook.state.reviewBlocked).toBeNull()
    await hook.unmount()
  })

  it('cổng `enforce`: bản có verdict `revise` thì KHOÁ duyệt; `warn`/`off` thì mở — siết đúng bằng harness', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const revise = { state: 'revise' as const, at: null, criticSessionId: 'critic-1', issues: [] }

    const enforced = await mount(repository, {
      read: vi.fn(async () => reportFor({ version: 1, verification: revise })),
      submitReview: vi.fn(),
    })
    expect(enforced.state.gate.verifyMode).toBe('enforce')
    expect(enforced.state.approvalLocked).toBe(true)
    await enforced.unmount()

    const warned = await mount(repository, {
      read: vi.fn(async () =>
        reportFor({
          version: 1,
          verification: revise,
          gate: { ...DEFAULT_PLAN_GATE, verifyMode: 'warn' },
        }),
      ),
      submitReview: vi.fn(),
    })
    expect(warned.state.gate.verifyMode).toBe('warn')
    // Cổng `warn` nói harness VẪN cho qua: khoá ở đây là mời một cú bấm không có gì chặn.
    expect(warned.state.approvalLocked).toBe(false)
    await warned.unmount()

    const disabled = await mount(repository, {
      read: vi.fn(async () =>
        reportFor({
          version: 1,
          verification: revise,
          gate: { ...DEFAULT_PLAN_GATE, verifyMode: 'off' },
        }),
      ),
      submitReview: vi.fn(),
    })
    expect(disabled.state.approvalLocked).toBe(false)
    await disabled.unmount()
  })

  it('env lạ bị harness hạ về `enforce` và khai kèm: `verifyUnknown` đi ra, giao diện siết như harness', async () => {
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, {
      read: vi.fn(async () =>
        reportFor({
          version: 1,
          verification: { state: 'revise', at: null, criticSessionId: null, issues: [] },
          gate: { ...DEFAULT_PLAN_GATE, verifyUnknown: 'yolo' },
        }),
      ),
      submitReview: vi.fn(),
    })

    expect(hook.state.gate.verifyUnknown).toBe('yolo')
    expect(hook.state.gate.verifyMode).toBe('enforce')
    expect(hook.state.approvalLocked).toBe(true)
    await hook.unmount()
  })

  it('đổi version: xoá kết luận của bản CŨ ngay, `verification` là `null` cho tới khi sổ trả lời', async () => {
    let release: ((report: PlanStatusReport) => void) | null = null
    const read = vi.fn(async (_identity: string, version: number | null) => {
      if (version === 2) {
        return reportFor({
          version: 2,
          state: 'approved',
          stateVersion: 2,
          verification: { state: 'ok', at: '2026-09-20T20:56:00Z', criticSessionId: 'critic-1', issues: [] },
          ownership: { sessionId: '9481bf87' },
        })
      }
      return new Promise<PlanStatusReport>((resolve) => {
        release = resolve
      })
    })
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [2, 1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read, submitReview: vi.fn() })

    expect(hook.state.verification?.state).toBe('ok')
    expect(hook.state.ownership.sessionId).toBe('9481bf87')

    await act(async () => {
      hook.state.selectVersion(1)
    })

    // Sổ của bản mới CHƯA trả lời: không mượn verdict `ok` của v2 in lên đầu v1, và không mượn cả
    // chủ phiên của v2 — `null` nói đúng "chưa đọc xong", `unknown` thì nói "sổ không đọc được".
    expect(hook.state.verification).toBeNull()
    expect(hook.state.ownership.sessionId).toBeNull()
    expect(hook.state.evaluation).toBeNull()
    // Chưa biết bản mới thế nào thì nút Duyệt không được mời bấm.
    expect(hook.state.approvalLocked).toBe(true)

    await act(async () => {
      release?.(reportFor({ version: 1, verification: { state: 'none', at: null, criticSessionId: null, issues: [] } }))
    })

    expect(hook.state.verification?.state).toBe('none')
    await hook.unmount()
  })

  it('`wake` + `approvalWarning` của harness đi nguyên vào dòng kết quả, không bị nuốt', async () => {
    const submitReview = vi.fn().mockResolvedValue({
      review: null,
      forwarded: true,
      recorded: true,
      resumed: false,
      turnId: null,
      wake: {
        state: 'busy',
        code: 'PLAN_WAKE_BUSY',
        message: 'phiên 9481bf87 đang chạy một lượt — quyết định đã ghi sổ, lượt mới chưa mở',
        sessionId: '9481bf87',
      },
      approvalWarning: 'bản v1 chưa đạt phản biện nhưng BOXFOX_PLAN_VERIFY=warn',
    })
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor({ version: 1 })), submitReview })

    await act(async () => {
      await hook.state.submitReview('approved', '')
    })

    expect(hook.state.reviewResult).toMatchObject({
      decision: 'approved',
      resumed: false,
      wake: {
        state: 'busy',
        code: 'PLAN_WAKE_BUSY',
        message: 'phiên 9481bf87 đang chạy một lượt — quyết định đã ghi sổ, lượt mới chưa mở',
        sessionId: '9481bf87',
      },
      approvalWarning: 'bản v1 chưa đạt phản biện nhưng BOXFOX_PLAN_VERIFY=warn',
    })
    await hook.unmount()
  })

  it('harness cũ không có `wake`: dòng kết quả vẫn đọc đúng bit `resumed`, không bịa kết cục nào', async () => {
    const submitReview = vi.fn().mockResolvedValue({
      review: null,
      forwarded: true,
      recorded: true,
      resumed: null,
      turnId: null,
    })
    const repository: PlanRepository = {
      list: vi.fn(async () => manifestWith('agent-box-plan', [1])),
      read: vi.fn(async (identity, version) => documentFor(identity, version)),
    }
    const hook = await mount(repository, { read: vi.fn(async () => reportFor({ version: 1 })), submitReview })

    await act(async () => {
      await hook.state.submitReview('approved', '')
    })

    expect(hook.state.reviewResult?.wake).toBeNull()
    expect(hook.state.reviewResult?.approvalWarning).toBeNull()
    expect(hook.state.reviewResult?.resumed).toBeNull()
    await hook.unmount()
  })
})
