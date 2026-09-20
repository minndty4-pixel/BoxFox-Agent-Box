/**
 * Router unit tests must never write into the operator's real log directory
 * (`~/BoxFox/logs`) — the same rule the harness tests follow through
 * `backend/tests/conftest.py` (BUG-31). Loaded with `--import` by `npm test`, so it
 * runs before any test file (and therefore before `src/system-log.mjs` resolves its
 * path). An explicit BOXFOX_SYSTEM_LOG_DIR still wins.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BOXFOX_SYSTEM_LOG_DIR ??= mkdtempSync(join(tmpdir(), 'boxfox-router-test-logs-'));
