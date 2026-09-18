import type { RouterRequestMeta } from '../types/provider'

export type RouterMessageContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

export interface RouterChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: RouterMessageContent | null
  tool_calls?: RouterToolCallDelta[]
  tool_call_id?: string
}

export interface RouterGenerateBody {
  connectionId?: string
  modelId?: string
  aliasId?: string
  messages: RouterChatMessage[]
  stream: true
  max_tokens: number
}

export interface RouterTokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface RouterToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
  [key: string]: unknown
}

export type RouterStreamEvent =
  | { type: 'meta'; meta: RouterRequestMeta }
  | { type: 'content'; content: string }
  | { type: 'tools'; toolCalls: RouterToolCallDelta[] }
  | { type: 'finish'; finishReason: string }
  | { type: 'usage'; usage: RouterTokenUsage }
  | { type: 'done' }

interface RouterErrorPayload {
  error?: {
    code?: string
    message?: string
    retryable?: boolean
  }
}

interface OpenAiStreamPayload extends RouterErrorPayload {
  boxfox?: Partial<RouterRequestMeta>
  usage?: RouterTokenUsage
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: RouterToolCallDelta[]
    }
    finish_reason?: string | null
  }>
}

export class RouterStreamError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number | null

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean; status?: number | null } = {},
  ) {
    super(message)
    this.name = 'RouterStreamError'
    this.code = options.code ?? 'router_stream_error'
    this.retryable = options.retryable ?? false
    this.status = options.status ?? null
  }
}

function abortError(): DOMException {
  return new DOMException('The request was aborted.', 'AbortError')
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function isRouterMeta(value: Partial<RouterRequestMeta> | undefined): value is RouterRequestMeta {
  return Boolean(
    value &&
      typeof value.requestId === 'string' &&
      typeof value.connectionId === 'string' &&
      typeof value.modelId === 'string',
  )
}

function parseEventData(frame: string): string | null {
  const lines = frame.split(/\r\n|\n|\r/)
  const data: string[] = []
  for (const line of lines) {
    if (line === '' || line.startsWith(':')) continue
    if (line === 'data') {
      data.push('')
      continue
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5)
      data.push(value.startsWith(' ') ? value.slice(1) : value)
    }
  }
  return data.length > 0 ? data.join('\n') : null
}

function findFrameBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer)
  return match ? { index: match.index, length: match[0].length } : null
}

function decodePayload(data: string): OpenAiStreamPayload {
  try {
    const parsed = JSON.parse(data) as unknown
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('SSE payload must be an object')
    }
    return parsed as OpenAiStreamPayload
  } catch {
    throw new RouterStreamError('Router returned malformed SSE data.', {
      code: 'malformed_sse',
      retryable: true,
    })
  }
}

function dispatchPayload(
  payload: OpenAiStreamPayload,
  onEvent: (event: RouterStreamEvent) => void,
) {
  if (payload.error) {
    throw new RouterStreamError(payload.error.message ?? 'Router request failed.', {
      code: payload.error.code,
      retryable: payload.error.retryable,
    })
  }

  if (isRouterMeta(payload.boxfox)) {
    onEvent({
      type: 'meta',
      meta: {
        requestId: payload.boxfox.requestId,
        connectionId: payload.boxfox.connectionId,
        modelId: payload.boxfox.modelId,
        aliasId: typeof payload.boxfox.aliasId === 'string' ? payload.boxfox.aliasId : null,
      },
    })
  }

  if (payload.usage && typeof payload.usage === 'object') {
    onEvent({ type: 'usage', usage: payload.usage })
  }

  for (const choice of payload.choices ?? []) {
    if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
      onEvent({ type: 'content', content: choice.delta.content })
    }
    if (Array.isArray(choice.delta?.tool_calls) && choice.delta.tool_calls.length > 0) {
      onEvent({ type: 'tools', toolCalls: choice.delta.tool_calls })
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
      onEvent({ type: 'finish', finishReason: choice.finish_reason })
    }
  }
}

export async function readRouterSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: RouterStreamEvent) => void,
  signal?: AbortSignal,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false

  const processFrame = (frame: string) => {
    const data = parseEventData(frame)
    if (data === null) return
    if (data.trim() === '[DONE]') {
      sawDone = true
      onEvent({ type: 'done' })
      return
    }
    dispatchPayload(decodePayload(data), onEvent)
  }

  const drain = () => {
    let boundary = findFrameBoundary(buffer)
    while (boundary) {
      const frame = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary.length)
      if (frame.trim().length > 0) processFrame(frame)
      if (sawDone) return
      boundary = findFrameBoundary(buffer)
    }
  }

  try {
    while (!sawDone) {
      assertNotAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      drain()
    }

    if (!sawDone) {
      buffer += decoder.decode()
      drain()
    }

    assertNotAborted(signal)
    if (!sawDone) {
      throw new RouterStreamError('Router stream ended before [DONE].', {
        code: 'stream_incomplete',
        retryable: true,
      })
    }
  } finally {
    reader.releaseLock()
  }
}

async function readHttpError(response: Response): Promise<RouterStreamError> {
  let payload: RouterErrorPayload | null
  try {
    payload = (await response.json()) as RouterErrorPayload
  } catch {
    payload = null
  }
  return new RouterStreamError(payload?.error?.message ?? `Router request failed (${response.status}).`, {
    code: payload?.error?.code ?? `http_${response.status}`,
    retryable: payload?.error?.retryable ?? response.status >= 500,
    status: response.status,
  })
}

export async function streamRouterGenerate(
  body: RouterGenerateBody,
  options: {
    signal: AbortSignal
    onEvent: (event: RouterStreamEvent) => void
    fetchImpl?: typeof fetch
  },
) {
  assertNotAborted(options.signal)
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl('/api/router/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BoxFox-Admin': '1',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) throw await readHttpError(response)
  if (!response.body) {
    throw new RouterStreamError('Router returned an empty stream.', {
      code: 'empty_stream',
      retryable: true,
      status: response.status,
    })
  }

  await readRouterSse(response.body, options.onEvent, options.signal)
}
