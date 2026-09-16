import { describe, expect, it } from 'vitest'
import { readRouterSse, RouterStreamError, type RouterStreamEvent } from './routerStream'

function streamBytes(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('readRouterSse', () => {
  it('handles UTF-8 characters, CRLF, and arbitrary chunk boundaries', async () => {
    const source =
      'data: {"boxfox":{"requestId":"req-1","connectionId":"conn-1","modelId":"model-1","aliasId":null}}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"Xin chào 🌟"}}]}\r\n\r\n' +
      'data: {"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\r\n\r\n' +
      'data: [DONE]\r\n\r\n'
    const encoded = new TextEncoder().encode(source)
    const star = new TextEncoder().encode('🌟')
    const starStart = encoded.findIndex((_, index) =>
      star.every((byte, offset) => encoded[index + offset] === byte),
    )
    const chunks = [
      encoded.slice(0, 13),
      encoded.slice(13, starStart + 1),
      encoded.slice(starStart + 1, starStart + 3),
      encoded.slice(starStart + 3),
    ]
    const events: RouterStreamEvent[] = []

    await readRouterSse(streamBytes(chunks), (event) => events.push(event))

    expect(events).toContainEqual({ type: 'content', content: 'Xin chào 🌟' })
    expect(events).toContainEqual({
      type: 'meta',
      meta: { requestId: 'req-1', connectionId: 'conn-1', modelId: 'model-1', aliasId: null },
    })
    expect(events).toContainEqual({
      type: 'usage',
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    })
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('stops at an SSE error and never reports a later DONE as success', async () => {
    const source =
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n' +
      'data: {"error":{"code":"upstream_429","message":"Busy","retryable":true}}\n\n' +
      'data: [DONE]\n\n'
    const events: RouterStreamEvent[] = []

    await expect(
      readRouterSse(streamBytes([new TextEncoder().encode(source)]), (event) => events.push(event)),
    ).rejects.toMatchObject({ code: 'upstream_429', retryable: true } satisfies Partial<RouterStreamError>)

    expect(events).toContainEqual({ type: 'content', content: 'partial' })
    expect(events).not.toContainEqual({ type: 'done' })
  })
})
