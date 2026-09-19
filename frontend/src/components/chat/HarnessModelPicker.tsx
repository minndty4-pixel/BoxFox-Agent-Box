/**
 * Bộ chọn nhanh Harness & Model (Quick Picker Popover) tại Chat Input Bar.
 * - Tab chuyển đổi ở đầu: [ 🧩 Harnesses | 🤖 Single Models ]
 * - Ô tìm kiếm nhanh (Search harnesses or models...)
 * - Danh sách item với dấu tích checkmark xanh cho cấu hình đang chọn
 * - Hỗ trợ chọn mức độ Thinking (Low / Medium / High) cho các model hỗ trợ reasoning
 * - Footer: [⚙️ Manage Harnesses] và [+ Create Harness]
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  Cpu,
  Search,
  Check,
  Settings,
  Plus,
  ChevronDown,
  X,
  Brain,
} from 'lucide-react'
import { useHarnessStore, AVAILABLE_MODELS } from '../../store/harnessStore'
import { useUiStore } from '../../store/uiStore'
import { useProviderStore } from '../../store/providerStore'
import { ProviderIcon } from '../providers/ProviderIcon'

export interface RouterSingleModel {
  id: string
  name: string
  provider: string
  thinkingLevels?: string[]
}

interface HarnessModelPickerProps {
  routerModels?: RouterSingleModel[]
  activeRouterModelId?: string
  onRouterModelChange?: (id: string) => void
}

export function HarnessModelPicker({ routerModels, activeRouterModelId, onRouterModelChange }: HarnessModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'harness' | 'model'>('harness')
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPosition, setPanelPosition] = useState({ left: 8, bottom: 8 })

  const harnesses = useHarnessStore((s) => s.harnesses)
  const activeHarnessId = useHarnessStore((s) => s.activeHarnessId)
  const activeModelId = useHarnessStore((s) => s.activeModelId)
  const activeType = useHarnessStore((s) => s.activeType)
  const thinkingLevel = useHarnessStore((s) => s.thinkingLevel)
  const setActiveHarness = useHarnessStore((s) => s.setActiveHarness)
  const setActiveModel = useHarnessStore((s) => s.setActiveModel)
  const setThinkingLevel = useHarnessStore((s) => s.setThinkingLevel)
  const openSettings = useUiStore((s) => s.openSettings)

  // ── Live Provider Models (tự kết nối Router, chỉ hiện khi user đã bật
  //    provider trong Settings > Provider) ────────────────────────────────
  const { snapshot, load: loadProviders } = useProviderStore()
  useEffect(() => {
    if (!snapshot) void loadProviders().catch(() => {})
  }, [snapshot, loadProviders])

  const liveModels: RouterSingleModel[] = useMemo(() => {
    if (!snapshot?.connections) return []
    return snapshot.connections
      .filter(c => c.enabled && c.authState === 'ready' && c.discoveryState === 'ready'
        && (c.providerId !== 'antigravity' || c.projectState === 'ready'))
      .flatMap(c =>
        c.models
          .filter(m => m.enabled && m.health !== 'unavailable')
          .map(m => ({
            id: `model:${c.id}:${m.id}`,
            name: `${c.name} · ${m.name}`,
            provider: c.providerId,
            thinkingLevels: m.thinkingLevels && m.thinkingLevels.length > 1 ? m.thinkingLevels : undefined,
          }))
      )
  }, [snapshot])

  // Khi có live models từ provider → ưu tiên hiển thị, ngược lại fallback
  // về danh sách tĩnh AVAILABLE_MODELS.
  const hasLive = liveModels.length > 0 || (routerModels && routerModels.length > 0)
  const effectiveModels = routerModels && routerModels.length > 0
    ? routerModels.map(m => ({
        ...m,
        thinkingLevels: m.thinkingLevels && m.thinkingLevels.length > 1 ? m.thinkingLevels : undefined,
      }))
    : liveModels.length > 0 ? liveModels : null

  // Current active entity
  const currentHarness = useMemo(
    () => harnesses.find((h) => h.id === activeHarnessId) ?? harnesses[0],
    [harnesses, activeHarnessId],
  )
  const currentModel = useMemo(
    () => AVAILABLE_MODELS.find((m) => m.id === activeModelId) ?? AVAILABLE_MODELS[0],
    [activeModelId],
  )
  const currentRouterModel = effectiveModels?.find((model) => model.id === activeRouterModelId) ?? effectiveModels?.[0] ?? null
  const selectedModelName = currentRouterModel?.name ?? currentModel?.name ?? ''
  const selectedModelProvider = currentRouterModel?.provider ?? currentModel?.provider ?? ''

  const displayModelName = useMemo(() => {
    if (!selectedModelName) return ''
    const parts = selectedModelName.split('·')
    const rawName = parts.length > 1 ? parts.slice(1).join('·').trim() : selectedModelName
    const cleaned = rawName
      .replace(/^Nex AGI:\s*/i, '')
      .replace(/\s*\(free\)$/i, '')
      .replace(/\s*\(Low\)|\(Medium\)|\(High\)/i, '')
      .trim()
    if (cleaned.length > 0) {
      if (cleaned.includes('Claude')) return 'Sonnet'
      if (cleaned.includes('DeepSeek')) return 'DeepSeek'
      if (cleaned.includes('Gemini')) return 'Gemini'
      return cleaned.length > 18 ? cleaned.slice(0, 16) + '…' : cleaned
    }
    return selectedModelName.split(' ')[0]
  }, [selectedModelName])

  const activeThinkingModel = useMemo(() => {
    if (activeType !== 'model') return null
    const target = effectiveModels?.find((m) => m.id === (activeRouterModelId || activeModelId))
    if (target?.thinkingLevels && target.thinkingLevels.length > 1) {
      return {
        id: target.id,
        name: target.name,
        provider: target.provider,
        thinkingLevels: target.thinkingLevels,
      }
    }
    return null
  }, [activeType, effectiveModels, activeRouterModelId, activeModelId])

  const subagentCount = currentHarness?.subagents?.filter((s) => s.enabled).length ?? 1

  // Filtered lists
  const filteredHarnesses = useMemo(() => {
    if (!search.trim()) return harnesses
    const q = search.toLowerCase()
    return harnesses.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.description.toLowerCase().includes(q) ||
        h.mainModel.toLowerCase().includes(q),
    )
  }, [harnesses, search])

  const filteredModels = useMemo(() => {
    if (!search.trim()) return AVAILABLE_MODELS
    const q = search.toLowerCase()
    return AVAILABLE_MODELS.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.contextWindow ? m.contextWindow.toLowerCase().includes(q) : false),
    )
  }, [search])

  const filteredRouterModels = useMemo(() => {
    const list = effectiveModels ?? []
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter((model) => model.name.toLowerCase().includes(q) || model.provider.toLowerCase().includes(q))
  }, [effectiveModels, search])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = 320
      setPanelPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  return (
    <div className="relative inline-block" ref={triggerRef}>
      {/* Trigger Button inside Chat Input Toolbar */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border border-line/50 bg-panel px-2 py-1 text-xs text-muted transition hover:border-zinc-500 hover:text-fg cursor-pointer select-none ${open ? 'border-brand/60 bg-panel2 text-fg ring-1 ring-brand/30' : ''
          }`}
        title={
          activeType === 'harness'
            ? `Harness: ${currentHarness?.name} (${subagentCount} sub-agents)`
            : `Model: ${selectedModelName} (${selectedModelProvider})`
        }
      >
        {activeType === 'harness' ? (
          <>
            <Bot className="size-3.5 text-brand" />
            <span className="font-semibold text-fg">{subagentCount}</span>
          </>
        ) : (
          <>
            {hasLive && selectedModelProvider ? (
              <ProviderIcon providerId={selectedModelProvider} className="size-3.5" />
            ) : (
              <Cpu className="size-3.5 text-amber-400" />
            )}
            <span className="font-semibold text-fg flex items-center gap-1.5">
              <span>{displayModelName}</span>
              {activeThinkingModel && (
                <span className="text-[10px] text-brand font-medium px-1.5 py-0.5 rounded bg-brand/10 border border-brand/25 capitalize leading-none">
                  {thinkingLevel}
                </span>
              )}
            </span>
          </>
        )}
        <ChevronDown className={`size-2.5 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Floating Popover (Anchored above the chat bar) */}
      {open && createPortal(
        <>
          <div
            ref={panelRef}
            className="fixed z-50 w-80 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl animate-in fade-in zoom-in-95 duration-150 select-none"
            style={{ left: panelPosition.left, bottom: panelPosition.bottom }}
          >
            {/* Search Header */}
            <div className="border-b border-line/70 p-2 bg-panel2/70">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 size-3.5 text-muted pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search harnesses or models..."
                  className="w-full rounded-lg border border-line/60 bg-panel px-2.5 py-1.5 pl-8 text-xs text-fg placeholder:text-muted/60 outline-hidden focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600"
                  autoFocus
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 text-muted hover:text-fg cursor-pointer"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              {/* Segmented Switch Tabs */}
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-line/50 bg-panel p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('harness')}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-medium transition cursor-pointer ${activeTab === 'harness'
                      ? 'bg-[#1e222d] text-white shadow-xs font-semibold'
                      : 'text-muted hover:text-fg'
                    }`}
                >
                  <Bot className="size-3 text-brand" />
                  <span>Harnesses</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('model')}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-medium transition cursor-pointer ${activeTab === 'model'
                      ? 'bg-[#1e222d] text-white shadow-xs font-semibold'
                      : 'text-muted hover:text-fg'
                    }`}
                >
                  <Cpu className="size-3 text-amber-400" />
                  <span>Single Models</span>
                </button>
              </div>
            </div>

            {/* Items List Area */}
            <div className="max-h-64 overflow-y-auto p-1.5 divide-y divide-line/30">
              {activeTab === 'harness' ? (
                /* Harnesses List */
                filteredHarnesses.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted">No harnesses found</div>
                ) : (
                  filteredHarnesses.map((harness) => {
                    const isSelected = activeType === 'harness' && activeHarnessId === harness.id
                    const enabledSubCount = harness.subagents?.filter((s) => s.enabled).length ?? 1
                    return (
                      <button
                        key={harness.id}
                        type="button"
                        onClick={() => {
                          setActiveHarness(harness.id)
                          setOpen(false)
                        }}
                        className={`flex w-full items-start justify-between rounded-lg p-2 text-left transition cursor-pointer ${isSelected
                            ? 'bg-[#1c212c] text-white'
                            : 'hover:bg-panel2/60 text-zinc-300'
                          }`}
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-xs text-fg">{harness.name}</span>
                            {harness.isBuiltIn && (
                              <span className="rounded bg-panel px-1 py-0.2 text-[9px] font-mono text-muted border border-line">
                                default
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-1 text-[11px] text-muted leading-tight">
                            {harness.description}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                            <span className="flex items-center gap-1">
                              <Bot className="size-2.5 text-brand" />
                              {enabledSubCount} sub-agents
                            </span>
                            <span>·</span>
                            <span className="truncate">{harness.mainModel}</span>
                          </div>
                        </div>

                        {isSelected && (
                          <Check className="size-4 shrink-0 text-brand mt-0.5 ml-2" />
                        )}
                      </button>
                    )
                  })
                )
              ) : (
                /* Single Models List — hiển thị live models khi user đã bật
                   provider trong Settings, ngược lại fallback AVAILABLE_MODELS */
                hasLive ? (
                  filteredRouterModels.length === 0 ? (
                    <div className="p-6 text-center text-xs text-muted">No models found</div>
                  ) : (
                    filteredRouterModels.map((model) => {
                      const isSelected = activeType === 'model' && (activeRouterModelId === model.id || activeModelId === model.id)
                      const hasThinking = Boolean(model.thinkingLevels && model.thinkingLevels.length > 1)
                      return (
                        <div
                          key={model.id}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              onRouterModelChange?.(model.id)
                              setActiveModel(model.id)
                            }
                          }}
                          onClick={() => {
                            onRouterModelChange?.(model.id)
                            setActiveModel(model.id)
                            if (!hasThinking) {
                              setOpen(false)
                            }
                          }}
                          className={`flex flex-col rounded-lg p-2 text-left transition cursor-pointer select-none ${
                            isSelected
                              ? 'bg-[#1c212c] text-white ring-1 ring-brand/30'
                              : 'hover:bg-panel2/60 text-zinc-300'
                          }`}
                        >
                          <div className="flex w-full items-center justify-between">
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <ProviderIcon providerId={model.provider} className="size-4" />
                                <span className="font-semibold text-xs text-fg truncate">{model.name}</span>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                                <span className="flex items-center gap-1">
                                  <span className={`size-1.5 rounded-full inline-block ${isSelected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                                  Live Provider
                                </span>
                              </div>
                            </div>

                            {isSelected && (
                              <Check className="size-4 shrink-0 text-brand ml-2" />
                            )}
                          </div>

                          {/* Inline Thinking Selector cho model đang được chọn */}
                          {isSelected && hasThinking && (
                            <div
                              className="mt-2 pt-1.5 border-t border-line/40 flex items-center justify-between"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="text-[10px] text-zinc-400 font-medium flex items-center gap-1">
                                <Brain className="size-3 text-brand" />
                                <span>Thinking:</span>
                              </span>
                              <div className="flex items-center gap-1 bg-panel p-0.5 rounded-md border border-line/50">
                                {model.thinkingLevels!.map((lvl) => {
                                  const isActive = thinkingLevel === lvl
                                  return (
                                    <button
                                      key={lvl}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setThinkingLevel(lvl as 'low' | 'medium' | 'high')
                                      }}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition cursor-pointer capitalize ${
                                        isActive
                                          ? 'bg-brand text-brand-fg font-semibold shadow-xs'
                                          : 'text-zinc-400 hover:text-white hover:bg-panel2'
                                      }`}
                                    >
                                      {lvl}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )
                ) : (
                  filteredModels.length === 0 ? (
                    <div className="p-6 text-center text-xs text-muted">No models found</div>
                  ) : (
                    filteredModels.map((model) => {
                      const isSelected = activeType === 'model' && activeModelId === model.id
                      const hasThinking = Boolean(model.thinkingLevels && model.thinkingLevels.length > 1)
                      return (
                        <div
                          key={model.id}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setActiveModel(model.id)
                            }
                          }}
                          onClick={() => {
                            setActiveModel(model.id)
                            if (!hasThinking) {
                              setOpen(false)
                            }
                          }}
                          className={`flex flex-col rounded-lg p-2 text-left transition cursor-pointer select-none ${
                            isSelected
                              ? 'bg-[#1c212c] text-white ring-1 ring-brand/30'
                              : 'hover:bg-panel2/60 text-zinc-300'
                          }`}
                        >
                          <div className="flex w-full items-center justify-between">
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Cpu className="size-4 text-amber-400" />
                                <span className="font-semibold text-xs text-fg">{model.name}</span>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                                <span>{model.provider}</span>
                                {model.contextWindow && (
                                  <>
                                    <span>·</span>
                                    <span>{model.contextWindow}</span>
                                  </>
                                )}
                              </div>
                            </div>

                            {isSelected && (
                              <Check className="size-4 shrink-0 text-brand ml-2" />
                            )}
                          </div>

                          {/* Inline Thinking Selector cho model đang được chọn */}
                          {isSelected && hasThinking && (
                            <div
                              className="mt-2 pt-1.5 border-t border-line/40 flex items-center justify-between"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="text-[10px] text-zinc-400 font-medium flex items-center gap-1">
                                <Brain className="size-3 text-brand" />
                                <span>Thinking:</span>
                              </span>
                              <div className="flex items-center gap-1 bg-panel p-0.5 rounded-md border border-line/50">
                                {model.thinkingLevels!.map((lvl) => {
                                  const isActive = thinkingLevel === lvl
                                  return (
                                    <button
                                      key={lvl}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setThinkingLevel(lvl as 'low' | 'medium' | 'high')
                                      }}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition cursor-pointer capitalize ${
                                        isActive
                                          ? 'bg-brand text-brand-fg font-semibold shadow-xs'
                                          : 'text-zinc-400 hover:text-white hover:bg-panel2'
                                      }`}
                                    >
                                      {lvl}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )
                )
              )}
            </div>

            {/* Footer Actions (Manage & Create) */}
            <div className="flex items-center justify-between border-t border-line/70 bg-[#141720] px-3 py-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  openSettings('harness')
                  setOpen(false)
                }}
                className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <Settings className="size-3.5" />
                <span className="text-[11px] font-medium">Manage Harnesses</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  openSettings('harness')
                  setOpen(false)
                }}
                className="flex items-center gap-1 text-brand hover:underline text-[11px] font-medium cursor-pointer"
              >
                <Plus className="size-3" />
                <span>Create Harness</span>
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
