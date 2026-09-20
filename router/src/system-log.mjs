/**
 * Developer system log for the router process — same JSONL shape as the harness
 * writer (`backend/src/agentbox/observability/system_log.py`), one file per
 * source in `~/BoxFox/logs`. The log directory lives on the HOST, outside the
 * sandbox container, so the agent inside the box cannot read it.
 *
 * Writing is best-effort: a log failure must never break a model request.
 *
 * Lifecycle (the owner's rule: log only while running, reset on shutdown):
 * `runId` is stamped on every line so two runs can be told apart, and the
 * GRACEFUL shutdown (`router.stop` → `resetOnShutdown()`) renames the active
 * file to `router.previous.jsonl`, replacing the older previous file, so the
 * next run starts empty. A hard kill skips that call entirely and leaves the
 * file — and everything in it — on disk.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG_DIR = process.env.BOXFOX_SYSTEM_LOG_DIR || path.join(os.homedir(), 'BoxFox', 'logs');
const FILE = path.join(LOG_DIR, 'router.jsonl');
const PREVIOUS_FILE = path.join(LOG_DIR, 'router.previous.jsonl');
const MAX_BYTES = 8 * 1024 * 1024;
const BACKUPS = 4;
const MAX_CHARS = 4000;
const REDACT = new Set(['apikey', 'api_key', 'apiKey', 'authorization', 'password', 'secret', 'token']);

/** Sortable per-process run id — the same idea as the harness `new_run_id()`. */
function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${process.pid}-${randomBytes(2).toString('hex')}`;
}

const RUN_ID = newRunId();

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
      runId: RUN_ID,
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

/**
 * Owner's rule on a GRACEFUL shutdown: the finished run becomes
 * `router.previous.jsonl` and the next run starts with an empty active file.
 * Exactly one previous file is kept (bounded disk). Best-effort, like every
 * other write here; returns the previous path or null when there was nothing
 * to reset.
 */
export function resetOnShutdown() {
  try {
    if (!fs.existsSync(FILE)) return null;
    fs.rmSync(PREVIOUS_FILE, { force: true });
    fs.renameSync(FILE, PREVIOUS_FILE);
    return PREVIOUS_FILE;
  } catch {
    return null;
  }
}

export const runId = RUN_ID;
export const logPath = FILE;
export const previousLogPath = PREVIOUS_FILE;
export const logDir = LOG_DIR;
