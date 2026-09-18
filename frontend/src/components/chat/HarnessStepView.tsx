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
  onOpenLightbox?: (media: LightboxMediaProps) => void
  snapshot?: ProviderSnapshot | null
  selection?: RouterChatSelection | null
}

interface HarnessTurn {
  id: string
  userEvent: HarnessEvent | null
  steps: HarnessEvent[]
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

function toolMeta(name: string): { icon: React.ReactNode; label: string; activeLabel: string } {
  switch (name) {
    case 'computer_screen_capture':
      return {
        icon: <Camera className="size-3.5 text-blue-400" />,
        label: 'Screen Capture',
        activeLabel: 'Capturing and analyzing sandbox display...',
      }
    case 'computer_screen_record':
      return {
        icon: <Camera className="size-3.5 text-amber-400" />,
        label: 'Screen Recording',
        activeLabel: 'Managing sandbox video recording...',
      }
    case 'browser_use':
      return {
        icon: <Camera className="size-3.5 text-emerald-400" />,
        label: 'Browser Automation',
        activeLabel: 'Navigating and interacting with browser page...',
      }
    case 'terminal_exec':
      return {
        icon: <Terminal className="size-3.5 text-brand" />,
        label: 'Terminal Command',
        activeLabel: 'Executing sandboxed terminal command...',
      }
    case 'codebase_grep':
    case 'codebase_glob':
      return {
        icon: <Search className="size-3.5 text-purple-400" />,
        label: 'Codebase Search',
        activeLabel: 'Searching workspace symbols and patterns...',
      }
    case 'file_read':
      return {
        icon: <FileText className="size-3.5 text-sky-400" />,
        label: 'File Inspection',
        activeLabel: 'Reading file contents...',
      }
    case 'file_write':
    case 'file_edit':
      return {
        icon: <FileText className="size-3.5 text-amber-400" />,
        label: 'File Modification',
        activeLabel: 'Writing updates to workspace file...',
      }
    case 'delegate_task':
      return {
        icon: <BrainCircuit className="size-3.5 text-brand" />,
        label: 'Subagent Delegation',
        activeLabel: 'Delegating work to autonomous specialist...',
      }
    default:
      return {
        icon: <Terminal className="size-3.5 text-brand" />,
        label: name || 'Tool Execution',
        activeLabel: `Executing ${name}...`,
      }
  }
}

export function HarnessStepView({
  events,
  status,
  error,
  onOpenLightbox,
  snapshot,
  selection,
}: HarnessStepViewProps) {
  const isBusy = status === 'running' || status === 'starting'

  // Nhóm events thành các Turn
  const turns = useMemo(() => {
    const list: HarnessTurn[] = []
    let current: HarnessTurn | null = null

    for (const event of events) {
      if (event.type === 'user') {
        if (current) list.push(current)
        current = {
          id: `turn_${event.seq}`,
          userEvent: event,
          steps: [],
          finalAssistant: null,
          usage: null,
          target: null,
          finish: null,
          startTime: event.created,
          endTime: event.created,
          isCompleted: false,
        }
        continue
      }

      if (!current) {
        current = {
          id: `turn_initial`,
          userEvent: null,
          steps: [],
          finalAssistant: null,
          usage: null,
          target: null,
          finish: null,
          startTime: event.created,
          endTime: event.created,
          isCompleted: false,
        }
      }

      current.endTime = Math.max(current.endTime, event.created)

      if (event.type === 'usage') {
        current.usage = event.data.usage as any
        current.target = (event.data.target as any) || (event.data.model ? { modelId: String(event.data.model) } : null)
      } else if (event.type === 'assistant') {
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
          <TurnBlock
            key={turn.id}
            turn={turn}
            isTurnBusy={isTurnBusy}
            onOpenLightbox={onOpenLightbox}
            snapshot={snapshot}
            selection={selection}
          />
        )
      })}

      {/* Global Error Banner */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-400 shadow-xs">
          <AlertCircle className="size-4 shrink-0 text-red-400 mt-0.5" />
          <div className="flex-1 font-mono text-[11px] whitespace-pre-wrap">{error}</div>
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

  // Có step nào cần hiển thị trong Accordion hay không
  const hasThinkingSteps = turn.steps.length > 0 || isTurnBusy

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

          {/* Sub-steps Hierarchical Tree */}
          {thinkingOpen && (
            <div className="ml-1 pl-3 space-y-2 border-l border-line/60 my-1 animate-in fade-in duration-150">
              {/* Tool Execution Sub-items with individual collapse */}
              {toolEnds.map((end) => (
                <CompletedToolSubItem
                  key={end.seq}
                  name={String(end.data.name ?? '')}
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
                  <span className="font-medium">{toolMeta(String(activeCall.data.name)).activeLabel}</span>
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

      {/* 3. Assistant Final Response & Model Header */}
      {turn.finalAssistant && (
        <div className="space-y-1.5 pl-0.5">
          {/* Model Info Header */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted select-none">
            <ProviderIcon providerId={providerId} className="size-3.5" />
            <span className="font-semibold text-fg">{targetModelId}</span>
            <span className="text-zinc-500">·</span>
            <span>{formatTime(turn.finalAssistant.created)}</span>
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <CheckCircle2 className="size-3" />
              <span>done</span>
            </span>

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
            <button
              type="button"
              onClick={handleCopyAssistant}
              className="ml-auto hover:text-fg text-muted transition cursor-pointer p-0.5"
              title="Copy response"
            >
              {copiedAssistant ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </button>
          </div>

          {/* Assistant Text */}
          <div className="max-w-3xl text-sm text-fg leading-relaxed">
            <MarkdownRenderer content={String(turn.finalAssistant.data.text ?? '')} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Sub-step tool accordion item */
function CompletedToolSubItem({
  name,
  result,
  onOpenLightbox,
}: {
  name: string
  result: unknown
  onOpenLightbox?: (media: LightboxMediaProps) => void
}) {
  const [open, setOpen] = useState(false)
  const meta = toolMeta(name)

  const isError = result && typeof result === 'object' && Boolean((result as any).is_error)

  const resultObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  const artifactPath = typeof resultObj?.artifact === 'string' ? resultObj.artifact : null
  const hasImage = typeof resultObj?.image === 'string'
  const mime = typeof resultObj?.mime === 'string' ? resultObj.mime : 'image/png'
  const imgSrc = hasImage ? `data:${mime};base64,${resultObj.image}` : null

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
            <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
          )}
          {meta.icon}
          <span className="font-mono text-[11px] text-zinc-300">{meta.label}</span>
          <span className="text-[10px] text-muted">· {isError ? 'failed' : 'completed'}</span>
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
                onClick={() => onOpenLightbox?.({ src: imgSrc, caption: 'Sandbox Screen Capture' })}
                className="max-h-48 max-w-full rounded-lg border border-line object-contain cursor-pointer hover:opacity-90 transition shadow-xs"
              />
            </div>
          )}

          {artifactPath && !imgSrc && (
            <div className="text-[11px] text-blue-400 font-mono">
              Artifact: {artifactPath}
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
