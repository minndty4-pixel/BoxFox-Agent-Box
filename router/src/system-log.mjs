/**
 * Developer system log for the router process — same JSONL shape as the harness
 * writer (`backend/src/agentbox/observability/system_log.py`), one file per
 * source in `~/BoxFox/logs`. The log directory lives on the HOST, outside the
 * sandbox container, so the agent inside the box cannot read it.
 *
 * Writing is best-effort: a log failure must never break a model request.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG_DIR = process.env.BOXFOX_SYSTEM_LOG_DIR || path.join(os.homedir(), 'BoxFox', 'logs');
const FILE = path.join(LOG_DIR, 'router.jsonl');
const MAX_BYTES = 8 * 1024 * 1024;
const BACKUPS = 4;
const MAX_CHARS = 4000;
const REDACT = new Set(['apikey', 'api_key', 'apiKey', 'authorization', 'password', 'secret', 'token']);

function redact(value, depth = 0) {
  if (depth > 3) return '…';
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      out[key] = REDACT.has(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.length <= 400 ? value : value.slice(0, 400) + '…';
  if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) return value;
  return String(value).slice(0, 400);
}

function rotate() {
  try {
    for (let index = BACKUPS - 1; index > 0; index -= 1) {
      const older = `${FILE}.${index}`;
      const newer = `${FILE}.${index - 1}`;
      if (fs.existsSync(newer)) fs.renameSync(newer, older);
    }
    fs.renameSync(FILE, `${FILE}.0`);
  } catch {
    /* rotation is best-effort */
  }
}

export function logEvent(event, fields = {}) {
  try {
    const { level = 'info', message, code, requestId, provider, model, durationMs, ...data } = fields;
    const entry = {
      ts: new Date().toISOString(),
      level,
      source: 'router',
      event,
    };
    if (requestId) entry.requestId = requestId;
    if (provider) entry.provider = provider;
    if (model) entry.model = model;
    if (code) entry.code = code;
    if (message) entry.message = String(message).slice(0, 1000);
    if (durationMs !== undefined && durationMs !== null) entry.durationMs = Math.round(durationMs * 10) / 10;
    if (Object.keys(data).length) entry.data = redact(data);
    let line = JSON.stringify(entry);
    if (line.length > MAX_CHARS) line = line.slice(0, MAX_CHARS - 20) + '…[truncated]"}';
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (fs.existsSync(FILE) && fs.statSync(FILE).size >= MAX_BYTES) rotate();
    fs.appendFileSync(FILE, line + '\n');
  } catch {
    /* never break a request because of logging */
  }
}

export function logFailure(event, error, fields = {}) {
  logEvent(event, {
    level: 'error',
    code: fields.code || (error && error.name) || 'ROUTER_ERROR',
    message: (error && error.message) || String(error || 'unknown router failure'),
    ...fields,
  });
}

export const logPath = FILE;
export const logDir = LOG_DIR;
