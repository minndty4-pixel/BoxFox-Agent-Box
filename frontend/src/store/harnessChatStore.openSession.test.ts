// Đường gửi: phiên mới phải mang theo chỉ dẫn của chủ sở hữu và các núm của harness,
// nhưng chỉ gửi trường nào harness thật sự đặt — thiếu trường là engine tự quyết.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ path: string; body: Record<string, unknown> | null; method: string }> = []
let ownerSettings: { instructions: string; revision: number } | null = { instructions: 'Be brief.', revision: 4 }

vi.mock('../lib/agentApi', () => ({
  agentApi: async (path: string, body?: unknown, method?: string) => {
    calls.push({ path, body: (body ?? null) as Record<string, unknown> | null, method: method ?? (body === undefined ? 'GET' : 'POST') })
    if (path === '/owner-settings') {
      if (!ownerSettings) throw new Error('Harness engine unavailable. Start the BoxFox launcher.')
      return ownerSettings
    }
    if (path === '/catalog') return { skills: [] }
    if (path === '/skill-settings') return { enabled: [], revision: 0, initialized: true }
    if (path === '/sessions') return { id: 'sid-open-1', status: 'queued', events: [], config: { contextWindow: 200000, contextWindowSource: 'catalog' } }
    if (path.endsWith('/turns')) return {}
    if (path === '/runtime-info') return {}
    return { id: 'sid-open-1', status: 'running', events: [] }
  },
}))

import { useHarnessChatStore } from './harnessChatStore'
import { useHarnessStore } from './harnessStore'
import { useOwnerSettingsStore } from './ownerSettingsStore'
import { useSessionRecordStore } from './sessionRecordStore'

const CHAT = 'chat-open-session'
const pristineHarness = useHarnessStore.getState()
const pristineOwner = useOwnerSettingsStore.getState()
const sessionBody = () => calls.find((call) => call.path === '/sessions')?.body ?? {}

beforeEach(() => {
  calls.length = 0
  ownerSettings = { instructions: 'Be brief.', revision: 4 }
  useHarnessStore.setState(pristineHarness, true)
  useOwnerSettingsStore.setState(pristineOwner, true)
  useSessionRecordStore.getState().reset()
  useHarnessChatStore.setState({ sessions: {} })
  localStorage.clear()
})

afterEach(() => {
  useHarnessChatStore.setState({ sessions: {} })
  localStorage.clear()
})

const send = async () => useHarnessChatStore.getState().send(CHAT, 'hello', null)

describe('openSession — đường gửi mang chỉ dẫn', () => {
  it('carries the owner directives and the harness id, and books the session', async () => {
    await send()

    expect(sessionBody().instructions).toBe('Be brief.')
    expect(sessionBody().harnessId).toBe('open-model-harness-copy-1')

    const record = useSessionRecordStore.getState().get('sid-open-1')
    expect(record).toMatchObject({ harnessId: 'open-model-harness-copy-1', instructionsChars: 9 })
    expect(record?.directivesSkipped).toBeUndefined()
  })

  it('omits the engine knobs a harness never set', async () => {
    await send()

    expect(sessionBody()).not.toHaveProperty('maxSteps')
    expect(sessionBody()).not.toHaveProperty('deadlineSeconds')
    expect(sessionBody()).not.toHaveProperty('tools')
  })

  it('sends the knobs only when the harness sets them, clamped to the engine range', async () => {
    const id = 'open-model-harness-copy-1'
    useHarnessStore.getState().setHarnessTuning(id, { maxSteps: 999, deadlineSeconds: 12, tools: ['file_read'] })

    await send()

    expect(sessionBody()).toMatchObject({ maxSteps: 60, deadlineSeconds: 12, tools: ['file_read'] })
    // Đường gửi đọc đúng harness đang dùng, không phải bản ghi đầu tiên trong danh sách.
    useHarnessStore.getState().setActiveHarness('open-model-harness')
    calls.length = 0
    await send()
    expect(sessionBody()).not.toHaveProperty('maxSteps')
  })

  it('still opens the session when the directives cannot be read, and says so', async () => {
    ownerSettings = null

    await send()

    expect(calls.some((call) => call.path === '/sessions')).toBe(true)
    expect(sessionBody()).not.toHaveProperty('instructions')
    const record = useSessionRecordStore.getState().get('sid-open-1')
    expect(record?.instructionsChars).toBe(0)
    expect(record?.directivesSkipped).toContain('Harness engine unavailable')
    expect(useOwnerSettingsStore.getState().loadError).toContain('Harness engine unavailable')
  })

  it('reads the directives once and reuses them for later sessions', async () => {
    await send()
    calls.length = 0
    localStorage.clear()
    useHarnessChatStore.setState({ sessions: {} })
    useSessionRecordStore.getState().reset()

    await send()

    expect(calls.filter((call) => call.path === '/owner-settings')).toHaveLength(0)
    expect(sessionBody().instructions).toBe('Be brief.')
  })
})
