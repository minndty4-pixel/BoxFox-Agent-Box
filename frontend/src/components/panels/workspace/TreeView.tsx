/**
 * Chế độ Tree — cây lồng nhau với vạch lùi (border-l từng cấp), chevron xoay khi
 * mở, và huy hiệu provenance cho file (dùng badge của `LabelDot`). Khóa React ổn
 * định theo `path` để giữ cuộn. Nạp con lười qua `onExpand`.
 *
 * Ngoài ra: hàng đang chạy thao tác ghi thì bị khoá (`pendingPaths`), hàng đang
 * đổi tên hiện ô nhập tại chỗ, và thư mục nhận thả để DI CHUYỂN entry vào trong.
 */
import { ChevronRight } from 'lucide-react'
import { useState, type DragEvent, type MouseEvent } from 'react'
import { useT } from '../../../i18n/context'
import { extOf, languageForExt } from '../../../lib/workspace'
import { flattenVisible, type TreeData, type WorkspaceTree } from '../../../lib/workspace/tree'
import type { WorkspaceEntry } from '../../../lib/workspace'
import { acceptsPathDrop, draggedPath, startPathDrag } from './DragDrop'
import { EntryLabelBadges, RenameInput, entryIcon } from './entryView'

const EMPTY_PENDING: ReadonlySet<string> = new Set()
const EMPTY_ERRORS: ReadonlyMap<string, string> = new Map()

interface TreeViewProps {
  tree: WorkspaceTree[]
  expanded: ReadonlySet<string>
  selected: ReadonlySet<string>
  onExpand: (path: string) => void
  onOpen: (path: string) => void
  onToggleSelect: (path: string, additive: boolean) => void
  onSelectRange: (path: string) => void
  onContextMenu: (entry: WorkspaceEntry, x: number, y: number) => void
  /** Chuột phải trên vùng trống (kể cả thư mục rỗng) → tạo mới trong `cwd`. */
  onContextMenuBackground?: (x: number, y: number) => void
  error: string | null
  /** Hàng đang có thao tác ghi chạy — khoá tương tác trên hàng đó. */
  pendingPaths?: ReadonlySet<string>
  /** Lỗi của thao tác ghi gần nhất theo từng mục — hiện qua tooltip của hàng. */
  entryErrors?: ReadonlyMap<string, string>
  /** Đường dẫn đang đổi tên tại chỗ (ô nhập thay cho tên). */
  renamingPath?: string | null
  onRenameCommit?: (path: string, name: string) => void
  onRenameCancel?: () => void
  /** Thả một entry đang kéo vào thư mục `destination`. */
  onMove?: (path: string, destination: string) => void
}

/** Đọc trường hiển thị từ TreeData (WorkspaceEntry hoặc FileNode). */
function readEntry(node: TreeData): WorkspaceEntry {
  if ('ext' in node) return node as WorkspaceEntry
  const ext = node.kind === 'file' ? extOf(node.name) : null
  return {
    name: node.name,
    kind: node.kind,
    sizeBytes: 0,
    mtime: '',
    integrity: node.integrity ?? null,
    confidentiality: node.confidentiality ?? null,
    ext,
    language: node.kind === 'file' ? languageForExt(ext) : null,
  }
}

export function TreeView({
  tree,
  expanded,
  selected,
  onExpand,
  onOpen,
  onToggleSelect,
  onSelectRange,
  onContextMenu,
  onContextMenuBackground,
  error,
  pendingPaths = EMPTY_PENDING,
  entryErrors = EMPTY_ERRORS,
  renamingPath = null,
  onRenameCommit,
  onRenameCancel,
  onMove,
}: TreeViewProps) {
  const t = useT()
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const flat = flattenVisible(tree)

  const handleActivate = (e: MouseEvent, path: string, isDir: boolean) => {
    const additive = e.metaKey || e.ctrlKey
    if (e.shiftKey) {
      onSelectRange(path)
      return
    }
    if (isDir) {
      if (additive) onToggleSelect(path, true)
      else onExpand(path)
      return
    }
    if (additive) onToggleSelect(path, true)
    else onToggleSelect(path, false)
    onOpen(path)
  }

  const handleContext = (e: MouseEvent, entry: WorkspaceEntry) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(entry, e.clientX, e.clientY)
  }

  // Vùng trống của cây (hàng không có entry nào ở dưới con trỏ).
  const handleBackgroundContext = (e: MouseEvent) => {
    if (!onContextMenuBackground) return
    e.preventDefault()
    onContextMenuBackground(e.clientX, e.clientY)
  }

  const handleDragOver = (e: DragEvent<HTMLElement>, destination: string) => {
    if (!acceptsPathDrop(e, destination)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(destination)
  }

  const handleDrop = (e: DragEvent<HTMLElement>, destination: string) => {
    setDropTarget(null)
    if (!acceptsPathDrop(e, destination)) return
    e.preventDefault()
    onMove?.(draggedPath(e), destination)
  }

  if (error) {
    return (
      <div
        onContextMenu={handleBackgroundContext}
        className="flex h-full items-center justify-center p-6 text-[12px] text-amber-400"
      >
        {t('workspace.error')}
      </div>
    )
  }
  if (flat.length === 0) {
    return (
      <div
        onContextMenu={handleBackgroundContext}
        className="flex h-full items-center justify-center text-[12px] text-muted"
      >
        {t('workspace.empty')}
      </div>
    )
  }

  return (
    <div onContextMenu={handleBackgroundContext} className="h-full overflow-auto p-1.5">
      {flat.map(({ node, depth }) => {
        const entry = readEntry(node.node)
        const isDir = entry.kind === 'dir'
        const isOpen = expanded.has(node.path)
        const { Icon, className: iconClass } = entryIcon(entry)
        const isPending = pendingPaths.has(node.path)
        const entryError = entryErrors.get(node.path)
        const isRenaming = renamingPath === node.path
        const rowClass = `flex flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-left text-[12px] transition ${
          selected.has(node.path) ? 'bg-brand/15 text-fg ring-1 ring-brand/40' : 'text-fg hover:bg-panel2'
        }${dropTarget === node.path ? ' ring-1 ring-brand/40' : ''}${isPending ? ' opacity-60' : ''}`
        const body = (
          <>
            {isDir ? (
              <ChevronRight
                className={`size-3.5 shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <Icon className={`size-3.5 shrink-0 ${iconClass}`} />
            {isRenaming ? (
              <RenameInput
                initialValue={entry.name}
                ariaLabel={t('workspace.renameAria')}
                onCommit={(name) => onRenameCommit?.(node.path, name)}
                onCancel={() => onRenameCancel?.()}
                className="font-mono text-[12px]"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
            )}
            <EntryLabelBadges entry={entry} className="ml-auto" />
          </>
        )
        return (
          <div key={node.path} className="flex items-stretch">
            {Array.from({ length: depth }).map((_, i) => (
              <span key={i} className="w-4 shrink-0 border-l border-line" aria-hidden="true" />
            ))}
            {isRenaming ? (
              // Không lồng <input> trong <button>; đổi sang div giữ nguyên lớp CSS.
              <div role="group" className={rowClass}>
                {body}
              </div>
            ) : (
              <button
                type="button"
                disabled={isPending}
                title={entryError}
                draggable
                onDragStart={(e) => startPathDrag(e, node.path)}
                onDragOver={isDir ? (e) => handleDragOver(e, node.path) : undefined}
                onDragLeave={isDir ? () => setDropTarget(null) : undefined}
                onDrop={isDir ? (e) => handleDrop(e, node.path) : undefined}
                onClick={(e) => handleActivate(e, node.path, isDir)}
                onContextMenu={(e) => handleContext(e, entry)}
                className={rowClass}
              >
                {body}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
