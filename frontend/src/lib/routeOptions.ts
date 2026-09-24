/**
 * Danh sách route của composer — MỘT dòng cho mỗi cặp (provider, model).
 *
 * Trước vòng 29, mỗi connection là một dòng option (`model:<connectionId>:<modelId>`), nên bốn
 * connection opencode cùng một model hiện thành bốn dòng giống nhau và phiên bị ghim vào đúng
 * một connection: khoá đó hết hạn mức là lượt chết, dù ba connection còn lại còn chạy được.
 *
 * Bản này gộp các connection DÙNG ĐƯỢC của cùng một provider + model thành một dòng
 * `provider:<providerId>:<modelId>`; router tự chọn connection trong nhóm (thứ tự
 * `connectionOrder`, có `roundRobin`) và tự failover khi khoá hết hạn mức. Ghim một connection
 * vẫn được — nằm trong `pins` của dòng đó, giữ nguyên cú pháp `model:<connectionId>:<modelId>`.
 *
 * Chỗ mới `lib/` (không phải trong `RouterTestChat.tsx`) để `HarnessModelPicker` dùng được mà
 * không tạo vòng `RouterTestChat → ChatInputBar → HarnessModelPicker → RouterTestChat`.
 */
import type { ProviderConnection, ProviderModel, ProviderSnapshot } from '../types/provider'
import type { RouterChatSelection } from '../store/routerChatStore'

/** Một dòng trong bảng chọn model của composer. `pins` cũng mang đúng hình dạng này. */
export interface RouterChatOption {
  value: string
  label: string
  providerId: string
  thinkingLevels?: string[]
  selection: RouterChatSelection
  /** Số connection dùng được gộp vào dòng — chỉ để hiện ở dòng phụ, không nằm trong nhãn. */
  connections?: number
  /** Số khoá của cả nhóm (một connection có thể giữ nhiều khoá) — cũng chỉ để hiện ở dòng phụ. */
  keys?: number
  /** Số connection trong nhóm mà danh sách model do người dùng gõ tay (dò hỏng) — dòng phụ nói ra. */
  handTyped?: number
  /** Các connection riêng lẻ của cùng model; chỉ khi nhóm có ≥ 2 connection. */
  pins?: RouterChatOption[]
}

/**
 * `(connection, model)` mà router THẬT SỰ định tuyến được — bản sao phía UI của `validTarget`
 * (`router/src/service.mjs`) và `_routable_model` (`backend/src/agentbox/agent_core/runtime.py`).
 *
 * Luật của router, nguyên văn: connection phải `enabled` + `authState === 'ready'` (antigravity
 * thêm `projectState === 'ready'`), model phải `enabled` và không `unavailable`; danh sách model
 * dò được (`discoveryState === 'ready'`) là đường thường, còn dò hỏng (`failed`/`degraded`) thì
 * chỉ những model `source === 'custom'` — thứ người dùng tự gõ — mới còn định tuyến được.
 *
 * Lệch luật này theo BẤT KỲ hướng nào cũng hỏng (Duyệt 29 tìm ra cả hai):
 * - rộng hơn ⇒ composer hứa một đích mà lượt không tới được;
 * - hẹp hơn ⇒ bảng chọn bỏ mất đích router vẫn chạy (connection dò hỏng + model gõ tay biến mất,
 *   và giao mức thinking tính trên tập HẸP hơn tập harness dùng, nên composer gửi `medium` cho
 *   nhóm mà harness từ chối — THINKING_LEVEL_UNSUPPORTED).
 * Mọi nơi cần trả lời "đích này có chạy được không" phải gọi hàm này, đừng chép lại luật.
 */
export function routable(connection: ProviderConnection, model: ProviderModel | null | undefined): boolean {
  if (!connection || !model) return false
  if (!connection.enabled || connection.authState !== 'ready') return false
  if (connection.providerId === 'antigravity' && connection.projectState !== 'ready') return false
  if (!model.enabled || model.health === 'unavailable') return false
  if (connection.discoveryState === 'ready') return true
  return model.source === 'custom'
    && (connection.discoveryState === 'failed' || connection.discoveryState === 'degraded')
}

/**
 * Connection định tuyến được ÍT NHẤT một model — vẫn đúng luật trên, chỉ hỏi ở mức connection
 * (danh sách model ở Settings dựng theo connection). Dùng hàm này thay vì tự lọc `discoveryState`.
 */
export function routableConnection(connection: ProviderConnection): boolean {
  return (connection.models ?? []).some((model) => routable(connection, model))
}

/**
 * Giao của hai danh sách mức thinking (so khớp hoa/thường, giữ cách viết của danh sách đầu).
 * Một bên không công bố mức nào, hoặc giao rỗng ⇒ `undefined` (không gửi mức nào).
 */
export function intersectThinkingLevels(a?: string[], b?: string[]): string[] | undefined {
  if (!a?.length || !b?.length) return undefined
  const shared = a.filter((level) => b.some((candidate) => candidate.toLowerCase() === level.toLowerCase()))
  return shared.length > 0 ? shared : undefined
}

/** Một nhóm connection định tuyến được của cùng (providerId, modelId). */
export interface RouterModelRow {
  providerId: string
  providerName: string
  modelId: string
  name: string
  connections: Array<{ id: string; name: string; thinkingLevels?: string[]; keys: number; handTyped: boolean }>
  /** Tổng số khoá của cả nhóm — vòng khoá router trang trí `keys`; vắng thì mỗi connection là một khoá. */
  keys: number
  /** Giao mức của MỌI connection trong nhóm — mức gửi đi phải hợp lệ với mọi đích. */
  thinkingLevels?: string[]
  /** Số connection trong nhóm mà danh sách model là do người dùng GÕ TAY (`discoveryState` hỏng).
   *  Vẫn định tuyến được, nhưng hàng phải nói ra thay vì gộp im lặng với connection đã dò xong. */
  handTyped: number
}

export function providerModelRows(snapshot: ProviderSnapshot | null | undefined): RouterModelRow[] {
  const rows = new Map<string, RouterModelRow>()
  for (const connection of snapshot?.connections ?? []) {
    for (const model of connection.models) {
      if (!routable(connection, model)) continue
      const levels = model.thinkingLevels?.length ? [...model.thinkingLevels] : undefined
      // Router chưa trang trí vòng khoá (`keys` vắng) thì một connection vẫn là một khoá —
      // con số hiện ra phải là số khoá THẬT có thể phục vụ lượt, không phải số 0.
      const keys = connection.keys && connection.keys.length > 0 ? connection.keys.length : 1
      // Chỉ tới đây được khi `discoveryState === 'ready'`, hoặc khi dò hỏng mà model gõ tay.
      const handTyped = connection.discoveryState !== 'ready'
      const key = `${connection.providerId}:${model.id}`
      const existing = rows.get(key)
      if (!existing) {
        rows.set(key, {
          providerId: connection.providerId,
          providerName: snapshot?.providers?.find((p) => p.id === connection.providerId)?.name ?? connection.name,
          modelId: model.id,
          name: model.name,
          connections: [{ id: connection.id, name: connection.name, thinkingLevels: levels, keys, handTyped }],
          keys,
          thinkingLevels: levels,
          handTyped: handTyped ? 1 : 0,
        })
        continue
      }
      existing.connections.push({ id: connection.id, name: connection.name, thinkingLevels: levels, keys, handTyped })
      existing.keys = (existing.keys ?? 0) + keys
      if (handTyped) existing.handTyped += 1
      existing.thinkingLevels = intersectThinkingLevels(existing.thinkingLevels, levels)
    }
  }
  return [...rows.values()]
}

function rowForTarget(rows: RouterModelRow[], target: { connectionId: string; modelId: string }) {
  return rows.find((row) => row.modelId === target.modelId
    && row.connections.some((connection) => connection.id === target.connectionId))
}

/**
 * Mức thinking dùng chung cho mọi đích của một alias: chỉ khi **mọi** đích đều công bố mức thì
 * giao của chúng mới là mức an toàn; đích nào chưa công bố thì để trống, và composer sẽ không
 * gửi mức nào (router dùng mức mặc định của đích nó chọn).
 */
export function aliasThinkingLevels(
  alias: ProviderSnapshot['aliases'][number],
  rows: RouterModelRow[],
): string[] | undefined {
  const lists: string[][] = []
  for (const target of alias.targets) {
    const row = rowForTarget(rows, target)
    const levels = row?.connections.find((connection) => connection.id === target.connectionId)?.thinkingLevels
    if (!levels || levels.length === 0) return undefined
    lists.push(levels)
  }
  if (lists.length === 0) return undefined
  const shared = lists[0].filter((level) => lists.every((list) => list.some((l) => l.toLowerCase() === level.toLowerCase())))
  return shared.length > 0 ? shared : undefined
}

/** Dòng option của một nhóm: một dòng cho cả nhóm, kèm `pins` khi nhóm có ≥ 2 connection. */
function rowOption(row: RouterModelRow): RouterChatOption {
  return {
    value: `provider:${row.providerId}:${row.modelId}`,
    label: `${row.providerName} · ${row.name}`,
    providerId: row.providerId,
    thinkingLevels: row.thinkingLevels,
    connections: row.connections.length,
    keys: row.keys,
    handTyped: row.handTyped > 0 ? row.handTyped : undefined,
    pins: row.connections.length < 2 ? undefined : row.connections.map((connection) => ({
      value: `model:${connection.id}:${row.modelId}`,
      label: connection.name,
      providerId: row.providerId,
      thinkingLevels: connection.thinkingLevels,
      selection: { kind: 'model', connectionId: connection.id, modelId: row.modelId } as RouterChatSelection,
    })),
    selection: { kind: 'provider', providerId: row.providerId, modelId: row.modelId } as RouterChatSelection,
  }
}

export function routerChatOptions(snapshot: ProviderSnapshot | null | undefined): RouterChatOption[] {
  const rows = providerModelRows(snapshot)
  const models = rows.map(rowOption)
  const aliases: RouterChatOption[] = (snapshot?.aliases ?? [])
    .filter((a) => a.enabled && a.targets.some((t) => rowForTarget(rows, t)))
    .map((a) => ({
      value: `alias:${a.id}`,
      label: a.name,
      providerId: snapshot?.connections.find((c) => c.id === a.targets[0]?.connectionId)?.providerId ?? 'router',
      thinkingLevels: aliasThinkingLevels(a, rows),
      selection: { kind: 'alias', aliasId: a.id } as RouterChatSelection,
    }))
  return [...aliases, ...models]
}

export function selectionKey(selection: RouterChatSelection | null): string {
  if (!selection) return ''
  if (selection.kind === 'alias') return `alias:${selection.aliasId}`
  if (selection.kind === 'provider') return `provider:${selection.providerId}:${selection.modelId}`
  return `model:${selection.connectionId}:${selection.modelId}`
}

/**
 * Tra một option theo `value`, tìm **cả trong `pins`**: `snapshot.defaultRoute` vẫn là dạng
 * `connectionId/modelId`, nên một phiên ghim phải chọn được đúng hàng con chứ không rơi về hàng cha.
 */
export function findRouteOption(
  options: RouterChatOption[],
  value: string | null | undefined,
): RouterChatOption | undefined {
  if (!value) return undefined
  for (const option of options) {
    if (option.value === value) return option
    const pinned = option.pins?.find((pin) => pin.value === value)
    if (pinned) return pinned
  }
  return undefined
}

/** Model cho picker/composer: `id`/`name` là tên trường hai đầu đang dùng. */
export interface RouterComposerModel {
  id: string
  name: string
  provider: string
  thinkingLevels?: string[]
  /** Số connection dùng được gộp vào dòng — dòng phụ của picker đọc số này. */
  connections?: number
  /** Số khoá của cả nhóm — dòng phụ của picker đọc số này. */
  keys?: number
  /** Số connection trong nhóm có danh sách model gõ tay (`discoveryState` hỏng) — dòng phụ đọc số này. */
  handTyped?: number
  /** Các connection riêng lẻ của cùng model (nhóm ≥ 2 connection). */
  pins?: RouterComposerModel[]
}

/** Adapter `RouterChatOption` → `RouterComposerModel` (đổi `value/label` thành `id/name`). */
export function composerModels(options: RouterChatOption[]): RouterComposerModel[] {
  return options.map((option) => ({
    id: option.value,
    name: option.label,
    provider: option.providerId,
    thinkingLevels: option.thinkingLevels,
    connections: option.connections,
    keys: option.keys,
    handTyped: option.handTyped,
    pins: option.pins?.map((pin) => ({
      id: pin.value,
      name: pin.label,
      provider: pin.providerId,
      thinkingLevels: pin.thinkingLevels,
    })),
  }))
}
