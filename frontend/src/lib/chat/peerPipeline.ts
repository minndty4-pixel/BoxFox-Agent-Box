/**
 * Đường ống peer của mesh con–con (đợt 22, T15) — đọc THẲNG từ event thật.
 *
 * Hợp đồng §1.3 của kế hoạch `v1-peer-mesh.md`:
 *   `peer_wait`      → luồng CON ĐANG CHỜ: `targets`, `mode`, `waitsUntilDelivery`,
 *                      `safetySeconds`, `deadline`, `turn`, `step`.
 *   `peer_wait_end`  → luồng con đang chờ: `status` (done/timeout/empty/pending_target),
 *                      `waitedMs`, `done[]`, `pending[]`, `extensionExhausted`.
 *   `peer_delivery`  → luồng NGƯỜI NHẬN: `from`, `role`, `chars`, `truncated`, `deliveryId`, `state`.
 *   `child`          → luồng CHA: `deliverTo` lúc giao việc, `deliveries[]` (mỗi mục có `state`,
 *                      `chars`, và `reason` khi `state === 'skipped'`) khi con đóng sổ.
 *
 * Hai luật của chủ nhà (Q2) được cài ở đây, không phải ở chỗ vẽ:
 *   1. Chờ peer nghĩa là chờ **tới lúc peer giao kết quả** — không phải đếm ngược tới một
 *      hạn cố định. Nhãn vì vậy là "đang chờ <role> giao kết quả"; thời gian chỉ được nói
 *      thêm khi lượt chờ KHÔNG tự truyền hạn (`waitsUntilDelivery = true`) — đó là lưới an toàn.
 *   2. Nhãn chờ tự tắt khi gặp `peer_wait_end` trong luồng của chính con đang chờ. Đó là đường
 *      DUY NHẤT: backend không phát `waiting_for` trong event `child` nào (nó chỉ là cột của sổ
 *      con — `grep -rn waiting_for backend/src` ra đúng cột store và `child_wait()`), nên ở đây
 *      không hứa một đường lùi nào cả.
 *
 * Mọi hàm ở đây trả `null`/mảng rỗng khi payload méo — không suy diễn trạng thái.
 */
import type { HarnessEvent } from '../../store/harnessChatStore'

const ROLE_PREFIX = 'role:'

/**
 * `role:review` → `review`; `main` giữ nguyên (tên vai trần, không có tiền tố).
 *
 * Đích trong event thật có HAI hình dạng: chuỗi (`'role:review'`, `'main'`,
 * `'peer:<sessionId>'`) và vật thể (`{sessionId, role}` — đúng hình dạng của `targets`
 * trong event `peer_wait`). Bản trước `String(...)` thẳng vật thể nên nhãn chờ in ra
 * `[object Object]`; lượt sống 2026-09-22 (`e94f1af0…`) bắt được đúng lỗi đó. Vật thể
 * không mang vai nào đọc được thì trả chuỗi rỗng — KHÔNG bao giờ trả `[object Object]`,
 * và người gọi đã có đường lùi (`|| 'peer'`).
 */
export function peerLabel(target: unknown): string {
  if (target !== null && typeof target === 'object') {
    const item = target as Record<string, unknown>
    for (const key of ['role', 'roleId', 'sessionId', 'name']) {
      const value = item[key]
      if (typeof value === 'string' && value.trim().length > 0) return peerLabel(value)
    }
    return ''
  }
  const text = String(target ?? '').trim()
  return text.startsWith(ROLE_PREFIX) ? text.slice(ROLE_PREFIX.length) : text
}

/** `['role:review', 'main']` (hoặc một chuỗi) → `['review', 'main']`; rác bị bỏ. */
export function peerLabels(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return raw.map(peerLabel).filter((label) => label.length > 0)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** `deliveryId` thật là số nguyên của sqlite (`child_deliveries.id`), không phải chuỗi. */
function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  return asText(value)
}

function declaredTurn(value: unknown): number | null {
  const turn = asNumber(value)
  return turn !== null && turn > 0 ? Math.trunc(turn) : null
}

/**
 * Trạng thái một biên nhận giao hàng — đúng ba giá trị backend ghi vào `child_deliveries.state`:
 * `injected` (đã bơm vào transcript người nhận), `pending` (đã xếp hàng, chưa tiêu thụ),
 * `skipped` (không giao được, kèm `reason`). Giá trị lạ/thiếu coi là `pending` — chưa có bằng
 * chứng nào cho thấy người nhận đã nhận.
 */
export type DeliveryState = 'injected' | 'pending' | 'skipped'

function deliveryState(value: unknown): DeliveryState {
  return value === 'injected' || value === 'skipped' ? value : 'pending'
}

/** Hai mã `reason` backend ghi cho hàng `skipped` (`runtime.PEER_SKIP_*`). */
export type PeerSkipReason = 'no_such_peer' | 'recipient_not_running'

/** Mã lý do nằm trong nhóm đã biết; mã lạ trả `null` để người gọi hiện nguyên mã. */
export function peerSkipReason(value: string | null): PeerSkipReason | null {
  return value === 'no_such_peer' || value === 'recipient_not_running' ? value : null
}

/** Một lượt chờ peer đang MỞ, dựng từ `peer_wait` thật. */
export interface PeerWait {
  /** Vai trần đang được chờ, ví dụ `['review']`. */
  roles: string[]
  /** `true` ⇒ người chờ KHÔNG truyền hạn, tức chờ tới lúc peer giao (Q2). */
  waitsUntilDelivery: boolean
  /** Lưới an toàn (giây) — chỉ để lượt không trông như treo. */
  safetySeconds: number | null
  /**
   * Mốc tuyệt đối của lưới an toàn đúng như backend gửi (đợt 22: epoch GIÂY, `1790098963.461`),
   * `null` khi không có. `deadlineMs()` là chỗ chuẩn hoá đơn vị — đừng trừ thẳng giá trị này.
   */
  deadline: number | null
  /** `created` của event `peer_wait` (ms). */
  startedAt: number | null
  turn: number | null
}

/** Một biên nhận "đã nhận từ <role>" — dựng từ `peer_delivery` / `deliveries[]` thật. */
export interface PeerReceipt {
  /** Vai của bên GIAO (đã bỏ tiền tố `role:`). */
  role: string
  chars: number | null
  deliveryId: string | null
  /** Trạng thái THẬT của biên nhận — chỉ `injected` mới được nói "đã nhận". */
  state: DeliveryState
  /** Mã lý do khi `skipped` (`no_such_peer` / `recipient_not_running`). */
  reason: string | null
}

/**
 * Lượt chờ đang mở của một luồng con: `peer_wait` chưa bị `peer_wait_end` đóng.
 *
 * Chờ là TUẦN TỰ, nên hàng đợi là FIFO; `peer_wait_end` có `turn` thì đóng đúng lượt đó
 * trước, không có thì đóng lượt cũ nhất còn treo.
 */
export function openPeerWait(events: readonly HarnessEvent[]): PeerWait | null {
  const open: PeerWait[] = []
  for (const event of events) {
    if (event.type === 'peer_wait') {
      open.push({
        roles: peerLabels(event.data.targets ?? event.data.target ?? event.data.role),
        waitsUntilDelivery: event.data.waitsUntilDelivery !== false,
        safetySeconds: asNumber(event.data.safetySeconds),
        deadline: asNumber(event.data.deadline),
        startedAt: asNumber(event.created),
        turn: declaredTurn(event.data.turn),
      })
      continue
    }
    if (event.type === 'peer_wait_end') {
      const turn = declaredTurn(event.data.turn)
      const index = turn !== null ? open.findIndex((wait) => wait.turn === turn) : 0
      if (index >= 0) open.splice(index, 1)
      else if (open.length > 0) open.pop()
    }
  }
  return open[0] ?? null
}

/** Mọi `peer_delivery` của một luồng (người nhận) ⇒ huy hiệu biên nhận trên hàng của họ. */
export function peerReceipts(events: readonly HarnessEvent[]): PeerReceipt[] {
  const receipts: PeerReceipt[] = []
  for (const event of events) {
    if (event.type !== 'peer_delivery') continue
    const role = peerLabel(event.data.role ?? event.data.from)
    if (!role) continue
    const state = deliveryState(event.data.state)
    receipts.push({
      role,
      chars: asNumber(event.data.chars),
      deliveryId: asId(event.data.deliveryId),
      state,
      reason: state === 'skipped' ? asText(event.data.reason) : null,
    })
  }
  return receipts
}

/**
 * Biên nhận mà một hàng con NHẬN được, đọc từ `deliveries[]` của một event `child` khác
 * (cha phát): mục nào có `recipient` trỏ đúng phiên của hàng này.
 *
 * Đích thật là `sessionId` (`main` là chính phiên cha). Ngoài ra `resolve_delivery_targets`
 * còn ghi một hàng `skipped` với `recipient` là CHÍNH TÊN VAI khi không có ai mang vai đó —
 * hàng ấy chỉ được nhận khi nó đã bị bỏ, để không gắn nhầm biên nhận của người khác.
 */
export function receiptsFromDeliveries(
  deliveries: unknown,
  role: string,
  sessionId: string,
): PeerReceipt[] {
  if (!Array.isArray(deliveries)) return []
  const keys = new Set([`${ROLE_PREFIX}${role}`, sessionId].filter((key) => key.length > 0))
  const receipts: PeerReceipt[] = []
  for (const raw of deliveries) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const recipient = String(item.recipient ?? '')
    const state = deliveryState(item.state)
    if (!keys.has(recipient) && !(state === 'skipped' && recipient === role)) continue
    receipts.push({
      role: peerLabel(item.role ?? item.from),
      chars: asNumber(item.chars),
      deliveryId: asId(item.deliveryId ?? item.id),
      state,
      reason: state === 'skipped' ? asText(item.reason) : null,
    })
  }
  return receipts
}

/** Thứ tự "đi xa tới đâu" của ba trạng thái, dùng khi hai nguồn nói khác nhau về CÙNG một lần giao. */
const RECEIPT_RANK: Record<DeliveryState, number> = { injected: 2, pending: 1, skipped: 0 }

/**
 * Gộp biên nhận từ hai nguồn (luồng của chính em + hàng sổ con của cha) và giữ trạng thái ĐI XA
 * NHẤT cho mỗi lần giao: cùng vai và cùng số ký tự thì `injected` thắng `pending`, vì
 * `peer_delivery` phát lúc hàng còn `pending` còn `deliveries[]` đọc sau khi người nhận đã tiêu thụ.
 * Không gộp thì hàng của em vừa "sẽ nhận" vừa "đã nhận" cho đúng một kết quả.
 */
export function mergeReceipts(
  first: readonly PeerReceipt[],
  second: readonly PeerReceipt[],
): PeerReceipt[] {
  const merged = new Map<string, PeerReceipt>()
  for (const receipt of [...first, ...second]) {
    const key = `${receipt.role}|${receipt.chars ?? ''}`
    const kept = merged.get(key)
    if (!kept || RECEIPT_RANK[receipt.state] > RECEIPT_RANK[kept.state]) merged.set(key, receipt)
  }
  return [...merged.values()]
}

/** Một mục trong `deliveries[]` của event `child` đóng sổ — biên nhận THẬT của một người nhận. */
export interface PeerDelivery {
  /**
   * `sessionId` người nhận (`main` là chính phiên cha), hoặc tên vai khi địa chỉ dạng vai
   * không phân giải được ai (`state === 'skipped'`).
   */
  recipient: string
  /** Trạng thái thật của lần giao. */
  state: DeliveryState
  chars: number | null
  /** Mã lý do khi `skipped`. */
  reason: string | null
}

/** `deliveries[]` thật của một event `child` (kết thúc) — mục méo bị bỏ. */
export function peerDeliveries(value: unknown): PeerDelivery[] {
  if (!Array.isArray(value)) return []
  const rows: PeerDelivery[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const recipient = String(item.recipient ?? '').trim()
    if (recipient.length === 0) continue
    const state = deliveryState(item.state)
    rows.push({
      recipient,
      state,
      chars: asNumber(item.chars),
      reason: state === 'skipped' ? asText(item.reason) : null,
    })
  }
  return rows
}

/** Nhãn đọc được của một `recipient` thật: `main` cho phiên cha, tên vai cho em cùng lượt. */
export function deliveryLabel(
  recipient: string,
  parentId: string | null | undefined,
  roleOf: (sessionId: string) => string | null,
): string | null {
  if (parentId && recipient === parentId) return 'main'
  return roleOf(recipient)
}

/** Session id 32 ký tự không đọc được — cắt còn 8 ký tự đầu; chuỗi ngắn (tên vai) giữ nguyên. */
export function shortPeerId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value
}

export interface PeerDeliveryView {
  /** Nhãn người nhận ĐÃ nhận hàng (đã xếp hàng hoặc đã tiêu thụ) — rỗng khi không giao cho ai. */
  delivered: string[]
  /** Người nhận KHÔNG nhận được hàng, kèm mã lý do thật khi backend có. */
  skipped: Array<{ target: string; reason: string | null }>
}

/**
 * `deliveries[]` thật → hai danh sách để vẽ mũi tên giao kết quả.
 *
 * `pending`/`injected` đều là "đã giao" (hàng đã sang hộp thư người nhận); `skipped` thì KHÔNG —
 * nó phải được kể ra kèm lý do, không được đội lốt "đã giao cho …".
 */
export function peerDeliveryView(
  rows: readonly PeerDelivery[],
  label: (recipient: string) => string,
): PeerDeliveryView {
  const delivered: string[] = []
  const skipped: Array<{ target: string; reason: string | null }> = []
  for (const row of rows) {
    const target = label(row.recipient)
    if (row.state === 'skipped') skipped.push({ target, reason: row.reason })
    else delivered.push(target)
  }
  return { delivered, skipped }
}

/** Mốc epoch ms thật (bản ghi `created` cũ dùng số nhỏ, không được coi là hạn). */
const EPOCH_MS_FLOOR = 1_000_000_000_000

/** Mốc epoch GIÂY hợp lệ — backend đợt 22 phát `deadline` bằng giây (`1790098963.461`). */
const EPOCH_S_FLOOR = 1_000_000_000

/** `deadline` thật → epoch ms; nhận CẢ hai đơn vị backend có thể phát, `null` khi không phải mốc thật. */
export function deadlineMs(deadline: number | null): number | null {
  if (deadline === null) return null
  if (deadline >= EPOCH_MS_FLOOR) return deadline
  if (deadline >= EPOCH_S_FLOOR) return deadline * 1000
  return null
}

/** `true` khi lưới an toàn có mốc tuyệt đối — chỉ khi đó mới cần đồng hồ đếm. */
export function hasAbsoluteDeadline(wait: PeerWait | null): boolean {
  return Boolean(wait && deadlineMs(wait.deadline) !== null)
}

/**
 * Số giây còn lại của lưới an toàn, hoặc `null` khi lượt chờ này không có lưới
 * (người chờ tự truyền hạn ⇒ nhãn chờ đã nói hết ý).
 *
 * Có `deadline` thật ⇒ còn lại = deadline − hiện tại (đồng hồ chạy).
 * Chỉ có `safetySeconds` ⇒ hiện CẢ cửa sổ an toàn, không bịa phần đã trôi qua.
 */
export function safetyNetSeconds(wait: PeerWait, nowMs: number): number | null {
  if (!wait.waitsUntilDelivery) return null
  const deadline = deadlineMs(wait.deadline)
  if (deadline !== null) {
    return Math.max(0, Math.round((deadline - nowMs) / 1000))
  }
  if (wait.safetySeconds !== null && wait.safetySeconds > 0) return Math.round(wait.safetySeconds)
  return null
}

/** `300` → `5:00`; quá một giờ thì kèm giờ (`1:05:00`). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const ss = String(rest).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
