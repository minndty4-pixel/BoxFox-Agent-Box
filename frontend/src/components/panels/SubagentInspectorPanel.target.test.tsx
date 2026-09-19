/**
 * Chip chuyên gia trong transcript mở tab Sub-agents kèm `sessionId`
 * (`components/chat/HarnessStepView.tsx` → `openTab('subagents', { sessionId })`).
 * Tab phải chọn ĐÚNG em đó, nhưng sau đó người dùng vẫn tự đổi được.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useHarnessChatStore } from '../../store/harnessChatStore'
import { useUiStore } from '../../store/uiStore'
import { SubagentInspectorPanel } from './SubagentInspectorPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHAT_ID = 'chat-subagents'

let roots: Root[] = []
const fetchMock = vi.fn()

function child(seq: number, sessionId: string, role: string) {
  return {
    seq,
    type: 'child',
    data: { sessionId, role, status: 'started', goal: `việc của ${role}` },
    created: seq,
  }
}

function seedChildren() {
  useHarnessChatStore.setState({
    sessions: {
      [CHAT_ID]: {
        id: 'sess-1',
        status: 'running',
        events: [child(1, 'child-A', 'Explore'), child(2, 'child-B', 'Build')],
        error: null,
      },
    },
  })
}

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <I18nProvider>
        <SubagentInspectorPanel />
      </I18nProvider>,
    )
  })
  return host
}

function selectedChild(host: HTMLElement): string | null {
  const selected = host.querySelector('[data-child-session-id][data-selected="true"]')
  return selected?.getAttribute('data-child-session-id') ?? null
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ events: [] }) }))
  useAgentStore.setState({ activeSessionId: CHAT_ID })
  seedChildren()
  useUiStore.setState({ tabIntentTargets: {}, openTabs: ['subagents'], activeTab: 'subagents' })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useHarnessChatStore.setState({ sessions: {} })
  vi.unstubAllGlobals()
})

describe('SubagentInspectorPanel — đích từ chip transcript', () => {
  it('không có đích thì chọn em đầu tiên như trước', () => {
    const host = render()

    expect(selectedChild(host)).toBe('child-A')
  })

  it('có `sessionId` trong đích thì chọn đúng em đó', () => {
    useUiStore.setState({ tabIntentTargets: { subagents: { sessionId: 'child-B' } } })
    const host = render()

    expect(selectedChild(host)).toBe('child-B')
  })

  it('người dùng tự đổi em khác thì lựa chọn của họ được giữ', () => {
    useUiStore.setState({ tabIntentTargets: { subagents: { sessionId: 'child-B' } } })
    const host = render()

    const first = host.querySelector('[data-child-session-id="child-A"]')
    act(() => {
      first?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(selectedChild(host)).toBe('child-A')
    // Cập nhật trạng thái (transcript đổi) không kéo về đích cũ.
    act(() => {
      seedChildren()
    })
    expect(selectedChild(host)).toBe('child-A')
  })

  it('đích không có trong danh sách thì không đổi lựa chọn', () => {
    useUiStore.setState({ tabIntentTargets: { subagents: { sessionId: 'child-không-tồn-tại' } } })
    const host = render()

    expect(selectedChild(host)).toBe('child-A')
  })
})
