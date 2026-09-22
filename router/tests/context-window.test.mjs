// Phần 1 của đợt 18: cửa sổ ngữ cảnh phải có MỘT chỗ trả lời, và mọi con số phải
// nói được nó từ đâu ra. Bảng tên là dữ liệu của hệ thống (kèm ngày chốt), không
// phải một luật suy diễn: tên nào không có trong bảng thì trả `null` để số nhà
// cung cấp (hoặc sàn an toàn của harness) quyết định.
//
// Nguyên tắc đã chốt với chủ sở hữu: với model mà TÊN KHỚP BẢNG, số của bảng luôn
// thắng, và số nhà cung cấp đã công bố được giữ bên cạnh ở `contextWindowReported`
// để đối chiếu (nhờ vậy một bảng sai còn lộ ra được).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTEXT_WINDOW_SOURCES,
  CONTEXT_WINDOW_TABLE_AS_OF,
  contextWindowFromName,
  resolveContextWindow,
} from '../src/context-window.mjs';
import { createProviders } from '../src/providers/index.mjs';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';

const json = (value, options = {}) => new Response(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });

/** Một connection DeepSeek với hai dòng: một dòng trong bảng, một dòng ngoài bảng. */
async function deepseekFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-context-window-test-'));
  const store = new RouterStore({ dataDir: dir });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const service = new ProviderService({
    store,
    providers: createProviders({ fetchImpl: async url => (String(url).endsWith('/models') ? json({ object: 'list', data: [{ id: 'deepseek-flash' }, { id: 'deepseek-r1' }] }) : json({ choices: [{ message: { content: 'OK' } }] })) }),
  });
  const connection = service.create({ providerId: 'deepseek', name: 'DeepSeek', endpoint: 'https://deepseek.invalid/v1', apiKey: 'test-only-key' });
  await service.discover(connection.id);
  const row = id => service.snapshot().connections.find(entry => entry.id === connection.id).models.find(model => model.id === id);
  return { service, connection, row };
}

const MILLION = 1_000_000;

test('bảng trả đúng số cho các dòng đang có trên máy này', () => {
  const rows = [
    'deepseek-flash',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp',
    'deepseek-v4-flash-0731',
    'deepseek-v4-pro-0813',
    'deepseek-v4.1-flash',
    'nemotron-3-ultra-free',
    'nemotron-3.5-lightning-free',
  ];
  for (const id of rows) {
    const row = contextWindowFromName(id, id);
    assert.ok(row, `${id} phải nằm trong bảng`);
    assert.equal(row.tokens, MILLION, `${id} là họ V4/V4.1`);
    assert.equal(row.source, 'documented');
  }
});

test('khớp đúng chạy trước khớp họ', () => {
  assert.equal(contextWindowFromName('deepseek-v4-pro-0813', '').match, 'exact');
  assert.equal(contextWindowFromName('deepseek-v4-pro-0901', '').match, 'family');
});

test('hậu tố, tiền tố nhà cung cấp và hoa-thường cho ra cùng một số', () => {
  const forms = [
    'deepseek-v4.1-flash:free',
    'DeepSeek-V4.1-Flash:Free',
    'TokenHarbor/deepseek-v4.1-flash',
    '~deepseek/deepseek-v4.1-flash',
    'deepseek-v4.1-flash:batch',
  ];
  for (const name of forms) {
    const row = contextWindowFromName(name, name);
    assert.ok(row, `${name} phải tra được`);
    assert.equal(row.tokens, MILLION, `${name} là cùng một model`);
  }
  // Tên hiển thị là đường tra thứ hai, khi id không khớp.
  assert.equal(contextWindowFromName('unknown-id', 'DeepSeek V4 Flash').tokens, MILLION);
});

test('N3 — hai dòng nemotron của OpenCode có số của bảng, không rơi về sàn null', () => {
  // Đo sống 2026-09-21: OpenCode không công bố cửa sổ cho hai id `-free` này
  // (`contextWindow: null`), còn OpenRouter công bố 1000000 cho hai bản `:free`
  // cùng model. Nếu bảng không có hàng, harness phải dùng SÀN của nó và gộp ở
  // 86 732 token — đó là lý do bảng nhận hai hàng này.
  for (const id of ['nemotron-3-ultra-free', 'nemotron-3.5-lightning-free']) {
    const row = contextWindowFromName(id, id);
    assert.ok(row, `${id} phải nằm trong bảng`);
    assert.equal(row.tokens, MILLION, `${id} là bản :free công bố 1M`);
    assert.equal(row.source, 'documented');
  }
  // Nhà cung cấp im lặng hoàn toàn: câu trả lời là bảng, không phải `null`.
  const resolved = resolveContextWindow({ id: 'nemotron-3-ultra-free', name: 'nemotron-3-ultra-free', reported: null });
  assert.equal(resolved.contextWindow, MILLION);
  assert.equal(resolved.contextWindowSource, 'documented', 'bảng đã khai thì nói là documented');
  assert.equal(resolved.contextWindowReported, null, 'không có số nhà cung cấp để đối chiếu');
});

test('N3 — bản trả tiền cùng model không bị hàng `-free` kéo theo', () => {
  // OpenRouter công bố 262144 cho `nvidia/nemotron-3-ultra-550b-a55b` (bản trả tiền)
  // và 1000000 cho bản `:free`. Hàng của bảng là id CHÍNH XÁC, nên bản trả tiền
  // không khớp hàng nào và giữ nguyên số nhà cung cấp của nó.
  for (const id of ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3.5-lightning']) {
    assert.equal(contextWindowFromName(id, id), null, `${id} không nằm trong bảng`);
    const resolved = resolveContextWindow({ id, name: id, reported: 262_144 });
    assert.equal(resolved.contextWindow, 262_144);
    assert.equal(resolved.contextWindowSource, 'reported');
  }
});

test('họ DeepSeek cũ KHÔNG nằm trong bảng — số nhà cung cấp giữ nguyên giá trị thật', () => {
  for (const id of ['deepseek-r1', 'deepseek-v3.2', 'deepseek-chat', 'deepseek-coder']) {
    assert.equal(contextWindowFromName(id, id), null, `${id} thật sự nhỏ hơn 1M`);
  }
  for (const id of ['qwen3.8-27b', 'glm-5.3', 'gemini-3.8-flash', 'claude-opus-5', 'gpt-5.4']) {
    assert.equal(contextWindowFromName(id, id), null, `${id} không thuộc bảng DeepSeek`);
  }
});

test('bảng thắng số nhà cung cấp, và số nhà cung cấp vẫn được giữ để đối chiếu', () => {
  const resolved = resolveContextWindow({ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', reported: 1_048_576 });
  assert.equal(resolved.contextWindow, MILLION);
  assert.equal(resolved.contextWindowSource, 'documented');
  assert.equal(resolved.contextWindowReported, 1_048_576, 'số đã công bố không bị vứt đi');
});

test('không có số đối chiếu thì contextWindowReported là null', () => {
  const resolved = resolveContextWindow({ id: 'deepseek-flash', name: 'deepseek-flash', reported: null });
  assert.equal(resolved.contextWindow, MILLION);
  assert.equal(resolved.contextWindowSource, 'documented');
  assert.equal(resolved.contextWindowReported, null);
});

test('không có trong bảng thì số nhà cung cấp là câu trả lời, mang nhãn reported', () => {
  const resolved = resolveContextWindow({ id: 'deepseek-r1', name: 'deepseek-r1', reported: 64_000 });
  assert.equal(resolved.contextWindow, 64_000);
  assert.equal(resolved.contextWindowSource, 'reported');
  assert.equal(resolved.contextWindowReported, null, 'không lặp lại chính con số đang dùng');
});

test('người dùng tự khai thì thắng cả bảng lẫn nhà cung cấp', () => {
  const resolved = resolveContextWindow({
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek-V4.1-Flash',
    reported: 1_048_576,
    declared: 32_768,
  });
  assert.equal(resolved.contextWindow, 32_768);
  assert.equal(resolved.contextWindowSource, 'manual');
  assert.equal(resolved.contextWindowReported, 1_048_576);
});

test('không nguồn nào trả lời thì cả ba trường đều null — không bịa số', () => {
  const resolved = resolveContextWindow({ id: 'mystery-model', name: 'mystery-model', reported: null });
  assert.deepEqual(resolved, { contextWindow: null, contextWindowSource: null, contextWindowReported: null });
});

test('số rác không được nhận: 0, âm, chuỗi, NaN đều bị bỏ qua', () => {
  for (const reported of [0, -1, 'nonsense', Number.NaN, undefined]) {
    const resolved = resolveContextWindow({ id: 'mystery-model', name: 'mystery-model', reported });
    assert.equal(resolved.contextWindow, null, `reported=${String(reported)} không phải một cửa sổ`);
  }
  for (const declared of [0, -1, 'nonsense']) {
    const resolved = resolveContextWindow({ id: 'deepseek-r1', name: 'deepseek-r1', reported: 64_000, declared });
    assert.equal(resolved.contextWindowSource, 'reported', 'khai rác thì rơi về nhà cung cấp');
  }
});

test('từ vựng nguồn gốc đúng ba giá trị đã chốt, và bảng khai ngày chốt của nó', () => {
  assert.deepEqual([...CONTEXT_WINDOW_SOURCES], ['manual', 'documented', 'reported']);
  assert.equal(CONTEXT_WINDOW_TABLE_AS_OF, '2026-09-21');
});

// ---- C3: đường người dùng tự khai một con số cho đúng model đó ----------------
//
// Bảng tên phủ họ V4/V4.1, nhưng một model lạ (hoặc một bảng đã cũ) vẫn cần một
// đường để người dùng nói đúng số. Đường đó đi qua PATCH như giá tay đã đi, và
// `clear: true` trả dòng về bảng/nhà cung cấp.

test('user declares a context window: the row says manual and keeps it', async t => {
  const { service, connection, row } = await deepseekFixture(t);
  assert.equal(row('deepseek-flash').contextWindow, 1_000_000, 'bảng trả lời trước khi người dùng khai');
  const patched = service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow: 32_768 } });
  const flash = patched.models.find(model => model.id === 'deepseek-flash');
  assert.equal(flash.contextWindow, 32_768);
  assert.equal(flash.contextWindowSource, 'manual');
  assert.equal(row('deepseek-flash').contextWindow, 32_768, 'số tay sống trong store, không chỉ trong câu trả lời');
});

test('a scan never overwrites a window the user declared', async t => {
  const { service, connection, row } = await deepseekFixture(t);
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow: 32_768 } });
  await service.discover(connection.id);
  assert.equal(row('deepseek-flash').contextWindow, 32_768, 'dò lại không được ghi đè lời khai của người dùng');
  assert.equal(row('deepseek-flash').contextWindowSource, 'manual');
});

test('clearing a declaration hands the row back to the table', async t => {
  const { service, connection, row } = await deepseekFixture(t);
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow: 32_768 } });
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', clear: true } });
  assert.equal(row('deepseek-flash').contextWindow, 1_000_000);
  assert.equal(row('deepseek-flash').contextWindowSource, 'documented');
  // Đo sống 2026-09-21: sau `clear`, số người dùng vừa khai từng được ghi lại
  // thành `contextWindowReported` (32768) như thể nhà cung cấp đã công bố nó.
  assert.equal(row('deepseek-flash').contextWindowReported, null, 'số tay không được đội lốt số nhà cung cấp');
});

test('clearing a declaration on a row OUTSIDE the table really clears it', async t => {
  const { service, connection, row } = await deepseekFixture(t);
  assert.equal(row('deepseek-r1').contextWindow, null, 'dòng ngoài bảng bắt đầu không có số nào');
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-r1', contextWindow: 64_000 } });
  assert.equal(row('deepseek-r1').contextWindow, 64_000);
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-r1', clear: true } });
  assert.equal(row('deepseek-r1').contextWindow, null, 'clear trả dòng về đúng trạng thái trước khi khai');
  assert.equal(row('deepseek-r1').contextWindowSource, null, 'số vừa xoá không được ở lại dưới nhãn `reported`');
});

test('a declaration keeps the provider number it replaced; a restart does too', async t => {
  const { service, connection, row } = await deepseekFixture(t);
  const conn = service.connection(connection.id);
  const flash = conn.models.find(model => model.id === 'deepseek-flash');
  // Như một lần dò trước đó đã công bố 1048576 cho dòng trong bảng.
  flash.contextWindowReported = 1_048_576;
  service.store.put('connection', conn);
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow: 32_768 } });
  assert.equal(row('deepseek-flash').contextWindow, 32_768);
  assert.equal(row('deepseek-flash').contextWindowReported, 1_048_576, 'khai tay giữ số nhà cung cấp bên cạnh');
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', clear: true } });
  assert.equal(row('deepseek-flash').contextWindow, 1_000_000);
  assert.equal(row('deepseek-flash').contextWindowReported, 1_048_576, 'clear trả lại số nhà cung cấp đã giữ');
  const healed = service.sanitizeConnection(service.connection(connection.id));
  assert.equal(healed.models.find(model => model.id === 'deepseek-flash').contextWindowReported, 1_048_576, 'khởi động lại giữ số nhà cung cấp');
});

test('a declaration equal to the provider number leaves nothing beside it', async t => {
  // CONTRACT: `contextWindowReported` chỉ có mặt khi nó KHÁC số đang dùng. Nhánh
  // PATCH đặt tay từng gán thẳng số nhà cung cấp, nên một dòng có thể tự báo hai
  // lần cùng một số (lỗi b18-review #5). Đo lại trên router đang chạy 2026-09-21.
  const { service, connection, row } = await deepseekFixture(t);
  const seedProviderNumber = () => {
    const conn = service.connection(connection.id);
    conn.models.find(model => model.id === 'deepseek-flash').contextWindowReported = 1_048_576;
    service.store.put('connection', conn);
  };
  seedProviderNumber();
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow: 1_048_576 } });
  assert.equal(row('deepseek-flash').contextWindow, 1_048_576);
  assert.equal(row('deepseek-flash').contextWindowSource, 'manual');
  assert.equal(row('deepseek-flash').contextWindowReported, null, 'cùng một số thì không có gì "bên cạnh" để báo');

  // Luật "chỉ khi khác" không được xoá mất số nhà cung cấp khi hai số thật sự khác nhau.
  seedProviderNumber();
  service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow: 32_768 } });
  assert.equal(row('deepseek-flash').contextWindow, 32_768);
  assert.equal(row('deepseek-flash').contextWindowReported, 1_048_576);
});

test('a window for a model the connection does not have names the missing step', async t => {
  const { service, connection } = await deepseekFixture(t);
  assert.throws(
    () => service.patch(connection.id, { modelContextWindow: { modelId: 'not-a-model', contextWindow: 32_768 } }),
    error => error.code === 'MODEL_NOT_FOUND' && error.status === 404,
  );
});

test('a window that is not a positive number is refused, not stored', async t => {
  const { service, connection } = await deepseekFixture(t);
  for (const contextWindow of [0, -1, 'lots', 1.5, null]) {
    assert.throws(
      () => service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow } }),
      error => error.code === 'INVALID_CONTEXT_WINDOW' && error.status === 400,
      `${String(contextWindow)} không phải một cửa sổ`,
    );
  }
});

test('the upper bound is 2 000 000 tokens: the last legal value is kept, one more is refused', async t => {
  // Vòng soát mã đợt 18 để lại đúng chỗ này là "chưa đo": cận dưới có ca, cận trên thì không.
  const { service, connection, row } = await deepseekFixture(t);
  const patched = service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow: 2_000_000 } });
  assert.equal(patched.models.find(model => model.id === 'deepseek-flash').contextWindow, 2_000_000);
  assert.equal(row('deepseek-flash').contextWindowSource, 'manual');

  for (const contextWindow of [2_000_001, 4_294_967_296]) {
    assert.throws(
      () => service.patch(connection.id, { modelContextWindow: { modelId: 'deepseek-flash', contextWindow } }),
      error => error.code === 'INVALID_CONTEXT_WINDOW' && error.status === 400,
      `${contextWindow} vượt trần và không được ghi`,
    );
  }
  assert.equal(row('deepseek-flash').contextWindow, 2_000_000, 'lượt bị từ chối không được đổi số đang dùng');
});
