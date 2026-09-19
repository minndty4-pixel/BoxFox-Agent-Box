/**
 * Thao tác ghi của `useWorkspaceFiles`: gọi đúng hàm repository với đường dẫn
 * đúng, nạp lại đúng thư mục bị ảnh hưởng, đánh dấu hàng đang bận, và khi lỗi thì
 * hiện lỗi theo từng mục mà KHÔNG đổi cây. Kèm trạng thái "vượt 1 MiB" của xem trước.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceFiles, WORKSPACE_TEXT_PREVIEW_LIMIT } from './useWorkspaceFiles'
import type { UseWorkspaceFilesResult } from './useWorkspaceFiles'
import { useUiStore } from '../store/uiStore'
import type {
  WorkspaceContent,
  WorkspaceEntry,
  WorkspaceListing,
  WorkspaceRepository,
} from '../lib/workspace'

const mtime = '2026-08-28T12:00:00Z'

function dir(name: string): WorkspaceEntry {
  return { name, kind: 'dir', sizeBytes: 0, mtime, integrity: null, confidentiality: null, ext: null, language: null }
}

function file(name: string, ext = 'ts', sizeBytes = 8): WorkspaceEntry {
  return {
    name,
    kind: 'file',
    sizeBytes,
    mtime,
    integrity: 'duong_nguoi_dung_cho_phep' as never,
    confidentiality: 'cong_khai',
    ext,
    language: 'typescript',
  }
}

function listing(entries: WorkspaceEntry[], path = ''): WorkspaceListing {
  return { breadcrumb: [{ name: 'workspace', path }, ...(path ? [{ name: path, path }] : [])], entries }
}

const ROOT = listing([dir('src'), dir('docs'), file('App.tsx'), file('big.log', 'log', 2 * WORKSPACE_TEXT_PREVIEW_LIMIT)])
const SRC = listing([file('parser.py', 'py'), file('auth.py', 'py')], 'src')
const DOCS = listing([], 'docs')

function contentFor(path: string): WorkspaceContent {
  return { content: `// ${path}`, sizeBytes: path.length, mime: 'text/plain', language: 'typescript', binary: false }
}

/** Kho repository đầy đủ, ghi đè theo `overrides`. */
function makeRepo(overrides?: Partial<WorkspaceRepository>): WorkspaceRepository {
  const base: WorkspaceRepository = {
    baseUrl: 'http://box.test',
    list: vi.fn(async (path: string) => (path === '' ? ROOT : path === 'src' ? SRC : DOCS)),
    readText: vi.fn(async (path: string) => contentFor(path)),
    mediaUrl: (p: string) => `http://box.test/__box/file/media?path=${encodeURIComponent(p)}`,
    thumbnailUrl: (p: string) => `http://box.test/__box/file/thumbnail?path=${encodeURIComponent(p)}`,
    downloadUrl: (p: string) => `http://box.test/__box/file/download?path=${encodeURIComponent(p)}`,
    zip: vi.fn(async () => new Blob(['zip'])),
    upload: vi.fn(async (targetDir: string, filename: string) => ({ path: `${targetDir}/${filename}`, sizeBytes: 0 })),
    unzip: vi.fn(async () => ({ extracted: 0, skipped: 0, warnings: [] })),
    mkdir: vi.fn(async (path: string) => ({ path, type: 'directory' as const })),
    touch: vi.fn(async (path: string) => ({ path, type: 'file' as const, size: 0 })),
    rename: vi.fn(async (path: string, name: string) => ({ path, newPath: name })),
    move: vi.fn(async (path: string, destination: string) => ({ path, newPath: `${destination}/${path}` })),
    deleteEntry: vi.fn(async (path: string) => ({ path, trashPath: `.trash/1-${path}` })),
  }
  return { ...base, ...overrides }
}

/** Đẩy hàng đợi microtask đủ nhiều để các hàm async trong hook chạy xong. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

async function mount(repository: WorkspaceRepository) {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useUiStore.getState().clearSelectedFile()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let latest: UseWorkspaceFilesResult | null = null

  function Probe() {
    latest = useWorkspaceFiles(repository)
    return null
  }

  await act(async () => {
    root.render(<Probe />)
  })

  return {
    get state() {
      if (!latest) throw new Error('Hook did not render.')
      return latest
    },
    async unmount() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('useWorkspaceFiles — thao tác ghi', () => {
  it('createFile gọi touch đúng đường dẫn trong thư mục hiện tại rồi nạp lại', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      await hook.state.createFile('notes.md')
    })
    await settle()

    expect(repo.touch).toHaveBeenCalledWith('notes.md')
    expect(repo.list).toHaveBeenCalledWith('', expect.any(AbortSignal))
    await hook.unmount()
  })

  it('createFolder tạo trong thư mục được chỉ định và nạp lại chính thư mục đó', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      await hook.state.createFolder('nested', 'src')
    })
    await settle()

    expect(repo.mkdir).toHaveBeenCalledWith('src/nested')
    expect(repo.list).toHaveBeenCalledWith('src', expect.any(AbortSignal))
    // Không kéo người dùng sang thư mục khác: vẫn đang ở gốc.
    expect(hook.state.cwd).toBe('')
    await hook.unmount()
  })

  it('createFile với tên rỗng thì không gọi repository', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      await hook.state.createFile('   ')
    })
    expect(repo.touch).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('renameEntry gọi rename và nạp lại thư mục cha', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      await hook.state.renameEntry('App.tsx', 'Main.tsx')
    })
    await settle()

    expect(repo.rename).toHaveBeenCalledWith('App.tsx', 'Main.tsx')
    expect(repo.list).toHaveBeenCalledWith('', expect.any(AbortSignal))
    await hook.unmount()
  })

  it('renameEntry với đúng tên cũ thì không gọi repository', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      await hook.state.renameEntry('App.tsx', 'App.tsx')
    })
    expect(repo.rename).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('moveEntry gọi move và nạp lại cả thư mục nguồn lẫn đích', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      await hook.state.moveEntry('src/parser.py', 'docs')
    })
    await settle()

    expect(repo.move).toHaveBeenCalledWith('src/parser.py', 'docs')
    expect(repo.list).toHaveBeenCalledWith('src', expect.any(AbortSignal))
    expect(repo.list).toHaveBeenCalledWith('docs', expect.any(AbortSignal))
    await hook.unmount()
  })

  it('moveEntry chặn di chuyển vào chính nó / vào thư mục con', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      await hook.state.moveEntry('src', 'src')
      await hook.state.moveEntry('src', 'src/nested')
      await hook.state.moveEntry('src', '')
    })
    expect(repo.move).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('deleteEntry gọi deleteEntry, nạp lại thư mục cha và bỏ mục khỏi vùng chọn', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      hook.state.toggleSelect('App.tsx')
    })
    await act(async () => {
      await hook.state.deleteEntry('App.tsx')
    })
    await settle()

    expect(repo.deleteEntry).toHaveBeenCalledWith('App.tsx')
    expect(repo.list).toHaveBeenCalledWith('', expect.any(AbortSignal))
    expect(hook.state.selected.has('App.tsx')).toBe(false)
    await hook.unmount()
  })

  it('deleteEntry đóng xem trước khi mục đang mở bị xoá', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      hook.state.open('src/parser.py')
    })
    await settle()
    expect(hook.state.previewPath).toBe('src/parser.py')

    await act(async () => {
      await hook.state.deleteEntry('src/parser.py')
    })
    await settle()

    expect(hook.state.previewPath).toBeNull()
    await hook.unmount()
  })

  it('lỗi khi tạo file: hiện lỗi theo mục + lỗi hành động, cây KHÔNG đổi', async () => {
    const repo = makeRepo({ mkdir: vi.fn(async () => Promise.reject(new Error('ALREADY_EXISTS: src'))) })
    const hook = await mount(repo)
    await settle()
    const before = hook.state.filteredEntries.map((e) => e.name)

    await act(async () => {
      await hook.state.createFolder('src', '')
    })
    await settle()

    expect(hook.state.entryErrors.get('src')).toBe('ALREADY_EXISTS: src')
    expect(hook.state.actionError).toBe('ALREADY_EXISTS: src')
    expect(hook.state.filteredEntries.map((e) => e.name)).toEqual(before)
    // Lỗi thao tác KHÔNG được biến thành lỗi tải danh sách (cây phải còn nguyên).
    expect(hook.state.status).not.toBe('error')
    expect(hook.state.error).toBeNull()

    await act(async () => {
      hook.state.clearEntryError('src')
    })
    expect(hook.state.entryErrors.has('src')).toBe(false)
    await hook.unmount()
  })

  it('lỗi khi đổi tên: giữ nguyên cây và không nạp lại danh sách', async () => {
    const repo = makeRepo({ rename: vi.fn(async () => Promise.reject(new Error('CONFLICT'))) })
    const hook = await mount(repo)
    await settle()
    const callsBefore = (repo.list as ReturnType<typeof vi.fn>).mock.calls.length

    await act(async () => {
      await hook.state.renameEntry('App.tsx', 'Main.tsx')
    })
    await settle()

    expect(hook.state.actionError).toBe('CONFLICT')
    expect((repo.list as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    await hook.unmount()
  })

  it('đánh dấu hàng đang bận trong lúc thao tác chạy', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const repo = makeRepo({
      mkdir: vi.fn(async (path: string) => {
        await gate
        return { path, type: 'directory' as const }
      }),
    })
    const hook = await mount(repo)
    await settle()

    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = hook.state.createFolder('later', 'src')
      await Promise.resolve()
    })
    expect(hook.state.pendingPaths.has('src/later')).toBe(true)

    await act(async () => {
      release()
      await pending
    })
    await settle()
    expect(hook.state.pendingPaths.has('src/later')).toBe(false)
    await hook.unmount()
  })

  it('mở file vượt 1 MiB: báo "vượt 1 MiB" và KHÔNG gọi readText', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      hook.state.open('big.log')
    })
    await settle()

    expect(hook.state.previewNotice).toBe('too-large')
    expect(hook.state.previewContent).toBeNull()
    expect(repo.readText).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('file nhỏ mở bình thường: không có thông báo lỗi', async () => {
    const repo = makeRepo()
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      hook.state.open('App.tsx')
    })
    await settle()

    expect(hook.state.previewNotice).toBeNull()
    expect(hook.state.previewContent?.content).toBe('// App.tsx')
    await hook.unmount()
  })

  it('đọc file lỗi: báo read-failed thay vì khung trống', async () => {
    const repo = makeRepo({ readText: vi.fn(async () => Promise.reject(new Error('boom'))) })
    const hook = await mount(repo)
    await settle()

    await act(async () => {
      hook.state.open('App.tsx')
    })
    await settle()

    expect(hook.state.previewNotice).toBe('read-failed')
    await hook.unmount()
  })
})
