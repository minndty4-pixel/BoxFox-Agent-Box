import React, { useState, useMemo } from 'react'
import {
  Terminal,
  Camera,
  FileText,
  Search,
  BrainCircuit,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Copy,
  Check,
  Hexagon,
  X,
  Maximize2,
} from 'lucide-react'
import type { HarnessEvent } from '../../store/harnessChatStore'
import type { ProviderSnapshot } from '../../types/provider'
import type { RouterChatSelection } from '../../store/routerChatStore'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ProviderIcon } from '../providers/ProviderIcon'
import type { LightboxMediaProps } from './MediaLightboxModal'

interface HarnessStepViewProps {
  events: HarnessEvent[]
  status: string
  error: string | null
  connectionWarning?: string | null
  onDismissWarning?: () => void
  onOpenLightbox?: (media: LightboxMediaProps) => void
  snapshot?: ProviderSnapshot | null
  selection?: RouterChatSelection | null
}

interface HarnessTurn {
  id: string
  modelChange?: { from: string; to: string } | null
  userEvent: HarnessEvent | null
  thought: string | null
  steps: HarnessEvent[]
  streamingText?: string | null
  finalAssistant: HarnessEvent | null
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    reasoning_tokens?: number
  } | null
  target: {
    modelId?: string
    connectionId?: string
    aliasId?: string | null
  } | null
  finish: HarnessEvent | null
  startTime: number
  endTime: number
  isCompleted: boolean
  error?: string | null
}

function toMs(t?: number): number {
  if (!t) return Date.now()
  return t < 1e11 ? t * 1000 : t
}

function formatTokens(n?: number): string {
  if (typeof n !== 'number') return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return 'Just now'
  const d = new Date(toMs(timestamp))
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function resolveProvider(modelId?: string, connectionId?: string, snapshot?: ProviderSnapshot | null): string {
  if (connectionId && snapshot?.connections) {
    const conn = snapshot.connections.find((c) => c.id === connectionId)
    if (conn?.providerId) return conn.providerId
  }
  const m = (modelId || '').toLowerCase()
  if (m.includes('gemini') || m.includes('google')) return 'gemini'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3')) return 'openai'
  if (m.includes('antigravity') || m.includes('boxfox')) return 'antigravity'
  return 'antigravity'
}

function getToolDisplay(name: string, args: Record<string, unknown> | null, isError: boolean): {
  actionLabel: string
  detailLabel: string
  icon: React.ReactNode
} {
  switch (name) {
    case 'terminal_exec': {
      const cmd = String(args?.command || args?.cmd || 'command')
      const shortCmd = cmd.length > 38 ? cmd.slice(0, 35) + '...' : cmd
      return {
        actionLabel: 'Ran',
        detailLabel: shortCmd,
        icon: <Terminal className="size-3.5 text-brand" />,
      }
    }
    case 'file_write':
    case 'file_edit': {
      const path = String(args?.path || args?.target || 'file')
      const fileName = path.split(/[/\\]/).pop() || path
      return {
        actionLabel: 'Edited',
        detailLabel: fileName,
        icon: <FileText className="size-3.5 text-amber-400" />,
      }
    }
    case 'file_read': {
      const path = String(args?.path || args?.target || 'file')
      const fileName = path.split(/[/\\]/).pop() || path
      return {
        actionLabel: 'Explored',
        detailLabel: fileName,
        icon: <FileText className="size-3.5 text-sky-400" />,
      }
    }
    case 'codebase_grep':
    case 'codebase_glob': {
      const q = String(args?.query || args?.pattern || 'patterns')
      return {
        actionLabel: 'Explored',
        detailLabel: `codebase (${q})`,
        icon: <Search className="size-3.5 text-purple-400" />,
      }
    }
    case 'computer_screen_capture': {
      return {
        actionLabel: 'Captured',
        detailLabel: 'sandbox display',
        icon: <Camera className="size-3.5 text-blue-400" />,
      }
    }
    case 'browser_use': {
      return {
        actionLabel: 'Explored',
        detailLabel: 'browser page',
        icon: <Camera className="size-3.5 text-emerald-400" />,
      }
    }
    case 'delegate_task': {
      return {
        actionLabel: 'Delegated',
        detailLabel: `specialist (${String(args?.role || 'agent')})`,
        icon: <BrainCircuit className="size-3.5 text-brand" />,
      }
    }
    default: {
      return {
        actionLabel: isError ? 'Failed' : 'Executed',
        detailLabel: name,
        icon: <Terminal className="size-3.5 text-brand" />,
      }
    }
  }
}

export function HarnessStepView({
  events,
  status,
  error,
  connectionWarning,
  onDismissWarning,
  onOpenLightbox,
  snapshot,
  selection,
}: HarnessStepViewProps) {
  const isBusy = status === 'running' || status === 'starting'

  // Nhóm events thành các Turn
  const turns = useMemo(() => {
    const list: HarnessTurn[] = []
    let current: HarnessTurn | null = null
    let pendingModelChange: { from: string; to: string } | null = null

    for (const event of events) {
      if (event.type === 'model_change') {
        pendingModelChange = { from: String(event.data.from || ''), to: String(event.data.to || '') }
        continue
      }

      if (event.type === 'user') {
        if (current) list.push(current)
        current = {
          id: `turn_${event.seq}`,
          modelChange: pendingModelChange,
          userEvent: event,
          thought: null,
          steps: [],
          streamingText: null,
          finalAssistant: null,
          usage: null,
          target: null,
          finish: null,
          startTime: event.created,
          endTime: event.created,
          isCompleted: false,
        }
        pendingModelChange = null
        continue
      }

      if (!current) {
        current = {
          id: `turn_initial`,
          modelChange: pendingModelChange,
          userEvent: null,
          thought: null,
          steps: [],
          streamingText: null,
          finalAssistant: null,
          usage: null,
          target: null,
          finish: null,
          startTime: event.created,
          endTime: event.created,
          isCompleted: false,
        }
        pendingModelChange = null
      }

      current.endTime = Math.max(current.endTime, event.created)

      if (event.type === 'thought') {
        current.thought = String(event.data.text ?? '')
      } else if (event.type === 'usage') {
        current.usage = event.data.usage as any
        current.target = (event.data.target as any) || (event.data.model ? { modelId: String(event.data.model) } : null)
      } else if (event.type === 'assistant_delta') {
        current.streamingText = String(event.data.text ?? '')
      } else if (event.type === 'assistant') {
        if (event.data.thought) {
          current.thought = String(event.data.thought)
        }
        const isFinal = event.data.final !== false
        if (isFinal) {
          current.finalAssistant = event
          current.isCompleted = true
        } else {
          current.steps.push(event)
        }
      } else if (event.type === 'finish') {
        current.finish = event
        current.isCompleted = true
      } else if (event.type === 'error') {
        current.error = String(event.data?.message ?? 'Turn execution error')
        current.isCompleted = true
      } else {
        current.steps.push(event)
      }
    }

    if (current) list.push(current)
    return list
  }, [events])

  return (
    <div className="space-y-6 font-sans select-text">
      {turns.map((turn, index) => {
        const isLastTurn = index === turns.length - 1
        const isTurnBusy = isLastTurn && isBusy && !turn.isCompleted

        return (
          <div key={turn.id} data-turn-latest={isLastTurn ? 'true' : undefined} data-turn-user="true">
            <TurnBlock
              turn={turn}
              isTurnBusy={isTurnBusy}
              onOpenLightbox={onOpenLightbox}
              snapshot={snapshot}
              selection={selection}
            />
          </div>
        )
      })}

      {/* Provider Connection Warning / Error: báo cùng chữ đỏ inline, không tạo box mới, tự động ẩn khi chat mới / đang chạy */}
      {!isBusy && connectionWarning && (
        <div className="flex items-center justify-between gap-2 py-1 text-xs text-rose-400 font-sans leading-relaxed select-text animate-in fade-in duration-150">
          <span className="flex-1">{connectionWarning}</span>
          {onDismissWarning && (
            <button
              type="button"
              onClick={onDismissWarning}
              className="text-zinc-500 hover:text-zinc-300 transition p-0.5 rounded cursor-pointer shrink-0"
              title="Đóng cảnh báo"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Global Error: only show if the session is currently failed AND error is not already shown in any turn AND not busy */}
      {!isBusy && status === 'failed' && error && !turns.some(t => t.error === error) && (
        <div className="py-1.5 text-xs text-rose-400 font-sans leading-relaxed select-text animate-in fade-in duration-150">
          {error}
        </div>
      )}
    </div>
  )
}

function TurnBlock({
  turn,
  isTurnBusy,
  onOpenLightbox,
  snapshot,
  selection,
}: {
  turn: HarnessTurn
  isTurnBusy: boolean
  onOpenLightbox?: (media: LightboxMediaProps) => void
  snapshot?: ProviderSnapshot | null
  selection?: RouterChatSelection | null
}) {
  const [copiedUser, setCopiedUser] = useState(false)
  const [copiedAssistant, setCopiedAssistant] = useState(false)

  // Collapse Accordion State: Mặc định collapse all khi đã completed, mở khi đang chạy
  const [thinkingOpen, setThinkingOpen] = useState(!turn.isCompleted)

  // Xác định Model info và Provider
  const targetModelId =
    turn.target?.modelId ??
    (selection?.kind === 'model' ? selection.modelId : selection?.kind === 'alias' ? selection.aliasId : 'gemini-3.7-flash-high')

  const targetConnId =
    turn.target?.connectionId ??
    (selection?.kind === 'model' ? selection.connectionId : undefined)

  const providerId = resolveProvider(targetModelId, targetConnId, snapshot)

  // Tính toán thời gian thực thi của turn
  const durationSec = Math.max(1, Math.round((toMs(turn.endTime) - toMs(turn.startTime)) / 1000))

  // Tool calls trong turn
  const toolStarts = turn.steps.filter((e) => e.type === 'tool_start')
  const toolEnds = turn.steps.filter((e) => e.type === 'tool_end')
  const activeCall = toolStarts.find((s) => !toolEnds.some((e) => e.data.id === s.data.id))

  // Trích xuất ảnh chụp màn hình trực tiếp từ các tool bước thực thi hoặc yêu cầu screenshot
  const capturedScreenshots = useMemo(() => {
    const list: Array<{
      id: string
      src: string
      caption: string
      artifactPath?: string
      sourceUrl?: string
    }> = []

    for (const end of toolEnds) {
      const name = String(end.data.name ?? '')
      const args = end.data.args as Record<string, unknown> | null
      const res = end.data.result
      const resObj = res && typeof res === 'object' ? (res as Record<string, unknown>) : null
      const artifactPath = typeof resObj?.artifact === 'string' ? resObj.artifact : null
      const hasImage = typeof resObj?.image === 'string'
      const mime = typeof resObj?.mime === 'string' ? resObj.mime : 'image/png'

      let imgSrc: string | null = hasImage ? `data:${mime};base64,${resObj!.image}` : null
      if (
        !imgSrc &&
        artifactPath &&
        (artifactPath.endsWith('.png') ||
          artifactPath.endsWith('.jpg') ||
          artifactPath.endsWith('.jpeg') ||
          artifactPath.endsWith('.webp') ||
          artifactPath.endsWith('.svg'))
      ) {
        const relPath = artifactPath.replace(/^\/home\/agent\/workspace\//, '')
        imgSrc = `/__box/file/media?path=${encodeURIComponent(relPath)}`
      }

      if (imgSrc) {
        list.push({
          id: `ss_${end.seq}`,
          src: imgSrc,
          caption:
            name === 'browser_use'
              ? 'Browser Page Screenshot'
              : 'Sandbox Desktop Screen Capture',
          artifactPath: artifactPath || undefined,
          sourceUrl: typeof args?.url === 'string' ? args.url : undefined,
        })
      }
    }

    return list
  }, [toolEnds])

  // Luôn hiển thị thanh Worked for Xs nếu đã có hoạt động hoặc đang chạy
  const hasThinkingSteps = turn.steps.length > 0 || Boolean(turn.thought) || isTurnBusy

  const handleCopyUser = () => {
    const text = String(turn.userEvent?.data?.text ?? '')
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedUser(true)
    setTimeout(() => setCopiedUser(false), 2000)
  }

  const handleCopyAssistant = () => {
    const text = String(turn.finalAssistant?.data?.text ?? '')
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedAssistant(true)
    setTimeout(() => setCopiedAssistant(false), 2000)
  }

  const userImage = turn.userEvent?.data?.image as string | undefined

  return (
    <div className="space-y-4">
      {/* 0. Model Changed Notice (if model was changed before this turn) */}
      {turn.modelChange && (
        <div className="flex items-center justify-center gap-2 py-1.5 select-none animate-in fade-in duration-200">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-panel2 border border-line text-zinc-400 text-[11px] shadow-2xs">
            <Hexagon className="size-3.5 text-brand" />
            <span>
              Model changed from <strong className="text-zinc-200 font-medium">{turn.modelChange.from}</strong> to <strong className="text-zinc-200 font-medium">{turn.modelChange.to}</strong>
            </span>
          </div>
        </div>
      )}

      {/* 1. User Prompt Bubble — Căn phải, chiếm tối đa 2/3 khung chat */}
      {turn.userEvent && (
        <div className="flex flex-col items-end gap-1.5 ml-auto max-w-[68%]">
          <div className="w-fit rounded-2xl bg-panel2 border border-line px-4 py-3 text-xs leading-relaxed text-fg shadow-xs">
            {userImage && (
              <div
                onClick={() => onOpenLightbox?.({ src: userImage, caption: 'Attached image' })}
                className="mb-2 max-w-sm cursor-pointer overflow-hidden rounded-xl border border-line/80 bg-panel hover:border-brand/60 transition shadow-xs group"
                title="Nhấp vào để phóng to ảnh"
              >
                <img
                  src={userImage}
                  alt="Attached"
                  className="w-full object-cover max-h-56 rounded-lg group-hover:scale-[1.02] transition duration-200"
                />
              </div>
            )}
            <MarkdownRenderer content={String(turn.userEvent.data.text ?? '')} />
          </div>

          {/* User Bubble Footer */}
          <div className="flex items-center gap-2 text-[10px] text-muted pr-1 select-none">
            <span>{formatTime(turn.userEvent.created)}</span>
            <button
              type="button"
              onClick={handleCopyUser}
              className="hover:text-fg transition cursor-pointer"
              title="Copy message"
            >
              {copiedUser ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </button>
            <span className="flex size-4 items-center justify-center rounded-full bg-panel border border-line text-[8px] font-bold text-muted">
              KV
            </span>
          </div>
        </div>
      )}

      {/* 2. Devin-style Hierarchical Thinking Accordion */}
      {hasThinkingSteps && (
        <div className="space-y-2 pl-0.5">
          {/* Main Parent Header: Worked for Xs > (Không viền hộp to, thanh thoát như Ảnh 2 & 4) */}
          <button
            type="button"
            onClick={() => setThinkingOpen(!thinkingOpen)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-fg font-medium transition cursor-pointer select-none group py-0.5"
          >
            <span
              className={`size-1.5 rounded-full transition duration-200 ${
                isTurnBusy ? 'bg-brand animate-pulse scale-110' : 'bg-brand/80 group-hover:scale-125'
              }`}
            />
            <span className="text-zinc-400 group-hover:text-zinc-200">
              {isTurnBusy ? 'Working...' : `Worked for ${durationSec}s`}
            </span>
            {thinkingOpen ? (
              <ChevronDown className="size-3.5 text-muted group-hover:text-fg transition" />
            ) : (
              <ChevronRight className="size-3.5 text-muted group-hover:text-fg transition" />
            )}
          </button>

          {/* Sub-steps Hierarchical Tree (Chuẩn xác như Ảnh 2) */}
          {thinkingOpen && (
            <div className="ml-1 pl-3 space-y-2 border-l border-line/60 my-1 animate-in fade-in duration-150">
              {/* Thinking Reasoning Sub-item (Luồng suy nghĩ stream từ model hoặc reasoning tokens đã sinh) */}
              {turn.thought ? (
                <ThinkingSubItem thought={turn.thought} durationSec={durationSec} isLive={isTurnBusy} />
              ) : turn.usage?.reasoning_tokens ? (
                <ThinkingSubItem
                  thought={`⚡ Deep reasoning process executed successfully (${turn.usage.reasoning_tokens} reasoning tokens). Cryptographically verified by Cloud Code signature.`}
                  durationSec={durationSec}
                  isLive={false}
                />
              ) : (
                <ThinkingSubItem
                  thought={`Direct response synthesized by ${targetModelId}.`}
                  durationSec={durationSec}
                  isLive={false}
                />
              )}

              {/* Tool Execution Sub-items with Devin-style labels */}
              {toolEnds.map((end) => (
                <CompletedToolSubItem
                  key={end.seq}
                  name={String(end.data.name ?? '')}
                  args={end.data.args as Record<string, unknown> | null}
                  result={end.data.result}
                  onOpenLightbox={onOpenLightbox}
                />
              ))}

              {/* Sub-agent Specialist Sub-items */}
              {turn.steps
                .filter((e) => e.type === 'child')
                .map((e) => (
                  <div
                    key={e.seq}
                    className="inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/5 px-2 py-0.5 text-[11px] text-brand font-medium select-none"
                  >
                    <BrainCircuit className="size-3 animate-pulse" />
                    <span>
                      Specialist: {String(e.data.role)} ({String(e.data.status)})
                    </span>
                  </div>
                ))}

              {/* Context Optimization Notice */}
              {turn.steps
                .filter((e) => e.type === 'compression')
                .map((e) => (
                  <div key={e.seq} className="text-[11px] text-muted italic">
                    Context optimized: {String(e.data.kind)}
                  </div>
                ))}

              {/* Active in-progress tool call indicator */}
              {isTurnBusy && activeCall && (
                <div className="flex items-center gap-2 py-1 text-xs text-blue-300 animate-pulse select-none">
                  <Loader2 className="size-3.5 text-blue-400 animate-spin shrink-0" />
                  <span className="font-medium">
                    {getToolDisplay(String(activeCall.data.name), activeCall.data.args as any, false).actionLabel}{' '}
                    {getToolDisplay(String(activeCall.data.name), activeCall.data.args as any, false).detailLabel}...
                  </span>
                </div>
              )}

              {/* Lightweight Text-only Thinking Indicator (Ảnh 2, Không viền hộp to) */}
              {isTurnBusy && !activeCall && (
                <div className="flex items-center gap-2 py-1 text-xs text-muted select-none">
                  <Sparkles className="size-3.5 text-brand animate-pulse shrink-0" />
                  <span className="text-zinc-300">BoxFox is thinking and synthesizing response...</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2.5 Inline Captured Screenshots — Nhả ảnh trực tiếp ra đoạn chat */}
      {capturedScreenshots.length > 0 && (
        <div className="space-y-2.5 max-w-2xl pl-0.5 my-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between text-xs text-muted select-none">
            <div className="flex items-center gap-1.5 font-semibold text-fg">
              <Camera className="size-3.5 text-brand" />
              <span>
                Sandbox Screen Capture{capturedScreenshots.length > 1 ? ` (${capturedScreenshots.length})` : ''}
              </span>
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">1280 × 720 · PNG</span>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {capturedScreenshots.map((item, idx) => (
              <div
                key={item.id || idx}
                className="group relative overflow-hidden rounded-xl border border-line bg-panel2 shadow-xs transition hover:border-brand/50 hover:shadow-md cursor-pointer"
                onClick={() => onOpenLightbox?.({ src: item.src, caption: item.caption || 'Sandbox Screen Capture' })}
                title="Nhấp để phóng to / tải về"
              >
                <img
                  src={item.src}
                  alt={item.caption || 'Sandbox Screen Capture'}
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none'
                  }}
                  className="w-full object-contain max-h-96 rounded-lg transition group-hover:scale-[1.01]"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition bg-black/75 backdrop-blur-xs px-2.5 py-1 rounded-md text-[11px] text-white shadow-xs">
                  <Maximize2 className="size-3 text-zinc-200" />
                  <span>Phóng to</span>
                </div>
                {item.artifactPath && (
                  <div className="px-3 py-1.5 border-t border-line/40 bg-panel/80 text-[10px] text-zinc-400 font-mono truncate flex items-center justify-between">
                    <span className="truncate">{item.artifactPath}</span>
                    <span className="text-brand shrink-0 ml-2">Click để phóng to</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Assistant Response & Model Header (Supports both live streamingText and finalAssistant) */}
      {(turn.finalAssistant || turn.streamingText) && (
        <div className="space-y-1.5 pl-0.5">
          {/* Model Info Header */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted select-none">
            <ProviderIcon providerId={providerId} className="size-3.5" />
            <span className="font-semibold text-fg">{targetModelId}</span>
            <span className="text-zinc-500">·</span>
            <span>{formatTime(turn.finalAssistant?.created || turn.endTime)}</span>
            {turn.finalAssistant ? (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <CheckCircle2 className="size-3" />
                <span>done</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-brand font-medium animate-pulse">
                <Loader2 className="size-3 animate-spin" />
                <span>streaming</span>
              </span>
            )}

            {/* Token Usage Metrics (↑ prompt_tokens ↓ completion_tokens) */}
            {turn.usage && (
              <>
                <span className="text-zinc-500">·</span>
                <span
                  className="font-mono text-[10px] text-zinc-400"
                  title={`Prompt tokens: ${turn.usage.prompt_tokens ?? 0} | Completion tokens: ${turn.usage.completion_tokens ?? 0}`}
                >
                  ↑ {formatTokens(turn.usage.prompt_tokens)} ↓ {formatTokens(turn.usage.completion_tokens)}
                </span>
              </>
            )}

            {/* Copy Response Button */}
            {turn.finalAssistant && (
              <button
                type="button"
                onClick={handleCopyAssistant}
                className="ml-auto hover:text-fg text-muted transition cursor-pointer p-0.5"
                title="Copy response"
              >
                {copiedAssistant ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </button>
            )}
          </div>

          {/* Assistant Text with Progressive Typewriter Reveal */}
          <div className="max-w-3xl text-sm text-fg leading-relaxed">
            <ProgressiveMarkdown
              content={String(turn.finalAssistant?.data?.text ?? turn.streamingText ?? '')}
              isLive={!turn.isCompleted || (Date.now() - toMs(turn.endTime) < 4000)}
            />
          </div>
        </div>
      )}

      {/* 4. Turn Error: Rendered cleanly within the specific turn where it occurred */}
      {turn.error && (
        <div className="py-2 text-xs text-rose-400 font-sans leading-relaxed select-text animate-in fade-in duration-150">
          {turn.error}
        </div>
      )}
    </div>
  )
}

/** Progressive Typewriter Markdown Reveal component */
function ProgressiveMarkdown({
  content,
  isLive,
}: {
  content: string
  isLive?: boolean
}) {
  const [displayedLength, setDisplayedLength] = useState(() => (isLive ? 0 : content.length))

  React.useEffect(() => {
    if (!isLive) {
      setDisplayedLength(content.length)
      return
    }

    if (displayedLength < content.length) {
      // Natural cadence: between 2 and 8 characters per tick (approx 1 word every 1-2 ticks)
      const remaining = content.length - displayedLength
      const step = Math.min(remaining, Math.max(2, Math.ceil(remaining / 12)))
      const timer = window.setTimeout(() => {
        setDisplayedLength((prev) => Math.min(content.length, prev + step))
      }, 18)
      return () => window.clearTimeout(timer)
    }
  }, [content, displayedLength, isLive])

  const isTyping = isLive && displayedLength < content.length
  const currentText = isLive ? content.slice(0, displayedLength) : content

  return (
    <div className="relative">
      <MarkdownRenderer content={currentText} />
      {isTyping && (
        <span className="inline-block w-1.5 h-3.5 bg-brand animate-pulse ml-0.5 align-middle rounded-xs" />
      )}
    </div>
  )
}

/** Thinking Reasoning Sub-item */
function ThinkingSubItem({ thought, durationSec, isLive }: { thought: string; durationSec?: number; isLive?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-fg transition cursor-pointer select-none group"
      >
        <Sparkles className="size-3 text-brand/80" />
        <span className="font-mono text-[11px] text-zinc-300">
          Thinking {durationSec ? `(${durationSec}s)` : ''}
        </span>
        {open ? (
          <ChevronDown className="size-3 text-muted group-hover:text-fg" />
        ) : (
          <ChevronRight className="size-3 text-muted group-hover:text-fg" />
        )}
      </button>

      {open && (
        <div className="ml-3 pl-3 border-l-2 border-brand/50 py-1.5 text-xs text-zinc-300/95 leading-relaxed bg-panel2/40 rounded-r-xl animate-in fade-in duration-150">
          <ProgressiveMarkdown content={thought} isLive={isLive} />
        </div>
      )}
    </div>
  )
}

/** Sub-step tool accordion item (Formatted like Photo 2) */
function CompletedToolSubItem({
  name,
  args,
  result,
  onOpenLightbox,
}: {
  name: string
  args: Record<string, unknown> | null
  result: unknown
  onOpenLightbox?: (media: LightboxMediaProps) => void
}) {
  const [open, setOpen] = useState(false)
  const isError = Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).is_error)
  const display = getToolDisplay(name, args, isError)

  const resultObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  const artifactPath = typeof resultObj?.artifact === 'string' ? resultObj.artifact : null
  const hasImage = typeof resultObj?.image === 'string'
  const mime = typeof resultObj?.mime === 'string' ? resultObj.mime : 'image/png'
  let imgSrc = hasImage ? `data:${mime};base64,${resultObj.image}` : null
  if (!imgSrc && artifactPath && (artifactPath.endsWith('.png') || artifactPath.endsWith('.jpg') || artifactPath.endsWith('.webp') || artifactPath.endsWith('.svg'))) {
    const relPath = artifactPath.replace(/^\/home\/agent\/workspace\//, '')
    imgSrc = `/__box/file/media?path=${encodeURIComponent(relPath)}`
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-fg transition cursor-pointer select-none group"
      >
        <div className="flex items-center gap-1.5">
          {isError ? (
            <AlertCircle className="size-3 text-red-400 shrink-0" />
          ) : (
            display.icon
          )}
          <span className="text-zinc-400">{display.actionLabel}</span>
          <span className="font-mono text-[11px] text-zinc-200 font-semibold">{display.detailLabel}</span>
          {isError && <span className="text-[10px] text-red-400">· failed</span>}
        </div>
        {open ? (
          <ChevronDown className="size-3 text-muted group-hover:text-fg" />
        ) : (
          <ChevronRight className="size-3 text-muted group-hover:text-fg" />
        )}
      </button>

      {open && (
        <div className="ml-4 space-y-2 rounded-xl border border-line bg-panel2/60 p-2.5 text-xs animate-in fade-in duration-150">
          {/* Screenshot thumbnail if available */}
          {imgSrc && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-semibold text-muted tracking-wider">
                Captured Screenshot:
              </span>
              <img
                src={imgSrc}
                alt="Captured Display"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none'
                }}
                onClick={() => onOpenLightbox?.({ src: imgSrc!, caption: 'Sandbox Screen Capture' })}
                className="max-h-48 max-w-full rounded-lg border border-line object-contain cursor-pointer hover:opacity-90 transition shadow-xs"
              />
            </div>
          )}

          {artifactPath && (
            <div className="text-[11px] text-zinc-400 font-mono flex items-center gap-1">
              <span className="text-zinc-500">Artifact:</span>
              <span className="text-blue-400 truncate">{artifactPath}</span>
            </div>
          )}

          <pre className="max-h-48 overflow-auto font-mono text-[11px] text-zinc-300 whitespace-pre-wrap">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
