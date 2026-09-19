/**
 * Subagent Inspector Dashboard — Thiết kế lại thành Luồng Hội Thoại (Chat Stream).
 * 
 * - Cột trái (~240px): Danh sách Specialists Pipeline (Explore, Plan, Build, Testing, v.v...)
 *   kèm status badge (Running 🟡, Done 🟢, Error 🔴), số tool calls.
 * - Cột phải: Khung Chat Stream đồng bộ với luồng hội thoại chính:
 *   1. Tin nhắn Prompt từ Main Agent (Orchestrator): Bong bóng giao việc với huy hiệu 🧠 Main Agent.
 *   2. Phản hồi từ Sub-agent:
 *      - Accordion Thinking (suy nghĩ nội tâm).
 *      - Accordion Tools Executed (danh sách công cụ đã chạy kèm arguments, stdout).
 *      - Báo cáo Markdown hoàn chỉnh qua MarkdownRenderer.
 *      - Cảnh báo lỗi inline nếu có.
 *   3. Thanh Footer Read-only Guard: Khóa không cho user gõ phím vào tiến trình con.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Bot,
  Terminal,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  BrainCircuit,
  Sparkles,
  Copy,
  Check,
  FileCode2,
  Search,
  Camera,
} from 'lucide-react'
import { useHarnessChatStore, type HarnessEvent } from '../../store/harnessChatStore'
import { useAgentStore } from '../../store/agentStore'
import { useUiStore } from '../../store/uiStore'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'

const ROLE_DESCRIPTIONS: Record<string, string> = {
  explore: 'Inspect the repository. Return file/symbol evidence, dependencies and unknowns.',
  plan: 'Produce an ordered implementation plan, constraints, risks and concrete acceptance checks.',
  design: 'Design interfaces, data flow and user interaction. Explain tradeoffs and compatibility.',
  build: 'Implement the assigned scope. Inspect before editing; report changed paths and verification.',
  debug: 'Reproduce, isolate and explain the root cause. Apply targeted fix and verify regressions.',
  review: 'Review without editing. Return actionable findings with severity and exact file evidence.',
  simplify: 'Simplify existing code without changing behavior. Preserve public contracts.',
  testing: 'Run meaningful tests in the sandbox, including UI/visual checks when relevant.',
  research: 'Research using observed repository or browser sources with grounded citations.',
}

interface ChildSessionView {
  sessionId: string
  role: string
  status: 'running' | 'completed' | 'failed'
  goal?: string
  prompt?: string
  context?: string
  summary?: string
  lastError?: string
  toolsRun: string[]
  events: HarnessEvent[]
}

interface ParsedToolCall {
  id: string
  name: string
  args: Record<string, unknown> | null
  result?: string | null
  isError?: boolean
  isRunning?: boolean
}

function getToolIcon(name: string) {
  switch (name) {
    case 'terminal_exec':
      return <Terminal className="size-3.5 text-brand" />
    case 'file_read':
    case 'file_write':
    case 'file_edit':
      return <FileCode2 className="size-3.5 text-brand" />
    case 'codebase_search':
    case 'codebase_glob':
      return <Search className="size-3.5 text-brand" />
    case 'browser_action':
      return <Camera className="size-3.5 text-brand" />
    default:
      return <Terminal className="size-3.5 text-brand" />
  }
}

function SubagentToolItem({ tool }: { tool: ParsedToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const cmd = tool.args ? (tool.args.command || tool.args.cmd || tool.args.path || JSON.stringify(tool.args)) : ''

  return (
    <div className="rounded-lg border border-line/60 bg-[#11151c] overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2 text-left hover:bg-panel2/40 transition cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getToolIcon(tool.name)}
          <span className="font-semibold text-fg text-[11px]">{tool.name}</span>
          {cmd && (
            <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[280px]">
              {String(cmd)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {tool.isRunning ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-400 font-mono flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-400 animate-ping" />
              running
            </span>
          ) : tool.isError ? (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] text-red-400 font-mono">
              failed
            </span>
          ) : (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-400 font-mono">
              exit 0
            </span>
          )}
          <ChevronDown className={`size-3 text-zinc-500 transition ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-line/40 bg-black/30 p-2.5 space-y-2 font-mono text-[11px]">
          {tool.args && (
            <div>
              <div className="text-[10px] text-zinc-500 font-sans font-medium uppercase tracking-wider mb-1">
                Arguments:
              </div>
              <pre className="rounded bg-panel/70 p-2 text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}
          {tool.result && (
            <div>
              <div className="text-[10px] text-zinc-500 font-sans font-medium uppercase tracking-wider mb-1">
                Result Output:
              </div>
              <pre className="rounded bg-panel/70 p-2 text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SubagentInspectorPanel() {
  const activeChatId = useAgentStore((s) => s.activeSessionId)
  const harnessRun = useHarnessChatStore((s) => s.sessions[activeChatId])

  // Tập hợp danh sách các subagent từ events của harness run
  const childrenMap = useMemo(() => {
    const map: Record<string, ChildSessionView> = {}
    if (!harnessRun?.events) return map

    for (const ev of harnessRun.events) {
      if (ev.type === 'child') {
        const sid = String(ev.data.sessionId ?? ev.data.role ?? 'unknown')
        const role = String(ev.data.role ?? 'specialist')
        const status = (ev.data.status === 'completed' ? 'completed' : ev.data.status === 'started' ? 'running' : 'failed') as ChildSessionView['status']
        const existing = map[sid] ?? {
          sessionId: sid,
          role,
          status,
          goal: String(ev.data.goal ?? ''),
          prompt: String(ev.data.prompt ?? ev.data.goal ?? ''),
          context: ev.data.context ? String(ev.data.context) : undefined,
          summary: String(ev.data.summary ?? ''),
          lastError: ev.data.last_error ? String(ev.data.last_error) : undefined,
          toolsRun: Array.isArray(ev.data.tools_run) ? ev.data.tools_run.map(String) : [],
          events: [],
        }
        existing.status = status
        if (ev.data.goal) existing.goal = String(ev.data.goal)
        if (ev.data.prompt) existing.prompt = String(ev.data.prompt)
        if (ev.data.context) existing.context = String(ev.data.context)
        if (ev.data.summary) existing.summary = String(ev.data.summary)
        if (ev.data.last_error) existing.lastError = String(ev.data.last_error)
        if (Array.isArray(ev.data.tools_run)) existing.toolsRun = ev.data.tools_run.map(String)
        map[sid] = existing
      }
    }
    return map
  }, [harnessRun?.events])

  const childrenList = useMemo(() => Object.values(childrenMap), [childrenMap])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const [childEvents, setChildEvents] = useState<HarnessEvent[]>([])
  const [copied, setCopied] = useState(false)

  const activeChild = useMemo(() => {
    if (selectedSessionId && childrenMap[selectedSessionId]) {
      return childrenMap[selectedSessionId]
    }
    return childrenList[0] ?? null
  }, [selectedSessionId, childrenMap, childrenList])

  // Chip chuyên gia trong transcript mở tab này kèm `sessionId` của em đó → chọn
  // đúng em. Chỉ áp dụng một lần cho mỗi đích để người dùng vẫn tự đổi được sau.
  const subagentsTarget = useUiStore((s) => s.tabIntentTargets.subagents)
  const targetChildId = typeof subagentsTarget?.sessionId === 'string' ? subagentsTarget.sessionId : null
  const appliedChildTargetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!targetChildId || appliedChildTargetRef.current === targetChildId) return
    if (!childrenList.some((child) => child.sessionId === targetChildId)) return
    appliedChildTargetRef.current = targetChildId
    setSelectedSessionId(targetChildId)
  }, [targetChildId, childrenList])

  // Live poll child events từ endpoint /api/agent/sessions/{childSessionId}
  useEffect(() => {
    if (!activeChild || !activeChild.sessionId || activeChild.sessionId === 'unknown') {
      setChildEvents([])
      return
    }

    let isMounted = true
    const fetchChildEvents = async () => {
      try {
        const res = await fetch(`/api/agent/sessions/${encodeURIComponent(activeChild.sessionId)}`, {
          headers: { 'X-BoxFox-Admin': '1' },
        })
        if (!res.ok) return
        const data = await res.json()
        if (isMounted && Array.isArray(data.events)) {
          setChildEvents(data.events)
        }
      } catch {
        /* best effort */
      }
    }

    void fetchChildEvents()
    if (activeChild.status === 'running') {
      const timer = setInterval(() => {
        void fetchChildEvents()
      }, 1000)
      return () => {
        isMounted = false
        clearInterval(timer)
      }
    }
    return () => {
      isMounted = false
    }
  }, [activeChild?.sessionId, activeChild?.status])

  // Phân tách luồng suy nghĩ (thought), tool calls và assistant output từ child events
  const { thoughtText, toolCalls, assistantOutput } = useMemo(() => {
    let thought = ''
    const tools: ParsedToolCall[] = []
    let output = ''

    const toolStarts = new Map<string, { name: string; args: Record<string, unknown> | null }>()

    for (const ev of childEvents) {
      if (ev.type === 'thought') {
        const t = String(ev.data.thought ?? ev.data.text ?? '')
        if (t) thought += (thought ? '\n' : '') + t
      } else if (ev.type === 'tool_start') {
        const name = String(ev.data.name ?? 'tool')
        const args = typeof ev.data.args === 'object' && ev.data.args !== null ? (ev.data.args as Record<string, unknown>) : null
        const callId = String(ev.data.tool_call_id ?? `${name}-${tools.length}`)
        toolStarts.set(callId, { name, args })
        tools.push({
          id: callId,
          name,
          args,
          isRunning: true,
        })
      } else if (ev.type === 'tool_end') {
        const callId = String(ev.data.tool_call_id ?? '')
        const res = ev.data.result ? (typeof ev.data.result === 'object' ? JSON.stringify(ev.data.result, null, 2) : String(ev.data.result)) : null
        const isError = Boolean(ev.data.is_error)
        const item = tools.find((t) => t.id === callId)
        if (item) {
          item.result = res
          item.isError = isError
          item.isRunning = false
        }
      } else if (ev.type === 'assistant_delta' || ev.type === 'assistant') {
        const text = String(ev.data.text ?? '')
        if (text) output += text
      }
    }

    return {
      thoughtText: thought.trim(),
      toolCalls: tools,
      assistantOutput: output.trim(),
    }
  }, [childEvents])

  const roleDescription = activeChild ? (ROLE_DESCRIPTIONS[activeChild.role] ?? 'Specialized subagent execution.') : ''

  const finalResponseText = assistantOutput || activeChild?.summary || ''

  const handleCopy = () => {
    if (!finalResponseText) return
    void navigator.clipboard.writeText(finalResponseText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#0d1117] text-fg select-none">
      {/* Top Header Banner — Read-only indicator */}
      <div className="flex items-center justify-between border-b border-line/70 bg-[#161b22] px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex size-5 items-center justify-center rounded bg-brand/20 text-brand">
            <BrainCircuit className="size-3.5" />
          </div>
          <span className="font-semibold text-fg">Sub-agent Execution Console</span>
          <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-mono text-muted border border-line">
            Autonomous Specialists
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/20">
          <ShieldAlert className="size-3" />
          <span>Read-only Stream (Autonomous execution delegated by Main Agent)</span>
        </div>
      </div>

      {/* Main 2-Column Area: Specialists Pipeline (Trái) & Chat Stream (Phải) */}
      <div className="flex min-h-0 flex-1">
        {/* Left Column: Subagents List Pipeline */}
        <div className="flex w-64 shrink-0 flex-col border-r border-line/60 bg-[#11141a]">
          <div className="border-b border-line/40 px-3 py-2 text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center justify-between">
            <span>Specialists Pipeline</span>
            <span className="font-mono text-[9px] bg-panel2 px-1.5 py-0.2 rounded text-zinc-400">
              {childrenList.length} total
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {childrenList.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted space-y-2">
                <Bot className="size-8 mx-auto text-zinc-600 animate-pulse" />
                <p>No subagents active yet.</p>
                <p className="text-[10px] text-zinc-500">
                  Orchestrator will delegate subtasks here during complex runs.
                </p>
              </div>
            ) : (
              childrenList.map((child) => {
                const isSelected = activeChild?.sessionId === child.sessionId

                return (
                  <button
                    key={child.sessionId}
                    type="button"
                    data-child-session-id={child.sessionId}
                    data-selected={isSelected}
                    onClick={() => setSelectedSessionId(child.sessionId)}
                    className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#1c222d] text-white border border-brand/40 shadow-xs ring-1 ring-brand/30'
                        : 'text-zinc-300 hover:bg-panel2/50 border border-transparent'
                    }`}
                  >
                    <div
                      className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                        child.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : child.status === 'running'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      <Bot className="size-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs capitalize truncate">
                          {child.role} Specialist
                        </span>
                        {child.status === 'completed' ? (
                          <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                        ) : child.status === 'running' ? (
                          <span className="size-2 rounded-full bg-amber-400 animate-ping shrink-0" />
                        ) : (
                          <AlertCircle className="size-3 text-red-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                        {child.toolsRun.length > 0 ? `${child.toolsRun.length} tools executed` : 'Autonomous run'}
                      </div>
                    </div>

                    <ChevronRight className={`size-3 text-zinc-600 transition ${isSelected ? 'text-brand' : ''}`} />
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Sub-agent Chat Stream */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#090d13]">
          {activeChild ? (
            <>
              {/* Header Info */}
              <div className="border-b border-line/60 bg-[#12161f] px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-fg capitalize flex items-center gap-1.5">
                      <Bot className="size-4 text-brand" />
                      {activeChild.role} Specialist
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        activeChild.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : activeChild.status === 'running'
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'bg-red-500/15 text-red-400 border border-red-500/30'
                      }`}
                    >
                      {activeChild.status}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    SID: {activeChild.sessionId.slice(0, 14)}…
                  </span>
                </div>

                {roleDescription && (
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    {roleDescription}
                  </p>
                )}
              </div>

              {/* Chat Stream Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
                {/* 1. Tin nhắn Prompt từ Main Agent (Orchestrator) */}
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-brand font-medium">
                    <BrainCircuit className="size-3.5 text-brand" />
                    <span>Main Agent (Orchestrator)</span>
                  </div>
                  <div className="max-w-[88%] rounded-2xl bg-panel2 border border-line px-4 py-3 text-xs leading-relaxed text-fg shadow-xs">
                    <MarkdownRenderer
                      content={activeChild.prompt || activeChild.goal || 'Inspect repository and report findings.'}
                    />
                  </div>
                </div>

                {/* 2. Luồng phản hồi của Sub-agent */}
                <div className="space-y-3.5 pt-2">
                  <div className="flex items-center justify-between text-xs text-muted pb-1 border-b border-line/40">
                    <div className="flex items-center gap-2">
                      <div className="flex size-5 items-center justify-center rounded bg-brand/10 text-brand">
                        <Bot className="size-3.5" />
                      </div>
                      <span className="font-semibold text-fg capitalize">
                        {activeChild.role} Specialist Output
                      </span>
                    </div>
                    {finalResponseText && (
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white transition cursor-pointer"
                        title="Copy response"
                      >
                        {copied ? (
                          <>
                            <Check className="size-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Thinking Accordion */}
                  {thoughtText && (
                    <div className="rounded-xl border border-line/60 bg-[#0f131a] overflow-hidden text-xs">
                      <button
                        type="button"
                        onClick={() => setThinkingExpanded(!thinkingExpanded)}
                        className="w-full flex items-center justify-between px-3 py-2 text-muted hover:text-fg transition cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Sparkles className="size-3.5 text-brand" />
                          <span className="font-medium text-[11px] text-zinc-300">
                            Thinking & Internal Reasoning
                          </span>
                        </div>
                        <ChevronDown
                          className={`size-3 text-zinc-500 transition ${thinkingExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {thinkingExpanded && (
                        <div className="px-3 pb-3 text-zinc-400 font-mono text-[11px] leading-relaxed whitespace-pre-wrap border-t border-line/30 pt-2 bg-black/20 max-h-60 overflow-y-auto">
                          {thoughtText}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tools Executed Accordion List */}
                  {toolCalls.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                        <Terminal className="size-3 text-brand" />
                        <span>Tools Executed ({toolCalls.length})</span>
                      </div>
                      <div className="space-y-1">
                        {toolCalls.map((tool) => (
                          <SubagentToolItem key={tool.id} tool={tool} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Final Markdown Report */}
                  <div className="rounded-2xl border border-line/70 bg-[#0f141d] p-4 text-xs leading-relaxed text-fg shadow-xs">
                    {finalResponseText ? (
                      <MarkdownRenderer content={finalResponseText} />
                    ) : (
                      <div className="text-zinc-500 italic py-2">
                        {activeChild.status === 'running'
                          ? 'Specialist is processing instructions autonomously in the sandbox...'
                          : 'No synthesis text returned from sub-agent.'}
                      </div>
                    )}
                  </div>

                  {/* Error Box if any */}
                  {activeChild.lastError && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400 flex items-start gap-2">
                      <AlertCircle className="size-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Execution Issue Encountered:</div>
                        <div className="mt-0.5 text-[11px] leading-relaxed font-mono">
                          {activeChild.lastError}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Footer: Read-only Guard */}
              <div className="border-t border-line/70 bg-[#12161f] px-4 py-2.5 flex items-center justify-between text-xs text-muted">
                <div className="flex items-center gap-2 text-zinc-400">
                  <ShieldAlert className="size-3.5 text-amber-400" />
                  <span className="text-[11px]">
                    🔒 Read-only sub-agent stream · Autonomous execution delegated by Main Agent
                  </span>
                </div>
                <span className="text-[10px] font-mono text-zinc-500 bg-panel px-2 py-0.5 rounded border border-line/50">
                  Sandbox Protected
                </span>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted">
              <Bot className="size-10 mb-2 text-zinc-600 animate-pulse" />
              <p className="text-xs">Select a specialist from the list to inspect its chat stream.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
