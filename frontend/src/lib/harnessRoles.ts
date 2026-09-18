import type { SubagentConfig } from '../types/harness'

export const HARNESS_ROLES = ['explore', 'plan', 'design', 'build', 'debug', 'review', 'simplify', 'testing', 'research'] as const

export function expandSubagents(existing: SubagentConfig[] = []): SubagentConfig[] {
  const aliases: Record<string, string> = { build: 'code', debug: 'test', testing: 'test' }
  return HARNESS_ROLES.map((id) => {
    const source = existing.find((s) => s.id === id) ?? existing.find((s) => s.id === aliases[id])
    return { ...source, id, name: id[0].toUpperCase() + id.slice(1), isBuiltIn: true,
      enabled: source?.enabled ?? true, model: source?.model?.startsWith('model:') || source?.model?.startsWith('alias:') ? source.model : 'inherit',
      systemPromptAppended: source?.systemPromptAppended ?? '' }
  })
}
