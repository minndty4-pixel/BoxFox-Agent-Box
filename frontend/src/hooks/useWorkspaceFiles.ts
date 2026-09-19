import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createWorkspaceRepository,
  extOf,
  findNode,
  languageForExt,
  mergeListing,
  previewKindFor,
  toggleExpand,
  WorkspaceRepositoryHttpError,
  type PreviewKind,
  type WorkspaceContent,
  type WorkspaceEntry,
  type WorkspaceListing,
  type WorkspaceRepository,
  type WorkspaceTree,
} from '../lib/workspace'
import { basename, childPath } from '../lib/workspace/tree'
import { useUiStore } from '../store/uiStore'

export type WorkspaceMode = 'explorer' | 'tree'
export type WorkspaceStatus = 'idle' | 'loading' | 'error' | 'refreshing'

/**
 * Trạng thái thật của phần xem trước: `too-large` = file vượt trần đọc 1 MiB của
 * container (tải về để xem, không phải lỗi), `read-failed` = đọc hỏng vì lý do khác.
 */
export type WorkspacePreviewNotice = 'too-large' | 'read-failed'

/** Trần đọc text của container (`deploy/docker/workspace_files.py`, 1 MiB). */
export const WORKSPACE_TEXT_PREVIEW_LIMIT = 1024 * 1024

export interface UseWorkspaceFilesResult {
  cwd: string
  listing: WorkspaceListing | null
  tree: WorkspaceTree[]
  expanded: ReadonlySet<string>
  search: string
  setSearch: (q: string) => void
  filteredEntries: WorkspaceEntry[]
  selected: ReadonlySet<string>
  previewPath: string | null
  previewEntry: WorkspaceEntry | null
  previewContent: WorkspaceContent | null
  previewKind: PreviewKind
  /** Lý do phần xem trước không có nội dung — `null` khi bình thường. */
  previewNotice: WorkspacePreviewNotice | null
  status: WorkspaceStatus
  error: string | null
  mode: WorkspaceMode
  setMode: (m: WorkspaceMode) => void
  repository: WorkspaceRepository
  /** Đường dẫn đang có thao tác ghi chạy — dùng để khoá hàng đó trên giao diện. */
  pendingPaths: ReadonlySet<string>
  /** Lỗi của thao tác ghi gần nhất, theo từng đường dẫn (cây KHÔNG bị đổi khi lỗi). */
  entryErrors: ReadonlyMap<string, string>
  /** Thông báo lỗi của thao tác ghi gần nhất, để hiện ở dòng trạng thái của panel. */
  actionError: string | null
  clearEntryError: (path: string) => void
  refresh: () => Promise<void>
  navigateTo: (path: string) => void
  goUp: () => void
  expand: (path: string) => void
  toggleSelect: (path: string, additive?: boolean) => void
  selectRange: (path: string) => void
  open: (path: string) => void
  closePreview: () => void
  download: (path: string) => void
  zipSelected: () => Promise<void>
  upload: (files: FileList | File[], targetDir: string) => Promise<void>
  unzip: (path: string) => Promise<void>
  createFile: (name: string, dir?: string) => Promise<void>
  createFolder: (name: string, dir?: string) => Promise<void>
  renameEntry: (path: string, name: string) => Promise<void>
  moveEntry: (path: string, destination: string) => Promise<void>
  deleteEntry: (path: string) => Promise<void>
  openInIde: (path: string) => void
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function deriveEntry(path: string): WorkspaceEntry {
  const name = basename(path)
  const ext = extOf(name)
  return {
    name,
    kind: 'file',
    sizeBytes: 0,
    mtime: '',
    integrity: null,
    confidentiality: null,
    ext,
    language: languageForExt(ext),
  }
}

function collectExpanded(roots: WorkspaceTree[]): Set<string> {
  const out = new Set<string>()
  const walk = (nodes: WorkspaceTree[]) => {
    for (const n of nodes) {
      if (n.expanded) out.add(n.path)
      if (n.children.length) walk(n.children)
    }
  }
  walk(roots)
  return out
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Could not load files.'
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/**
 * Hook panel-LOCAL cho trình duyệt file workspace. Giữ cwd, cache listing, cây
 * (nạp lười), chọn nhiều, xem trước, và các thao tác tải/nén/giải nén/tải lên.
 * Dùng generation riêng cho ba luồng (navigate / expand-tree / đọc nội dung) để
 * response cũ bị drop và unmount abort mọi request đang chạy.
 */
export function useWorkspaceFiles(repository?: WorkspaceRepository): UseWorkspaceFilesResult {
  const defaultRepositoryRef = useRef<WorkspaceRepository | null>(null)
  if (!defaultRepositoryRef.current) defaultRepositoryRef.current = createWorkspaceRepository()
  const activeRepository = repository ?? defaultRepositoryRef.current
  const repoRef = useRef(activeRepository)
  repoRef.current = activeRepository

  const [cwd, setCwd] = useState('')
  const [listings, setListings] = useState<Map<string, WorkspaceListing>>(() => new Map())
  const [tree, setTree] = useState<WorkspaceTree[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewEntry, setPreviewEntry] = useState<WorkspaceEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<WorkspaceContent | null>(null)
  const [previewKind, setPreviewKind] = useState<PreviewKind>('unknown')
  const [previewNotice, setPreviewNotice] = useState<WorkspacePreviewNotice | null>(null)
  const [status, setStatus] = useState<WorkspaceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [mode, setModeState] = useState<WorkspaceMode>('explorer')
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(() => new Set())
  const [entryErrors, setEntryErrors] = useState<Map<string, string>>(() => new Map())
  const [actionError, setActionError] = useState<string | null>(null)

  // Refs đồng bộ để callback ổn định ([]) đọc giá trị mới nhất.
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const treeRef = useRef(tree)
  treeRef.current = tree
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const previewPathRef = useRef(previewPath)
  previewPathRef.current = previewPath
  const lastAnchorRef = useRef<string | null>(null)

  const navGenRef = useRef(0)
  const treeGenRef = useRef(0)
  const contentGenRef = useRef(0)
  const navControllerRef = useRef<AbortController | null>(null)
  const treeControllerRef = useRef<AbortController | null>(null)
  const contentControllerRef = useRef<AbortController | null>(null)

  const filteredEntries = useMemo(() => {
    const listing = listings.get(cwd) ?? null
    if (!listing) return []
    const q = search.trim().toLowerCase()
    if (!q) return listing.entries
    return listing.entries.filter((e) => e.name.toLowerCase().includes(q))
  }, [listings, cwd, search])
  const filteredRef = useRef(filteredEntries)
  filteredRef.current = filteredEntries

  const expanded = useMemo(() => collectExpanded(tree), [tree])

  const resolveEntry = useCallback((path: string): WorkspaceEntry => {
    const found = findNode(treeRef.current, path)
    const node = found?.node
    if (node && node.kind === 'file') {
      const name = node.name
      const ext = 'ext' in node && typeof node.ext === 'string' ? node.ext : extOf(name)
      return {
        name,
        kind: 'file',
        sizeBytes: 'sizeBytes' in node && typeof node.sizeBytes === 'number' ? node.sizeBytes : 0,
        mtime: 'mtime' in node && typeof node.mtime === 'string' ? node.mtime : '',
        integrity: node.integrity ?? null,
        confidentiality: node.confidentiality ?? null,
        ext,
        language: 'language' in node && typeof node.language === 'string' ? node.language : languageForExt(ext),
      }
    }
    return deriveEntry(path)
  }, [])

  const loadList = useCallback(async (path: string, isRefresh: boolean, activate = true) => {
    const generation = ++navGenRef.current
    navControllerRef.current?.abort()
    const controller = new AbortController()
    navControllerRef.current = controller
    setStatus(isRefresh ? 'refreshing' : 'loading')
    setError(null)
    try {
      const listing = await repoRef.current.list(path, controller.signal)
      if (generation !== navGenRef.current) return
      // Thao tác ghi chỉ nạp lại thư mục bị ảnh hưởng — không kéo người dùng đi
      // khỏi thư mục đang xem (`activate === false`).
      if (activate) setCwd(path)
      setListings((prev) => {
        const next = new Map(prev)
        next.set(path, listing)
        return next
      })
      setTree((prev) => mergeListing(path, listing, prev))
      setStatus('idle')
    } catch (cause) {
      if (generation !== navGenRef.current) return
      if (isAbortError(cause)) return
      setError(messageFor(cause))
      setStatus('error')
    }
  }, [])

  const loadChildren = useCallback(async (path: string) => {
    const generation = ++treeGenRef.current
    treeControllerRef.current?.abort()
    const controller = new AbortController()
    treeControllerRef.current = controller
    try {
      const listing = await repoRef.current.list(path, controller.signal)
      if (generation !== treeGenRef.current) return
      setListings((prev) => {
        const next = new Map(prev)
        next.set(path, listing)
        return next
      })
      setTree((prev) => mergeListing(path, listing, prev))
    } catch (cause) {
      if (generation !== treeGenRef.current) return
      if (isAbortError(cause)) return
      setError(messageFor(cause))
    }
  }, [])

  const open = useCallback(async (path: string) => {
    // Khi mở file từ Tree View, đồng bộ cwd về thư mục cha để Breadcrumb phản
    // ánh vị trí thật của file (workspace > .plans) thay vì chỉ hiện "workspace".
    const parent = parentOf(path)
    if (parent !== cwdRef.current) {
      setCwd(parent)
      void loadList(parent, false)
    }
    setPreviewPath(path)
    const entry = resolveEntry(path)
    setPreviewEntry(entry)
    const kind = previewKindFor(entry)
    setPreviewKind(kind)
    setPreviewContent(null)
    setPreviewNotice(null)
    // Ảnh/video/âm thanh/PDF dùng mediaUrl trực tiếp — không cần readText.
    if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') return
    // File vượt trần đọc 1 MiB của container: nói thẳng "vượt 1 MiB" thay vì
    // để khung xem trước trống trơn như một lỗi khó hiểu.
    if (entry.sizeBytes > WORKSPACE_TEXT_PREVIEW_LIMIT) {
      setPreviewNotice('too-large')
      return
    }
    const generation = ++contentGenRef.current
    contentControllerRef.current?.abort()
    const controller = new AbortController()
    contentControllerRef.current = controller
    try {
      const content = await repoRef.current.readText(path, controller.signal)
      if (generation !== contentGenRef.current) return
      setPreviewContent(content)
      // File không có đuôi nhưng nội dung là text → hạ xuống text.
      if (kind === 'unknown' && !content.binary) setPreviewKind('text')
    } catch (cause) {
      if (generation !== contentGenRef.current) return
      if (isAbortError(cause)) return
      setPreviewContent(null)
      setPreviewNotice('read-failed')
    }
  }, [resolveEntry, loadList])

  /**
   * Đích của ý định mở tab Files (`tabIntentTargets.files = {path}`, hợp đồng §1):
   * agent mở tab kèm đúng file cần xem. Ý định có thể tới lúc panel ĐÃ mở sẵn, nên
   * phải tiêu thụ ngay tại chỗ chứ không chỉ ở lần mount như `selectedFilePath`.
   *
   * `selectedFilePath` (người dùng bấm chip trong transcript) là lựa chọn TRỰC
   * TIẾP nên luôn thắng khi cả hai cùng có mặt; mỗi đích chỉ áp dụng MỘT lần để
   * người dùng vẫn tự đổi được sau đó.
   */
  const filesIntentTarget = useUiStore((s) => s.tabIntentTargets.files)
  const filesIntentPath = typeof filesIntentTarget?.path === 'string' ? filesIntentTarget.path : ''
  const appliedIntentPathRef = useRef<string | null>(null)

  const openIntentPath = useCallback(
    (path: string) => {
      appliedIntentPathRef.current = path
      void loadList(parentOf(path), false).then(() => {
        void open(path)
      })
    },
    [loadList, open],
  )

  useEffect(() => {
    if (!filesIntentPath || appliedIntentPathRef.current === filesIntentPath) return
    // Lựa chọn trực tiếp của người dùng chưa được tiêu thụ → nhường cho nó. Đích
    // này coi như đã xét: người dùng vừa nói rõ muốn xem gì, không kéo họ đi nơi
    // khác ngay sau đó.
    if (useUiStore.getState().selectedFilePath) {
      appliedIntentPathRef.current = filesIntentPath
      return
    }
    openIntentPath(filesIntentPath)
  }, [filesIntentPath, openIntentPath])

  // Lần mount đầu: nếu có selectedFilePath (từ ChatPanel) → mở thư mục cha rồi
  // mở file; nếu không mà có ý định Files của agent → mở file agent chỉ định;
  // ngược lại liệt kê gốc. Sau đó abort mọi request khi unmount.
  useEffect(() => {
    const initialFile = useUiStore.getState().selectedFilePath
    const initialIntent = useUiStore.getState().tabIntentTargets.files
    const initialIntentPath =
      typeof initialIntent?.path === 'string' && initialIntent.path ? initialIntent.path : ''
    if (initialFile) {
      useUiStore.getState().clearSelectedFile()
      const parent = parentOf(initialFile)
      void loadList(parent, false).then(() => {
        void open(initialFile)
      })
    } else if (initialIntentPath) {
      // Cùng đường với hiệu ứng trên, nhưng chạy trước `loadList('')` để không
      // liệt kê gốc rồi bị thay bằng thư mục cha (một lần nạp thắng theo thế hệ).
      openIntentPath(initialIntentPath)
    } else {
      void loadList('', false)
    }
    return () => {
      navGenRef.current += 1
      treeGenRef.current += 1
      contentGenRef.current += 1
      navControllerRef.current?.abort()
      treeControllerRef.current?.abort()
      contentControllerRef.current?.abort()
    }
  }, [])

  const refresh = useCallback(async () => {
    await loadList(cwdRef.current, true)
  }, [loadList])

  const closePreview = useCallback(() => {
    contentGenRef.current += 1
    contentControllerRef.current?.abort()
    setPreviewPath(null)
    setPreviewEntry(null)
    setPreviewContent(null)
    setPreviewNotice(null)
  }, [])

  const navigateTo = useCallback(
    (path: string) => {
      closePreview()
      lastAnchorRef.current = null
      void loadList(path, false)
    },
    [loadList, closePreview],
  )

  const goUp = useCallback(() => {
    closePreview()
    if (cwdRef.current === '') return
    void loadList(parentOf(cwdRef.current), false)
  }, [loadList, closePreview])

  const setMode = useCallback(
    (m: WorkspaceMode) => {
      closePreview()
      setModeState(m)
    },
    [closePreview],
  )

  const expand = useCallback(
    (path: string) => {
      const node = findNode(treeRef.current, path)
      if (node?.expanded) {
        // Đang mở → đóng.
        setTree((prev) => toggleExpand(path, prev))
        return
      }
      // Mở ngay (optimistic) để chevron phản hồi tức thì; nếu chưa nạp con thì
      // tải lười — mergeListing sẽ gắn con và giữ expanded=true.
      setTree((prev) => toggleExpand(path, prev))
      if (node && !node.loaded) void loadChildren(path)
    },
    [loadChildren],
  )

  const toggleSelect = useCallback((path: string, additive = false) => {
    lastAnchorRef.current = path
    setSelected((prev) => {
      if (!additive) return new Set([path])
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const selectRange = useCallback(
    (path: string) => {
      const order = filteredRef.current.map((e) => childPath(cwdRef.current, e.name))
      const anchor = lastAnchorRef.current ?? path
      const ai = order.indexOf(anchor)
      const pi = order.indexOf(path)
      if (ai < 0 || pi < 0) {
        toggleSelect(path, false)
        return
      }
      const lo = Math.min(ai, pi)
      const hi = Math.max(ai, pi)
      setSelected(new Set(order.slice(lo, hi + 1)))
      lastAnchorRef.current = path
    },
    [toggleSelect],
  )

  const download = useCallback((path: string) => {
    const a = document.createElement('a')
    a.href = repoRef.current.downloadUrl(path)
    a.download = basename(path)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  const zipSelected = useCallback(async () => {
    const paths = [...selectedRef.current]
    if (paths.length === 0) return
    try {
      const blob = await repoRef.current.zip(paths)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'workspace-selection.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Trì hoãn revoke sang tick kế tiếp để trình duyệt kịp bắt đầu tải.
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (cause) {
      setError(cause instanceof WorkspaceRepositoryHttpError ? cause.message : messageFor(cause))
    }
  }, [])

  const upload = useCallback(
    async (files: FileList | File[], targetDir: string) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setStatus('refreshing')
      setError(null)
      for (const file of list) {
        try {
          await repoRef.current.upload(targetDir, file.name, file)
        } catch (cause) {
          setError(cause instanceof WorkspaceRepositoryHttpError ? cause.message : messageFor(cause))
        }
      }
      await loadList(cwdRef.current, true)
    },
    [loadList],
  )

  const unzip = useCallback(
    async (path: string) => {
      try {
        await repoRef.current.unzip(path)
        await loadList(cwdRef.current, true)
      } catch (cause) {
        setError(cause instanceof WorkspaceRepositoryHttpError ? cause.message : messageFor(cause))
      }
    },
    [loadList],
  )

  const openInIde = useCallback((path: string) => {
    useUiStore.getState().openFileInIde(path)
  }, [])

  const markPending = useCallback((path: string, on: boolean) => {
    setPendingPaths((prev) => {
      const next = new Set(prev)
      if (on) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  const setEntryError = useCallback((path: string, message: string | null) => {
    setEntryErrors((prev) => {
      const next = new Map(prev)
      if (message) next.set(path, message)
      else next.delete(path)
      return next
    })
  }, [])

  const clearEntryError = useCallback((path: string) => setEntryError(path, null), [setEntryError])

  /**
   * Chạy một thao tác GHI lên `path`: đánh dấu hàng đang bận, gọi repository, rồi
   * nạp lại đúng những thư mục bị ảnh hưởng. Khi lỗi thì ghi lỗi theo từng mục và
   * KHÔNG đụng tới cây — người dùng vẫn thấy nguyên trạng thái trước đó.
   */
  const runEntryOperation = useCallback(
    async (path: string, run: (repository: WorkspaceRepository) => Promise<unknown>, reloads: string[]) => {
      setActionError(null)
      setEntryError(path, null)
      markPending(path, true)
      try {
        await run(repoRef.current)
      } catch (cause) {
        const message = cause instanceof WorkspaceRepositoryHttpError ? cause.message : messageFor(cause)
        setEntryError(path, message)
        setActionError(message)
        return false
      } finally {
        markPending(path, false)
      }
      for (const dir of [...new Set(reloads)]) {
        await loadList(dir, true, dir === cwdRef.current)
      }
      return true
    },
    [loadList, markPending, setEntryError],
  )

  const createFile = useCallback(
    async (name: string, dir = '') => {
      const clean = name.trim()
      if (!clean) return
      const target = childPath(dir, clean)
      await runEntryOperation(target, (repository) => repository.touch(target), [dir])
    },
    [runEntryOperation],
  )

  const createFolder = useCallback(
    async (name: string, dir = '') => {
      const clean = name.trim()
      if (!clean) return
      const target = childPath(dir, clean)
      await runEntryOperation(target, (repository) => repository.mkdir(target), [dir])
    },
    [runEntryOperation],
  )

  const renameEntry = useCallback(
    async (path: string, name: string) => {
      const clean = name.trim()
      if (!clean || clean === basename(path)) return
      await runEntryOperation(path, (repository) => repository.rename(path, clean), [parentOf(path)])
    },
    [runEntryOperation],
  )

  const moveEntry = useCallback(
    async (path: string, destination: string) => {
      // Không di chuyển vào chính nó / vào thư mục con của nó, và không "di
      // chuyển" sang chỗ đang đứng.
      if (destination === path || destination.startsWith(`${path}/`)) return
      if (parentOf(path) === destination) return
      await runEntryOperation(path, (repository) => repository.move(path, destination), [
        parentOf(path),
        destination,
      ])
    },
    [runEntryOperation],
  )

  const deleteEntry = useCallback(
    async (path: string) => {
      const ok = await runEntryOperation(path, (repository) => repository.deleteEntry(path), [parentOf(path)])
      if (!ok) return
      setSelected((prev) => {
        const next = new Set([...prev].filter((p) => p !== path && !p.startsWith(`${path}/`)))
        return next.size === prev.size ? prev : next
      })
      const opened = previewPathRef.current
      if (opened && (opened === path || opened.startsWith(`${path}/`))) closePreview()
    },
    [closePreview, runEntryOperation],
  )

  return {
    cwd,
    listing: listings.get(cwd) ?? null,
    tree,
    expanded,
    search,
    setSearch,
    filteredEntries,
    selected,
    previewPath,
    previewEntry,
    previewContent,
    previewKind,
    previewNotice,
    status,
    error,
    mode,
    setMode,
    repository: activeRepository,
    pendingPaths,
    entryErrors,
    actionError,
    clearEntryError,
    refresh,
    navigateTo,
    goUp,
    expand,
    toggleSelect,
    selectRange,
    open,
    closePreview,
    download,
    zipSelected,
    upload,
    unzip,
    createFile,
    createFolder,
    renameEntry,
    moveEntry,
    deleteEntry,
    openInIde,
  }
}
