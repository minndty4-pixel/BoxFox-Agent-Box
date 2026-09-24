import type { SubagentConfig } from '../types/harness'

export const HARNESS_ROLES = [
  'explore',
  'plan',
  'design',
  'build',
  'debug',
  'review',
  // Vai phản biện độc lập (vòng 25): đọc ĐÚNG bản đang xem rồi trả lỗi kèm cách sửa. Đứng ngay sau
  // `review` vì cùng họ "soi", nhưng khác việc: `review` soi mã, `plan-review` soi kế hoạch.
  'plan-review',
  'simplify',
  'testing',
  'research',
  // Vòng 27 (đợt 6): vai phản biện độc lập của việc nghiên cứu — chạy trên tệp hồ sơ và trả
  // verdict `revise`/`pass`, cùng họ "soi" như `plan-review` nhưng soi hồ sơ, nên đứng CUỐI
  // danh sách: các vai cũ giữ nguyên thứ tự đang được test ghim.
  'research-review',
] as const

/** Tên hiển thị cho vai có gạch nối — các vai một chữ vẫn dùng luật viết hoa chữ đầu. */
const ROLE_NAMES: Record<string, string> = {
  'plan-review': 'Plan Review',
  'research-review': 'Research Review',
}

/**
 * `mainModel` chỉ có ĐÚNG hai dạng chạy được: `'default'` (router tự chọn) hoặc một định danh
 * định tuyến `model:<connectionId>:<modelId>` / `alias:<id>` — đúng dạng composer gửi.
 * Router chỉ nhận tên alias hoặc chuỗi có `/`, mọi dạng khác trả `404 MODEL_NOT_FOUND`
 * (router/src/engine.mjs:14-24) — đo sống với `deepseek-v4-pro` và `Claude 3.7 Sonnet`.
 */
export function isRoutableModel(value: string): boolean {
  if (value === 'default') return true
  if (value.startsWith('alias:')) return value.slice('alias:'.length).trim().length > 0
  if (!value.startsWith('model:')) return false
  const rest = value.slice('model:'.length)
  const split = rest.indexOf(':')
  return split > 0 && rest.slice(split + 1).length > 0
}

export function expandSubagents(existing: SubagentConfig[] = []): SubagentConfig[] {
  const aliases: Record<string, string> = { build: 'code', debug: 'test', testing: 'test' }
  return HARNESS_ROLES.map((id) => {
    const source = existing.find((s) => s.id === id) ?? existing.find((s) => s.id === aliases[id])
    return { ...source, id, name: ROLE_NAMES[id] ?? id[0].toUpperCase() + id.slice(1), isBuiltIn: true,
      enabled: source?.enabled ?? true, model: source?.model?.startsWith('model:') || source?.model?.startsWith('alias:') ? source.model : 'inherit',
      systemPromptAppended: source?.systemPromptAppended ?? '' }
  })
}
