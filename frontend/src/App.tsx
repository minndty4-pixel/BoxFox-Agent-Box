/**
 * Main App Layout — BoxFox / Devin Professional Workspace.
 * VS Code-style tab system with 'Open Workspace' TopBar menu and rich workspace panels.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  FileText,
  Monitor,
  Code2,
  Terminal,
  Shapes,
  Tag,
  ScrollText,
  GitPullRequest,
  ShieldAlert,
  ArrowLeft,
  X,
  Plus,
  ChevronDown,
  FolderOpen,
  BrainCircuit,
} from 'lucide-react'
import { useT } from './i18n/context'
import { useAgentStore } from './store/agentStore'
import { useUiStore, ALL_PANEL_TABS, type PanelTabId } from './store/uiStore'
import { Sidebar } from './components/shell/Sidebar'
import { isCompactViewport, useViewportWidth } from './components/shell/useViewportWidth'
import { Resizer } from './components/shell/Resizer'
import { ChatPanel } from './components/panels/ChatPanel'
import { PlanPanel } from './components/panels/PlanPanel'
import { DecisionsPanel } from './components/panels/DecisionsPanel'
import { TerminalPanel } from './components/panels/TerminalPanel'
import { SandboxScreenPanel } from './components/panels/SandboxScreenPanel'
import { SubagentInspectorPanel } from './components/panels/SubagentInspectorPanel'
import { IdePanel } from './components/panels/IdePanel'
import { LabelsLeasesPanel } from './components/panels/LabelsLeasesPanel'
import { ModeSwitchCard } from './components/ModeSwitchCard'
import { LabelDot } from './components/LabelDot'
import { DesignCanvasPanel } from './components/panels/DesignCanvasPanel'
import { AuditPanel } from './components/panels/AuditPanel'
import { PullRequestsPanel } from './components/panels/PullRequestsPanel'
import { WorkspaceFilesPanel } from './components/panels/workspace/WorkspaceFilesPanel'
import { SystemLogPanel } from './components/panels/SystemLogPanel'
import { BoxControls } from './components/shell/BoxControls'
import { SettingsModal } from './components/settings/SettingsModal'
import { CompletionEmailNotice } from './components/CompletionEmailNotice'
import { SearchSessionsModal } from './components/shell/SearchSessionsModal'
import { useCompletionEmail } from './hooks/useCompletionEmail'

const TAB_LABEL_KEY: Record<PanelTabId, string> = {
  plan: 'tabs.plan',
  sandbox: 'tabs.sandbox',
  subagents: 'tabs.subagents',
  ide: 'tabs.ide',
  terminal: 'tabs.terminal',
  design: 'tabs.design',
  decisions: 'tabs.decisions',
  pull_requests: 'tabs.pull_requests',
  labels: 'tabs.labels',
  audit: 'tabs.audit',
  files: 'tabs.files',
  system_log: 'tabs.system_log',
}

const TAB_ICON: Record<PanelTabId, React.ComponentType<{ className?: string }>> = {
  plan: FileText,
  sandbox: Monitor,
  subagents: BrainCircuit,
  ide: Code2,
  terminal: Terminal,
  design: Shapes,
  decisions: ShieldAlert,
  pull_requests: GitPullRequest,
  labels: Tag,
  audit: ScrollText,
  files: FolderOpen,
  system_log: Activity,
}

const AVAILABLE_PANEL_TABS: { id: PanelTabId; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'plan', label: 'Plan Document', desc: 'Architecture blueprint & step review', icon: FileText },
  { id: 'sandbox', label: 'Sandbox Machine', desc: 'Live container vision & browser frame', icon: Monitor },
  { id: 'subagents', label: 'Sub-agents Console', desc: 'Autonomous specialists activity & thinking', icon: BrainCircuit },
  { id: 'ide', label: 'IDE (VS Code Web)', desc: 'code-server running inside the box', icon: Code2 },
  { id: 'terminal', label: 'Integrated Terminal', desc: 'Interactive shell in sandbox container', icon: Terminal },
  { id: 'design', label: 'Design Canvas', desc: 'Interactive UI canvas, visual flow & mockup editor', icon: Shapes },
  { id: 'decisions', label: 'Decisions & Approvals', desc: 'Security permission requests & design choices', icon: ShieldAlert },
  { id: 'pull_requests', label: 'Pull Requests', desc: 'Git branches, PR diffs & CI checks', icon: GitPullRequest },
  { id: 'labels', label: 'Labels & Leases', desc: 'IFC security provenance & active leases', icon: Tag },
  { id: 'audit', label: 'Audit Logs', desc: 'Immutable security action ledger', icon: ScrollText },
  { id: 'files', label: 'Workspace Files', desc: 'Browse, preview & manage workspace files', icon: FolderOpen },
  { id: 'system_log', label: 'System Log', desc: 'Dev log written on the host, outside the box', icon: Activity },
]

/**
 * Tab CHỈ dành cho chế độ phát triển. Bảng Nhật ký hệ thống là công cụ của dev
 * (việc 5, bản v2): nó đọc log của harness trên host qua `/api/agent/system-log`,
 * nên bản dựng sản phẩm không hiện nó ở menu "Open Workspace" và cũng không mở
 * được tab đó. `import.meta.env.DEV` là chế độ dev có sẵn của ứng dụng — không
 * thêm cờ mới.
 */
const DEV_ONLY_PANEL_TABS: ReadonlySet<PanelTabId> = new Set<PanelTabId>(['system_log'])

export function isPanelTabAvailable(id: PanelTabId, env: ImportMetaEnv = import.meta.env): boolean {
  return Boolean(env.DEV) || !DEV_ONLY_PANEL_TABS.has(id)
}

/** Danh sách tab của menu "Open Workspace", đã lọc theo chế độ dev. */
export function availablePanelTabs(env: ImportMetaEnv = import.meta.env) {
  return AVAILABLE_PANEL_TABS.filter((tab) => isPanelTabAvailable(tab.id, env))
}

export default function App() {
  const t = useT()
  const init = useAgentStore((s) => s.init)
  const teardown = useAgentStore((s) => s.teardown)
  useEffect(() => {
    init()
    return () => teardown()
  }, [init, teardown])

  useCompletionEmail()


  const mode = useAgentStore((s) => s.mode)
  const taskEpoch = useAgentStore((s) => s.taskEpoch)
  const budget = useAgentStore((s) => s.budget)
  const proposal = useAgentStore((s) => s.proposal)
  const rejectBundle = useAgentStore((s) => s.rejectBundle)
  const context = useAgentStore((s) => s.context)
  const sessions = useAgentStore((s) => s.sessions)
  const activeSessionId = useAgentStore((s) => s.activeSessionId)
  const activeSession = sessions.find((s) => s.session_id === activeSessionId)
  const sessionTitle = activeSession?.title || 'New Session'

  const rawOpenTabs = useUiStore((s) => s.openTabs)
  // Bảng nhật ký hệ thống là tab DEV: ở bản dựng sản phẩm nó không mở được, kể cả
  // khi trạng thái tab còn sót lại từ trước.
  const openTabs = rawOpenTabs.filter((tab) => ALL_PANEL_TABS.includes(tab) && isPanelTabAvailable(tab))
  const activeTab = useUiStore((s) => s.activeTab)
  const openTab = useUiStore((s) => s.openTab)
  const closeTab = useUiStore((s) => s.closeTab)
  const closePanel = useUiStore((s) => s.closePanel)
  const splitRatio = useUiStore((s) => s.splitRatio)
  // Dưới ~768px cột chat phải chiếm trọn bề ngang: cột chat 120px ở 390px là
  // không dùng được (BUG-23). Sidebar tự thu về thanh biểu tượng ở <1024px.
  const compactLayout = isCompactViewport(useViewportWidth())

  const containerRef = useRef<HTMLDivElement>(null)
  const showModeSwitch = proposal !== null

  const requests = useAgentStore((s) => s.requests)
  const pendingRequestsCount = Object.values(requests).filter((r) => r.status === 'dang_cho').length
  // Người dùng tự bấm tab nào thì tab đó được "ghim": ý định tự mở của agent
  // nhắm đúng tab ấy sẽ chỉ xếp hàng (hợp đồng §3).
  const pinTab = useUiStore((s) => s.pinTab)
  const pendingIntents = useUiStore((s) => s.pendingIntents)
  const intentCountFor = (tab: PanelTabId) =>
    pendingIntents.filter((intent) => intent.tab === tab).length

  function renderActiveTab() {
    if (showModeSwitch && activeTab === 'plan') {
      return <ModeSwitchCard proposal={proposal!} rejectBundle={rejectBundle} />
    }
    switch (activeTab) {
      case 'plan':
        return <PlanPanel />
      case 'sandbox':
        return <SandboxScreenPanel />
      case 'subagents':
        return <SubagentInspectorPanel />
      case 'ide':
        return <IdePanel />

      case 'terminal':
        return <TerminalPanel />
      case 'design':
        return <DesignCanvasPanel />
      case 'decisions':
        return <DecisionsPanel />
      case 'pull_requests':
        return <PullRequestsPanel />
      case 'labels':
        return <LabelsLeasesPanel />
      case 'audit':
        return <AuditPanel />
      case 'files':
        return <WorkspaceFilesPanel />
      case 'system_log':
        // Cùng một hàng rào với menu: trạng thái tab sót lại từ trước cũng không mở
        // được bảng này ở bản dựng sản phẩm.
        return isPanelTabAvailable('system_log') ? <SystemLogPanel /> : null
      default:
        return null
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg select-none">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cleaned TopBar Header with Open Workspace Dropdown */}
        <TopBar
          title={sessionTitle}
          mode={mode}
          taskEpoch={taskEpoch}
          budget={budget}
          context={context}
        />

        <div ref={containerRef} className="flex min-h-0 flex-1">
          {/* Left Column — Chat & Prompt Input Bar.
              min-w-0 (không còn min-w-[480px]): sàn thật do Resizer chốt
              bằng pixel (clampSplitRatio), nên tổng min-content không bao
              giờ vượt viewport và không còn bị overflow-hidden cắt panel
              còn lại. */}
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-line"
            style={compactLayout
              ? { flex: '1 1 0%', width: 'auto' }
              : { flex: `${splitRatio} 0 0%`, width: `${splitRatio * 100}%` }}
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatPanel />
            </div>
          </div>

          {!compactLayout && <Resizer containerRef={containerRef} />}

          {/* Right Column — VS Code-style Workspace Tabs (cùng lý do min-w-0 như trên).
              Ở chế độ hẹp (<768px) panel phải tạm ẩn để cột chat đủ rộng. */}
          {!compactLayout && (
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
            style={{ flex: `${1 - splitRatio} 0 0%`, width: `${(1 - splitRatio) * 100}%` }}
          >
            {/* Top Workspace Tab Bar */}
            <div className="flex items-center gap-0.5 border-b border-line bg-panel px-2 pt-1 relative">
              {openTabs.map((tab) => {
                const Icon = TAB_ICON[tab]
                const isActive = activeTab === tab
                // Huy hiệu đếm = yêu cầu mock đang chờ (tab Decisions) + số ý định
                // tự mở đang xếp hàng cho tab này.
                const badgeCount = intentCountFor(tab) + (tab === 'decisions' ? pendingRequestsCount : 0)
                const isDecisionsWithPending = badgeCount > 0

                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      pinTab(tab)
                      openTab(tab)
                    }}
                    aria-selected={isActive}
                    className={`group flex items-center gap-1.5 rounded-t-md border-t border-x px-3 py-1.5 text-xs font-medium transition cursor-pointer ${isActive
                        ? 'border-line bg-panel2 text-fg shadow-xs'
                        : 'border-transparent text-muted hover:text-fg hover:bg-panel2/40'
                      }`}
                  >
                    <Icon
                      className={`size-3.5 ${isDecisionsWithPending
                          ? 'text-amber-400 animate-pulse'
                          : isActive
                            ? 'text-brand'
                            : 'text-muted'
                        }`}
                    />
                    <span>{tab === 'decisions' ? 'Decisions' : tab === 'subagents' ? 'Sub-agents' : t(TAB_LABEL_KEY[tab] as 'tabs.plan')}</span>

                    {isDecisionsWithPending && (
                      <span
                        data-testid={`tab-badge-${tab}`}
                        className="flex size-4 items-center justify-center rounded-full bg-amber-500/20 font-mono text-[9px] font-bold text-amber-300"
                      >
                        {badgeCount}
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab)
                      }}
                      className="ml-1 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-panel hover:text-fg cursor-pointer transition"
                      aria-label="Close tab"
                    >
                      <X className="size-2.5" />
                    </span>
                  </button>
                )
              })}

              {/* Close entire panel button */}
              {openTabs.length > 0 && (
                <div className="ml-auto flex items-center pr-1">
                  <button
                    type="button"
                    onClick={closePanel}
                    className="rounded p-1 text-muted hover:text-fg hover:bg-panel2 transition cursor-pointer"
                    title="Close workspace panel"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Tab Content or VS Code-style Empty Watermark */}
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeTab && openTabs.length > 0 ? (
                <div
                  className={
                    activeTab === 'sandbox' || activeTab === 'ide'
                      ? 'flex h-full flex-col overflow-hidden'
                      : 'h-full overflow-auto'
                  }
                >
                  {renderActiveTab()}
                </div>
              ) : (
                /* VS Code-style Empty State */
                <div className="flex h-full flex-col items-center justify-center p-8 text-center select-none bg-panel">
                  <div className="max-w-md space-y-4">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-panel2 border border-line text-muted">
                      <Monitor className="size-6 text-brand" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-fg">No Workspace View Open</h3>
                      <p className="mt-1 text-xs text-muted leading-relaxed">
                        Select a view from the shortcuts below or click the <span className="text-brand font-medium">Open Workspace</span> button above.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      {availablePanelTabs().map((item) => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => openTab(item.id)}
                            className="flex items-center gap-2 rounded-lg border border-line bg-panel2/50 p-2.5 text-left text-xs font-medium text-fg hover:bg-panel2 hover:border-zinc-500 transition cursor-pointer"
                          >
                            <Icon className="size-4 text-brand shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Global Full-Screen Settings Modal */}
      <SettingsModal />

      {/* Mock email preview banner (dismissible) */}
      <CompletionEmailNotice />
    </div>
  )
}

function TopBar({
  title,
  mode,
  taskEpoch,
  budget,
  context,
}: {
  title: string
  mode: string
  taskEpoch: number
  budget: { steps: number; tokens: number; costUsd: number; capUsd: number }
  context: { integrity_floor: string; confidentiality_ceiling: string }
}) {
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const openTab = useUiStore((s) => s.openTab)
  const openTabs = useUiStore((s) => s.openTabs)
  // Chọn tab từ menu này cũng là người dùng tự chọn → ghim tab đó.
  const pinTab = useUiStore((s) => s.pinTab)

  // Close add tab popup menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    if (addMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [addMenuOpen])

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-panel px-3.5 select-none">
      {/* Left: Session Title & Badges */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded text-muted transition hover:bg-panel2 hover:text-fg cursor-pointer"
          title="Back"
        >
          <ArrowLeft className="size-3" />
        </button>
        <span className="size-1.5 rounded-full bg-emerald-400" />
        <h1 className="text-xs font-semibold text-fg">{title}</h1>
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${mode === 'ACT'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
            }`}
        >
          {mode}
        </span>
        <span className="text-[11px] font-mono text-muted">epoch #{taskEpoch}</span>
        <span className="hidden text-[11px] font-mono text-muted lg:inline">
          {budget.tokens.toLocaleString()} tokens · ${budget.costUsd.toFixed(2)}
        </span>
      </div>

      {/* Right: Open Workspace Button, Machine Controls & Security Labels */}
      <div className="flex items-center gap-2.5">
        {/* Open Workspace Dropdown Button */}
        <div className="relative inline-block" ref={addMenuRef}>
          <button
            type="button"
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition cursor-pointer ${addMenuOpen
                ? 'border-brand/60 bg-panel2 text-brand shadow-xs'
                : 'border-line/70 bg-panel2/50 text-muted hover:border-line hover:bg-panel2 hover:text-fg'
              }`}
            title="Open Workspace View"
          >
            <Plus className="size-3 text-brand" />
            <span className="hidden sm:inline">Open Workspace</span>
            <ChevronDown className={`size-3 transition-transform duration-150 ${addMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Popup Menu */}
          {addMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-panel2 p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                Open Workspace View
              </div>
              <div className="space-y-0.5 mt-0.5">
                {availablePanelTabs().map((tabItem) => {
                  const Icon = tabItem.icon
                  const isAlreadyOpen = openTabs.includes(tabItem.id)
                  return (
                    <button
                      key={tabItem.id}
                      type="button"
                      onClick={() => {
                        pinTab(tabItem.id)
                        openTab(tabItem.id)
                        setAddMenuOpen(false)
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${isAlreadyOpen
                          ? 'bg-panel/60 text-fg'
                          : 'text-muted hover:bg-panel hover:text-fg'
                        }`}
                    >
                      <Icon className="size-3.5 text-brand shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-fg">{tabItem.label}</div>
                        <div className="text-[10px] text-muted truncate">{tabItem.desc}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <BoxControls />
        <LabelDot
          integrity={context.integrity_floor as 'duoc_nguoi_dung_cho_phep'}
          confidentiality={context.confidentiality_ceiling as 'cong_khai'}
        />
        <SearchSessionsModal />
      </div>
    </div>
  )
}
