/**
 * Menu chuột phải của panel Files: các hàng mới (Tạo file / Tạo thư mục / Đổi tên
 * / Xoá) gọi đúng callback, và "Xoá" bắt buộc qua bước xác nhận nói rõ mục sẽ được
 * chuyển vào `.trash` — không bao giờ nói "xoá vĩnh viễn".
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { I18nProvider } from '../../../i18n'
import type { WorkspaceEntry } from '../../../lib/workspace'
import { ContextMenu } from './ContextMenu'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FILE: WorkspaceEntry = {
  name: 'plan.md',
  kind: 'file',
  sizeBytes: 12,
  mtime: '2026-08-28T12:00:00Z',
  integrity: 'duoc_nguoi_dung_cho_phep',
  confidentiality: 'cong_khai',
  ext: 'md',
  language: 'markdown',
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

interface Callbacks {
  onClose: Mock<() => void>
  onDownload: Mock<(path: string) => void>
  onZip: Mock<() => void>
  onUnzip: Mock<(path: string) => void>
  onOpenInIde: Mock<(path: string) => void>
  onNewFile: Mock<(entry: WorkspaceEntry, path: string) => void>
  onNewFolder: Mock<(entry: WorkspaceEntry, path: string) => void>
  onRename: Mock<(path: string) => void>
  onDelete: Mock<(path: string) => void>
}

function renderMenu(path = 'docs/plan.md', entry: WorkspaceEntry = FILE, background = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const cb: Callbacks = {
    onClose: vi.fn<() => void>(),
    onDownload: vi.fn<(path: string) => void>(),
    onZip: vi.fn<() => void>(),
    onUnzip: vi.fn<(path: string) => void>(),
    onOpenInIde: vi.fn<(path: string) => void>(),
    onNewFile: vi.fn<(entry: WorkspaceEntry, path: string) => void>(),
    onNewFolder: vi.fn<(entry: WorkspaceEntry, path: string) => void>(),
    onRename: vi.fn<(path: string) => void>(),
    onDelete: vi.fn<(path: string) => void>(),
  }
  act(() => {
    root.render(
      <I18nProvider>
        <ContextMenu anchor={{ x: 10, y: 10 }} path={path} entry={entry} selectedCount={1} background={background} {...cb} />
      </I18nProvider>,
    )
  })
  return { host, cb }
}

function row(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))
  if (!found) throw new Error(`Không thấy hàng "${label}" trong menu.`)
  return found as HTMLButtonElement
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('ContextMenu — thao tác ghi', () => {
  it('hiện đủ hàng Tạo file / Tạo thư mục / Đổi tên / Xoá cùng các hàng cũ', () => {
    const { host } = renderMenu()
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Download', 'Zip & download', 'New file', 'New folder', 'Rename', 'Delete', 'Open in VS Code Web']))
  })

  it('Tạo file / Tạo thư mục gọi callback kèm entry + đường dẫn rồi đóng menu', () => {
    const first = renderMenu()
    click(row(first.host, 'New file'))
    expect(first.cb.onNewFile).toHaveBeenCalledWith(FILE, 'docs/plan.md')
    expect(first.cb.onClose).toHaveBeenCalled()

    const second = renderMenu()
    click(row(second.host, 'New folder'))
    expect(second.cb.onNewFolder).toHaveBeenCalledWith(FILE, 'docs/plan.md')
  })

  it('Đổi tên gọi callback với đường dẫn', () => {
    const { host, cb } = renderMenu()
    click(row(host, 'Rename'))
    expect(cb.onRename).toHaveBeenCalledWith('docs/plan.md')
  })

  it('Xoá KHÔNG xoá ngay: hiện bước xác nhận nói rõ chuyển vào .trash', () => {
    const { host, cb } = renderMenu()
    click(row(host, 'Delete'))

    expect(cb.onDelete).not.toHaveBeenCalled()
    const confirm = row(host, 'Move to .trash')
    expect(host.textContent).toContain('.trash')
    expect(host.textContent).toContain('plan.md')
    expect(host.textContent).not.toMatch(/permanently|vĩnh viễn/i)

    click(confirm)
    expect(cb.onDelete).toHaveBeenCalledWith('docs/plan.md')
    expect(cb.onClose).toHaveBeenCalled()
  })

  it('chuột phải vùng trống: chỉ hai hàng tạo mới cho chính thư mục đó', () => {
    const dir: WorkspaceEntry = { ...FILE, name: 'docs', kind: 'dir', ext: null, language: null }
    const { host, cb } = renderMenu('docs', dir, true)

    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['New file', 'New folder'])

    click(row(host, 'New folder'))
    expect(cb.onNewFolder).toHaveBeenCalledWith(dir, 'docs')
    expect(cb.onDelete).not.toHaveBeenCalled()
    expect(cb.onRename).not.toHaveBeenCalled()
  })

  it('huỷ ở bước xác nhận thì quay lại menu và không xoá gì', () => {
    const { host, cb } = renderMenu()
    click(row(host, 'Delete'))
    click(row(host, 'Cancel'))

    expect(cb.onDelete).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Delete')
    expect(host.textContent).not.toContain('Move to .trash')
  })
})
