import { describe, expect, it } from 'vitest'
import { expandSubagents, HARNESS_ROLES } from './harnessRoles'

describe('harness role migration', () => {
  it('splits combined roles while preserving user guidance and enabled state', () => {
    const roles = expandSubagents([{ id: 'test', name: 'Debug & Test', enabled: false, model: 'Kimi 2.7 Code', systemPromptAppended: 'Keep my reproduction' }])
    expect(roles.map(r => r.id)).toEqual([...HARNESS_ROLES])
    for (const id of ['debug', 'testing']) {
      expect(roles.find(r => r.id === id)).toMatchObject({ enabled: false, model: 'inherit', systemPromptAppended: 'Keep my reproduction' })
    }
    expect(roles.find(r => r.id === 'research')?.enabled).toBe(true)
  })
  it('retains explicitly selected live model routes', () => {
    expect(expandSubagents([{ id: 'build', name: 'Build', enabled: true, model: 'model:connection:model-id', systemPromptAppended: '' }]).find(r => r.id === 'build')?.model).toBe('model:connection:model-id')
  })
})
