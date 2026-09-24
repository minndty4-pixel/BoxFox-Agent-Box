/**
 * Chỉ thị giữa lượt (vòng 27 / C-5) — lượt đang chạy (`running`) và lượt đang chờ người dùng
 * quyết định (`awaiting_decision`) đều là lượt ĐANG SỐNG: harness KHÔNG còn trả 409
 * `SESSION_BUSY` cho prompt thường ở phiên gốc, nó xếp câu đó vào hàng đợi `session_steers`
 * (HTTP 202 `{status:'steered'}`) và main đọc ở BƯỚC KẾ.
 *
 * Phía UI vì vậy:
 *  1. `send` ĐI tới harness cho prompt thường khi lượt đang chạy (không từ chối tại chỗ nữa);
 *  2. câu trả lời `steered` được ghi lại thành dòng xác nhận kèm nguyên văn, và lượt KHÔNG bị
 *     đóng — trạng thái vẫn là trạng thái đang sống, nội dung đang chạy còn nguyên;
 *  3. lượt chưa mở xong (`starting`) vẫn bị từ chối tại chỗ;
 *  4. lệnh điều khiển `/stop` vẫn đi tới harness để thoát lượt đang bị chặn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { path: string; body?: unknown; method?: string }

const calls: Call[] = []

const { agentApiMock } = vi.hoisted(() => ({ agentApiMock: vi.fn() }))

vi.mock('../lib/agentApi', () => ({ agentApi: agentApiMock }))

import { useHarnessChatStore } from './harnessChatStore'
import { useUiStore } from './uiStore'

const CHAT = 'chat-blocked'
const SID = 'sid-b'

beforeEach(() => {
  calls.length = 0
  agentApiMock.mockReset()
  agentApiMock.mockImplementation(async (path: string, body?: unknown, method?: string) => {
    calls.push({ path, body, method: method ?? (body === undefined ? 'GET' : 'POST') })
    // 202 của harness khi chỉ thị đã vào hàng đợi của lượt đang chạy.
    if (path.includes('/turns')) return { status: 'steered', steerId: 'steer-1' }
    return { id: 'sid-b', status: 'running', events: [] }
  })
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

describe('send khi lượt đang chạy', () => {
  it('prompt thường được XẾP HÀNG: gửi lên harness và ghi dòng xác nhận kèm nguyên văn', async () => {
    await useHarnessChatStore.getState().send(CHAT, 'dừng nhánh luật, hạ xuống mức 2', null)

    const turn = calls.find((call) => call.path === `/sessions/${SID}/turns`)
    expect(turn).toBeTruthy()
    expect(turn?.method).toBe('POST')
    expect((turn?.body as { prompt?: string })?.prompt).toBe('dừng nhánh luật, hạ xuống mức 2')

    const session = useHarnessChatStore.getState().sessions[CHAT]
    // Lượt KHÔNG bị đóng và không hoá `starting`: đây vẫn là lượt đang chạy.
    expect(session.status).toBe('running')
    expect(session.error).toBeNull()
    expect(session.steerNotice?.text).toBe('dừng nhánh luật, hạ xuống mức 2')
    expect(session.steerNotice?.steerId).toBe('steer-1')
    // Và vòng poll sau chỉ thị vẫn chạy để trạng thái thật trở về.
    expect(calls.some((call) => call.path.startsWith(`/sessions/${SID}?after=`))).toBe(true)
  })

  it('lượt chưa mở xong (`starting`) vẫn bị từ chối tại chỗ — không gửi, không có banner lỗi', async () => {
    useHarnessChatStore.setState({
      sessions: { [CHAT]: { id: SID, status: 'starting', events: [], error: null } },
    })

    await useHarnessChatStore.getState().send(CHAT, 'Làm tiếp việc khác', null)

    expect(calls).toEqual([])
    expect(useHarnessChatStore.getState().sessions[CHAT].status).toBe('starting')
    expect(useHarnessChatStore.getState().sessions[CHAT].error).toBeNull()
    expect(useHarnessChatStore.getState().sessions[CHAT].steerNotice ?? null).toBeNull()
  })

  it('chỉ thị bị harness từ chối (`BOXFOX_STEER=off` ⇒ 409) thì lượt vẫn đang chạy, chỉ hiện lỗi', async () => {
    // Lượt chạy thật vẫn sống ở harness: chỉ câu vừa gõ là không được nhận.
    agentApiMock.mockImplementationOnce(async (path: string, body?: unknown, method?: string) => {
      calls.push({ path, body, method: method ?? 'POST' })
      throw new Error('Error: {"error":{"code":"SESSION_BUSY","message":"Turn in progress"}}')
    })

    await useHarnessChatStore.getState().send(CHAT, 'dừng nhánh luật', null)

    const session = useHarnessChatStore.getState().sessions[CHAT]
    expect(session.status).toBe('awaiting_decision')
    expect(session.error).toContain('SESSION_BUSY')
    expect(session.steerNotice ?? null).toBeNull()
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
