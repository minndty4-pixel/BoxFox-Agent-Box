/**
 * Regression: the 1200 ms refresh poll must not wipe an error the user is still reading.
 * Root cause found during the E2E fix batch (BUG-17): refresh() assigned `error: null`
 * whenever the session was not failed, so the inline alert vanished after one poll.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const sessions: Record<string, { id: string; status: string; events: Array<{ seq: number; type: string; data: Record<string, unknown>; created: number }> }> = {}

vi.mock('../lib/agentApi', () => ({
  agentApi: async (path: string) => {
    const id = path.split('?')[0].split('/').pop() as string
    const session = sessions[id]
    if (!session) throw new Error('Harness HTTP 404: Not found')
    return session
  },
}))

import { useHarnessChatStore } from './harnessChatStore'

const CHAT = 'chat-error-persistence'

afterEach(() => {
  useHarnessChatStore.setState({ sessions: {} })
  for (const key of Object.keys(sessions)) delete sessions[key]
})

describe('harnessChatStore error persistence', () => {
  it('keeps a reported error across a poll that reports no failure', async () => {
    sessions['sid-1'] = { id: 'sid-1', status: 'running', events: [] }
    useHarnessChatStore.setState({
      sessions: { [CHAT]: { id: 'sid-1', status: 'failed', events: [], error: 'SETUP_REQUIRED: install the CLI' } },
    })

    await useHarnessChatStore.getState().refresh(CHAT)

    expect(useHarnessChatStore.getState().sessions[CHAT].error).toBe('SETUP_REQUIRED: install the CLI')
  })

  it('replaces the error when the session reports a new error event', async () => {
    sessions['sid-2'] = {
      id: 'sid-2',
      status: 'failed',
      events: [{ seq: 3, type: 'error', data: { message: 'CONTEXT_LIMIT: too large' }, created: 3 }],
    }
    useHarnessChatStore.setState({
      sessions: { [CHAT]: { id: 'sid-2', status: 'running', events: [], error: 'old message' } },
    })

    await useHarnessChatStore.getState().refresh(CHAT)

    expect(useHarnessChatStore.getState().sessions[CHAT].error).toBe('CONTEXT_LIMIT: too large')
  })

  it('clears the error when a new turn starts', async () => {
    useHarnessChatStore.setState({
      sessions: { [CHAT]: { id: 'sid-3', status: 'failed', events: [], error: 'old message' } },
    })
    sessions['sid-3'] = { id: 'sid-3', status: 'failed', events: [] }

    await useHarnessChatStore.getState().refresh(CHAT)
    expect(useHarnessChatStore.getState().sessions[CHAT].error).toBe('old message')

    // clearError is what the UI's dismiss button calls.
    useHarnessChatStore.getState().clearError(CHAT)
    expect(useHarnessChatStore.getState().sessions[CHAT]?.error ?? null).toBeNull()
  })
})
