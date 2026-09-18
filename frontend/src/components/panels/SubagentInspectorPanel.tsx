/**
 * Subagent Inspector Dashboard (Thiết kế theo chuẩn Ảnh 3 của người dùng).
 * 
 * - Panel bên phải rộng rãi chia 2 cột:
 *   + Cột trái (~220px): Danh sách các Sub-agent đã kích hoạt (Explore, Plan, Build, Testing, v.v...)
 *     kèm status badge (Running 🟡, Done 🟢, Error 🔴), thời gian chạy và số tool calls.
 *   + Cột phải (flex-1): Khung chi tiết "Thinking Console":
 *     - Header: Tên vai trò, Model được cấp phát, Goal của nhiệm vụ con.
 *     - Tabs con: [ 🧠 Thinking / Suy luận ] | [ 🛠️ Tools đã gọi ] | [ 📋 Kết quả tóm tắt ]
 *     - Banner cảnh báo: "Chế độ quan sát tự trị. User không thể gửi tin nhắn vào tiến trình con."
 */
import { useState, useMemo } from 'react'
import {
  Bot,
  Terminal,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ShieldAlert,
  BrainCircuit,
  Eye,
  Layers,
} from 'lucide-react'
import { useHarnessChatStore, type HarnessEvent } from '../../store/harnessChatStore'
import { useAgentStore } from '../../store/agentStore'

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
  summary?: string
  lastError?: string
  toolsRun: string[]
  events: HarnessEvent[]
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
          summary: String(ev.data.summary ?? ''),
          lastError: ev.data.last_error ? String(ev.data.last_error) : undefined,
          toolsRun: Array.isArray(ev.data.tools_run) ? ev.data.tools_run.map(String) : [],
          events: [],
        }
        existing.status = status
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
  const [detailTab, setDetailTab] = useState<'thinking' | 'tools' | 'summary'>('thinking')

  const activeChild = useMemo(() => {
    if (selectedSessionId && childrenMap[selectedSessionId]) {
      return childrenMap[selectedSessionId]
    }
    return childrenList[0] ?? null
  }, [selectedSessionId, childrenMap, childrenList])

  const roleDescription = activeChild ? (ROLE_DESCRIPTIONS[activeChild.role] ?? 'Specialized subagent execution.') : ''

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
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
          <ShieldAlert className="size-3" />
          <span>Read-only Inspection (User cannot send input to child agents)</span>
        </div>
      </div>

      {/* Main 2-Column Area (Bố cục theo chuẩn Ảnh 3) */}
      <div className="flex min-h-0 flex-1">
        {/* Left Column: Subagents List (Ảnh 3: danh sách [plan], [plan], [plan]...) */}
        <div className="flex w-60 shrink-0 flex-col border-r border-line/60 bg-[#11141a]">
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
                const isSelected = (activeChild?.sessionId === child.sessionId)

                return (
                  <button
                    key={child.sessionId}
                    type="button"
                    onClick={() => setSelectedSessionId(child.sessionId)}
                    className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#1c222d] text-white border border-brand/40 shadow-xs'
                        : 'text-zinc-300 hover:bg-panel2/50 border border-transparent'
                    }`}
                  >
                    <div
                      className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                        child.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : child.status === 'running'
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      <Bot className="size-4" />
                    </div>


                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs capitalize truncate">
                          {child.role}
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
                        {child.toolsRun.length > 0 ? `${child.toolsRun.length} tools executed` : 'Ready'}
                      </div>
                    </div>

                    <ChevronRight className={`size-3 text-zinc-600 transition ${isSelected ? 'text-brand' : ''}`} />
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Thinking & Console Area (Ảnh 3: "thinking in here") */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#090d13]">
          {activeChild ? (
            <>
              {/* Header Info */}
              <div className="border-b border-line/60 bg-[#12161f] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-fg capitalize">
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
                    SID: {activeChild.sessionId.slice(0, 12)}…
                  </span>
                </div>

                {roleDescription && (
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    {roleDescription}
                  </p>
                )}


                {/* Sub-tabs switch */}
                <div className="mt-3 flex items-center gap-1 border-t border-line/40 pt-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab('thinking')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      detailTab === 'thinking'
                        ? 'bg-panel2 text-brand font-semibold shadow-xs'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    <BrainCircuit className="size-3.5" />
                    <span>Thinking & Reasoning</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('tools')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      detailTab === 'tools'
                        ? 'bg-panel2 text-brand font-semibold shadow-xs'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    <Terminal className="size-3.5" />
                    <span>Tools Executed ({activeChild.toolsRun.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('summary')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      detailTab === 'summary'
                        ? 'bg-panel2 text-brand font-semibold shadow-xs'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    <FileCode2 className="size-3.5" />
                    <span>Outcome Summary</span>
                  </button>
                </div>
              </div>

              {/* Body: "thinking in here" */}
              <div className="flex-1 overflow-y-auto p-4 font-mono text-xs select-text">
                {detailTab === 'thinking' && (
                  <div className="rounded-xl border border-line/70 bg-[#0f131a] p-4 text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    <div className="flex items-center gap-2 pb-2 mb-3 border-b border-line/40 text-muted font-sans text-xs">
                      <Eye className="size-3.5 text-brand" />
                      <span>Specialist internal thought stream:</span>
                    </div>
                    {activeChild.summary ? (
                      <div>{activeChild.summary}</div>
                    ) : (
                      <div className="text-zinc-500 italic">
                        Sub-agent is processing instructions autonomously in the sandbox...
                      </div>
                    )}
                    {activeChild.lastError && (
                      <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-red-400 text-xs">
                        <strong>Error encountered:</strong> {activeChild.lastError}
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'tools' && (
                  <div className="space-y-2">
                    {activeChild.toolsRun.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted">
                        No tools called by this specialist yet.
                      </div>
                    ) : (
                      activeChild.toolsRun.map((toolName, idx) => (
                        <div
                          key={`${toolName}-${idx}`}
                          className="flex items-center justify-between rounded-lg border border-line/60 bg-[#11151c] px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <Terminal className="size-3.5 text-brand" />
                            <span className="font-semibold text-fg">{toolName}</span>
                          </div>
                          <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono">
                            executed
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'summary' && (
                  <div className="rounded-xl border border-line/70 bg-[#0f131a] p-4 text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    <div className="flex items-center gap-2 pb-2 mb-3 border-b border-line/40 text-muted font-sans text-xs">
                      <Layers className="size-3.5 text-brand" />
                      <span>Returned synthesis to parent Orchestrator:</span>
                    </div>
                    <p>{activeChild.summary || 'Work in progress.'}</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted">
              <Bot className="size-10 mb-2 text-zinc-600" />
              <p className="text-xs">Select a specialist from the list to inspect its activity.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
