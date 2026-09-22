import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { expandSubagents, isRoutableModel } from '../lib/harnessRoles'
import { cachedRuntimeInfo, deadlineCeiling, narrowTools, stepsCeiling, validToolNames } from '../lib/ownerDirectives'
import type { Harness, ModelOption, SubagentConfig } from '../types/harness'

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro (Global) 1M High',
    provider: 'DeepSeek',
    supportsImages: false,
    contextWindow: '1M',
    thinkingLevels: ['low', 'medium', 'high'],
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'DeepSeek',
    supportsImages: false,
    // Vòng 18: cùng họ V4 với dòng Pro ở trên, cũng 1M — '128k' ở đây là dữ liệu sai.
    contextWindow: '1M',
    thinkingLevels: ['low', 'medium', 'high'],
  },
  {
    id: 'glm-5.2',
    name: 'GLM 5.2',
    provider: 'Zhipu AI',
    supportsImages: true,
    contextWindow: '128k',
  },
  {
    id: 'kimi-2.7-code',
    name: 'Kimi 2.7 Code',
    provider: 'Moonshot AI',
    supportsImages: false,
    contextWindow: '256k',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    supportsImages: true,
    contextWindow: '1M',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    supportsImages: true,
    contextWindow: '2M',
  },
  {
    id: 'claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    supportsImages: true,
    contextWindow: '200k',
    thinkingLevels: ['low', 'medium', 'high'],
  },
]

const DEFAULT_SUBAGENTS: SubagentConfig[] = [
  {
    id: 'explore',
    name: 'Explore',
    isBuiltIn: true,
    enabled: true,
    model: 'DeepSeek V4 Flash',
    systemPromptAppended: '',
  },
  {
    id: 'code',
    name: 'Code & Build',
    isBuiltIn: true,
    enabled: true,
    model: 'GLM 5.2',
    systemPromptAppended: '',
  },
  {
    id: 'review',
    name: 'Review & Verify',
    isBuiltIn: true,
    enabled: true,
    model: 'DeepSeek V4 Pro (Global) 1M High',
    systemPromptAppended: '',
  },
  {
    id: 'test',
    name: 'Debug & Test',
    isBuiltIn: true,
    enabled: true,
    model: 'Kimi 2.7 Code',
    systemPromptAppended: '',
  },
]

const INITIAL_HARNESSES: Harness[] = [
  {
    id: 'gpt-code-gpt-review',
    name: 'GPT code + GPT review',
    description: 'Build-then-review flow: the main agent implements, a second specialist checks the diff before you see it.',
    isBuiltIn: true,
    mainModel: 'default',
    subagents: DEFAULT_SUBAGENTS,
  },
  {
    id: 'gpt-code-opus-review',
    name: 'GPT code + Opus review',
    description: 'Same build-then-review flow, with a slower and more careful validation pass before the result lands.',
    isBuiltIn: true,
    mainModel: 'default',
    subagents: DEFAULT_SUBAGENTS,
  },
  {
    id: 'opus-code-gpt-review',
    name: 'Opus code + GPT review',
    description: 'Architecture-first flow: the main agent plans and builds, then a specialist runs an automated sanity check.',
    isBuiltIn: true,
    mainModel: 'default',
    subagents: DEFAULT_SUBAGENTS,
  },
  {
    id: 'open-model-harness',
    name: 'Open Model Harness',
    description:
      'Mixed cast: each specialist uses the model written on its own card, and the main agent follows the router default.',
    isBuiltIn: true,
    mainModel: 'default',
    subagents: DEFAULT_SUBAGENTS,
  },
  {
    id: 'fable-code-gpt-review',
    name: 'Fable code + GPT review',
    description: 'Creative code flow with structured validation.',
    isBuiltIn: true,
    mainModel: 'default',
    subagents: DEFAULT_SUBAGENTS,
  },
  {
    id: 'open-model-harness-copy-1',
    name: 'Open Model Harness (Copy)1',
    description:
      'Customized open-weight pipeline with user-specific system instructions and specialized debug prompts.',
    isBuiltIn: false,
    mainModel: 'default',
    subagents: [
      {
        id: 'explore',
        name: 'Explore',
        isBuiltIn: true,
        enabled: true,
        model: 'DeepSeek V4 Pro (Global) 1M High',
        systemPromptAppended: 'Focus strictly on discovering hidden invariants and checking security boundaries.',
      },
      {
        id: 'code',
        name: 'Code & Build',
        isBuiltIn: true,
        enabled: true,
        model: 'GLM 5.2',
        systemPromptAppended: 'Always generate clean typed code without any unnecessary wrapper functions.',
      },
    ],
  },
  {
    id: 'open-model-harness-copy',
    name: 'Open Model Harness (Copy)',
    description: 'Staging harness copy for experimentation.',
    isBuiltIn: false,
    mainModel: 'DeepSeek V4 Flash',
    subagents: DEFAULT_SUBAGENTS,
  },
]

/** Tên gợi ý cho bản sao: quét cả họ `(Copy)` — kể cả `(Copy)1` không dấu cách — và lấy số còn trống kế tiếp. */
const COPY_SUFFIX = /\s*\(Copy\)\s*(\d*)$/

export function nextCopyName(sourceName: string, existingNames: string[]): string {
  const base = sourceName.replace(COPY_SUFFIX, '').trim() || sourceName
  const used = new Set<number>()
  for (const name of existingNames) {
    const match = name.match(COPY_SUFFIX)
    if (!match || name.slice(0, match.index).trim() !== base) continue
    used.add(match[1] ? Number(match[1]) : 1)
  }
  let next = 1
  while (used.has(next)) next += 1
  return `${base} (Copy) ${next}`
}

/** Chỉ hai dạng chạy được; mọi giá trị khác bị kẹp về `'default'` thay vì lưu một lời hứa sai. */
export function routableMainModel(value: string | undefined): string {
  return value && isRoutableModel(value) ? value : 'default'
}

/** Id mới, không trùng: tạo rồi nhân bản trong cùng một mili-giây vẫn phải ra hai record khác nhau. */
function nextHarnessId(existing: Harness[]): string {
  const base = `harness-${Date.now()}`
  if (!existing.some((h) => h.id === base)) return base
  let suffix = 2
  while (existing.some((h) => h.id === `${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/**
 * Bản vá cho ba trường chỉnh tay của một harness. Mỗi trường có BA ý nghĩa:
 * - thiếu khoá / `undefined` = không đụng tới trường đó;
 * - `number` / `string[]` = đặt (store tự kẹp theo trần thật của engine);
 * - `null` = XOÁ trường để engine tự quyết — ô nhập trống trong trình sửa phải
 *   quay về mặc định của engine, không phải giữ lại con số cũ (lỗi b18-review #3:
 *   trước đây `undefined` vừa là "bỏ qua" vừa là "đã xoá", nên một trường đã đặt
 *   không bao giờ xoá được — đặt 20 bước rồi xoá ô thì ô tự điền lại 20).
 */
export interface HarnessTuning {
  maxSteps?: number | null
  deadlineSeconds?: number | null
  tools?: string[] | null
}

function clampInt(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

export interface HarnessState {
  harnesses: Harness[]
  teamDefaultId: string
  myDefaultId: string
  activeHarnessId: string
  activeType: 'harness' | 'model'
  activeModelId: string
  // Mức thinking nhà cung cấp công bố có thể là 'max'/'xhigh', không chỉ bộ ba cũ.
  thinkingLevel: string
  searchQuery: string

  setSearchQuery: (query: string) => void
  setTeamDefault: (id: string) => void
  setMyDefault: (id: string) => void
  setActiveHarness: (id: string) => void
  setActiveModel: (id: string) => void
  setThinkingLevel: (thinkingLevel: string) => void
  setActiveType: (type: 'harness' | 'model') => void

  getHarnessById: (id: string) => Harness | undefined
  saveHarness: (harness: Harness) => void
  createHarness: (baseHarness?: Partial<Harness>) => string
  cloneHarness: (id: string) => string
  deleteHarness: (id: string) => void
  setHarnessTuning: (id: string, patch: HarnessTuning) => void
}

export const useHarnessStore = create<HarnessState>()(persist((set, get) => ({
  harnesses: INITIAL_HARNESSES.map((h) => ({ ...h, mainModel: 'default', modelWarning: undefined, subagents: expandSubagents(h.subagents) })),
  teamDefaultId: 'open-model-harness-copy-1',
  myDefaultId: 'open-model-harness-copy-1',
  activeHarnessId: 'open-model-harness-copy-1',
  activeType: 'harness',
  activeModelId: 'claude-3.7-sonnet',
  thinkingLevel: 'medium',
  searchQuery: '',

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setTeamDefault: (teamDefaultId) => set({ teamDefaultId }),
  setMyDefault: (myDefaultId) => set({ myDefaultId }),
  setActiveHarness: (activeHarnessId) => set({ activeHarnessId, activeType: 'harness' }),
  setActiveModel: (activeModelId) => set({ activeModelId, activeType: 'model' }),
  setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
  setActiveType: (activeType) => set({ activeType }),

  getHarnessById: (id) => get().harnesses.find((h) => h.id === id),

  saveHarness: (updatedHarness) =>
    set((state) => {
      // `mainModel` không định tuyến được bị kẹp về 'default' (router trả 404 MODEL_NOT_FOUND).
      const next: Harness = {
        ...updatedHarness,
        mainModel: routableMainModel(updatedHarness.mainModel),
        subagents: expandSubagents(updatedHarness.subagents),
        updatedAt: new Date().toISOString(),
      }
      const exists = state.harnesses.some((h) => h.id === updatedHarness.id)
      if (exists) {
        return { harnesses: state.harnesses.map((h) => (h.id === updatedHarness.id ? next : h)) }
      }
      return { harnesses: [...state.harnesses, next] }
    }),

  createHarness: (baseHarness) => {
    const newId = nextHarnessId(get().harnesses)
    const created: Harness = {
      id: newId,
      name: baseHarness?.name || 'New Custom Harness',
      description: baseHarness?.description || 'Custom configured AI workflow',
      mainModel: routableMainModel(baseHarness?.mainModel),
      isBuiltIn: false,
      createdAt: new Date().toISOString(),
      subagents: expandSubagents(baseHarness?.subagents || INITIAL_HARNESSES[0].subagents),
      // Không đặt maxSteps/deadlineSeconds/tools: thiếu trường = engine tự quyết.
      ...(baseHarness?.maxSteps !== undefined ? { maxSteps: baseHarness.maxSteps } : {}),
      ...(baseHarness?.deadlineSeconds !== undefined ? { deadlineSeconds: baseHarness.deadlineSeconds } : {}),
      ...(baseHarness?.tools !== undefined ? { tools: baseHarness.tools } : {}),
    }
    set((state) => ({ harnesses: [...state.harnesses, created], activeHarnessId: newId }))
    return newId
  },

  cloneHarness: (id) => {
    const state = get()
    const newId = nextHarnessId(state.harnesses)
    const source = state.harnesses.find((h) => h.id === id)
    if (!source) return newId

    const cloned: Harness = {
      ...source,
      subagents: source.subagents.map((subagent) => ({ ...subagent })),
      id: newId,
      name: nextCopyName(source.name, state.harnesses.map((h) => h.name)),
      isBuiltIn: false,
      duplicatedFrom: { id: source.id, name: source.name },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    // Nhân bản là để thử, không phải để đổi harness đang dùng — khác createHarness.
    set((current) => ({ harnesses: [...current.harnesses, cloned] }))
    return newId
  },

  deleteHarness: (id) =>
    set((state) => {
      const target = state.harnesses.find((h) => h.id === id)
      if (!target || target.isBuiltIn) return {}
      // Bản sao mất bản gốc thì dòng tóm tắt rơi về dạng thường.
      const harnesses = state.harnesses
        .filter((h) => h.id !== id)
        .map((h) => (h.duplicatedFrom?.id === id ? { ...h, duplicatedFrom: undefined } : h))
      if (state.activeHarnessId !== id) return { harnesses }
      const fallback =
        harnesses.find((h) => h.id === state.teamDefaultId)?.id ??
        harnesses.find((h) => h.isBuiltIn)?.id ??
        harnesses[0]?.id ??
        ''
      return { harnesses, activeHarnessId: fallback }
    }),

  setHarnessTuning: (id, patch) =>
    set((state) => {
      const tuning: Partial<Harness> = {}
      const cleared = new Set<'maxSteps' | 'deadlineSeconds' | 'tools'>()
      if ('maxSteps' in patch) {
        const raw = patch.maxSteps
        if (raw === null || raw === undefined) cleared.add('maxSteps')
        else {
          const steps = clampInt(raw, 1, stepsCeiling(cachedRuntimeInfo()))
          if (steps !== null) tuning.maxSteps = steps
        }
      }
      if ('deadlineSeconds' in patch) {
        const raw = patch.deadlineSeconds
        if (raw === null || raw === undefined) cleared.add('deadlineSeconds')
        else {
          const seconds = clampInt(raw, 5, deadlineCeiling(cachedRuntimeInfo()))
          if (seconds !== null) tuning.deadlineSeconds = seconds
        }
      }
      // Chỉ giữ tên công cụ engine biết; chưa biết danh sách thì giữ nguyên, không xoá trắng.
      if ('tools' in patch) {
        const raw = patch.tools
        if (raw === null || raw === undefined) cleared.add('tools')
        else tuning.tools = narrowTools(raw, validToolNames(cachedRuntimeInfo()))
      }
      if (!Object.keys(tuning).length && !cleared.size) return {}
      return {
        harnesses: state.harnesses.map((h) => {
          if (h.id !== id) return h
          const next: Harness = { ...h, ...tuning }
          // Xoá hẳn khoá, không gán `undefined`: một khoá còn nằm đó với giá trị
          // `undefined` vẫn là "có mặt" với `in`/`Object.keys`, và bản lưu lại mang
          // theo một trường rỗng thay vì không có trường nào.
          if (cleared.has('maxSteps')) delete next.maxSteps
          if (cleared.has('deadlineSeconds')) delete next.deadlineSeconds
          if (cleared.has('tools')) delete next.tools
          return next
        }),
      }
    }),
}), { name: 'boxfox_harness_v0', partialize: (state) => ({ harnesses: state.harnesses, activeHarnessId: state.activeHarnessId, activeType: state.activeType, activeModelId: state.activeModelId, thinkingLevel: state.thinkingLevel, teamDefaultId: state.teamDefaultId, myDefaultId: state.myDefaultId }) }))
