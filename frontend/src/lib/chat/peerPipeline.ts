/**
 * Đường ống peer của mesh con–con (đợt 22, T15) — đọc THẲNG từ event thật.
 *
 * Hợp đồng §1.3 của kế hoạch `v1-peer-mesh.md`:
 *   `peer_wait`      → luồng CON ĐANG CHỜ: `targets`, `mode`, `waitsUntilDelivery`,
 *                      `safetySeconds`, `deadline`, `turn`, `step`.
 *   `peer_wait_end`  → luồng con đang chờ: `status` (done/timeout/empty/pending_target),
 *                      `waitedMs`, `done[]`, `pending[]`, `extensionExhausted`.
 *   `peer_delivery`  → luồng NGƯỜI NHẬN: `from`, `role`, `chars`, `truncated`, `deliveryId`.
 *
 * Hai luật của chủ nhà (Q2) được cài ở đây, không phải ở chỗ vẽ:
 *   1. Chờ peer nghĩa là chờ **tới lúc peer giao kết quả** — không phải đếm ngược tới một
 *      hạn cố định. Nhãn vì vậy là "đang chờ <role> giao kết quả"; thời gian chỉ được nói
 *      thêm khi lượt chờ KHÔNG tự truyền hạn (`waitsUntilDelivery = true`) — đó là lưới an toàn.
 *   2. Nhãn tự tắt khi gặp `peer_wait_end` (đường chính) hoặc khi hàng sổ con của cha
 *      không còn `waiting_for` (đường dự phòng khi event kết thúc bị mất).
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

function declaredTurn(value: unknown): number | null {
  const turn = asNumber(value)
  return turn !== null && turn > 0 ? Math.trunc(turn) : null
}

/** Một lượt chờ peer đang MỞ, dựng từ `peer_wait` thật. */
export interface PeerWait {
  /** Vai trần đang được chờ, ví dụ `['review']`. */
  roles: string[]
  /** `true` ⇒ người chờ KHÔNG truyền hạn, tức chờ tới lúc peer giao (Q2). */
  waitsUntilDelivery: boolean
  /** Lưới an toàn (giây) — chỉ để lượt không trông như treo. */
  safetySeconds: number | null
  /** Mốc tuyệt đối (ms) của lưới an toàn, khi backend gửi kèm. */
  deadline: number | null
  /** `created` của event `peer_wait` (ms). */
  startedAt: number | null
  turn: number | null
}

/** Một biên nhận "đã nhận từ <role>" — dựng từ `peer_delivery` thật. */
export interface PeerReceipt {
  /** Vai của bên GIAO (đã bỏ tiền tố `role:`). */
  role: string
  chars: number | null
  deliveryId: string | null
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
    receipts.push({
      role,
      chars: asNumber(event.data.chars),
      deliveryId: asText(event.data.deliveryId),
    })
  }
  return receipts
}

/**
 * Hàng sổ con của CHA còn `waiting_for` ⇒ con đó đang chờ peer (đường dự phòng khi
 * luồng của con không được poll, hoặc `peer_wait_end` đã mất).
 */
export function waitFromChildRow(data: Record<string, unknown>): PeerWait | null {
  const roles = peerLabels(data.waiting_for ?? data.waitingFor)
  if (roles.length === 0) return null
  return {
    roles,
    waitsUntilDelivery: data.waitsUntilDelivery !== false,
    safetySeconds: asNumber(data.safetySeconds),
    deadline: asNumber(data.deadline),
    startedAt: asNumber(data.waitingSince),
    turn: declaredTurn(data.turn),
  }
}

/**
 * Biên nhận mà một hàng con NHẬN được, đọc từ `deliveries[]` của một event `child` khác
 * (cha phát): mục nào có `recipient` trỏ đúng vai hoặc đúng phiên của hàng này.
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
    if (!keys.has(recipient)) continue
    receipts.push({
      role: peerLabel(item.role ?? item.from),
      chars: asNumber(item.chars),
      deliveryId: asText(item.deliveryId ?? item.id),
    })
  }
  return receipts
}

/** `deliveries[]` thật của một event `child` (kết thúc) — mục méo bị bỏ. */
export function deliveryRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
}

/** Mốc tuyệt đối đủ lớn để coi là epoch ms thật (bản ghi cũ dùng số nhỏ làm `created`). */
const EPOCH_MS_FLOOR = 1_000_000_000_000

/** `true` khi lưới an toàn có mốc tuyệt đối — chỉ khi đó mới cần đồng hồ đếm. */
export function hasAbsoluteDeadline(wait: PeerWait | null): boolean {
  return Boolean(wait && wait.deadline !== null && wait.deadline >= EPOCH_MS_FLOOR)
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
  if (hasAbsoluteDeadline(wait)) {
    return Math.max(0, Math.round(((wait.deadline as number) - nowMs) / 1000))
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
