/**
 * Menu chuột phải trên một entry: Tải về / Nén ZIP & tải / Giải nén (chỉ khi
 * entry là .zip) / Mở trong VS Code Web, cộng các thao tác GHI — Tạo file, Tạo
 * thư mục, Đổi tên, Xoá. Đóng khi click ngoài hoặc nhấn Escape.
 *
 * "Xoá" không bao giờ xoá thẳng: menu chuyển sang bước xác nhận nói rõ entry sẽ
 * được chuyển vào `.trash` (thùng rác trong workspace), rồi mới gọi `onDelete`.
 *
 * `background` = chuột phải trên vùng trống của danh sách: chỉ hiện hai hàng tạo
 * mới cho chính thư mục đang mở (nhờ vậy thư mục rỗng vẫn tạo được mục mới).
 */
import { Download, FileArchive, FilePlus, FolderOpen, FolderPlus, Pencil, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n/context'
import type { WorkspaceEntry } from '../../../lib/workspace'

interface ContextMenuProps {
  anchor: { x: number; y: number }
  path: string
  entry: WorkspaceEntry
  selectedCount: number
  /** Chuột phải trên vùng trống: chỉ hai hàng tạo mới, `path` là thư mục hiện tại. */
  background?: boolean
  onClose: () => void
  onDownload: (path: string) => void
  onZip: () => void
  onUnzip: (path: string) => void
  onOpenInIde: (path: string) => void
  onNewFile: (entry: WorkspaceEntry, path: string) => void
  onNewFolder: (entry: WorkspaceEntry, path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
}

export function ContextMenu({
  anchor,
  path,
  entry,
  selectedCount,
  background = false,
  onClose,
  onDownload,
  onZip,
  onUnzip,
  onOpenInIde,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: ContextMenuProps) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Giữ menu trong viewport (menu đã có thêm 4 hàng thao tác ghi; bản nền trống chỉ 2 hàng).
  const menuRows = background ? 2 : 10
  const maxLeft = Math.max(8, window.innerWidth - 224)
  const maxTop = Math.max(8, window.innerHeight - (menuRows * 30 + 20))
  const left = Math.min(anchor.x, maxLeft)
  const top = Math.min(anchor.y, maxTop)
  const isZip = entry.ext === 'zip'

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-52 rounded-lg border border-line bg-panel2 p-1 shadow-xl"
      style={{ left, top }}
    >
      {background ? (
        <>
          <MenuItem icon={<FilePlus className="size-3.5" />} onClick={run(() => onNewFile(entry, path))}>
            {t('workspace.context.newFile')}
          </MenuItem>
          <MenuItem icon={<FolderPlus className="size-3.5" />} onClick={run(() => onNewFolder(entry, path))}>
            {t('workspace.context.newFolder')}
          </MenuItem>
        </>
      ) : confirmingDelete ? (
        <>
          <p className="px-2 py-1.5 text-[11px] text-muted" role="alert">
            {t('workspace.context.deleteConfirm', { name: entry.name })}
          </p>
          <MenuItem icon={<Trash2 className="size-3.5" />} onClick={run(() => onDelete(path))}>
            {t('workspace.context.deleteConfirmAction')}
          </MenuItem>
          <MenuItem icon={<X className="size-3.5" />} onClick={() => setConfirmingDelete(false)}>
            {t('workspace.context.cancel')}
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem icon={<Download className="size-3.5" />} onClick={run(() => onDownload(path))}>
            {t('workspace.context.download')}
          </MenuItem>
          <MenuItem icon={<FileArchive className="size-3.5" />} onClick={run(onZip)}>
            {t('workspace.context.zip')}
            {selectedCount > 1 && <span className="ml-1 text-muted">({selectedCount})</span>}
          </MenuItem>
          {isZip && (
            <MenuItem icon={<FolderOpen className="size-3.5" />} onClick={run(() => onUnzip(path))}>
              {t('workspace.context.unzip')}
            </MenuItem>
          )}
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<FilePlus className="size-3.5" />} onClick={run(() => onNewFile(entry, path))}>
            {t('workspace.context.newFile')}
          </MenuItem>
          <MenuItem icon={<FolderPlus className="size-3.5" />} onClick={run(() => onNewFolder(entry, path))}>
            {t('workspace.context.newFolder')}
          </MenuItem>
          <MenuItem icon={<Pencil className="size-3.5" />} onClick={run(() => onRename(path))}>
            {t('workspace.context.rename')}
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmingDelete(true)}>
            {t('workspace.context.delete')}
          </MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Zap className="size-3.5 text-brand" />} onClick={run(() => onOpenInIde(path))}>
            {t('workspace.context.openInIde')}
          </MenuItem>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon, onClick, children }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-panel"
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  )
}
