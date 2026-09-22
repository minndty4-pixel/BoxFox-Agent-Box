import { useEffect, useState, useRef, useMemo } from 'react'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Cpu,
  Layers,
  Sparkles,
  Database,
  Terminal,
  ShieldCheck,
  X,
  Compass,
  Code2,
  Bug,
  Zap,
  Boxes,
  Workflow,
  Search,
} from 'lucide-react'
import { useHarnessStore, AVAILABLE_MODELS } from '../../store/harnessStore'
import { useSkillsStore } from '../../store/skillsStore'
import { useRouterStore } from '../../store/routerStore'
import { useRuntimeInfoStore } from '../../store/runtimeInfoStore'

export interface NodeDetails {
  title: string
  description: string
  role?: string
  modelAssigned?: string
  inheritedFrom?: string
  toolsAllowed?: string[]
  /** Engine chưa trả lời nên danh sách công cụ đang thiếu — nói thẳng thay vì bỏ trống. */
  toolsUnavailable?: boolean
  meta?: Record<string, string | undefined>
}

export interface FlowNode {
  id: string
  label: string
  category: 'context' | 'brain' | 'subagent' | 'skills' | 'tools' | 'memory'
  sublabel?: string
  badge?: string
  icon: React.ComponentType<{ className?: string }>
  x: number
  y: number
  color: string
  borderColor: string
  glowColor?: string
  phaseNumber?: number
  details?: NodeDetails
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  label?: string
  color?: string
  animated?: boolean
  style?: 'solid' | 'dashed'
}

export function HarnessFlowVisualizer() {
  const {
    harnesses,
    activeHarnessId,
    activeType,
    activeModelId,
    setActiveType,
    setActiveHarness,
    setActiveModel,
    getHarnessById,
  } = useHarnessStore()

  const skills = useSkillsStore((s) => s.skills)
  const activeSkills = useMemo(() => skills.filter((sk) => sk.enabled), [skills])
  const routerRoutes = useRouterStore((s) => s.routes)

  /**
   * Danh sách công cụ theo vai trò là dữ liệu thật của engine
   * (`GET /api/agent/runtime-info` → `roles[].tools`). Bản chép tay trước đây in ra
   * năm cái tên không hề tồn tại trong registry: file_multi_replace, diagram_generate,
   * dir_list, git_diff, read_url_content.
   */
  const runtimeInfo = useRuntimeInfoStore((s) => s.info)
  const loadRuntimeInfo = useRuntimeInfoStore((s) => s.load)
  useEffect(() => {
    void loadRuntimeInfo()
  }, [loadRuntimeInfo])

  const roleTools = useMemo(() => {
    const byRole = new Map((runtimeInfo?.roles ?? []).map((role) => [role.id, role.tools]))
    return (roleId: string) => byRole.get(roleId)
  }, [runtimeInfo])

  // Danh sách model hợp nhất từ Router và Available Models
  const allAvailableModels = useMemo(() => {
    const list: { id: string; name: string; provider: string }[] = []
    
    // Thêm các models Antigravity & Router đã kết nối
    for (const route of routerRoutes) {
      for (const m of route.models || []) {
        if (!list.some((item) => item.id === m.id)) {
          list.push({
            id: m.id,
            name: m.name || m.id,
            provider: route.displayName || route.sourceId,
          })
        }
      }
    }

    // Thêm các models tiêu chuẩn
    for (const m of AVAILABLE_MODELS) {
      if (!list.some((item) => item.id === m.id)) {
        list.push({ id: m.id, name: m.name, provider: m.provider })
      }
    }

    // Models Antigravity fallback
    const defaults = [
      { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash (High Reasoning)', provider: 'Antigravity' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Antigravity' },
      { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'Anthropic' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'DeepSeek' },
    ]
    for (const d of defaults) {
      if (!list.some((item) => item.id === d.id)) {
        list.push(d)
      }
    }

    return list
  }, [routerRoutes])

  // Lấy model name hiển thị đẹp
  const getModelDisplayName = (modelId: string) => {
    const found = allAvailableModels.find((m) => m.id === modelId)
    return found ? found.name : modelId
  }

  const activeHarness = useMemo(() => {
    return (
      getHarnessById(activeHarnessId) ??
      harnesses[0] ?? {
        id: 'default',
        name: 'Open Model Harness',
        description: 'Multi-step autonomous reasoning pipeline',
        isBuiltIn: true,
        mainModel: 'DeepSeek V4 Pro (Global) 1M High',
        subagents: [],
      }
    )
  }, [getHarnessById, activeHarnessId, harnesses])

  const isSingleModelMode = activeType === 'model'
  const activeSingleModelName = getModelDisplayName(activeModelId || 'gemini-3.6-flash-high')

  const [zoom, setZoom] = useState(0.85)
  const [pan, setPan] = useState({ x: 0, y: -20 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  // Zoom handlers
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, z + 0.15))
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, z - 0.15))
  const handleReset = () => {
    setZoom(0.85)
    setPan({ x: 0, y: -20 })
  }

  // Pan handlers
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.flow-node') || (e.target as HTMLElement).closest('.flow-controls') || (e.target as HTMLElement).closest('.flow-header')) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }

  const onMouseUp = () => setIsDragging(false)

  // Wheel zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.06 : 0.06
    setZoom((z) => Math.min(2.0, Math.max(0.4, z + delta)))
  }

  // Cấu trúc 4 Tầng Pipeline Nodes chuẩn Hermes & BoxFox
  const nodes: FlowNode[] = useMemo(() => {
    const effectiveMainModel = isSingleModelMode
      ? activeSingleModelName
      : activeHarness.mainModel === 'default'
      ? 'Claude 3.7 Sonnet / Antigravity'
      : activeHarness.mainModel

    // Model được gán cho các Subagents
    const getSubagentModel = (subagentModel?: string) => {
      if (isSingleModelMode) {
        return activeSingleModelName
      }
      if (!subagentModel || subagentModel === 'inherit' || subagentModel === 'default') {
        return `Inherit: ${effectiveMainModel}`
      }
      return subagentModel
    }

    return [
      // ==========================================
      // TẦNG 1 (Top: y = -240): 3-Tier Context Engine
      // ==========================================
      {
        id: 'context-engine',
        label: '3-Tier Context Engine',
        category: 'context',
        sublabel: 'Hierarchical Prompt Caching & Grounding',
        badge: 'Tier 1 • Tier 2 • Tier 3',
        icon: Layers,
        x: 0,
        y: -240,
        color: '#38bdf8',
        borderColor: '#0284c7',
        glowColor: 'rgba(56, 189, 248, 0.25)',
        details: {
          title: '3-Tier Context Engine (Prompt Hierarchical Caching)',
          role: 'Context Layer Manager',
          description:
            'Quản lý ngữ cảnh phân tầng nhằm tối ưu hoá 100% tỷ lệ prompt-caching LLM và cung cấp nền tảng grounding sandbox thời gian thực.',
          meta: {
            'Tier 1 (Stable)': 'Identity, Coding Principles & Anti-Loop Constraints (Bất biến)',
            'Tier 2 (Environment)': 'OS Windows, Workspace Directory Snapshot & Git Status (Bền vững)',
            'Tier 3 (Dynamic)': 'User Goal, Active Skills Injected & Current Subagent Lineage (Biến động)',
            'Active Skills Injected': `${activeSkills.length} disciplines enabled`,
          },
        },
      },

      // ==========================================
      // TẦNG 2 (Middle-Top: y = -80): Orchestrator Brain
      // ==========================================
      {
        id: 'orchestrator-brain',
        label: 'Orchestrator Brain',
        category: 'brain',
        sublabel: effectiveMainModel,
        badge: isSingleModelMode ? 'Single Model Mode (Active)' : 'Harness Orchestrator',
        icon: Cpu,
        x: 0,
        y: -80,
        color: '#f97316',
        borderColor: '#fb923c',
        glowColor: 'rgba(249, 115, 22, 0.35)',
        details: {
          title: `Orchestrator Brain (${isSingleModelMode ? 'Single Model Mode' : activeHarness.name})`,
          role: 'Central Dispatcher & Task Decomposition',
          modelAssigned: effectiveMainModel,
          inheritedFrom: isSingleModelMode ? 'User Single Model Selection' : 'Harness Architecture Config',
          description:
            'Bộ não trung tâm phụ trách lập luận multi-step, tự sửa sai (self-correction feedback), phân rã nhiệm vụ và điều phối các Subagents chuyên biệt.',
          meta: {
            'Selected Model': effectiveMainModel,
            'Execution Engine': 'Hermes Cognitive Core Loop (Async Tool Delegation)',
            'Anti-Loop Guard': 'Active (Ngăn lặp vô hạn lệnh và recursive tools)',
            'Child Subagents Count': '5 Primary Phases + Specialized Roles',
            'Status': isSingleModelMode ? 'Direct Override Active' : 'Multi-Agent Topology Active',
          },
        },
      },

      // ==========================================
      // TẦNG 3 (Pipeline Row: y = 80): 5-Phase Subagents
      // ==========================================
      // Phase 1: Explore
      {
        id: 'subagent-explore',
        label: '1. Explore',
        category: 'subagent',
        phaseNumber: 1,
        sublabel: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'explore')?.model),
        badge: isSingleModelMode ? 'Single Override' : 'Read-Only Sandbox',
        icon: Compass,
        x: -420,
        y: 80,
        color: '#38bdf8',
        borderColor: '#0284c7',
        details: {
          title: 'Explore Specialist (Phase 1)',
          role: 'Khảo sát và Ánh xạ cấu trúc Codebase',
          modelAssigned: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'explore')?.model),
          description:
            'Chuyên trách tìm kiếm file, grep code, lập chỉ mục kiến trúc dự án và cung cấp snapshot tài nguyên cho Orchestrator mà không được sửa code.',
          toolsAllowed: roleTools('explore'),
          toolsUnavailable: roleTools('explore') === undefined,
          meta: {
            'Sandboxed Permissions': 'Strictly Read-Only (Không có quyền file_write / edit)',
            'Execution Target': 'Map and discover patterns, locate symbols and schema definitions',
          },
        },
      },

      // Phase 2: Plan & Design
      {
        id: 'subagent-plan',
        label: '2. Plan & Design',
        category: 'subagent',
        phaseNumber: 2,
        sublabel: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'plan')?.model),
        badge: isSingleModelMode ? 'Single Override' : 'Architecture Design',
        icon: Workflow,
        x: -210,
        y: 80,
        color: '#a855f7',
        borderColor: '#9333ea',
        details: {
          title: 'Plan & Design Specialist (Phase 2)',
          role: 'Thiết kế Kiến trúc & Lập Kế hoạch Thực thi',
          modelAssigned: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'plan')?.model),
          description:
            'Phân tích rủi ro, vạch ra các bước thực hiện chi tiết, định nghĩa các interfaces và ranh giới an toàn trước khi viết bất kỳ dòng mã nào.',
          toolsAllowed: roleTools('plan'),
          toolsUnavailable: roleTools('plan') === undefined,
          meta: {
            'Discipline': 'Spec-Driven Development & Accidental Data Loss Prevention',
            'Output Format': 'Structured Markdown Implementation Plan & Verification Matrix',
          },
        },
      },

      // Phase 3: Build & Code
      {
        id: 'subagent-build',
        label: '3. Build & Code',
        category: 'subagent',
        phaseNumber: 3,
        sublabel: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'build')?.model),
        badge: isSingleModelMode ? 'Single Override' : 'Full File Edit',
        icon: Code2,
        x: 0,
        y: 80,
        color: '#10b981',
        borderColor: '#059669',
        glowColor: 'rgba(16, 185, 129, 0.25)',
        details: {
          title: 'Build & Code Specialist (Phase 3)',
          role: 'Lập trình & Hiện thực hóa Mã nguồn',
          modelAssigned: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'build')?.model),
          description:
            'Chuyên tâm sinh code chất lượng cao, thực thi chỉnh sửa chính xác từng khối nội dung file mà không làm mất comment hay phá vỡ cấu trúc.',
          toolsAllowed: roleTools('build'),
          toolsUnavailable: roleTools('build') === undefined,
          meta: {
            'Discipline': 'Strict Typescript / Python Best Practices, No Ad-hoc Utilities',
            'Modification Guard': 'Preserve unrelated docstrings and adhere to project standards',
          },
        },
      },

      // Phase 4: Testing & Debug
      {
        id: 'subagent-testing',
        label: '4. Testing & Debug',
        category: 'subagent',
        phaseNumber: 4,
        sublabel: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'testing')?.model),
        badge: isSingleModelMode ? 'Single Override' : 'Sandbox Execution',
        icon: Bug,
        x: 210,
        y: 80,
        color: '#eab308',
        borderColor: '#ca8a04',
        details: {
          title: 'Testing & Debug Specialist (Phase 4)',
          role: 'Chạy Thử nghiệm & Chẩn đoán Lỗi',
          modelAssigned: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'testing')?.model),
          description:
            'Thực thi các lệnh test (Vitest, Pytest), phân tích log lỗi, cô lập nguyên nhân gốc rễ và xác thực hành vi của hệ thống trong môi trường sandbox.',
          toolsAllowed: roleTools('testing'),
          toolsUnavailable: roleTools('testing') === undefined,
          meta: {
            'Verification Pipeline': 'Unit Tests, Typecheck, Diagnostics & Visual Inspection',
            'Environment': 'Dockerized Sandbox / Local Isolated Runtime',
          },
        },
      },

      // Phase 5: Review & Simplify
      {
        id: 'subagent-review',
        label: '5. Review & Verify',
        category: 'subagent',
        phaseNumber: 5,
        sublabel: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'review')?.model),
        badge: isSingleModelMode ? 'Single Override' : 'Quality Gate',
        icon: ShieldCheck,
        x: 420,
        y: 80,
        color: '#ec4899',
        borderColor: '#db2777',
        details: {
          title: 'Review & Verify Specialist (Phase 5)',
          role: 'Thẩm định Chất lượng & Cổng Kiểm soát An toàn',
          modelAssigned: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'review')?.model),
          description:
            'Rà soát mã nguồn lần cuối, đối chiếu diff với yêu cầu ban đầu của người dùng, phát hiện lỗ hổng bảo mật và tối giản hóa logic dư thừa.',
          toolsAllowed: roleTools('review'),
          toolsUnavailable: roleTools('review') === undefined,
          meta: {
            'Quality Standards': 'Clean Code, Performance, Security Boundary Validation',
            'Sign-off Gate': 'Final Pass / Fail Verdict before User Delivery',
          },
        },
      },

      // Specialized Subagent: Research & Docs (Branch node)
      {
        id: 'subagent-research',
        label: 'Deep Research',
        category: 'subagent',
        sublabel: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'research')?.model),
        badge: isSingleModelMode ? 'Single Override' : 'Doc Intelligence',
        icon: Search,
        x: -210,
        y: 170,
        color: '#06b6d4',
        borderColor: '#0891b2',
        details: {
          title: 'Deep Research Specialist',
          role: 'Tra cứu Tài liệu & Phân tích Giải thuật',
          modelAssigned: getSubagentModel(activeHarness.subagents?.find((s) => s.id === 'research')?.model),
          description:
            'Hỗ trợ tra cứu nhanh tài liệu API bên ngoài, tổng hợp kiến thức chuyên ngành và phân tích các trường hợp ngoại lệ phức tạp.',
          toolsAllowed: roleTools('research'),
          toolsUnavailable: roleTools('research') === undefined,
          meta: {
            'Scope': 'External SDKs, Standard Specs, Protocol References',
          },
        },
      },

      // ==========================================
      // TẦNG 4 (Bottom Infrastructure: y = 290)
      // ==========================================
      // Khối Trái: Skills Pool
      {
        id: 'skills-pool',
        label: 'Active Skills Pool',
        category: 'skills',
        sublabel: `${activeSkills.length} Hermes Disciplines Injected`,
        badge: `${activeSkills.length} Skills`,
        icon: Sparkles,
        x: -330,
        y: 290,
        color: '#06b6d4',
        borderColor: '#0891b2',
        details: {
          title: 'Active Hermes & Antigravity Skills Pool',
          role: 'Specialized Prompt Disciplines',
          description:
            'Các bộ quy chuẩn và kỹ năng chuyên sâu được nạp động vào Tier 3 Context để định hướng tác phong làm việc của các subagents.',
          meta: {
            'Active Count': `${activeSkills.length} skills active`,
            'Selected Skills': activeSkills.map((s) => s.name).join(', ') || 'None',
            'Injection Timing': 'Loaded dynamically on session start and turn dispatch',
          },
        },
      },

      // Khối Giữa: Memory Ledger
      {
        id: 'memory-ledger',
        label: 'Memory Ledger',
        category: 'memory',
        sublabel: 'SQLite Durable Turns & Lineage',
        badge: 'Durable Storage',
        icon: Database,
        x: 0,
        y: 290,
        color: '#6366f1',
        borderColor: '#4f46e5',
        details: {
          title: 'Multi-Turn Memory Ledger (SQLite & Checkpoints)',
          role: 'Durable State & Lineage Persistence',
          description:
            'Lưu trữ toàn bộ lịch sử hội thoại, sự kiện công cụ, dấu vết phân rã subagent và checkpoint phục hồi sau khi restart.',
          meta: {
            'Storage Backend': 'SQLite Database (Durable Tables)',
            'Persistence Scope': 'Sessions, Turns, Tool Invocations, Subagent Spawns',
            'Recovery Guarantee': 'Durable Lineage Tracking & Auto Compaction',
          },
        },
      },

      // Khối Phải: Core Tools Suite
      {
        id: 'tools-suite',
        label: 'Core Tools Suite',
        category: 'tools',
        sublabel: 'Docker Sandbox, Browser & Computer Use',
        badge: 'Sandbox APIs',
        icon: Terminal,
        x: 330,
        y: 290,
        color: '#14b8a6',
        borderColor: '#0d9488',
        details: {
          title: 'Core Tools Suite & Execution Runtimes',
          role: 'Sandboxed Tool Providers',
          description:
            'Hệ thống công cụ thực thi mạnh mẽ được cách ly trong sandbox Docker và bảo vệ bằng cơ chế phân quyền theo vai trò.',
          meta: {
            'Code & Files': 'file_read, file_write, file_edit_block, codebase_grep, codebase_glob',
            'Terminal & OS': 'terminal_exec inside isolated Docker container',
            'Media & Browser': 'browser_use, computer_screen_capture, computer_use',
          },
        },
      },
    ]
  }, [
    isSingleModelMode,
    activeSingleModelName,
    activeHarness,
    activeSkills,
    roleTools,
  ])

  // Định nghĩa các đường luồng kết nối có hướng (Directed Flow Edges)
  const edges: FlowEdge[] = useMemo(() => {
    return [
      // 1. Context Engine -> Brain (Luồng nạp ngữ cảnh)
      { id: 'e-ctx-brain', from: 'context-engine', to: 'orchestrator-brain', label: 'Hierarchical Context Injection', color: '#38bdf8', animated: true },

      // 2. Brain -> Subagents (Luồng phân rã nhiệm vụ)
      { id: 'e-brain-explore', from: 'orchestrator-brain', to: 'subagent-explore', label: '1. Map Codebase', color: '#f97316', animated: true },
      { id: 'e-brain-plan', from: 'orchestrator-brain', to: 'subagent-plan', label: '2. Architecture Plan', color: '#f97316', animated: true },
      { id: 'e-brain-build', from: 'orchestrator-brain', to: 'subagent-build', label: '3. Delegate Code', color: '#f97316', animated: true },
      { id: 'e-brain-testing', from: 'orchestrator-brain', to: 'subagent-testing', label: '4. Verify & Test', color: '#f97316', animated: true },
      { id: 'e-brain-review', from: 'orchestrator-brain', to: 'subagent-review', label: '5. Quality Gate', color: '#f97316', animated: true },
      { id: 'e-brain-research', from: 'orchestrator-brain', to: 'subagent-research', label: 'Research Query', color: '#06b6d4', style: 'dashed' },

      // 3. Chuỗi Pipeline tuần tự giữa các Subagents (Left-to-Right Sequential Flow)
      { id: 'e-sub-1-2', from: 'subagent-explore', to: 'subagent-plan', label: 'Codebase Spec', color: '#38bdf8', animated: true },
      { id: 'e-sub-2-3', from: 'subagent-plan', to: 'subagent-build', label: 'Plan & Contracts', color: '#a855f7', animated: true },
      { id: 'e-sub-3-4', from: 'subagent-build', to: 'subagent-testing', label: 'Target Code', color: '#10b981', animated: true },
      { id: 'e-sub-4-5', from: 'subagent-testing', to: 'subagent-review', label: 'Test Report', color: '#eab308', animated: true },

      // 4. Hạ tầng kết nối (Tầng 4)
      { id: 'e-skills-ctx', from: 'skills-pool', to: 'context-engine', label: 'Inject Skills', color: '#06b6d4', style: 'dashed' },
      { id: 'e-brain-mem', from: 'orchestrator-brain', to: 'memory-ledger', label: 'State Sync & Checkpoints', color: '#6366f1', animated: true },
      { id: 'e-tools-sub', from: 'tools-suite', to: 'subagent-build', label: 'Execute Sandbox Tools', color: '#14b8a6', animated: true },
      { id: 'e-tools-test', from: 'tools-suite', to: 'subagent-testing', label: 'Run Vitest / Shell', color: '#14b8a6', animated: true },
    ]
  }, [])

  // Map vị trí của các Nodes để vẽ SVG edges chính xác
  const nodeMap = useMemo(() => {
    const map = new Map<string, FlowNode>()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  return (
    <div className="relative flex h-[680px] w-full flex-col overflow-hidden rounded-xl border border-line bg-[#0a0b0e] select-none shadow-2xl">
      {/* Background Dot Grid */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#64748b 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Top Header Interactive Toolbar & Status Overlay */}
      <div className="flow-header absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-auto">
        {/* Left: Mode Title & Realtime Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/90 px-3.5 py-2 backdrop-blur-md shadow-lg">
            <div className="size-2.5 rounded-full bg-emerald-500 animate-pulse ring-4 ring-emerald-500/20" />
            <span className="text-xs font-bold text-fg tracking-tight">BoxFox Topology Flow</span>
            <span className="text-xs text-muted/60">|</span>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted text-[11px]">Mode:</span>
              <span
                className={`font-semibold font-mono text-[11px] px-2 py-0.5 rounded-md border ${
                  isSingleModelMode
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-brand/40 bg-brand/10 text-brand'
                }`}
              >
                {isSingleModelMode ? 'Single Model Mode' : 'Multi-Agent Harness'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Quick Switcher Bar (Realtime Model Sync) */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2/90 p-1 backdrop-blur-md shadow-lg">
          {/* Toggle Harness vs Single Model */}
          <button
            type="button"
            onClick={() => setActiveType('harness')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
              !isSingleModelMode
                ? 'bg-brand text-brandfg shadow-sm'
                : 'text-muted hover:text-fg'
            }`}
          >
            <Boxes className="size-3.5" />
            <span>Harness Topology</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveType('model')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
              isSingleModelMode
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-muted hover:text-fg'
            }`}
          >
            <Zap className="size-3.5" />
            <span>Single Model</span>
          </button>

          {/* Dynamic Selector based on activeType */}
          <div className="h-4 w-px bg-line mx-1" />

          {isSingleModelMode ? (
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-[11px] font-medium text-muted">Active Model:</span>
              <select
                value={activeModelId}
                onChange={(e) => setActiveModel(e.target.value)}
                className="appearance-none rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-mono font-medium text-emerald-400 outline-none hover:border-emerald-500/60 focus:border-emerald-500 cursor-pointer max-w-[200px] truncate"
              >
                {allAvailableModels.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#16181d] text-fg">
                    {m.name} ({m.provider})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-[11px] font-medium text-muted">Harness:</span>
              <select
                value={activeHarnessId}
                onChange={(e) => setActiveHarness(e.target.value)}
                className="appearance-none rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-semibold text-brand outline-none hover:border-brand/60 focus:border-brand cursor-pointer max-w-[200px] truncate"
              >
                {harnesses.map((h) => (
                  <option key={h.id} value={h.id} className="bg-[#16181d] text-fg">
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Interactive Drag & Zoom Canvas */}
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        className="relative flex-1 cursor-grab active:cursor-grabbing overflow-hidden"
      >
        <div
          className="absolute left-1/2 top-1/2 transition-transform duration-75 origin-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* SVG Connection Lines with Animated Flow & Markers */}
          <svg className="absolute -left-[800px] -top-[500px] w-[1600px] h-[1000px] pointer-events-none overflow-visible">
            <defs>
              {/* Directed Arrowhead Marker */}
              <marker
                id="flow-arrow-brand"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f97316" opacity={0.8} />
              </marker>
              <marker
                id="flow-arrow-cyan"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#38bdf8" opacity={0.8} />
              </marker>
              <marker
                id="flow-arrow-emerald"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" opacity={0.8} />
              </marker>
            </defs>

            {edges.map((edge) => {
              const fromNode = nodeMap.get(edge.from)
              const toNode = nodeMap.get(edge.to)
              if (!fromNode || !toNode) return null

              const sx = fromNode.x + 800
              const sy = fromNode.y + 500
              const ex = toNode.x + 800
              const ey = toNode.y + 500

              // Tính toán đường cong Bezier mềm mại theo hướng dòng chảy
              const dx = ex - sx
              const dy = ey - sy
              const isHorizontal = Math.abs(dx) > Math.abs(dy)

              let pathData = ''
              if (isHorizontal && Math.abs(dy) < 50) {
                // Đường ngang thẳng hoặc cong nhẹ giữa các subagents
                const cx = (sx + ex) / 2
                pathData = `M ${sx} ${sy} C ${cx} ${sy - 15}, ${cx} ${ey - 15}, ${ex} ${ey}`
              } else {
                // Đường dọc Top-to-Bottom
                const cy = (sy + ey) / 2
                pathData = `M ${sx} ${sy} C ${sx} ${cy}, ${ex} ${cy}, ${ex} ${ey}`
              }

              const isSelected =
                selectedNode?.id === fromNode.id || selectedNode?.id === toNode.id
              const edgeColor = isSelected ? '#fb923c' : edge.color || '#475569'

              return (
                <g key={edge.id} className="transition-opacity duration-200">
                  {/* Đường bóng mờ phía sau */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#000000"
                    strokeWidth={isSelected ? 5 : 3.5}
                    strokeOpacity={0.7}
                  />

                  {/* Đường nối chính với màu sắc và animation */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={edgeColor}
                    strokeWidth={isSelected ? 2.5 : 1.8}
                    strokeDasharray={
                      edge.style === 'dashed'
                        ? '5 4'
                        : edge.animated
                        ? '6 4'
                        : undefined
                    }
                    strokeOpacity={isSelected ? 1 : 0.65}
                    className={edge.animated ? 'animate-[dash_20s_linear_infinite]' : ''}
                    markerEnd={`url(#flow-arrow-${
                      edgeColor === '#38bdf8' ? 'cyan' : edgeColor === '#10b981' ? 'emerald' : 'brand'
                    })`}
                  />
                </g>
              )
            })}
          </svg>

          {/* Render Nodes */}
          {nodes.map((node) => {
            const Icon = node.icon
            const isBrain = node.category === 'brain'
            const isContext = node.category === 'context'
            const isSelected = selectedNode?.id === node.id

            return (
              <div
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedNode(node)
                }}
                className={`flow-node absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-150 cursor-pointer ${
                  isBrain ? 'z-30' : isContext ? 'z-25' : 'z-20'
                }`}
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
              >
                <div
                  className={`group relative flex flex-col rounded-xl border p-3 backdrop-blur-md transition-all shadow-xl ${
                    isSelected
                      ? 'ring-2 ring-brand scale-105 bg-[#1a1d24]'
                      : 'hover:scale-105 hover:border-brand/70 bg-[#12141a]'
                  } ${isBrain ? 'min-w-[240px]' : 'min-w-[170px]'}`}
                  style={{
                    borderColor: isSelected
                      ? node.borderColor
                      : isBrain
                      ? isSingleModelMode
                        ? '#10b981'
                        : '#f97316'
                      : '#262933',
                    boxShadow: isBrain
                      ? `0 0 25px ${node.glowColor || 'rgba(249, 115, 22, 0.2)'}`
                      : undefined,
                  }}
                >
                  {/* Top Bar: Icon + Label + Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex size-7 items-center justify-center rounded-lg border p-1 shrink-0"
                        style={{
                          borderColor: `${node.borderColor}50`,
                          backgroundColor: `${node.color}1c`,
                          color: node.color,
                        }}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="flex flex-col text-left">
                        <span
                          className={`font-bold tracking-tight text-fg ${
                            isBrain ? 'text-xs' : 'text-[11px]'
                          }`}
                        >
                          {node.label}
                        </span>
                      </div>
                    </div>

                    {node.badge && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider shrink-0 ${
                          isSingleModelMode && isBrain
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-panel2 text-muted border border-line'
                        }`}
                      >
                        {node.badge}
                      </span>
                    )}
                  </div>

                  {/* Sublabel / Model Name with Realtime indicator */}
                  {node.sublabel && (
                    <div className="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-1.5 text-left">
                      {isBrain && (
                        <div
                          className={`size-1.5 rounded-full ${
                            isSingleModelMode ? 'bg-emerald-400' : 'bg-brand'
                          } animate-pulse`}
                        />
                      )}
                      <span
                        className={`text-[10px] font-mono truncate ${
                          isSingleModelMode && (isBrain || node.category === 'subagent')
                            ? 'text-emerald-400 font-medium'
                            : 'text-muted'
                        }`}
                        title={node.sublabel}
                      >
                        {node.sublabel}
                      </span>
                    </div>
                  )}

                  {/* Phase number indicator for Subagents */}
                  {node.phaseNumber && (
                    <div className="absolute -top-2 -left-2 flex size-4 items-center justify-center rounded-full bg-panel border border-line text-[9px] font-mono text-muted font-bold shadow-sm">
                      {node.phaseNumber}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Floating Bottom-Left Zoom / Pan Toolbar */}
      <div className="flow-controls absolute bottom-4 left-4 z-20 flex items-center gap-1 rounded-lg border border-line bg-panel2/90 p-1 backdrop-blur-md shadow-lg">
        <button
          type="button"
          onClick={handleZoomIn}
          title="Zoom In"
          className="rounded p-1.5 text-muted hover:bg-panel hover:text-fg transition cursor-pointer"
        >
          <ZoomIn className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          title="Zoom Out"
          className="rounded p-1.5 text-muted hover:bg-panel hover:text-fg transition cursor-pointer"
        >
          <ZoomOut className="size-3.5" />
        </button>
        <div className="h-4 w-px bg-line" />
        <button
          type="button"
          onClick={handleReset}
          title="Reset View"
          className="rounded p-1.5 text-muted hover:bg-panel hover:text-fg transition cursor-pointer"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <span className="px-1.5 text-[10px] font-mono text-muted">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Bottom Right Legend Indicator */}
      <div className="absolute bottom-4 right-4 z-20 hidden md:flex items-center gap-4 rounded-lg border border-line bg-panel/90 px-3.5 py-1.5 backdrop-blur-md shadow-lg text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#38bdf8]" />
          <span>Context & Explore</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#f97316]" />
          <span>Orchestrator Brain</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#10b981]" />
          <span>Build & Code</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#ec4899]" />
          <span>Review Gate</span>
        </div>
      </div>

      {/* Selected Node Details Side Drawer */}
      {selectedNode && (
        <div className="absolute right-4 top-16 bottom-4 z-30 w-84 rounded-xl border border-line bg-panel/95 p-5 shadow-2xl backdrop-blur-xl overflow-y-auto space-y-4 animate-in slide-in-from-right-4 duration-150">
          <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <div
                className="flex size-8 items-center justify-center rounded-lg border p-1"
                style={{
                  borderColor: `${selectedNode.borderColor}50`,
                  backgroundColor: `${selectedNode.color}20`,
                  color: selectedNode.color,
                }}
              >
                <selectedNode.icon className="size-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-fg">{selectedNode.label}</h3>
                {selectedNode.details?.role && (
                  <span className="text-[10px] text-muted font-medium block">
                    {selectedNode.details.role}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="rounded p-1 text-muted hover:bg-panel2 hover:text-fg transition cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          {selectedNode.details && (
            <div className="space-y-3.5 text-xs">
              {/* Description */}
              <div>
                <span className="text-[10px] font-bold text-brand uppercase tracking-wider">
                  Mô Tả & Trách Nhiệm
                </span>
                <p className="mt-1 text-muted leading-relaxed text-[11px]">
                  {selectedNode.details.description}
                </p>
              </div>

              {/* Model Assignment Info */}
              {selectedNode.details.modelAssigned && (
                <div className="rounded-lg border border-line bg-panel2 p-2.5 space-y-1">
                  <span className="text-[10px] font-semibold text-muted uppercase block">
                    Model Được Gán
                  </span>
                  <span className="text-xs font-mono font-semibold text-emerald-400 block break-words">
                    {selectedNode.details.modelAssigned}
                  </span>
                  {selectedNode.details.inheritedFrom && (
                    <span className="text-[10px] text-muted/80 block">
                      Nguồn: {selectedNode.details.inheritedFrom}
                    </span>
                  )}
                </div>
              )}

              {/* Tools Allowed */}
              {(selectedNode.details.toolsAllowed || selectedNode.details.toolsUnavailable) && (
                <div className="space-y-1.5 border-t border-line pt-3">
                  <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                    Tools Được Phép Thực Thi
                  </span>
                  {(selectedNode.details.toolsAllowed?.length ?? 0) > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(selectedNode.details.toolsAllowed ?? []).map((t) => (
                        <span
                          key={t}
                          className="rounded border border-line bg-panel2 px-2 py-0.5 text-[10px] font-mono text-cyan-400"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted">
                      Danh sách công cụ đang unavailable — engine chưa trả lời. Sơ đồ không đoán tên công cụ.
                    </p>
                  )}
                </div>
              )}

              {/* Meta Specifications */}
              {selectedNode.details.meta && (
                <div className="space-y-2 border-t border-line pt-3">
                  <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                    Thông Số Kỹ Thuật
                  </span>
                  {Object.entries(selectedNode.details.meta).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-line bg-panel2 p-2">
                      <span className="text-[10px] font-semibold text-muted uppercase block">
                        {key}
                      </span>
                      <span className="text-[11px] font-medium text-fg break-words">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
