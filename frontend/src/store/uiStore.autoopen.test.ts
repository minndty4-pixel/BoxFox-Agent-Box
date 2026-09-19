/**
 * Luật tự mở tab — `docs/plan/next-batch-contract.md` §3.
 *
 * `ui_intent` (và các ý định suy ra từ `plan_written` / `decision_requested`) chỉ
 * là GỢI Ý: giao diện quyết định mở hay xếp hàng theo đúng ba điều kiện, dừng ở
 * điều kiện đầu tiên vi phạm. Ý định bị chặn nằm trong `pendingIntents` để tab
 * đích hiện huy hiệu đếm, và mở tab đó sẽ tiêu thụ hết hàng đợi của nó.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_OPEN_IDLE_MS, MAX_PENDING_TAB_INTENTS, useUiStore } from './uiStore'

function resetStore() {
  localStorage.clear()
  useUiStore.setState({
    openTabs: [],
    activeTab: null,
    panelFullscreen: false,
    pendingIntents: [],
    pinnedTab: null,
    lastUserActivityAt: 0,
    autoOpenTabs: true,
    autoOpenOnlyWhenIdle: true,
    tabIntentTargets: {},
    planRevision: 0,
    sessionScrollOffsets: {},
  })
}

beforeEach(resetStore)

describe('uiStore — luật tự mở tab (hợp đồng §3)', () => {
  it('mở tab ngay khi người dùng đang rảnh', () => {
    const outcome = useUiStore
      .getState()
      .requestTabIntent({ tab: 'plan', target: { identity: 'agent-box-plan' }, reason: 'plan_written' })

    expect(outcome).toBe('opened')
    expect(useUiStore.getState().activeTab).toBe('plan')
    expect(useUiStore.getState().openTabs).toContain('plan')
    expect(useUiStore.getState().tabIntentTargets.plan).toMatchObject({ identity: 'agent-box-plan' })
    expect(useUiStore.getState().pendingIntents).toEqual([])
  })

  it('điều kiện 1 — công tắc tắt thì chỉ xếp hàng', () => {
    useUiStore.setState({ autoOpenTabs: false })
    const outcome = useUiStore
      .getState()
      .requestTabIntent({ tab: 'decisions', target: { requestId: 'd1' }, reason: 'decision_requested' })

    expect(outcome).toBe('queued')
    expect(useUiStore.getState().activeTab).toBeNull()
    expect(useUiStore.getState().pendingIntents).toHaveLength(1)
    expect(useUiStore.getState().pendingIntents[0]).toMatchObject({
      tab: 'decisions',
      target: { requestId: 'd1' },
      reason: 'decision_requested',
    })
  })

  it('điều kiện 2 — tab đã được người dùng ghim thì không cướp vị trí', () => {
    useUiStore.getState().openTab('decisions')
    useUiStore.getState().pinTab('decisions')

    const outcome = useUiStore
      .getState()
      .requestTabIntent({ tab: 'decisions', target: { requestId: 'd2' }, reason: 'decision_requested' })

    expect(outcome).toBe('queued')
    expect(useUiStore.getState().activeTab).toBe('decisions')
    expect(useUiStore.getState().pendingIntents).toHaveLength(1)
  })

  it('điều kiện 3 — vừa gõ phím/cuộn trong 15s thì chờ', () => {
    useUiStore.getState().noteUserActivity()
    const outcome = useUiStore
      .getState()
      .requestTabIntent({ tab: 'plan', target: { identity: 'p' }, reason: 'plan_written' })

    expect(outcome).toBe('queued')
    expect(AUTO_OPEN_IDLE_MS).toBe(15000)

    // Rảnh trở lại → ý định mới được mở ngay.
    useUiStore.setState({ lastUserActivityAt: Date.now() - AUTO_OPEN_IDLE_MS - 1 })
    const second = useUiStore
      .getState()
      .requestTabIntent({ tab: 'plan', target: { identity: 'p' }, reason: 'plan_written' })
    expect(second).toBe('opened')
  })

  it('tắt "chỉ khi rảnh" thì mở ngay dù vừa có hoạt động', () => {
    useUiStore.setState({ autoOpenOnlyWhenIdle: false })
    useUiStore.getState().noteUserActivity()

    const outcome = useUiStore
      .getState()
      .requestTabIntent({ tab: 'subagents', target: { sessionId: 'child-1' }, reason: 'child_started' })

    expect(outcome).toBe('opened')
    expect(useUiStore.getState().tabIntentTargets.subagents).toMatchObject({ sessionId: 'child-1' })
  })

  it('mở tab tiêu thụ hàng đợi của chính tab đó, giữ đích của ý định mới nhất', () => {
    useUiStore.setState({ autoOpenTabs: false })
    const { requestTabIntent } = useUiStore.getState()
    requestTabIntent({ tab: 'plan', target: { identity: 'v1-plan', version: 1 }, reason: 'plan_written' })
    requestTabIntent({ tab: 'decisions', target: { requestId: 'd1' }, reason: 'decision_requested' })
    requestTabIntent({ tab: 'plan', target: { identity: 'v2-plan', version: 2 }, reason: 'plan_written' })
    expect(useUiStore.getState().pendingIntents).toHaveLength(3)

    useUiStore.getState().openTab('plan')

    const state = useUiStore.getState()
    expect(state.activeTab).toBe('plan')
    expect(state.pendingIntents.map((intent) => intent.tab)).toEqual(['decisions'])
    expect(state.tabIntentTargets.plan).toMatchObject({ identity: 'v2-plan', version: 2 })
  })

  it('hàng đợi chỉ giữ 20 ý định gần nhất', () => {
    useUiStore.setState({ autoOpenTabs: false })
    for (let i = 0; i < MAX_PENDING_TAB_INTENTS + 5; i += 1) {
      useUiStore
        .getState()
        .requestTabIntent({ tab: 'plan', target: { identity: `p${i}` }, reason: 'plan_written' })
    }

    const pending = useUiStore.getState().pendingIntents
    expect(pending).toHaveLength(MAX_PENDING_TAB_INTENTS)
    // Mới nhất ở cuối, cũ nhất bị cắt.
    expect(pending.at(-1)?.target).toMatchObject({ identity: `p${MAX_PENDING_TAB_INTENTS + 4}` })
    expect(pending.some((intent) => intent.target?.identity === 'p0')).toBe(false)
  })

  it('đóng tab thì bỏ ghim của tab đó', () => {
    useUiStore.getState().openTab('plan')
    useUiStore.getState().pinTab('plan')
    expect(useUiStore.getState().pinnedTab).toBe('plan')

    useUiStore.getState().closeTab('plan')
    expect(useUiStore.getState().pinnedTab).toBeNull()
  })

  it('planRevision tăng khi agent ghi kế hoạch mới', () => {
    const before = useUiStore.getState().planRevision
    useUiStore.getState().bumpPlanRevision()
    expect(useUiStore.getState().planRevision).toBe(before + 1)
  })

  it('nhớ vị trí cuộn theo từng phiên', () => {
    useUiStore.getState().rememberSessionScroll('chat-a', 420)
    useUiStore.getState().rememberSessionScroll('chat-b', 12)
    expect(useUiStore.getState().sessionScrollOffsets).toMatchObject({ 'chat-a': 420, 'chat-b': 12 })
  })
})
