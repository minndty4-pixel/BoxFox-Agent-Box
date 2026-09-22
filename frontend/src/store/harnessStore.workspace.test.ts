import { beforeEach, describe, expect, it, vi } from 'vitest'

// Runtime-info thật của engine (đo sống: GET /api/agent/runtime-info) — chỉ giữ phần store dùng.
const RUNTIME_INFO = {
  tools: ['file_read', 'terminal_exec', 'web_search'],
  toolGroups: [],
  limits: {
    instructionsChars: 12000,
    maxStepsDefault: 16,
    maxStepsMax: 60,
    deadlineDefaultSeconds: 180,
    deadlineMaxSeconds: 600,
    childMaxSteps: 10,
    childDeadlineSeconds: 120,
  },
}

vi.mock('../lib/agentApi', () => ({
  agentApi: async (path: string) => {
    if (path === '/runtime-info') return RUNTIME_INFO
    throw new Error(`agentApi mock: unexpected ${path}`)
  },
}))

import { isRoutableModel } from '../lib/harnessRoles'
import { loadRuntimeInfo, narrowTools } from '../lib/ownerDirectives'
import { nextCopyName, useHarnessStore } from './harnessStore'

const pristine = useHarnessStore.getState()
const state = () => useHarnessStore.getState()

beforeEach(() => {
  localStorage.clear()
  useHarnessStore.setState(pristine, true)
})

describe('harness records in boxfox_harness_v0', () => {
  it('loads an old record that has none of the new fields and lets the engine choose', async () => {
    localStorage.setItem(
      'boxfox_harness_v0',
      JSON.stringify({
        state: {
          harnesses: [{ id: 'legacy', name: 'Legacy harness', description: 'written before this round', mainModel: 'default', subagents: [] }],
          activeHarnessId: 'legacy',
          teamDefaultId: 'legacy',
          myDefaultId: 'legacy',
        },
        version: 0,
      }),
    )
    await useHarnessStore.persist.rehydrate()

    const legacy = state().getHarnessById('legacy')
    expect(legacy?.name).toBe('Legacy harness')
    expect(legacy?.mainModel).toBe('default')
    // Thiếu trường = engine tự quyết (16 bước / 180 giây / đủ công cụ); store không được bịa số.
    expect(legacy?.maxSteps).toBeUndefined()
    expect(legacy?.deadlineSeconds).toBeUndefined()
    expect(legacy?.tools).toBeUndefined()
  })

  it('clamps the engine knobs into the range the engine accepts', () => {
    const id = 'gpt-code-gpt-review'
    state().setHarnessTuning(id, { maxSteps: 0, deadlineSeconds: 1 })
    expect(state().getHarnessById(id)).toMatchObject({ maxSteps: 1, deadlineSeconds: 5 })

    state().setHarnessTuning(id, { maxSteps: 999, deadlineSeconds: 9999 })
    expect(state().getHarnessById(id)).toMatchObject({ maxSteps: 60, deadlineSeconds: 600 })

    state().setHarnessTuning(id, { maxSteps: Number.NaN })
    expect(state().getHarnessById(id)?.maxSteps).toBe(60)
  })

  it('keeps only tool names the engine reports, and never guesses when it has no list', async () => {
    await loadRuntimeInfo()
    const id = 'gpt-code-gpt-review'
    state().setHarnessTuning(id, { tools: ['file_read', 'ghost_tool', 'terminal_exec'] })
    expect(state().getHarnessById(id)?.tools).toEqual(['file_read', 'terminal_exec'])
    // Chưa biết danh sách hợp lệ thì giữ nguyên điều người dùng gõ, không xoá trắng.
    expect(narrowTools(['a', 'b'], null)).toEqual(['a', 'b'])
  })

  it('creates a prefilled harness that becomes the one in use', () => {
    const id = state().createHarness()
    const created = state().getHarnessById(id)
    expect(created).toMatchObject({ name: 'New Custom Harness', description: 'Custom configured AI workflow', isBuiltIn: false })
    expect(state().activeHarnessId).toBe(id)
    expect(created?.maxSteps).toBeUndefined()
  })

  /**
   * Lỗi b18-review #3: `setHarnessTuning` coi `undefined` là "bỏ qua", nên một
   * trường đã đặt KHÔNG BAO GIỜ xoá được — đặt 20 bước, xoá ô, lưu: ô tự điền
   * lại 20. `null` là tín hiệu XOÁ, và nó phải xoá hẳn khoá.
   */
  it('clears a knob with `null` and really removes the key', () => {
    const id = 'gpt-code-gpt-review'
    state().setHarnessTuning(id, { maxSteps: 20, deadlineSeconds: 45 })
    expect(state().getHarnessById(id)).toMatchObject({ maxSteps: 20, deadlineSeconds: 45 })

    state().setHarnessTuning(id, { maxSteps: null, deadlineSeconds: null })

    const cleared = state().getHarnessById(id)
    expect(cleared?.maxSteps).toBeUndefined()
    expect(cleared?.deadlineSeconds).toBeUndefined()
    // Không phải "khoá còn nằm đó với giá trị undefined".
    expect(cleared && 'maxSteps' in cleared).toBe(false)
    expect(cleared && 'deadlineSeconds' in cleared).toBe(false)
    // Và bản lưu lại không mang khoá nào của hai trường ấy.
    expect(Object.keys(JSON.parse(localStorage.getItem('boxfox_harness_v0') ?? '{}').state?.harnesses?.[0] ?? {})).not.toContain('maxSteps')
  })

  it('`undefined`/thiếu khoá nghĩa là KHÔNG đụng tới, không phải xoá', () => {
    const id = 'gpt-code-gpt-review'
    state().setHarnessTuning(id, { maxSteps: 20 })
    state().setHarnessTuning(id, { deadlineSeconds: 30 })
    state().setHarnessTuning(id, {})

    expect(state().getHarnessById(id)).toMatchObject({ maxSteps: 20, deadlineSeconds: 30 })
  })

  it('bật lại đủ bộ công cụ thì xoá danh sách đã thu hẹp', () => {
    const id = 'gpt-code-gpt-review'
    state().setHarnessTuning(id, { tools: ['file_read'] })
    expect(state().getHarnessById(id)?.tools).toEqual(['file_read'])

    state().setHarnessTuning(id, { tools: null })

    const cleared = state().getHarnessById(id)
    expect(cleared?.tools).toBeUndefined()
    expect(cleared && 'tools' in cleared).toBe(false)
  })
})

describe('isRoutableModel', () => {
  it('accepts the two forms the composer sends', () => {
    expect(isRoutableModel('default')).toBe(true)
    expect(isRoutableModel('model:2f5c1a9e-1:deepseek-v4-pro')).toBe(true)
    expect(isRoutableModel('alias:fast-reviewer')).toBe(true)
  })

  it('rejects a bare model id and a display name — the router answers 404 MODEL_NOT_FOUND', () => {
    // Đo sống trên router đang chạy (127.0.0.1:3101) với cả hai giá trị dưới đây:
    //   HTTP 404
    //   {"error":{"code":"MODEL_NOT_FOUND","message":"Unknown model. Use an identifier returned by /v1/models.","retryable":false}}
    expect(isRoutableModel('deepseek-v4-pro')).toBe(false)
    expect(isRoutableModel('Claude 3.7 Sonnet')).toBe(false)
    expect(isRoutableModel('')).toBe(false)
    expect(isRoutableModel('model:')).toBe(false)
    expect(isRoutableModel('model:connection-without-model')).toBe(false)
    expect(isRoutableModel('alias:')).toBe(false)
  })
})

describe('saveHarness', () => {
  it('cannot store a main model the router would refuse', () => {
    const source = state().getHarnessById('gpt-code-gpt-review')!
    state().saveHarness({ ...source, mainModel: 'deepseek-v4-pro' })
    expect(state().getHarnessById('gpt-code-gpt-review')?.mainModel).toBe('default')

    state().saveHarness({ ...source, mainModel: 'Claude 3.7 Sonnet' })
    expect(state().getHarnessById('gpt-code-gpt-review')?.mainModel).toBe('default')
  })

  it('keeps a routable main model as typed', () => {
    const source = state().getHarnessById('gpt-code-gpt-review')!
    state().saveHarness({ ...source, mainModel: 'model:2f5c1a9e-1:deepseek-v4-pro' })
    expect(state().getHarnessById('gpt-code-gpt-review')?.mainModel).toBe('model:2f5c1a9e-1:deepseek-v4-pro')

    state().saveHarness({ ...source, mainModel: 'alias:fast-reviewer' })
    expect(state().getHarnessById('gpt-code-gpt-review')?.mainModel).toBe('alias:fast-reviewer')
  })
})

describe('cloneHarness', () => {
  it('proposes the next free number in the (Copy) family', () => {
    const id = state().cloneHarness('open-model-harness')
    const cloned = state().getHarnessById(id)
    // Fixture đang có 'Open Model Harness (Copy)1' và 'Open Model Harness (Copy)'.
    expect(cloned?.name).toBe('Open Model Harness (Copy) 2')
    expect(nextCopyName('Alpha', [])).toBe('Alpha (Copy) 1')
    expect(nextCopyName('Alpha', ['Alpha (Copy) 1', 'Alpha (Copy) 2'])).toBe('Alpha (Copy) 3')
    expect(nextCopyName('Alpha (Copy) 2', [])).toBe('Alpha (Copy) 1')
  })

  it('remembers where it came from and leaves the harness in use alone', () => {
    const id = state().cloneHarness('open-model-harness')
    expect(state().getHarnessById(id)?.duplicatedFrom).toEqual({ id: 'open-model-harness', name: 'Open Model Harness' })
    expect(state().activeHarnessId).toBe('open-model-harness-copy-1')
    expect(state().getHarnessById('open-model-harness')?.name).toBe('Open Model Harness')
  })

  it('gives a clone made in the same millisecond its own record', () => {
    const originalId = state().createHarness()
    const copyId = state().cloneHarness(originalId)
    expect(copyId).not.toBe(originalId)
    expect(state().harnesses.filter((h) => h.id === copyId)).toHaveLength(1)
  })
})

describe('deleteHarness', () => {
  it('refuses to delete a built-in harness', () => {
    state().deleteHarness('open-model-harness')
    expect(state().getHarnessById('open-model-harness')).toBeTruthy()
  })

  it('strips duplicatedFrom when the original is gone', () => {
    const originalId = state().createHarness()
    const copyId = state().cloneHarness(originalId)
    expect(state().getHarnessById(copyId)?.duplicatedFrom).toEqual({ id: originalId, name: 'New Custom Harness' })

    state().deleteHarness(originalId)
    expect(state().getHarnessById(originalId)).toBeUndefined()
    expect(state().getHarnessById(copyId)).toBeTruthy()
    expect(state().getHarnessById(copyId)?.duplicatedFrom).toBeUndefined()
  })

  it('falls back to the default harness when the one in use is deleted', () => {
    state().deleteHarness('open-model-harness-copy-1')
    const after = state()
    expect(after.getHarnessById('open-model-harness-copy-1')).toBeUndefined()
    expect(after.activeHarnessId).toBe('gpt-code-gpt-review')
    expect(after.getHarnessById(after.activeHarnessId)).toBeTruthy()
  })
})

describe('built-in records', () => {
  it('promise only what they keep: router default, no model names in the description', () => {
    for (const harness of state().harnesses.filter((h) => h.isBuiltIn)) {
      expect(harness.mainModel).toBe('default')
      expect(harness.description).not.toMatch(/DeepSeek|Claude|GPT|Opus|Gemini|GLM|Kimi/i)
    }
  })
})
