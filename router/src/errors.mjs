export class RouterError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const messages = {
  AUTH: 'Provider authentication failed. Reconnect or replace the credential.',
  RATE_LIMIT: 'Provider rate limit or quota reached. Try again later.',
  CAPACITY: 'The provider is temporarily at capacity. Retry shortly.',
  MODEL_NOT_FOUND: 'The provider no longer exposes this model. Refresh model inventory.',
  POLICY_DENIED: 'The provider rejected this request because of an upstream policy.',
  TIMEOUT: 'The request deadline was reached.',
  CANCELLED: 'Request cancelled.',
  PROJECT_REQUIRED: 'This account requires a Google Cloud project ID. Enter it in Provider.',
  PROJECT_DISCOVERY: 'Could not establish the account project. Retry discovery.',
  UNAVAILABLE: 'Provider is unavailable or returned an invalid response.',
  CAPABILITY: 'This model does not support the requested operation.',
};
export function safeError(error) {
  if (error instanceof RouterError) return error;
  if (error?.name === 'AbortError') return new RouterError('CANCELLED', messages.CANCELLED, 499);
  if (error?.name === 'TimeoutError') return new RouterError('TIMEOUT', messages.TIMEOUT, 504, true);
  const status = Number(error?.status) || 502;
  const code = messages[error?.code] ? error.code : status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : 'UNAVAILABLE';
  return new RouterError(code, messages[code], status, Boolean(error?.retryable) || status === 429 || status >= 500);
}
export function assert(condition, message, code = 'INVALID_REQUEST', status = 400) {
  if (!condition) throw new RouterError(code, message, status);
}
export function errorEnvelope(error) {
  const safe = safeError(error);
  return { error: { code: safe.code, message: safe.message, retryable: safe.retryable, ...(Number.isFinite(safe.retryAfterMs) ? { retryAfterMs: safe.retryAfterMs } : {}) } };
}
