/**
 * Panel "Workspace Files" — kết nối hook useWorkspaceFiles với toolbar, lưới/
 * cây, overlay xem trước và menu chuột phải. Trạng thái menu + trạng thái "đang
 * tạo/đang đổi tên" giữ ở đây (cần selected set + các thao tác từ hook).
 *
 * Ô tạo file/thư mục dùng lại đúng mẫu hàng của cây (icon + tên), nằm ngay trên
 * danh sách nên không đổi bố cục sẵn có; đổi tên thì sửa tại chỗ trên hàng đó.
 *
 * Chuột phải trên vùng trống (kể cả thư mục rỗng) mở menu chỉ gồm hai hàng tạo
 * mới cho chính thư mục đang mở.
 */
import { useState } from 'react'
import { File, Folder } from 'lucide-react'
import { useT } from '../../../i18n/context'
import { useWorkspaceFiles, type WorkspaceStatus } from '../../../hooks/useWorkspaceFiles'
import { childPath, parentPath } from '../../../lib/workspace/tree'
import type { WorkspaceCrumb, WorkspaceEntry } from '../../../lib/workspace'
import { ContextMenu } from './ContextMenu'
import { ExplorerGrid } from './ExplorerGrid'
import { PreviewStudio } from './PreviewStudio'
import { TreeView } from './TreeView'
import { WorkspaceToolbar } from './WorkspaceToolbar'

interface MenuState {
  entry: WorkspaceEntry
  path: string
  x: number
  y: number
  /** `true` khi bấm trên vùng trống — chỉ hiện hai hàng tạo mới cho `path`. */
  background: boolean
}

/** Việc đang chờ người dùng nhập xong: tạo mục mới trong `dir`, hoặc đổi tên. */
type CreateState = { dir: string; kind: 'file' | 'dir' }

const ROOT_CRUMB: WorkspaceCrumb[] = [{ name: 'workspace', path: '' }]

export function WorkspaceFilesPanel() {
  const t = useT()
  const ws = useWorkspaceFiles()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [creating, setCreating] = useState<CreateState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const crumbs = ws.listing?.breadcrumb ?? ROOT_CRUMB
  const onUploadFiles = (files: FileList | File[]) => ws.upload(files, ws.cwd)
  const canGoBack = ws.previewPath !== null || ws.cwd !== ''
  const handleBack = () => (ws.previewPath ? ws.closePreview() : ws.goUp())

  const openContextMenu = (entry: WorkspaceEntry, x: number, y: number) => {
    setMenu({ entry, path: childPath(ws.cwd, entry.name), x, y, background: false })
  }

  /** Chuột phải trên vùng trống → đích tạo mới là thư mục đang mở. */
  const openBackgroundMenu = (x: number, y: number) => {
    const slash = ws.cwd.lastIndexOf('/')
    const name = ws.cwd ? ws.cwd.slice(slash + 1) : 'workspace'
    setMenu({
      entry: { name, kind: 'dir', sizeBytes: 0, mtime: '', integrity: null, confidentiality: null, ext: null, language: null },
      path: ws.cwd,
      x,
      y,
      background: true,
    })
  }

  // Tạo mục mới: trong thư mục vừa bấm, hoặc cạnh file vừa bấm.
  const targetDirFor = (entry: WorkspaceEntry, path: string) =>
    entry.kind === 'dir' ? path : parentPath(path)

  const startCreate = (entry: WorkspaceEntry, path: string, kind: 'file' | 'dir') => {
    setRenaming(null)
    setCreating({ dir: targetDirFor(entry, path), kind })
  }

  const commitCreate = (name: string) => {
    const pending = creating
    setCreating(null)
    if (!pending) return
    const clean = name.trim()
    if (!clean) return
    if (pending.kind === 'file') void ws.createFile(clean, pending.dir)
    else void ws.createFolder(clean, pending.dir)
  }

  const startRename = (path: string) => {
    setCreating(null)
    setRenaming(path)
  }

  const commitRename = (path: string, name: string) => {
    setRenaming(null)
    void ws.renameEntry(path, name)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold">{t('workspace.title')}</h2>
        <StatusBadge status={ws.status} actionError={ws.actionError} />
      </div>

      <WorkspaceToolbar
        crumbs={crumbs}
        onNavigate={ws.navigateTo}
        onBack={handleBack}
        canGoBack={canGoBack}
        mode={ws.mode}
        onModeChange={ws.setMode}
        search={ws.search}
        onSearchChange={ws.setSearch}
        onUploadFiles={onUploadFiles}
        onRefresh={ws.refresh}
        selectedCount={ws.selected.size}
        status={ws.status}
        onMoveEntry={ws.moveEntry}
      />

      {creating && (
        <div className="flex items-center gap-1 border-b border-line px-3 py-1 text-[12px]">
          {creating.kind === 'dir' ? (
            <Folder className="size-3.5 shrink-0 text-amber-400" />
          ) : (
            <File className="size-3.5 shrink-0 text-muted" />
          )}
          <span className="shrink-0 font-mono text-muted">{creating.dir ? `${creating.dir}/` : 'workspace/'}</span>
          <input
            autoFocus
            aria-label={t('workspace.newEntryAria')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCreate(e.currentTarget.value)
              else if (e.key === 'Escape') setCreating(null)
            }}
            onBlur={(e) => commitCreate(e.currentTarget.value)}
            className="min-w-0 flex-1 rounded border border-brand/60 bg-panel px-1 py-0.5 font-mono text-[12px] text-fg outline-none"
          />
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {ws.mode === 'explorer' ? (
          <ExplorerGrid
            entries={ws.filteredEntries}
            cwd={ws.cwd}
            selected={ws.selected}
            repository={ws.repository}
            status={ws.status}
            error={ws.error}
            canGoUp={ws.cwd !== ''}
            onOpen={ws.open}
            onNavigate={ws.navigateTo}
            onToggleSelect={ws.toggleSelect}
            onSelectRange={ws.selectRange}
            onUploadFiles={onUploadFiles}
            onGoUp={ws.goUp}
            onContextMenu={openContextMenu}
            onContextMenuBackground={openBackgroundMenu}
            pendingPaths={ws.pendingPaths}
            entryErrors={ws.entryErrors}
            renamingPath={renaming}
            onRenameCommit={commitRename}
            onRenameCancel={() => setRenaming(null)}
            onMove={ws.moveEntry}
          />
        ) : (
          <TreeView
            tree={ws.tree}
            expanded={ws.expanded}
            selected={ws.selected}
            onExpand={ws.expand}
            onOpen={ws.open}
            onToggleSelect={ws.toggleSelect}
            onSelectRange={ws.selectRange}
            onContextMenu={openContextMenu}
            onContextMenuBackground={openBackgroundMenu}
            error={ws.error}
            pendingPaths={ws.pendingPaths}
            entryErrors={ws.entryErrors}
            renamingPath={renaming}
            onRenameCommit={commitRename}
            onRenameCancel={() => setRenaming(null)}
            onMove={ws.moveEntry}
          />
        )}

        {ws.previewPath && (
          <PreviewStudio
            path={ws.previewPath}
            entry={ws.previewEntry}
            content={ws.previewContent}
            kind={ws.previewKind}
            notice={ws.previewNotice}
            repository={ws.repository}
            onClose={ws.closePreview}
            onOpenInIde={ws.openInIde}
          />
        )}
      </div>

      {menu && (
        <ContextMenu
          anchor={{ x: menu.x, y: menu.y }}
          path={menu.path}
          entry={menu.entry}
          selectedCount={ws.selected.size}
          background={menu.background}
          onClose={() => setMenu(null)}
          onDownload={ws.download}
          onZip={ws.zipSelected}
          onUnzip={ws.unzip}
          onOpenInIde={ws.openInIde}
          onNewFile={(entry, path) => startCreate(entry, path, 'file')}
          onNewFolder={(entry, path) => startCreate(entry, path, 'dir')}
          onRename={startRename}
          onDelete={(path) => void ws.deleteEntry(path)}
        />
      )}
    </div>
  )
}

function StatusBadge({ status, actionError }: { status: WorkspaceStatus; actionError: string | null }) {
  const t = useT()
  if (status === 'loading') return <span className="text-[11px] text-muted">{t('workspace.loading')}</span>
  if (status === 'refreshing') return <span className="text-[11px] text-muted">{t('workspace.refresh')}</span>
  if (status === 'error') return <span className="text-[11px] text-amber-400">{t('workspace.error')}</span>
  if (actionError) {
    return (
      <span className="truncate text-[11px] text-amber-400" role="alert" title={actionError}>
        {t('workspace.actionFailed')} · {actionError}
      </span>
    )
  }
  return null
}
