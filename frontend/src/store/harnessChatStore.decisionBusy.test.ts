/**
 * Phiên đang chờ người dùng quyết định (`awaiting_decision`) là một lượt chạy
 * ĐANG SỐNG: harness giữ lượt đó và `runtime.start()` ném `SESSION_BUSY` cho mọi
 * prompt thường (route `/turns` trả 409), trong khi `/stop` vẫn được nhận.
 *
 * Vì vậy phía UI phải xử lý `awaiting_decision` y như `running`:
 *  1. `send` từ chối prompt thường TẠI CHỖ (không có banner lỗi 409 thô);
 *  2. lệnh điều khiển `/stop` vẫn đi tới harness để thoát lượt đang bị chặn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { path: string; body?: unknown; method?: string }

const calls: Call[] = []

vi.mock('../lib/agentApi', () => ({
  agentApi: async (path: string, body?: unknown, method?: string) => {
    calls.push({ path, body, method: method ?? (body === undefined ? 'GET' : 'POST') })
    if (path.includes('/turns')) return { status: 'running' }
    return { id: 'sid-b', status: 'awaiting_decision', events: [] }
  },
}))

import { useHarnessChatStore } from './harnessChatStore'
import { useUiStore } from './uiStore'

const CHAT = 'chat-blocked'
const SID = 'sid-b'

beforeEach(() => {
  calls.length = 0
  useHarnessChatStore.setState({
    sessions: { [CHAT]: { id: SID, status: 'awaiting_decision', events: [], error: null } },
    decisions: {},
    intentSeq: {},
  })
  useUiStore.setState({
    openTabs: [],
    activeTab: null,
    pendingIntents: [],
    pinnedTab: null,
    lastUserActivityAt: 0,
    autoOpenTabs: true,
    autoOpenOnlyWhenIdle: false,
    tabIntentTargets: {},
    planRevision: 0,
  })
})

describe('send khi phiên đang chờ quyết định', () => {
  it('prompt thường bị từ chối tại chỗ — không gửi lên harness, không có lỗi 409', async () => {
    await useHarnessChatStore.getState().send(CHAT, 'Làm tiếp việc khác', null)

    expect(calls).toEqual([])
    expect(useHarnessChatStore.getState().sessions[CHAT].status).toBe('awaiting_decision')
    expect(useHarnessChatStore.getState().sessions[CHAT].error).toBeNull()
  })

  it('lệnh điều khiển `/stop` vẫn gửi được để thoát lượt đang bị chặn', async () => {
    await useHarnessChatStore.getState().send(CHAT, '/stop', null)

    const turn = calls.find((call) => call.path === `/sessions/${SID}/turns`)
    expect(turn).toBeTruthy()
    expect(turn?.method).toBe('POST')
    expect((turn?.body as { prompt?: string })?.prompt).toBe('/stop')
    // và vòng poll sau lệnh vẫn chạy để trạng thái thật trở về
    expect(calls.some((call) => call.path.startsWith(`/sessions/${SID}?after=`))).toBe(true)
  })
})
