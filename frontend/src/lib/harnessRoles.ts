import type { SubagentConfig } from '../types/harness'

export const HARNESS_ROLES = ['explore', 'plan', 'design', 'build', 'debug', 'review', 'simplify', 'testing', 'research'] as const

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
    return { ...source, id, name: id[0].toUpperCase() + id.slice(1), isBuiltIn: true,
      enabled: source?.enabled ?? true, model: source?.model?.startsWith('model:') || source?.model?.startsWith('alias:') ? source.model : 'inherit',
      systemPromptAppended: source?.systemPromptAppended ?? '' }
  })
}
