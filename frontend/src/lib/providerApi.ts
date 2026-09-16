interface ApiOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
    retryable?: boolean
  }
}

export class ProviderApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean

  constructor(message: string, code = 'REQUEST_FAILED', status = 500, retryable = false) {
    super(message)
    this.name = 'ProviderApiError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
  const headers: Record<string, string> = { 'X-BoxFox-Admin': '1' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(110000)]) : AbortSignal.timeout(110000),
    credentials: 'same-origin',
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as T & ErrorEnvelope)
    : null

  if (!response.ok) {
    const error = payload?.error
    throw new ProviderApiError(
      error?.message ?? `Router request failed (${response.status}).`,
      error?.code,
      response.status,
      error?.retryable,
    )
  }

  return payload as T
}
