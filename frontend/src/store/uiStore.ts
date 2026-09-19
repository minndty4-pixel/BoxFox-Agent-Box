/**
 * Trạng thái THUẦN GIAO DIỆN: thanh bên thu gọn, tab nào đang mở, tỉ lệ hai
 * cột, file nào đang chọn, modal nguồn nào đang mở, và điều hướng Settings.
 */
import { create } from 'zustand'
import type { AuditQueryId } from '../types/session'
import type { SettingSectionId, SettingTabId } from '../types/harness'
import type { Lang } from '../i18n/context'
import type { ExecutedWork } from '../lib/notifyEmail'
import { buildIdeUrl } from '../lib/ide/config'

/**
 * Trạng thái của một email mock "đã gửi" — lưu lại để hiển thị banner xem trước
 * sau khi phiên đạt trạng thái `xong`. `lang`/`title`/`work` được chốt tại thời
 * điểm gửi để banner không đổi theo locale hay kịch bản sau đó.
 */
export interface CompletionEmail {
  to: string
  at: string
  lang: Lang
  title: string
  work: ExecutedWork[]
}

export type PanelTabId =
  | 'plan'
  | 'sandbox'
  | 'subagents'
  | 'ide'
  | 'terminal'
  | 'design'
  | 'decisions'
  | 'pull_requests'
  | 'labels'
  | 'audit'
  | 'files'

export const ALL_PANEL_TABS: PanelTabId[] = [
  'plan',
  'sandbox',
  'subagents',
  'ide',
  'terminal',
  'design',
  'decisions',
  'pull_requests',
  'labels',
  'audit',
  'files',
]

/**
 * Ý định mở tab do agent phát ra (hợp đồng §1 `ui_intent`, §3 luật tự mở tab).
 * `target` là ngữ cảnh kèm theo: `{identity}` cho plan, `{requestId}` cho
 * decisions, `{path}` cho files, `{sessionId}` cho subagents.
 */
export interface TabIntent {
  tab: PanelTabId
  target?: Record<string, unknown> | null
  reason: string
}

/** Cửa sổ "người dùng đang rảnh" của luật tự mở tab (hợp đồng §3). */
export const AUTO_OPEN_IDLE_MS = 15000

/** Trần số ý định chờ giữ lại; ý định cũ nhất bị bỏ trước (hợp đồng §3). */
export const MAX_PENDING_TAB_INTENTS = 20

/** Cờ bật/tắt của người dùng, lưu cùng chỗ với `boxfox_theme`. */
function getInitialFlag(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const saved = localStorage.getItem(key)
  if (saved === 'true') return true
  if (saved === 'false') return false
  return fallback
}

export const AUTO_OPEN_TABS_KEY = 'boxfox_auto_open_tabs'
export const AUTO_OPEN_IDLE_ONLY_KEY = 'boxfox_auto_open_only_when_idle'


function getInitialTheme(): 'light' | 'dark' | 'system' {
  if (typeof window === 'undefined') return 'dark'
  const saved = localStorage.getItem('boxfox_theme') as 'light' | 'dark' | 'system' | null
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'dark'
}

function applyDomTheme(theme: 'light' | 'dark' | 'system') {
  if (typeof document === 'undefined') return
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (isDark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// Khởi chạy ngay khi nạp store
if (typeof window !== 'undefined') {
  applyDomTheme(getInitialTheme())
}

interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  accountMenuOpen: boolean
  setAccountMenuOpen: (open: boolean) => void

  sessionTab: 'recent' | 'groups'
  setSessionTab: (tab: 'recent' | 'groups') => void

  openTabs: PanelTabId[]
  activeTab: PanelTabId | null
  /**
   * Mở + kích hoạt tab. `target` (tuỳ chọn) là ngữ cảnh của ý định đang mở
   * (ví dụ `{identity}` cho plan) — panel đọc lại qua `tabIntentTargets`.
   */
  openTab: (tab: PanelTabId, target?: Record<string, unknown> | null) => void
  closeTab: (tab: PanelTabId) => void
  closePanel: () => void

  // ── Luật tự mở tab (hợp đồng §3) ───────────────────────────────────────
  /** Tab người dùng tự bấm trên thanh tab; ý định trúng tab này chỉ xếp hàng. */
  pinnedTab: PanelTabId | null
  pinTab: (tab: PanelTabId) => void
  /** Mốc hoạt động gần nhất của người dùng (keydown trong khung soạn tin, cuộn chat). */
  lastUserActivityAt: number
  noteUserActivity: () => void
  autoOpenTabs: boolean
  setAutoOpenTabs: (enabled: boolean) => void
  autoOpenOnlyWhenIdle: boolean
  setAutoOpenOnlyWhenIdle: (enabled: boolean) => void
  /** Ý định bị chặn, mới nhất ở cuối; tab đích hiện huy hiệu đếm. */
  pendingIntents: TabIntent[]
  requestTabIntent: (intent: TabIntent) => 'opened' | 'queued'
  /** Ngữ cảnh của lần mở tab gần nhất, cho panel tự chọn đúng mục. */
  tabIntentTargets: Partial<Record<PanelTabId, Record<string, unknown> | null>>

  /** Tăng khi agent ghi một plan mới (`plan_written`) — `usePlanFiles` nghe số này. */
  planRevision: number
  bumpPlanRevision: () => void

  /** Vị trí cuộn đã nhớ của từng phiên chat, khôi phục khi quay lại phiên đó. */
  sessionScrollOffsets: Record<string, number>
  rememberSessionScroll: (sessionId: string, offset: number) => void

  panelFullscreen: boolean
  toggleFullscreen: () => void

  /** Bề rộng cột chat, tính theo phần của cả vùng làm việc (0,25 → 0,75). */
  splitRatio: number
  setSplitRatio: (ratio: number) => void

  selectedFilePath: string | null
  selectFile: (path: string) => void
  /** Xóa `selectedFilePath` sau khi panel Files đã tiêu thụ (mở file). */
  clearSelectedFile: () => void

  /**
   * URL code-server mà tab IDE sẽ nhúng khi mở theo yêu cầu "Mở trong VS Code
   * Web" từ tab Files. `null` ⇒ dùng mặc định (gốc workspace). `useIdeFrame`
   * theo dõi giá trị này để iframe tải đúng thư mục.
   */
  ideLaunchUrl: string | null
  /** Đặt `ideLaunchUrl` mở đúng `filePath` nhưng giữ gốc workspace rồi mở tab IDE. */
  openFileInIde: (filePath: string) => void

  sourceLabelId: string | null
  openSource: (labelId: string) => void
  closeSource: () => void

  labelsTab: 'context' | 'leases'
  setLabelsTab: (tab: 'context' | 'leases') => void

  auditQuery: AuditQueryId | 'all'
  setAuditQuery: (query: AuditQueryId | 'all') => void

  // Theme
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void

  // Settings state
  isSettingsOpen: boolean
  settingsCategory: SettingSectionId
  settingsTab: SettingTabId
  providerInitialTab: 'api' | 'router'
  editingHarnessId: string | null
  openSettings: (tab?: SettingTabId) => void
  closeSettings: () => void
  setSettingsTab: (tab: SettingTabId, category?: SettingSectionId) => void
  setEditingHarnessId: (id: string | null) => void

  // Plan tab controls
  planViewMode: 'plan' | 'diff'
  setPlanViewMode: (mode: 'plan' | 'diff') => void
  planSubTab: 'overview' | 'detailed'
  setPlanSubTab: (tab: 'overview' | 'detailed') => void
  showFeedbackBanner: boolean
  setShowFeedbackBanner: (show: boolean) => void

  // Autopilot toggle in chat bar
  autopilotEnabled: boolean
  setAutopilotEnabled: (enabled: boolean) => void

  // Command palette / Quick search
  searchOpen: boolean
  openSearch: () => void
  closeSearch: () => void

  // Email notifications (mock)
  userEmail: string
  setUserEmail: (email: string) => void
  notifyOnComplete: boolean
  setNotifyOnComplete: (enabled: boolean) => void
  completionEmail: CompletionEmail | null
  setCompletionEmail: (email: CompletionEmail | null) => void
}

export const MIN_SPLIT = 0.36
export const MAX_SPLIT = 0.64

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  accountMenuOpen: false,
  setAccountMenuOpen: (open) => set({ accountMenuOpen: open }),

  sessionTab: 'recent',
  setSessionTab: (tab) => set({ sessionTab: tab }),

  openTabs: [],
  activeTab: null,
  // Mở tab cũng là "đã tiêu thụ" mọi ý định đang xếp hàng cho tab đó: huy hiệu
  // tắt, và ngữ cảnh của ý định cuối cùng trở thành ngữ cảnh của lần mở này.
  openTab: (tab, target) =>
    set((s) => {
      const queued = s.pendingIntents.filter((intent) => intent.tab === tab)
      const queuedTarget = queued.length ? (queued[queued.length - 1].target ?? null) : null
      const nextTarget = target ?? queuedTarget
      const pendingIntents = s.pendingIntents.filter((intent) => intent.tab !== tab)
      return {
        openTabs: s.openTabs.includes(tab) ? s.openTabs : [...s.openTabs, tab],
        activeTab: tab,
        pendingIntents,
        tabIntentTargets: nextTarget
          ? { ...s.tabIntentTargets, [tab]: nextTarget }
          : s.tabIntentTargets,
      }
    }),
  closeTab: (tab) =>
    set((s) => {
      const openTabs = s.openTabs.filter((item) => item !== tab)
      const activeTab = s.activeTab === tab ? (openTabs[0] ?? null) : s.activeTab
      return {
        openTabs,
        activeTab,
        pinnedTab: s.pinnedTab === tab ? null : s.pinnedTab,
        panelFullscreen: openTabs.length ? s.panelFullscreen : false,
      }
    }),
  closePanel: () => set({ activeTab: null, panelFullscreen: false }),

  // ── Luật tự mở tab (hợp đồng §3). Thứ tự ba điều kiện là phần hợp đồng:
  // dừng ở điều kiện đầu tiên vi phạm và xếp hàng thay vì mở.
  pinnedTab: null,
  pinTab: (tab) => set({ pinnedTab: tab }),

  lastUserActivityAt: 0,
  noteUserActivity: () => set({ lastUserActivityAt: Date.now() }),

  autoOpenTabs: getInitialFlag(AUTO_OPEN_TABS_KEY, true),
  setAutoOpenTabs: (enabled) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AUTO_OPEN_TABS_KEY, String(enabled))
    set({ autoOpenTabs: enabled })
  },
  autoOpenOnlyWhenIdle: getInitialFlag(AUTO_OPEN_IDLE_ONLY_KEY, true),
  setAutoOpenOnlyWhenIdle: (enabled) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AUTO_OPEN_IDLE_ONLY_KEY, String(enabled))
    set({ autoOpenOnlyWhenIdle: enabled })
  },

  pendingIntents: [],
  requestTabIntent: (intent) => {
    const state = get()
    const queue = () => {
      set((s) => ({
        pendingIntents: [...s.pendingIntents, intent].slice(-MAX_PENDING_TAB_INTENTS),
      }))
      return 'queued' as const
    }
    if (!state.autoOpenTabs) return queue()
    if (state.pinnedTab === intent.tab) return queue()
    if (state.autoOpenOnlyWhenIdle && Date.now() - state.lastUserActivityAt < AUTO_OPEN_IDLE_MS) {
      return queue()
    }
    state.openTab(intent.tab, intent.target ?? null)
    return 'opened' as const
  },
  tabIntentTargets: {},

  planRevision: 0,
  bumpPlanRevision: () => set((s) => ({ planRevision: s.planRevision + 1 })),

  sessionScrollOffsets: {},
  rememberSessionScroll: (sessionId, offset) =>
    set((s) => ({ sessionScrollOffsets: { ...s.sessionScrollOffsets, [sessionId]: offset } })),

  panelFullscreen: false,
  toggleFullscreen: () => set((s) => ({ panelFullscreen: !s.panelFullscreen })),

  splitRatio: 0.46,
  setSplitRatio: (ratio) =>
    set({ splitRatio: Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio)) }),

  selectedFilePath: null,
  // Định tuyến lại: chọn file → mở tab Files (panel Workspace Files tiêu thụ
  // `selectedFilePath` rồi mở file đó, không mở song song cả tab IDE nữa).
  selectFile: (path) => {
    set({ selectedFilePath: path })
    get().openTab('files')
  },
  clearSelectedFile: () => set({ selectedFilePath: null }),

  ideLaunchUrl: null,
  openFileInIde: (filePath) => {
    set({ ideLaunchUrl: buildIdeUrl(import.meta.env, '', filePath) })
    get().openTab('ide')
  },

  sourceLabelId: null,
  openSource: (labelId) => set({ sourceLabelId: labelId }),
  closeSource: () => set({ sourceLabelId: null }),

  labelsTab: 'context',
  setLabelsTab: (tab) => set({ labelsTab: tab }),

  auditQuery: 'all',
  setAuditQuery: (query) => set({ auditQuery: query }),

  // Settings
  isSettingsOpen: false,
  settingsCategory: 'AGENTS',
  settingsTab: 'harness',
  providerInitialTab: 'router',
  editingHarnessId: null,
  openSettings: (tab = 'harness') =>
    set((s) => ({ isSettingsOpen: true, settingsTab: tab === 'llm_api_keys' || tab === 'router' ? 'provider' : tab, providerInitialTab: tab === 'llm_api_keys' ? 'api' : tab === 'router' ? 'router' : s.providerInitialTab, editingHarnessId: null })),
  closeSettings: () => set({ isSettingsOpen: false, editingHarnessId: null }),
  setSettingsTab: (tab, category) =>
    set((s) => ({
      settingsTab: tab === 'llm_api_keys' || tab === 'router' ? 'provider' : tab,
      providerInitialTab: tab === 'llm_api_keys' ? 'api' : tab === 'router' ? 'router' : s.providerInitialTab,
      settingsCategory: category ?? s.settingsCategory,
      editingHarnessId: null,
    })),
  setEditingHarnessId: (id) => set({ editingHarnessId: id }),

  // Plan
  planViewMode: 'plan',
  setPlanViewMode: (mode) => set({ planViewMode: mode }),
  planSubTab: 'overview',
  setPlanSubTab: (tab) => set({ planSubTab: tab }),
  showFeedbackBanner: true,
  setShowFeedbackBanner: (show) => set({ showFeedbackBanner: show }),

  // Theme
  theme: getInitialTheme(),
  setTheme: (theme) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('boxfox_theme', theme)
    }
    applyDomTheme(theme)
    set({ theme })
  },

  // Autopilot
  autopilotEnabled: true,
  setAutopilotEnabled: (enabled) => set({ autopilotEnabled: enabled }),

  // Search modal
  searchOpen: false,
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),

  // Email notifications (mock)
  userEmail: '',
  setUserEmail: (email) => set({ userEmail: email }),
  notifyOnComplete: false,
  setNotifyOnComplete: (enabled) => set({ notifyOnComplete: enabled }),
  completionEmail: null,
  setCompletionEmail: (completionEmail) => set({ completionEmail }),
}))
