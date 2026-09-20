// Bản v2 của nhật ký hệ thống — phía router (việc 7 của chủ sở hữu).
//
// Luật của chủ dự án: "Log sẽ chỉ ghi khi chạy. Khi boxfox shutdown, log được reset."
// Test này chứng minh: mỗi dòng mang `runId` của lượt chạy, `resetOnShutdown()` đổi
// tên file đang ghi thành `router.previous.jsonl` (chỉ giữ ĐÚNG MỘT file trước), và
// một cú kill cứng — tức không gọi được dòng reset nào — không làm mất file.
//
// Thư mục log được đặt lại NGAY TRONG FILE NÀY (trước khi import module, nên phải
// import động): chạy `node --test tests/system-log-lifecycle.test.mjs` trực tiếp cũng
// không bao giờ ghi vào `~/BoxFox/logs` của người vận hành (luật BUG-31).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = mkdtempSync(join(tmpdir(), 'boxfox-router-log-lifecycle-'));
process.env.BOXFOX_SYSTEM_LOG_DIR = LOG_DIR;

const { logEvent, logFailure, logDir, logPath, previousLogPath, runId, resetOnShutdown } =
  await import('../src/system-log.mjs');

after(() => rmSync(LOG_DIR, { recursive: true, force: true }));

const lines = file => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const routerFiles = () => readdirSync(LOG_DIR).filter(name => name.startsWith('router')).sort();
// Mỗi test tự dựng lại trạng thái đầu, để thứ tự chạy không ảnh hưởng kết quả.
const cleanState = () => {
  rmSync(logPath, { force: true });
  rmSync(previousLogPath, { force: true });
};

test('every line carries the run id of this process', () => {
  assert.equal(logDir, LOG_DIR, 'test phải chạy trong thư mục tạm, không phải ~/BoxFox/logs');
  assert.equal(logPath, join(LOG_DIR, 'router.jsonl'));
  assert.equal(previousLogPath, join(LOG_DIR, 'router.previous.jsonl'));
  assert.match(runId, /^\d{8}T\d{6}Z-\d+-[0-9a-f]{4}$/, 'runId phải sắp xếp được và có pid');

  cleanState();
  logEvent('router.start', { port: 3101, pid: process.pid });
  logFailure('chat.failed', new Error('hết hạn'), { code: 'DEADLINE', requestId: 'r1' });

  const entries = lines(logPath);
  assert.equal(entries.length, 2);
  assert.deepEqual([...new Set(entries.map(entry => entry.runId))], [runId]);
  assert.equal(entries[0].event, 'router.start');
  assert.equal(entries[0].source, 'router');
  assert.equal(entries[0].data.port, 3101);
  assert.equal(entries[1].level, 'error');
  assert.equal(entries[1].code, 'DEADLINE');
  assert.equal(entries[1].requestId, 'r1');
  assert.equal(entries[1].message, 'hết hạn');
  assert.ok(entries[1].ts.endsWith('Z'));
});

test('a graceful shutdown resets the active file and keeps exactly one previous run', () => {
  cleanState();
  assert.deepEqual(routerFiles(), [], 'bắt đầu từ trạng thái rỗng');
  assert.equal(resetOnShutdown(), null, 'không có file đang ghi thì không làm gì');

  logEvent('router.start', { run: 'lượt 1' });
  logEvent('chat.end', { run: 'lượt 1' });
  assert.deepEqual(routerFiles(), ['router.jsonl'], 'chưa tắt thì chưa có file trước');

  assert.equal(resetOnShutdown(), previousLogPath, 'tắt êm: file đang ghi thành file trước');
  assert.ok(!existsSync(logPath), 'file đang ghi phải được reset');
  assert.deepEqual(routerFiles(), ['router.previous.jsonl']);
  assert.deepEqual(lines(previousLogPath).map(entry => entry.data.run), ['lượt 1', 'lượt 1']);

  // Lượt chạy sau mở file mới, rỗng; rồi tắt êm lần nữa.
  logEvent('router.start', { run: 'lượt 2' });
  assert.deepEqual(lines(logPath).map(entry => entry.data.run), ['lượt 2']);
  resetOnShutdown();
  assert.deepEqual(routerFiles(), ['router.previous.jsonl'], 'chỉ giữ đúng một file trước, đĩa không phình');
  assert.deepEqual(lines(previousLogPath).map(entry => entry.data.run), ['lượt 2'], 'file trước là lượt mới nhất');
});

test('a hard kill never resets anything', () => {
  cleanState();
  // Kill cứng không chạy được dòng reset nào: chỉ cần KHÔNG gọi resetOnShutdown().
  logEvent('router.start', { run: 'bị kill' });
  logEvent('chat.failed', { run: 'bị kill', code: 'UPSTREAM_UNREACHABLE' });

  assert.deepEqual(routerFiles(), ['router.jsonl'], 'không có file trước nào được tạo ra');
  assert.equal(lines(logPath).length, 2, 'file của lượt bị kill vẫn còn nguyên trên đĩa');

  // Lượt chạy kế tiếp ghi tiếp vào đúng file đó (không bị dọn trước) — nên `runId` là
  // thứ duy nhất phân biệt hai lượt trong cùng một file.
  logEvent('router.start', { run: 'lượt sau' });
  const entries = lines(logPath);
  assert.deepEqual(entries.map(entry => entry.data.run), ['bị kill', 'bị kill', 'lượt sau']);
  assert.equal(new Set(entries.map(entry => entry.runId)).size, 1, 'cùng tiến trình → cùng runId');
});

test('secrets are redacted before they reach the file', () => {
  cleanState();
  logEvent('chat.call', { apiKey: 'sk-live-leaked', headers: { authorization: 'Bearer abc' }, model: 'giữ lại' });

  const entry = lines(logPath).at(-1);
  assert.equal(entry.data.apiKey, '[redacted]');
  assert.equal(entry.data.headers.authorization, '[redacted]');
  assert.equal(entry.model, 'giữ lại', 'trường không phải bí mật vẫn giữ nguyên');
  assert.ok(!readFileSync(logPath, 'utf8').includes('sk-live-leaked'));
});
