/**
 * Luồng thật của panel Files, chạy trên `MockWorkspaceRepository` (bật tường minh
 * qua env, đúng đường mà `createWorkspaceRepository` cho phép ở chế độ dev):
 * chuột phải → "Tạo file" → nhập tên tại chỗ → mục mới xuất hiện;
 * "Xoá" → xác nhận → mục biến mất; "Đổi tên" → ô nhập tại chỗ đổi tên mục.
 *
 * Không dùng mạng: mock là dữ liệu trong bộ nhớ của adapter, không phải dữ liệu
 * giả trên đường chạy thật.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import { WorkspaceFilesPanel } from './WorkspaceFilesPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  vi.stubEnv('VITE_WORKSPACE_SOURCE', 'mock')
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

async function settle(times = 8) {
  await act(async () => {
    for (let i = 0; i < times; i++) await Promise.resolve()
  })
}

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(
      <I18nProvider>
        <WorkspaceFilesPanel />
      </I18nProvider>,
    )
  })
  await settle()
  return host
}

function buttonWith(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)
  if (!found) throw new Error(`Không thấy nút "${label}". Danh sách: ${[...host.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`)
  return found as HTMLButtonElement
}

function elementWith(host: HTMLElement, label: string): HTMLElement {
  const found = [...host.querySelectorAll('*')].find((el) => (el.textContent ?? '').trim() === label)
  if (!found) throw new Error(`Không thấy mục "${label}".`)
  return found as HTMLElement
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function contextMenuOn(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }))
  })
}

async function typeInto(input: HTMLInputElement, value: string, key = 'Enter') {
  await act(async () => {
    input.value = value
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
  await settle()
}

describe('WorkspaceFilesPanel — tạo / đổi tên / xoá', () => {
  it('tạo file mới qua menu chuột phải rồi nhập tên tại chỗ', async () => {
    const host = await renderPanel()
    expect(host.textContent).toContain('plan.md')

    contextMenuOn(elementWith(host, 'plan.md'))
    click(buttonWith(host, 'New file'))

    const input = host.querySelector('input[aria-label="New entry name"]') as HTMLInputElement
    expect(input).toBeTruthy()
    await typeInto(input, 'ghi-chu.md')

    expect(host.textContent).toContain('ghi-chu.md')
  })

  it('tạo thư mục mới trong thư mục vừa bấm (đường dẫn đích hiện trên ô nhập)', async () => {
    const host = await renderPanel()
    contextMenuOn(elementWith(host, 'docs'))
    click(buttonWith(host, 'New folder'))

    expect(host.textContent).toContain('docs/')
    const input = host.querySelector('input[aria-label="New entry name"]') as HTMLInputElement
    await typeInto(input, 'nghien-cuu')

    // Thư mục mới nằm trong docs nên vào docs để thấy.
    click(elementWith(host, 'docs'))
    await settle()
    expect(host.textContent).toContain('nghien-cuu')
  })

  it('đổi tên tại chỗ: ô nhập hiện trên hàng và ghi tên mới', async () => {
    const host = await renderPanel()
    contextMenuOn(elementWith(host, 'plan.md'))
    click(buttonWith(host, 'Rename'))

    const input = host.querySelector('input[aria-label="New name"]') as HTMLInputElement
    expect(input.value).toBe('plan.md')
    await typeInto(input, 'ke-hoach.md')

    expect(host.textContent).toContain('ke-hoach.md')
    expect(host.textContent).not.toContain('plan.md')
  })

  it('xoá phải xác nhận và mục chuyển vào .trash rồi biến mất khỏi danh sách', async () => {
    const host = await renderPanel()
    contextMenuOn(elementWith(host, 'plan.md'))
    click(buttonWith(host, 'Delete'))

    expect(host.textContent).toContain('.trash')
    click(buttonWith(host, 'Move to .trash'))
    await settle()

    expect(host.textContent).not.toContain('plan.md')
  })

  it('thư mục rỗng vẫn tạo được mục mới: chuột phải vùng trống → Tạo file', async () => {
    const host = await renderPanel()
    // Tạo thư mục mới ở gốc (menu của một file ở gốc → đích là thư mục cha).
    contextMenuOn(elementWith(host, 'plan.md'))
    click(buttonWith(host, 'New folder'))
    await typeInto(host.querySelector('input[aria-label="New entry name"]') as HTMLInputElement, 'trong')

    // Vào thư mục rỗng: chỉ còn vùng trống.
    click(elementWith(host, 'trong'))
    await settle()
    expect(host.textContent).toContain('Folder is empty.')

    contextMenuOn(host.querySelector('.relative.overflow-auto') as HTMLElement)
    const labels = [...host.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())
    expect(labels).toEqual(expect.arrayContaining(['New file', 'New folder']))
    expect(labels).not.toContain('Delete')

    click(buttonWith(host, 'New file'))
    expect(host.textContent).toContain('trong/')
    await typeInto(host.querySelector('input[aria-label="New entry name"]') as HTMLInputElement, 'ghi-chu.md')

    expect(host.textContent).toContain('ghi-chu.md')
  })

  it('huỷ xác nhận xoá thì mục vẫn còn', async () => {
    const host = await renderPanel()
    contextMenuOn(elementWith(host, 'plan.md'))
    click(buttonWith(host, 'Delete'))
    click(buttonWith(host, 'Cancel'))
    await settle()

    expect(host.textContent).toContain('plan.md')
  })
})
