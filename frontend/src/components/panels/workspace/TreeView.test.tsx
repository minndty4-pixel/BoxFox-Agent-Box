/**
 * Hàng của cây Tree: huy hiệu provenance (integrity/confidentiality của backend),
 * ô đổi tên tại chỗ, hàng bị khoá khi đang bận, và thả một entry vào thư mục để
 * di chuyển. Render qua raw `createRoot` + `act` (dự án không dùng @testing-library).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import type { WorkspaceEntry } from '../../../lib/workspace'
import type { WorkspaceTree } from '../../../lib/workspace/tree'
import { WORKSPACE_PATH_MIME, acceptsPathDrop, isPathDrag, startPathDrag } from './DragDrop'
import { TreeView } from './TreeView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function entry(over: Partial<WorkspaceEntry> & { name: string }): WorkspaceEntry {
  return {
    kind: 'file',
    sizeBytes: 10,
    mtime: '2026-08-28T12:00:00Z',
    integrity: null,
    confidentiality: null,
    ext: 'md',
    language: 'markdown',
    ...over,
  }
}

const TREE: WorkspaceTree[] = [
  {
    path: 'src',
    node: entry({ name: 'src', kind: 'dir', ext: null, language: null }),
    expanded: false,
    loaded: true,
    children: [],
  },
  {
    path: 'plan.md',
    node: entry({
      name: 'plan.md',
      integrity: 'duoc_nguoi_dung_cho_phep',
      confidentiality: 'cong_khai',
    }),
    expanded: false,
    loaded: true,
    children: [],
  },
  {
    path: '.env',
    node: entry({
      name: '.env',
      ext: 'env',
      integrity: 'khong_tin_duoc',
      confidentiality: 'bi_mat',
    }),
    expanded: false,
    loaded: true,
    children: [],
  },
]

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

function renderTree(props: Partial<Parameters<typeof TreeView>[0]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const handlers = {
    onExpand: vi.fn(),
    onOpen: vi.fn(),
    onToggleSelect: vi.fn(),
    onSelectRange: vi.fn(),
    onContextMenu: vi.fn(),
    onContextMenuBackground: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    onMove: vi.fn(),
  }
  act(() => {
    root.render(
      <I18nProvider>
        <TreeView
          tree={TREE}
          expanded={new Set()}
          selected={new Set()}
          error={null}
          {...handlers}
          {...props}
        />
      </I18nProvider>,
    )
  })
  return { host, handlers }
}

function rowButton(host: HTMLElement, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(name))
  if (!found) throw new Error(`Không thấy hàng "${name}".`)
  return found as HTMLButtonElement
}

/** DataTransfer giả — jsdom không dựng được DragEvent thật. */
function dataTransfer(path: string) {
  const store = new Map<string, string>([[WORKSPACE_PATH_MIME, path]])
  return {
    types: [WORKSPACE_PATH_MIME],
    effectAllowed: 'none',
    dropEffect: 'none',
    files: [] as unknown[],
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => void store.set(type, value),
  }
}

function dragEvent(type: string, dt: ReturnType<typeof dataTransfer>): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  return ev
}

describe('TreeView — hàng file/thư mục', () => {
  it('hiện huy hiệu integrity + confidentiality của entry', () => {
    const { host } = renderTree()
    expect(host.textContent).toContain('Được người dùng cho phép')
    expect(host.textContent).toContain('Công khai')
    expect(host.textContent).toContain('Không tin được')
    expect(host.textContent).toContain('Bí mật')
  })

  it('hàng đang có thao tác ghi thì bị khoá', () => {
    const { host, handlers } = renderTree({ pendingPaths: new Set(['plan.md']) })
    const pending = rowButton(host, 'plan.md')
    expect(pending.disabled).toBe(true)
    const idle = rowButton(host, 'src')
    expect(idle.disabled).toBe(false)

    act(() => {
      idle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(handlers.onExpand).toHaveBeenCalledWith('src')
  })

  it('đổi tên tại chỗ: ô nhập thay tên, Enter ghi tên mới', () => {
    const { host, handlers } = renderTree({ renamingPath: 'plan.md' })
    const input = host.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('plan.md')

    act(() => {
      input.value = 'ke-hoach.md'
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(handlers.onRenameCommit).toHaveBeenCalledWith('plan.md', 'ke-hoach.md')
  })

  it('Escape trong ô đổi tên thì huỷ, không ghi', () => {
    const { host, handlers } = renderTree({ renamingPath: 'plan.md' })
    const input = host.querySelector('input') as HTMLInputElement
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(handlers.onRenameCommit).not.toHaveBeenCalled()
    expect(handlers.onRenameCancel).toHaveBeenCalled()
  })

  it('thả một entry vào hàng thư mục thì gọi onMove tới thư mục đó', () => {
    const { host, handlers } = renderTree()
    const target = rowButton(host, 'src')
    const dt = dataTransfer('plan.md')

    act(() => {
      target.dispatchEvent(dragEvent('dragover', dt))
      target.dispatchEvent(dragEvent('drop', dt))
    })
    expect(handlers.onMove).toHaveBeenCalledWith('plan.md', 'src')
  })

  it('không nhận thả thư mục vào chính nó hoặc vào con của nó', () => {
    const { host, handlers } = renderTree()
    const target = rowButton(host, 'src')
    const dt = dataTransfer('src')

    act(() => {
      target.dispatchEvent(dragEvent('drop', dt))
    })
    expect(handlers.onMove).not.toHaveBeenCalled()

    // Hàm thuần cũng chặn cùng luật — kể cả khi đích là thư mục con.
    const nested = dataTransfer('src')
    expect(acceptsPathDrop({ dataTransfer: nested, preventDefault: () => {} } as never, 'src/nested')).toBe(false)
    // Còn thư mục khác thì vẫn nhận.
    expect(acceptsPathDrop({ dataTransfer: nested, preventDefault: () => {} } as never, 'docs')).toBe(true)
  })

  it('chuột phải vùng trống gọi onContextMenuBackground, bấm trên hàng thì chỉ gọi onContextMenu', () => {
    const { host, handlers } = renderTree()
    const container = host.firstElementChild as HTMLElement

    act(() => {
      container.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 12, clientY: 34 }))
    })
    expect(handlers.onContextMenuBackground).toHaveBeenCalledWith(12, 34)

    act(() => {
      rowButton(host, 'plan.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 6 }))
    })
    expect(handlers.onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ name: 'plan.md' }), 5, 6)
    expect(handlers.onContextMenuBackground).toHaveBeenCalledTimes(1)
  })

  it('thư mục rỗng (không có hàng nào) vẫn nhận chuột phải trên vùng trống', () => {
    const { host, handlers } = renderTree({ tree: [] })
    act(() => {
      ;(host.firstElementChild as HTMLElement).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 1, clientY: 2 }),
      )
    })
    expect(handlers.onContextMenuBackground).toHaveBeenCalledWith(1, 2)
  })

  it('startPathDrag đặt MIME nội bộ nên thả tệp từ hệ điều hành vẫn là upload', () => {
    const dt = dataTransfer('')
    startPathDrag({ dataTransfer: dt } as never, 'src/parser.py')
    expect(dt.getData(WORKSPACE_PATH_MIME)).toBe('src/parser.py')
    expect(dt.effectAllowed).toBe('move')
    expect(isPathDrag({ dataTransfer: dt } as never)).toBe(true)
    expect(isPathDrag({ dataTransfer: { types: ['Files'], getData: () => '' } } as never)).toBe(false)
  })
})
