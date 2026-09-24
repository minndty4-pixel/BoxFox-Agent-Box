// Key ring — nhiều khoá trong MỘT connection.
//
// Hôm nay mỗi connection giữ đúng một dòng `credentials` (`store.mjs:32`), nên
// "429 thì sang khoá kế tiếp" phải làm bằng tay: bốn connection `opencode`, bốn
// credential, và một biến môi trường để chọn connection cho lượt chạy. Vòng này
// gộp chúng lại: `connection.keys` là một mảng CÓ THỨ TỰ (khoá trên cùng được
// dùng trước) của các dòng `credentials` đã mã hoá sẵn có — không dòng nào bị
// mã hoá lại, không khoá nào phải gõ lại (AAD của bản mã là id của DÒNG, không
// phải id connection, nên chuyển một dòng sang connection khác là thao tác dữ
// liệu, không phải thao tác mật mã — `store.mjs:44`).
//
// Tệp này là phần THUẦN TRÍ NHỚ của cơ chế đó: nó biết khoá nào đang nghỉ, nghỉ
// tới bao giờ, và lần cuối khoá đó thất bại vì gì. Không I/O, không lưu đĩa:
// `state`/`cooldownUntil`/`lastError` sống trong RAM, nên restart router là mọi
// khoá về vòng xoay ngay — đúng ý đồ với cửa sổ nghỉ 30 s–2 phút. Thứ duy nhất
// được ghi bền là `lastUsedAt`, và nó được ghi kèm vào lần ghi connection đã có
// sẵn ở đường thành công của engine.

/**
 * Mốc nghỉ mặc định. Quyết định của chủ nhà: một bucket free-tier hiếm khi hồi
 * nhanh hơn 30 s, nên 429 đầu tiên đã cho khoá đó nghỉ 30 s thay vì luật
 * 2-strike cũ (5 s–5 phút).
 */
export const KEY_COOLDOWN_MS = 30_000;

/**
 * Trần nghỉ. Đây là **quy ước của dự án**, không phải con số của nhà cung cấp
 * nào, và có hai lý do:
 *
 *  1. Một `retry-after` vô lý (ví dụ 3600) không được phép âm thầm bỏ một khoá
 *     khỏi vòng xoay quá lâu — hết cửa sổ thì khoá về vòng, provider nói "vẫn
 *     429" và ring park lại bằng con số mới.
 *  2. Cửa sổ nghỉ không vượt xa nhịp retry của harness (`RATE_LIMIT_MIN/MAX =
 *     2/30 s`, `RETRY_BUDGET_SECONDS = 60` —
 *     `backend/src/agentbox/agent_core/failures.py:203-256`).
 */
export const KEY_COOLDOWN_MAX_MS = 120_000;

/** Trần số khoá một connection được giữ — đủ cho bốn connection đang có và biên rộng. */
export const MAX_KEYS_PER_CONNECTION = 10;

/** Câu 429 có nói tới hạn mức (không chỉ "chậm lại") — chữ của `opencode`: "quota reached for this session". */
export const QUOTA_RE = /quota|usage limit|exhaust|hạn mức/i;

/** Số ký tự đầu của một secret được phép rời khỏi store. Không bao giờ nhiều hơn. */
const HEAD_CHARS = 6;

/** Nửa sau của một bản chuỗi bất khả: ring đang nghỉ nhưng chưa từng có lỗi nào. */
export const RING_EXHAUSTED_MESSAGE = 'Every key on this connection is cooling down after a provider limit.';

/**
 * `prefix` của một khoá: sáu ký tự đầu, kèm dấu `…` khi secret dài hơn — hoặc
 * `null` khi blob không có secret nào (`opencode` không cần khoá). Đây là toàn
 * bộ những gì một secret được phép lộ ra: không bao giờ quá sáu ký tự.
 */
export function headOf(secret) {
  const value = typeof secret === 'string' ? secret.trim() : '';
  if (!value) return null;
  return value.length > HEAD_CHARS ? `${value.slice(0, HEAD_CHARS)}…` : value;
}

/**
 * Công thức nghỉ DUY NHẤT của vòng này. `retry-after` của provider chỉ được
 * NÂNG, không bao giờ được hạ: không header ⇒ 30 s; `Retry-After: 3` ⇒ 30 s;
 * `90` ⇒ 90 s; `600` ⇒ 120 s (trần); giá trị rác ⇒ 30 s.
 */
export function cooldownFor(retryAfterMs) {
  const requested = Number(retryAfterMs);
  const value = Number.isFinite(requested) && requested > 0 ? requested : 0;
  return Math.min(Math.max(value || KEY_COOLDOWN_MS, KEY_COOLDOWN_MS), KEY_COOLDOWN_MAX_MS);
}

/**
 * Trạng thái một khoá để giao diện vẽ:
 *
 *   `cooling`   — đang nghỉ sau một lần 429 vì tốc độ/giới hạn tạm thời;
 *   `exhausted` — đang nghỉ sau một lần 429 có nói tới hạn mức (mockup 03);
 *   `error`     — lần gọi gần nhất hỏng vì một lý do KHÁC 429 (400/5xx/AUTH);
 *   `ready`     — còn dùng được.
 *
 * Hết cửa sổ nghỉ thì khoá về vòng xoay ngay: một lần 429 đã hết hạn không còn
 * là bản án nào (truyền `now` để kiểm điều đó).
 */
export function classifyState(entry = {}, now = Date.now()) {
  const code = entry?.lastError?.code ?? entry?.lastErrorCode ?? null;
  const message = entry?.lastError?.message ?? entry?.lastErrorMessage ?? '';
  if (Number(entry?.cooldownUntil) > now) return QUOTA_RE.test(String(message)) ? 'exhausted' : 'cooling';
  return code && code !== 'RATE_LIMIT' ? 'error' : 'ready';
}

/**
 * Vòng khoá trong một connection.
 *
 * Thứ tự = "khoá trên cùng được dùng trước", KHÔNG có con trỏ xoay vòng: một
 * request luôn bắt đầu ở khoá đầu tiên chưa nghỉ theo thứ tự ring. Nhờ vậy
 * `activeKeyId` là "khoá của lượt thử gần nhất" và không cần bền hoá con trỏ.
 */
export class KeyRing {
  constructor() {
    this.entries = new Map();
  }

  #entry(keyId) {
    if (!this.entries.has(keyId)) {
      this.entries.set(keyId, { cooldownUntil: 0, lastError: null, lastErrorAt: null, lastModelId: null });
    }
    return this.entries.get(keyId);
  }

  /** Lỗi được giữ NGUYÊN đối tượng: `code`/`message`/`status`/`retryAfterMs` không bị sao chép lại. */
  #remember(entry, error) {
    entry.lastError = error;
    entry.lastErrorAt = Date.now();
  }

  /** Khoá đầu tiên chưa nghỉ (cả object entry trong `connection.keys`), hoặc `null`. */
  pick(connection, now = Date.now()) {
    const keys = Array.isArray(connection?.keys) ? connection.keys : [];
    for (const key of keys) {
      const entry = this.entries.get(key?.id);
      if (!entry || !(entry.cooldownUntil > now)) return key;
    }
    return null;
  }

  hasCallable(connection, now = Date.now()) {
    return Boolean(this.pick(connection, now));
  }

  /**
   * Cho một khoá nghỉ theo công thức §1.3 và nhớ lỗi THẬT của provider để lượt
   * sau, khi cả ring đang nghỉ, lỗi đó được ném ra nguyên vẹn.
   */
  park(keyId, { retryAfterMs = null, error = null, modelId = null } = {}) {
    const entry = this.#entry(keyId);
    entry.cooldownUntil = Date.now() + cooldownFor(retryAfterMs);
    if (modelId) entry.lastModelId = modelId;
    if (error) this.#remember(entry, error);
    return entry.cooldownUntil;
  }

  /** Một lỗi KHÁC 429: không nghỉ, nhưng là lần thử gần nhất của khoá đó. */
  note(keyId, error = null) {
    const entry = this.#entry(keyId);
    if (error) this.#remember(entry, error);
    return entry;
  }

  /** Xoá mọi thứ đang nhớ về một khoá: hết nghỉ và hết dòng lỗi (nút "Thử ngay"). */
  clear(keyId) {
    this.entries.delete(keyId);
  }

  /**
   * Lỗi THẬT gần nhất trong ring, giữ nguyên `code`/`message`/`status`/
   * `retryAfterMs` — không bọc lại thành câu tổng hợp. `null` khi ring chưa
   * từng thất bại (ca bất khả trên thực tế).
   */
  lastError(connection) {
    const keys = Array.isArray(connection?.keys) ? connection.keys : [];
    let newest = null;
    for (const key of keys) {
      const entry = this.entries.get(key?.id);
      if (!entry?.lastError) continue;
      if (!newest || Number(entry.lastErrorAt || 0) >= Number(newest.at || 0)) newest = { at: entry.lastErrorAt, error: entry.lastError };
    }
    return newest?.error || null;
  }

  /**
   * Trang trí `connection.keys[]` cho snapshot: mỗi entry giữ nguyên `id`,
   * `label`, `prefix`, `createdAt`, `lastUsedAt` đã lưu, và được thêm trạng
   * thái sống trong RAM. Không có secret nào ở đây ngoài `prefix` ≤ 6 ký tự.
   */
  state(connection, now = Date.now()) {
    const keys = (Array.isArray(connection?.keys) ? connection.keys : []).map(key => {
      const entry = this.entries.get(key?.id) || {};
      return {
        id: key?.id ?? null,
        label: key?.label ?? null,
        prefix: key?.prefix ?? null,
        createdAt: key?.createdAt ?? null,
        state: classifyState(entry, now),
        cooldownUntil: Number(entry.cooldownUntil) > now ? entry.cooldownUntil : null,
        resetAt: this.#resetAt(connection, entry),
        lastErrorCode: entry.lastError?.code ?? null,
        lastErrorMessage: entry.lastError?.message ?? null,
        lastUsedAt: key?.lastUsedAt ?? null,
      };
    });
    const active = connection?.activeKeyId ?? null;
    return { keys, activeKeyId: keys.some(key => key.id === active) ? active : null };
  }

  /**
   * Mốc hạn mức mở lại, epoch ms, khi provider có báo cho đúng model mà khoá
   * vừa chạm (`connection.quota.models[].resetTime`, ISO string). `opencode`
   * trả stub rỗng nên ở đó luôn là `null` — không bịa một mốc nào.
   */
  #resetAt(connection, entry) {
    if (!entry?.lastModelId) return null;
    const rows = connection?.quota?.models;
    if (!Array.isArray(rows)) return null;
    const row = rows.find(value => value?.modelId === entry.lastModelId);
    const raw = row?.resetTime ?? row?.resetAt ?? null;
    const parsed = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
}
