import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRouterChatStoreForTests, useRouterChatStore } from './routerChatStore'

function sseResponse(frames: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(`data: ${frame}\n\n`))
        controller.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function successResponse(requestId: string, content: string) {
  return sseResponse([
    JSON.stringify({
      boxfox: { requestId, connectionId: 'conn-1', modelId: 'model-1', aliasId: null },
    }),
    JSON.stringify({ choices: [{ delta: { content } }] }),
    JSON.stringify({ choices: [{ finish_reason: 'stop' }] }),
    JSON.stringify({ usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }),
    '[DONE]',
  ])
}

describe('routerChatStore', () => {
  beforeEach(() => {
    resetRouterChatStoreForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetRouterChatStoreForTests()
  })

  it('sends every turn as a fresh one-message payload', async () => {
    const bodies: unknown[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return successResponse(`req-${bodies.length}`, `answer-${bodies.length}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    useRouterChatStore.getState().setSelection({ kind: 'model', connectionId: 'conn-1', modelId: 'model-1' })

    await useRouterChatStore.getState().send('first prompt')
    await useRouterChatStore.getState().send('second prompt')

    expect(bodies).toEqual([
      {
        connectionId: 'conn-1',
        modelId: 'model-1',
        messages: [{ role: 'user', content: 'first prompt' }],
        stream: true,
        max_tokens: 256,
      },
      {
        connectionId: 'conn-1',
        modelId: 'model-1',
        messages: [{ role: 'user', content: 'second prompt' }],
        stream: true,
        max_tokens: 256,
      },
    ])
    expect(useRouterChatStore.getState().turns.map((turn) => turn.response)).toEqual(['answer-1', 'answer-2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps partial output when an SSE error fails the turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          JSON.stringify({ choices: [{ delta: { content: 'partial answer' } }] }),
          JSON.stringify({ error: { code: 'upstream_failure', message: 'Provider failed', retryable: true } }),
          '[DONE]',
        ]),
      ),
    )
    useRouterChatStore.getState().setSelection({ kind: 'alias', aliasId: 'fast' })

    const ok = await useRouterChatStore.getState().send('hello')
    const turn = useRouterChatStore.getState().turns[0]

    expect(ok).toBe(false)
    expect(turn).toMatchObject({
      response: 'partial answer',
      status: 'failed',
      error: 'Provider failed',
    })
  })

  it('cancels an active request and ignores late stream updates', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const encoder = new TextEncoder()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'))
            })
          },
        })
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }),
    )
    useRouterChatStore.getState().setSelection({ kind: 'model', connectionId: 'conn-1', modelId: 'model-1' })

    const pending = useRouterChatStore.getState().send('cancel me')
    await Promise.resolve()
    await Promise.resolve()
    useRouterChatStore.getState().stop()

    expect(streamController).not.toBeNull()
    await pending
    const turn = useRouterChatStore.getState().turns[0]
    expect(turn?.status).toBe('cancelled')
    expect(turn?.response).toBe('partial')
    expect(turn?.status).not.toBe('completed')
    expect(useRouterChatStore.getState().isSending).toBe(false)
  })
})
