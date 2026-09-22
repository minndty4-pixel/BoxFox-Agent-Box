// A6/A7 — thân request `/turns` phải mang `attachments` (đường dẫn tệp đã nằm trên box) và
// `images` (nhiều ảnh), đồng thời vẫn giữ `image` số ít cho harness cũ trong lúc triển khai.
// Lượt không có ảnh/tệp thì KHÔNG được gửi thêm khoá rỗng.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ path: string; body: Record<string, unknown> | null; method: string }> = []

vi.mock('../lib/agentApi', () => ({
  agentApi: async (path: string, body?: unknown, method?: string) => {
    calls.push({ path, body: (body ?? null) as Record<string, unknown> | null, method: method ?? (body === undefined ? 'GET' : 'POST') })
    if (path === '/owner-settings') return { instructions: 'Be brief.', revision: 1 }
    if (path === '/catalog') return { skills: [] }
    if (path === '/skill-settings') return { enabled: [], revision: 0, initialized: true }
    if (path === '/sessions') return { id: 'sid-attach-1', status: 'queued', events: [], config: {} }
    if (path.endsWith('/turns')) return {}
    return { id: 'sid-attach-1', status: 'running', events: [] }
  },
}))

import { useHarnessChatStore } from './harnessChatStore'
import { useHarnessStore } from './harnessStore'
import { useOwnerSettingsStore } from './ownerSettingsStore'
import { useSessionRecordStore } from './sessionRecordStore'
import type { OutgoingAttachment } from '../lib/chat/attachmentUpload'

const CHAT = 'chat-attachments'
const pristineHarness = useHarnessStore.getState()
const pristineOwner = useOwnerSettingsStore.getState()

const turnBody = () => calls.filter((call) => call.path.endsWith('/turns')).pop()?.body ?? {}

const attachment: OutgoingAttachment = {
  name: '3.md',
  path: '.uploaded_artifacts/proj/src/3.md',
  absolutePath: '/home/agent/workspace/.uploaded_artifacts/proj/src/3.md',
  sizeBytes: 42,
  kind: 'folder-item',
}

beforeEach(() => {
  calls.length = 0
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

describe('harnessChatStore.send — ảnh và tệp đính kèm', () => {
  it('gửi nhiều ảnh: có `images`, và `image` giữ ảnh đầu cho harness cũ', async () => {
    await useHarnessChatStore
      .getState()
      .send(CHAT, 'xem hai ảnh', null, 'data:image/png;base64,AAA', undefined, undefined, [
        'data:image/png;base64,AAA',
        'data:image/png;base64,BBB',
      ])

    const body = turnBody()
    expect(body.prompt).toBe('xem hai ảnh')
    expect(body.images).toEqual(['data:image/png;base64,AAA', 'data:image/png;base64,BBB'])
    expect(body.image).toBe('data:image/png;base64,AAA')
    expect(body.attachments).toBeUndefined()
  })

  it('gửi tệp: `attachments` đi kèm, prompt rỗng dùng câu mô tả tệp', async () => {
    await useHarnessChatStore.getState().send(CHAT, '', null, undefined, undefined, undefined, undefined, [attachment])

    const body = turnBody()
    expect(body.attachments).toEqual([attachment])
    expect(body.prompt).toBe('Inspect the attached files.')
  })

  it('lượt chỉ có text: không thêm khoá `images`/`attachments` rỗng', async () => {
    await useHarnessChatStore.getState().send(CHAT, 'chỉ chữ', null)

    const body = turnBody()
    expect(body.prompt).toBe('chỉ chữ')
    expect('images' in body).toBe(false)
    expect('attachments' in body).toBe(false)
  })
})
