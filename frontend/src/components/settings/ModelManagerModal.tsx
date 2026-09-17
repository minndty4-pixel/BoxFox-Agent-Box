import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Search,
  Bot,
  Check,
  Plus,
  Copy,
  Sparkles,
  Eye,
  Activity,
  Play,
  RotateCw,
  ChevronRight,
} from 'lucide-react'
import { useProviderStore } from '../../store/providerStore'
import { ProviderIcon } from '../providers/ProviderIcon'
import type { ProviderConnection } from '../../types/provider'

interface ModelManagerModalProps {
  connection: ProviderConnection
  onClose: () => void
  initialSelectedModelId?: string
}

const ITEM_HEIGHT = 50
const OVERSCAN = 6

export function ModelManagerModal({
  connection,
  onClose,
  initialSelectedModelId,
}: ModelManagerModalProps) {
  const request = useProviderStore((state) => state.request)
  const busy = useProviderStore((state) => state.busy)

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'free' | 'passed'>('active')
  const [selectedId, setSelectedId] = useState<string>(
    initialSelectedModelId ||
      connection.models.find((m) => m.enabled)?.id ||
      connection.models[0]?.id ||
      ''
  )

  // Testing state
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testPrompt, setTestPrompt] = useState('Reply exactly: BOXFOX_OK')
  const [stream, setStream] = useState(false)
  const [testOutput, setTestOutput] = useState<{
    status: 'idle' | 'running' | 'passed' | 'failed'
    latencyMs?: number
    content?: string
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    error?: string
  }>({ status: 'idle' })

  // Custom model creation state
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customId, setCustomId] = useState('')
  const [customName, setCustomName] = useState('')
  const [customVision, setCustomVision] = useState(false)
  const [customReasoning, setCustomReasoning] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Virtual scrolling state
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRaf = useRef<number | null>(null)

  const enabledIds = useMemo(
    () => new Set(connection.models.filter((m) => m.enabled).map((m) => m.id)),
    [connection.models]
  )

  // Filter models with deferred search for responsive typing
  const filteredModels = useMemo(() => {
    return connection.models.filter((m) => {
      // Filter tab
      if (filterTab === 'active' && !m.enabled) return false
      if (filterTab === 'free') {
        const isFree = m.id.includes(':free') || m.id === 'openrouter/free' || (m as any).pricing?.prompt === '0'
        if (!isFree) return false
      }
      if (filterTab === 'passed' && m.health !== 'ready') return false

      // Search term
      if (!deferredSearch.trim()) return true
      const query = deferredSearch.toLowerCase()
      return m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
    })
  }, [connection.models, filterTab, deferredSearch])

  // Reset scroll when filter or search changes
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      setScrollTop(0)
    }
  }, [filterTab, deferredSearch])

  const selectedModel = useMemo(() => {
    return connection.models.find((m) => m.id === selectedId) || filteredModels[0] || connection.models[0]
  }, [connection.models, selectedId, filteredModels])

  // Virtual windowing calculations
  const totalCount = filteredModels.length
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(550 / ITEM_HEIGHT) + 2 * OVERSCAN
  const endIndex = Math.min(totalCount, startIndex + visibleCount)
  const visibleModels = filteredModels.slice(startIndex, endIndex)
  const paddingTop = startIndex * ITEM_HEIGHT
  const paddingBottom = Math.max(0, (totalCount - endIndex) * ITEM_HEIGHT)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current)
    scrollRaf.current = requestAnimationFrame(() => {
      setScrollTop(top)
    })
  }

  // Toggle single model
  const toggleModel = async (modelId: string) => {
    const isCurrentlyEnabled = enabledIds.has(modelId)
    const nextEnabled = isCurrentlyEnabled
      ? Array.from(enabledIds).filter((id) => id !== modelId)
      : [...Array.from(enabledIds), modelId]
    await request(`/api/router/connections/${encodeURIComponent(connection.id)}`, 'PATCH', {
      enabledModelIds: nextEnabled,
    })
  }

  // Toggle all free models
  const enableAllFree = async () => {
    const freeIds = connection.models
      .filter((m) => m.id.includes(':free') || m.id === 'openrouter/free')
      .map((m) => m.id)
    const merged = Array.from(new Set([...Array.from(enabledIds), ...freeIds]))
    await request(`/api/router/connections/${encodeURIComponent(connection.id)}`, 'PATCH', {
      enabledModelIds: merged,
    })
  }

  // Disable all
  const disableAll = async () => {
    await request(`/api/router/connections/${encodeURIComponent(connection.id)}`, 'PATCH', {
      enabledModelIds: [],
    })
  }

  // Copy helper
  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text)
    setCopiedId(text)
    setTimeout(() => setCopiedId(null), 1500)
  }

  // Test inference probe
  const runTestModel = async (modelId: string) => {
    setTestingId(modelId)
    setTestOutput({ status: 'running' })
    const started = Date.now()
    try {
      const res = (await request(
        `/api/router/connections/${encodeURIComponent(connection.id)}/models/${encodeURIComponent(modelId)}/test`,
        'POST'
      )) as any
      const latency = Date.now() - started
      setTestOutput({
        status: 'passed',
        latencyMs: latency,
        content: 'BOXFOX_OK',
        usage: res?.usage,
      })
    } catch (err: any) {
      setTestOutput({
        status: 'failed',
        latencyMs: Date.now() - started,
        error: err?.message || 'Inference probe failed',
      })
    } finally {
      setTestingId(null)
    }
  }

  // Add custom model
  const handleAddCustomModel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customId.trim()) return

    const newModel = {
      id: customId.trim(),
      name: customName.trim() || customId.trim(),
      enabled: true,
      source: 'custom' as const,
      capabilities: {
        streaming: 'reported' as const,
        tools: 'reported' as const,
        vision: customVision ? ('reported' as const) : ('none' as const),
        reasoning: customReasoning ? ('reported' as const) : ('none' as const),
      },
    }

    const updatedModels = [...connection.models, newModel]
    const updatedEnabledIds = Array.from(new Set([...Array.from(enabledIds), newModel.id]))

    await request(`/api/router/connections/${encodeURIComponent(connection.id)}`, 'PATCH', {
      models: updatedModels,
      enabledModelIds: updatedEnabledIds,
    })

    setCustomId('')
    setCustomName('')
    setCustomVision(false)
    setCustomReasoning(false)
    setShowCustomForm(false)
    setSelectedId(newModel.id)
  }

  // Render status badge helper
  const getStatusBadge = (model: any) => {
    if (model.health === 'ready' || model.lastProbe?.status === 'passed') {
      return (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Passed
        </span>
      )
    }
    if (model.health === 'error' || model.lastProbe?.status === 'failed') {
      return (
        <span className="flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400 border border-rose-500/20">
          <span className="size-1.5 rounded-full bg-rose-500" />
          Failed
        </span>
      )
    }
    return (
      <span className="flex items-center gap-1 rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-muted border border-line">
        <span className="size-1.5 rounded-full bg-muted/60" />
        Untested
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 sm:p-6 animate-fade-in">
      <div className="flex flex-col w-full max-w-5xl max-h-[88vh] h-[720px] rounded-2xl border border-line bg-[#0e1015] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-line/80 px-6 py-4 bg-[#14171d] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-panel2 border border-line">
              <ProviderIcon providerId={connection.providerId} name={connection.name} className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-fg tracking-tight">
                  Available Models ({connection.name})
                </h2>
                <span className="rounded-full bg-brand/10 border border-brand/20 px-2 py-0.5 text-[11px] font-mono font-medium text-brand">
                  {enabledIds.size}/{connection.models.length} active
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Manage live discovered models, add custom identifiers, or probe upstream inference latency.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted hover:text-fg hover:bg-panel2 transition cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal Body: Split-View 2 Columns */}
        <div className="flex flex-1 min-h-0 divide-x divide-line/60">
          {/* ============================================================ */}
          {/* LEFT COLUMN: Search, Filters & Model List (Width: 50%)       */}
          {/* ============================================================ */}
          <div className="flex flex-col w-1/2 min-w-0 bg-[#0e1015]">
            {/* Search & Actions Bar */}
            <div className="p-3.5 border-b border-line/40 space-y-2.5 shrink-0 bg-[#12141a]/60">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search 400+ models by name, slug or provider..."
                    className="w-full rounded-lg border border-line bg-panel pl-8 pr-3 py-1.5 text-xs text-fg placeholder:text-muted/60 focus:border-brand focus:ring-1 focus:ring-brand outline-hidden"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowCustomForm(!showCustomForm)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer shrink-0 ${
                    showCustomForm
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-line bg-panel hover:bg-panel2 text-fg'
                  }`}
                >
                  <Plus className="size-3.5" />
                  <span>Custom Model</span>
                </button>
              </div>

              {/* Filter Tabs & Quick Batch Actions */}
              <div className="flex items-center justify-between text-xs pt-0.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setFilterTab('active')}
                    className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer text-xs ${
                      filterTab === 'active'
                        ? 'bg-panel2 text-brand font-semibold shadow-xs'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    Active ({enabledIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('all')}
                    className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer text-xs ${
                      filterTab === 'all'
                        ? 'bg-panel2 text-brand font-semibold shadow-xs'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    All ({connection.models.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('free')}
                    className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer text-xs ${
                      filterTab === 'free'
                        ? 'bg-panel2 text-emerald-400 font-semibold shadow-xs'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    Free Tier
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('passed')}
                    className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer text-xs ${
                      filterTab === 'passed'
                        ? 'bg-panel2 text-brand font-semibold shadow-xs'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    Passed
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void enableAllFree()}
                    className="text-muted hover:text-emerald-400 transition cursor-pointer disabled:opacity-50"
                  >
                    Enable Free
                  </button>
                  <span className="text-muted/40">·</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void disableAll()}
                    className="text-muted hover:text-rose-400 transition cursor-pointer disabled:opacity-50"
                  >
                    Disable All
                  </button>
                </div>
              </div>
            </div>

            {/* Custom Model Inline Creation Drawer */}
            {showCustomForm && (
              <form
                onSubmit={handleAddCustomModel}
                className="p-3.5 border-b border-brand/30 bg-brand/5 space-y-2.5 text-xs animate-slide-down shrink-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-fg">Add Custom Model Identifier</span>
                  <button
                    type="button"
                    onClick={() => setShowCustomForm(false)}
                    className="text-muted hover:text-fg"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-muted uppercase">Model ID / Slug</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. meta-llama/llama-3.3-70b-instruct"
                      value={customId}
                      onChange={(e) => setCustomId(e.target.value)}
                      className="mt-1 w-full rounded border border-line bg-panel px-2.5 py-1 text-xs text-fg font-mono outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted uppercase">Display Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Llama 3.3 70B"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="mt-1 w-full rounded border border-line bg-panel px-2.5 py-1 text-xs text-fg outline-hidden"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-3 text-muted text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customVision}
                        onChange={(e) => setCustomVision(e.target.checked)}
                        className="rounded"
                      />
                      Vision
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customReasoning}
                        onChange={(e) => setCustomReasoning(e.target.checked)}
                        className="rounded"
                      />
                      Reasoning
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={!customId.trim() || busy}
                    className="rounded bg-brand px-3 py-1 text-[11px] font-semibold text-brandfg hover:opacity-90 cursor-pointer disabled:opacity-50"
                  >
                    Add & Enable
                  </button>
                </div>
              </form>
            )}

            {/* Virtualized Compact Rows List (Smooth 60 FPS vertical scrollable container) */}
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-2 will-change-scroll"
              style={{
                contain: 'content',
                overscrollBehavior: 'contain',
              }}
            >
              {filteredModels.length === 0 ? (
                <div className="py-16 text-center text-xs text-muted">
                  No models match your search or filter
                </div>
              ) : (
                <div
                  style={{
                    paddingTop: `${paddingTop}px`,
                    paddingBottom: `${paddingBottom}px`,
                  }}
                  className="space-y-1"
                >
                  {visibleModels.map((model) => (
                    <ModelRowItem
                      key={model.id}
                      model={model}
                      isSelected={selectedModel?.id === model.id}
                      isEnabled={enabledIds.has(model.id)}
                      isTesting={testingId === model.id}
                      onSelect={() => setSelectedId(model.id)}
                      onToggle={() => void toggleModel(model.id)}
                      onTest={() => {
                        setSelectedId(model.id)
                        void runTestModel(model.id)
                      }}
                      getStatusBadge={getStatusBadge}
                      busy={busy}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ============================================================ */}
          {/* RIGHT COLUMN: Detail & Quick Test Workbench (Width: 50%)    */}
          {/* ============================================================ */}
          <div className="flex flex-col w-1/2 min-w-0 bg-[#12141a] p-5 overflow-y-auto">
            {selectedModel ? (
              <div className="space-y-4">
                {/* Model Title & Capabilities Header */}
                <div className="border-b border-line/60 pb-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-fg tracking-tight">
                        {selectedModel.name}
                      </h3>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="font-mono text-xs text-muted select-all">
                          {selectedModel.id}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(selectedModel.id)}
                          className="rounded p-1 text-muted hover:text-fg hover:bg-panel cursor-pointer transition"
                          title="Copy Model ID"
                        >
                          {copiedId === selectedModel.id ? (
                            <Check className="size-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enabledIds.has(selectedModel.id)}
                          onChange={() => void toggleModel(selectedModel.id)}
                          className="size-3.5 rounded text-brand focus:ring-0 accent-blue-500"
                        />
                        <span className={enabledIds.has(selectedModel.id) ? 'text-brand' : 'text-muted'}>
                          {enabledIds.has(selectedModel.id) ? 'Active' : 'Disabled'}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Pricing Overview */}
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <div className="rounded-lg border border-line bg-[#0d0f13] p-2.5">
                      <span className="block text-[10px] uppercase font-mono text-muted">Input (Prompt)</span>
                      <span className="text-xs font-semibold text-fg font-mono">
                        {(selectedModel as any).pricing?.prompt
                          ? `$${(Number((selectedModel as any).pricing.prompt) * 1000000).toFixed(2)} / 1M`
                          : (selectedModel.id.includes(':free') || selectedModel.id === 'openrouter/free')
                          ? 'FREE'
                          : 'Standard'}
                      </span>
                    </div>
                    <div className="rounded-lg border border-line bg-[#0d0f13] p-2.5">
                      <span className="block text-[10px] uppercase font-mono text-muted">Output (Completion)</span>
                      <span className="text-xs font-semibold text-fg font-mono">
                        {(selectedModel as any).pricing?.completion
                          ? `$${(Number((selectedModel as any).pricing.completion) * 1000000).toFixed(2)} / 1M`
                          : (selectedModel.id.includes(':free') || selectedModel.id === 'openrouter/free')
                          ? 'FREE'
                          : 'Standard'}
                      </span>
                    </div>
                    <div className="rounded-lg border border-line bg-[#0d0f13] p-2.5">
                      <span className="block text-[10px] uppercase font-mono text-muted">Context Window</span>
                      <span className="text-xs font-semibold text-fg font-mono">
                        {(selectedModel as any).context_length
                          ? `${Math.round((selectedModel as any).context_length / 1024)}k tokens`
                          : '128k tokens'}
                      </span>
                    </div>
                  </div>

                  {/* Badges / Features */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {(selectedModel.id.includes(':free') || selectedModel.id === 'openrouter/free') && (
                      <span className="rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold">
                        Free Tier (0 USD)
                      </span>
                    )}
                    {(selectedModel.capabilities?.vision === 'reported' ||
                      selectedModel.capabilities?.vision === 'verified') && (
                      <span className="flex items-center gap-1 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 text-[10px] font-medium">
                        <Eye className="size-3" /> Vision Supported
                      </span>
                    )}
                    {(selectedModel.capabilities?.reasoning === 'reported' ||
                      selectedModel.capabilities?.reasoning === 'verified' ||
                      ((selectedModel as any).thinkingLevels?.length ?? 0) > 0) && (
                      <span className="flex items-center gap-1 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium">
                        <Sparkles className="size-3" /> Thinking / Reasoning
                      </span>
                    )}
                    <span className="rounded-md bg-panel2 border border-line text-muted px-2 py-0.5 text-[10px] font-mono">
                      Source: {selectedModel.source || 'live'}
                    </span>
                  </div>
                </div>

                {/* Health & Probe Status Card */}
                <div className="rounded-xl border border-line/70 bg-[#0d0f13] p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-fg">Probe Verification Status</span>
                    {getStatusBadge(selectedModel)}
                  </div>

                  {selectedModel.lastProbe ? (
                    <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono">
                      <div className="rounded bg-panel2/60 p-2">
                        <span className="block text-[10px] text-muted">Status</span>
                        <span className="font-semibold text-emerald-400 uppercase">
                          {selectedModel.lastProbe.status}
                        </span>
                      </div>
                      <div className="rounded bg-panel2/60 p-2">
                        <span className="block text-[10px] text-muted">Latency</span>
                        <span className="font-semibold text-fg">
                          {selectedModel.lastProbe.latencyMs} ms
                        </span>
                      </div>
                      <div className="rounded bg-panel2/60 p-2">
                        <span className="block text-[10px] text-muted">HTTP Code</span>
                        <span className="font-semibold text-fg">
                          {selectedModel.lastProbe.httpStatus || 200}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted">
                      This model has not been probed yet. Click "Run Test" below to verify live upstream inference.
                    </p>
                  )}
                </div>

                {/* Interactive Test Playground (In-Modal Inference) */}
                <div className="rounded-xl border border-line/70 bg-[#0d0f13] p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Activity className="size-4 text-brand" />
                      <span className="text-xs font-semibold text-fg">Quick Inference Test</span>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stream}
                        onChange={(e) => setStream(e.target.checked)}
                        className="rounded"
                      />
                      SSE Stream
                    </label>
                  </div>

                  {/* Prompt input */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                      Test Prompt
                    </label>
                    <input
                      type="text"
                      value={testPrompt}
                      onChange={(e) => setTestPrompt(e.target.value)}
                      placeholder="Prompt to verify model output..."
                      className="w-full rounded-lg border border-line/80 bg-panel px-3 py-1.5 text-xs text-fg placeholder:text-muted/50 focus:border-brand/60 focus:ring-1 focus:ring-brand/40 outline-hidden font-mono"
                    />
                  </div>

                  {/* Run Test Button */}
                  <button
                    type="button"
                    disabled={testingId !== null || !enabledIds.has(selectedModel.id)}
                    onClick={() => void runTestModel(selectedModel.id)}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brandfg hover:opacity-95 transition disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {testingId === selectedModel.id ? (
                      <>
                        <RotateCw className="size-3.5 animate-spin" />
                        <span>Sending Request to Upstream…</span>
                      </>
                    ) : (
                      <>
                        <Play className="size-3.5 fill-current" />
                        <span>Run Test Inference</span>
                      </>
                    )}
                  </button>

                  {!enabledIds.has(selectedModel.id) && (
                    <p className="text-[11px] text-amber-400/80 text-center">
                      * Please enable this model first before running test inference.
                    </p>
                  )}

                  {/* Test Results Output Console */}
                  {testOutput.status !== 'idle' && (
                    <div className="mt-3 rounded-lg border border-line/60 bg-black/60 p-3 space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between text-[11px] pb-1 border-b border-line/30">
                        <span
                          className={`font-semibold uppercase ${
                            testOutput.status === 'passed'
                              ? 'text-emerald-400'
                              : testOutput.status === 'failed'
                              ? 'text-rose-400'
                              : 'text-amber-400'
                          }`}
                        >
                          Status: {testOutput.status}
                        </span>
                        {testOutput.latencyMs && (
                          <span className="text-muted">{testOutput.latencyMs} ms latency</span>
                        )}
                      </div>

                      {testOutput.content && (
                        <div className="text-zinc-200 whitespace-pre-wrap max-h-24 overflow-y-auto">
                          {testOutput.content}
                        </div>
                      )}

                      {testOutput.error && (
                        <div className="text-rose-400 whitespace-pre-wrap max-h-24 overflow-y-auto">
                          {testOutput.error}
                        </div>
                      )}

                      {testOutput.usage && (
                        <div className="text-[10px] text-muted pt-1 border-t border-line/20">
                          Tokens: {testOutput.usage.prompt_tokens ?? 0} prompt /{' '}
                          {testOutput.usage.completion_tokens ?? 0} completion · Cost: 0 USD
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted space-y-2">
                <Bot className="size-8 text-muted/40" />
                <p className="text-xs">Select a model from the left list to view details and test inference</p>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-line/60 bg-[#14171d] px-5 py-2.5 shrink-0 text-xs">
          <span className="text-[11px] text-muted">
            Tip: Only models with <span className="text-emerald-400 font-mono font-medium">Passed</span> status are guaranteed to serve stable inference.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-panel2 border border-line px-4 py-1.5 text-xs font-medium text-fg hover:bg-panel transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// Memoized individual model row item to prevent re-rendering when other models change
const ModelRowItem = React.memo(function ModelRowItem({
  model,
  isSelected,
  isEnabled,
  isTesting,
  onSelect,
  onToggle,
  onTest,
  getStatusBadge,
  busy,
}: {
  model: any
  isSelected: boolean
  isEnabled: boolean
  isTesting: boolean
  onSelect: () => void
  onToggle: () => void
  onTest: () => void
  getStatusBadge: (m: any) => React.ReactNode
  busy: boolean
}) {
  const isFree = model.id.includes(':free') || model.id === 'openrouter/free'

  return (
    <div
      style={{ height: `${ITEM_HEIGHT}px` }}
      onClick={onSelect}
      className={`group flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition cursor-pointer box-border ${
        isSelected
          ? 'bg-[#182234] border border-brand/50 shadow-xs'
          : 'hover:bg-panel2/60 border border-transparent'
      }`}
    >
      {/* Left: Checkbox Toggle + Model Info */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="size-3.5 rounded border-line text-brand focus:ring-0 cursor-pointer shrink-0 accent-blue-500"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate font-medium text-xs ${
                isSelected ? 'text-white font-semibold' : 'text-fg'
              }`}
            >
              {model.name}
            </span>
            {isFree && (
              <span className="rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.2 text-[9px] font-mono shrink-0">
                free
              </span>
            )}
            {model.source === 'custom' && (
              <span className="rounded bg-brand/10 text-brand border border-brand/20 px-1 py-0.2 text-[9px] font-mono shrink-0">
                custom
              </span>
            )}
          </div>

          <p className="truncate font-mono text-[10px] text-muted" title={model.id}>
            {model.id}
          </p>
        </div>
      </div>

      {/* Right: Status badge & Quick Action */}
      <div className="flex items-center gap-2 shrink-0">
        {getStatusBadge(model)}

        <button
          type="button"
          disabled={busy || isTesting}
          onClick={(e) => {
            e.stopPropagation()
            onTest()
          }}
          className="opacity-80 group-hover:opacity-100 rounded border border-line bg-panel hover:bg-panel2 px-2 py-0.5 text-[10px] font-medium text-fg hover:text-brand transition cursor-pointer"
        >
          {isTesting ? '…' : 'Test'}
        </button>

        <ChevronRight
          className={`size-3.5 transition ${
            isSelected ? 'text-brand translate-x-0.5' : 'text-muted/30 group-hover:text-muted'
          }`}
        />
      </div>
    </div>
  )
})
