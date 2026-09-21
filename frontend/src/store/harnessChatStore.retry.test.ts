/**
 * Hai lỗi người dùng gặp trong cùng một buổi: mức thinking gửi đi không phải mức model công bố,
 * và một id phiên cũ làm mọi lần gửi hỏng mãi với đúng một chữ "Not found".
 *
 * Cả hai đều được sửa ở đây, nên ca kiểm nằm ngay trên `send()` — nơi dựng thân request.
 * Mock trả 404 cho id đã chết: bản đầu trả lời lành cho **mọi** GET, nên vòng poll sau khi
 * tự mở lại phiên không bao giờ chạm đúng chỗ hỏng trong thực tế (store vẫn giữ id cũ).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { path: string; body: any }

const calls: Call[] = []
let turnFailures: Error[] = []
const deadSessions: Record<string, Error> = {}

vi.mock('../lib/agentApi', () => ({
  agentApi: async (path: string, body?: unknown) => {
    calls.push({ path, body })
    if (path === '/sessions') return { id: 'fresh-sid' }
    if (path.endsWith('/turns')) {
      const failure = turnFailures.shift()
      if (failure) throw failure
      return { status: 'running' }
    }
    const id = path.split('?')[0].split('/').pop() as string
    if (deadSessions[id]) throw deadSessions[id]
    return { id, status: 'running', events: [] }
  },
}))

vi.mock('./skillsStore', () => ({
  useSkillsStore: { getState: () => ({ load: async () => undefined, skills: [] }) },
}))

import { useHarnessChatStore } from './harnessChatStore'
import { useHarnessStore } from './harnessStore'

const CHAT = 'chat-retry'

const turnCalls = () => calls.filter((call) => call.path.endsWith('/turns'))
const created = () => calls.filter((call) => call.path === '/sessions')

beforeEach(() => {
  calls.length = 0
  turnFailures = []
  for (const key of Object.keys(deadSessions)) delete deadSessions[key]
  localStorage.clear()
  useHarnessChatStore.setState({ sessions: {} })
  useHarnessStore.setState({ thinkingLevel: 'medium' })
})

afterEach(() => {
  useHarnessChatStore.setState({ sessions: {} })
})

describe('send — mức thinking', () => {
  it('kéo mức toàn cục về mức model công bố (DeepSeek Pro không có "medium")', async () => {
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-1', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'model', connectionId: 'c1', modelId: '~deepseek/deepseek-pro-latest' },
      null, 'DeepSeek Low', ['max', 'high', 'low'])

    expect(turnCalls()[0].body.route).toEqual({
      connectionId: 'c1', modelId: '~deepseek/deepseek-pro-latest', thinkingLevel: 'low',
    })
  })

  it('giữ nguyên mức khi model công bố đúng mức đang chọn', async () => {
    useHarnessStore.setState({ thinkingLevel: 'high' })
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-1', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'model', connectionId: 'c1', modelId: 'm1' }, null, 'x', ['max', 'high', 'low'])

    expect(turnCalls()[0].body.route.thinkingLevel).toBe('high')
  })

  it('model chỉ công bố một mức thì mức đó được gửi, không phải mức toàn cục', async () => {
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-1', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'model', connectionId: 'c1', modelId: 'm1' }, null, 'x', ['high'])

    expect(turnCalls()[0].body.route.thinkingLevel).toBe('high')
  })

  it('giữ nguyên mức đang chọn khi model không công bố mức nào', async () => {
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-1', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'model', connectionId: 'c1', modelId: 'm1' }, null, 'x', [])

    expect(turnCalls()[0].body.route.thinkingLevel).toBe('medium')
  })

  it('tuyến alias không gửi mức nào khi chưa biết mức chung của các đích', async () => {
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-1', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'alias', aliasId: 'a1' }, null, 'x')

    expect(turnCalls()[0].body.route).toEqual({ aliasId: 'a1' })
  })

  it('tuyến alias gửi mức chung đã biết của các đích', async () => {
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-1', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'alias', aliasId: 'a1' }, null, 'x', ['low', 'medium'])

    expect(turnCalls()[0].body.route).toEqual({ aliasId: 'a1', thinkingLevel: 'medium' })
  })
})

describe('send — phiên cũ', () => {
  it('mở phiên mới, ghi id mới vào store rồi gửi lại lượt đúng một lần', async () => {
    turnFailures = [new Error('SESSION_NOT_FOUND: session dead-sid is not known to this harness')]
    deadSessions['dead-sid'] = new Error('SESSION_NOT_FOUND: session dead-sid is not known to this harness')
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'dead-sid', status: 'idle', events: [], error: null, lastModelLabel: 'x' } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'model', connectionId: 'c1', modelId: 'm1' }, null, 'x')

    expect(created().length).toBe(1)
    expect(turnCalls().map((call) => call.path)).toEqual(['/sessions/dead-sid/turns', '/sessions/fresh-sid/turns'])
    // Id mới phải nằm trong store: vòng poll 1200 ms và lần gửi sau đều đọc nó trước
    // localStorage, nên chỉ ghi localStorage là khung chat đỏ vĩnh viễn.
    expect(useHarnessChatStore.getState().sessions[CHAT].id).toBe('fresh-sid')
    expect(useHarnessChatStore.getState().sessions[CHAT].error).toBeNull()
    // Sau lượt gửi lại, không còn lời gọi nào nhắm vào id đã chết: vòng poll cuối
    // `send()` phải đọc phiên mới, nếu không khung chat quay lại trạng thái đỏ.
    const afterResend = calls.slice(calls.findIndex((call) => call.path === '/sessions/fresh-sid/turns'))
    expect(afterResend.length).toBeGreaterThan(0)
    expect(afterResend.every((call) => !call.path.startsWith('/sessions/dead-sid'))).toBe(true)
  })

  it('không mở phiên mới khi lỗi không phải phiên cũ', async () => {
    turnFailures = [new Error('UPSTREAM_HTTP_429: the model router answered Router HTTP 429 (rate limit)')]
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'sid-9', status: 'idle', events: [], error: null, lastModelLabel: 'x' } } })

    await useHarnessChatStore.getState().send(CHAT, 'hỏi', { kind: 'model', connectionId: 'c1', modelId: 'm1' }, null, 'x')

    expect(created().length).toBe(0)
    expect(turnCalls().length).toBe(1)
    expect(useHarnessChatStore.getState().sessions[CHAT].error).toContain('UPSTREAM_HTTP_429')
  })
})

describe('refresh — id phiên đã chết', () => {
  it('dọn khung chat im lặng theo mã SESSION_NOT_FOUND, không bày lỗi đỏ', async () => {
    deadSessions['gone-sid'] = new Error('SESSION_NOT_FOUND: session gone-sid is not known to this harness; it was deleted or the harness started with an empty store')
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'gone-sid', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().refresh(CHAT)

    expect(useHarnessChatStore.getState().sessions[CHAT]).toBeUndefined()
    expect(localStorage.getItem(`boxfox-harness-session:${CHAT}`)).toBeNull()
  })

  it('vẫn dọn theo câu chữ cũ của harness bản trước ("Not found")', async () => {
    deadSessions['legacy-sid'] = new Error('Not found')
    useHarnessChatStore.setState({ sessions: { [CHAT]: { id: 'legacy-sid', status: 'idle', events: [], error: null } } })

    await useHarnessChatStore.getState().refresh(CHAT)

    expect(useHarnessChatStore.getState().sessions[CHAT]).toBeUndefined()
  })
})
