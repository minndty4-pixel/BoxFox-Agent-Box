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
  KEYS_PRESENT: 'Remove the keys on this connection first — deleting it would drop them.',
};
export function safeError(error) {
  if (error instanceof RouterError) return error;
  if (error?.name === 'AbortError') return new RouterError('CANCELLED', messages.CANCELLED, 499);
  if (error?.name === 'TimeoutError') return new RouterError('TIMEOUT', messages.TIMEOUT, 504, true);
  const status = Number(error?.status) || 502;
  const code = messages[error?.code] ? error.code : status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : 'UNAVAILABLE';
  return new RouterError(code, messages[code], status, Boolean(error?.retryable) || status === 429 || status >= 500);
}

/**
 * Statuses that can only be about THIS request, never about the credential: a 400 caused
 * by the request itself (context overflow, malformed body, unsupported parameter, content
 * policy on one input) says nothing about the account. Account-scoped statuses keep their
 * own rules: 401 and 403 (authentication/authorization), 402 (billing), 404 (the model
 * inventory is stale) and 429 (rate limit) still belong to the connection.
 *
 * Ported from 9Router's `checkFallbackError()` (`open-sse/services/accountFallback.js:48-60`),
 * whose comment gives the reason: cooling a healthy connection down only takes it out of
 * rotation, and with a single connection every later request in the window fails with a copy
 * of this very error ("all 1 accounts locked for <model> | lastError=[400]: ..."), which hides
 * the real cause from the caller. Hand the upstream error back for this request instead.
 */
const ACCOUNT_SCOPED_STATUSES = new Set([401, 402, 403, 404, 429]);
export function requestScopedClientError(error) {
  const status = Number(safeError(error)?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 && !ACCOUNT_SCOPED_STATUSES.has(status);
}
export function assert(condition, message, code = 'INVALID_REQUEST', status = 400) {
  if (!condition) throw new RouterError(code, message, status);
}
export function errorEnvelope(error) {
  const safe = safeError(error);
  return { error: { code: safe.code, message: safe.message, retryable: safe.retryable, ...(Number.isFinite(safe.retryAfterMs) ? { retryAfterMs: safe.retryAfterMs } : {}) } };
}
