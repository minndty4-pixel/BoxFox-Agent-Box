/**
 * A10 (kế hoạch v1 Phần A) — bong bóng người dùng phải cho thấy nội dung đã đi tới box.
 *
 * Ba điều được đo:
 *   1. lượt có `attachments` ⇒ hiện chip mỗi tệp (tên + dung lượng, `title` = đường dẫn tuyệt đối);
 *   2. lượt có nhiều ảnh (`images`) ⇒ hiện đủ số ảnh, mỗi ảnh mở được lightbox;
 *   3. bản ghi CŨ (chỉ `image` số ít, không có `attachments`) ⇒ render y hệt trước đây, không chip.
 *
 * E5 (đợt 22) thêm hai điều nữa, đo trong khối `describe` cuối: chip đọc
 * `đường dẫn · dung lượng · loại` và có nút "Mở trong Files" gọi `uiStore.selectFile(path)`.
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { HarnessEvent } from '../../store/harnessChatStore'
import { useUiStore } from '../../store/uiStore'
import type { LightboxMediaProps } from './MediaLightboxModal'
import { HarnessStepView } from './HarnessStepView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let seq = 0

function ev(type: string, data: Record<string, unknown> = {}): HarnessEvent {
  seq += 1
  return { seq, type, data, created: 1000 + seq }
}

function render(events: HarnessEvent[], onOpenLightbox?: (media: LightboxMediaProps) => void): HTMLElement {
  const node: ReactNode = (
    <HarnessStepView events={events} status="idle" error={null} onOpenLightbox={onOpenLightbox} />
  )
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

function click(el: Element | null | undefined) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  seq = 0
})

beforeEach(() => {
  localStorage.clear()
  useUiStore.setState({ selectedFilePath: null })
})

describe('HarnessStepView — nội dung đính kèm trên bong bóng người dùng (A10)', () => {
  it('lượt có attachments ⇒ chip tên + dung lượng, title là đường dẫn tuyệt đối', () => {
    const host = render([
      ev('user', {
        text: 'Đọc 2 tệp này',
        attachments: [
          { name: '3096.png', path: '.uploaded_artifacts/3096.png', sizeBytes: 214 * 1024 },
          { name: '3101.txt', path: '.uploaded_artifacts/3101.txt', sizeBytes: 1229 },
        ],
      }),
    ])

    const chips = host.querySelectorAll('[data-testid="user-attachment-chip"]')
    expect(chips).toHaveLength(2)
    expect(chips[0].getAttribute('title')).toBe('/home/agent/workspace/.uploaded_artifacts/3096.png')
    expect(chips[0].textContent).toContain('3096.png')
    expect(chips[0].textContent).toContain('214 KB')
    expect(chips[1].textContent).toContain('3101.txt')
    expect(chips[1].textContent).toContain('1 KB')
  })

  it('lượt có nhiều ảnh ⇒ hiện đủ ảnh, mỗi ảnh mở lightbox đúng src', () => {
    const onOpenLightbox = vi.fn()
    const host = render(
      [
        ev('user', {
          text: 'xem ảnh',
          images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
          image: 'data:image/png;base64,AAA',
        }),
      ],
      onOpenLightbox,
    )

    const images = Array.from(host.querySelectorAll('img[alt="Attached"]')) as HTMLImageElement[]
    expect(images).toHaveLength(2)
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'data:image/png;base64,AAA',
      'data:image/png;base64,BBB',
    ])
    click(images[1].closest('div[title]'))
    expect(onOpenLightbox).toHaveBeenCalledWith({ type: 'image', src: 'data:image/png;base64,BBB', caption: 'Attached image' })
  })

  it('bản ghi CŨ (chỉ `image` số ít, không attachments) ⇒ một ảnh, KHÔNG có chip tệp', () => {
    const host = render([ev('user', { text: 'lượt cũ', image: 'data:image/png;base64,OLD' })])

    const images = Array.from(host.querySelectorAll('img[alt="Attached"]')) as HTMLImageElement[]
    expect(images).toHaveLength(1)
    expect(images[0].getAttribute('src')).toBe('data:image/png;base64,OLD')
    expect(host.querySelector('[data-testid="user-attachments"]')).toBeNull()
  })

  it('`attachments` méo (phần tử rác) bị bỏ qua, không làm vỡ bong bóng', () => {
    const host = render([
      ev('user', {
        text: 'dữ liệu méo',
        attachments: [null, 'rác', { path: '.uploaded_artifacts/7.md' }],
      }),
    ])

    const chips = host.querySelectorAll('[data-testid="user-attachment-chip"]')
    expect(chips).toHaveLength(1)
    // Thiếu `name` thì lấy `path` làm nhãn, thiếu `sizeBytes` thì không bịa dung lượng.
    expect(chips[0].textContent).toContain('.uploaded_artifacts/7.md')
    expect(chips[0].textContent).not.toContain('KB')
  })
})

describe('HarnessStepView — chip đính kèm E5: đường dẫn · dung lượng · loại + Mở trong Files', () => {
  it('chip đọc đủ ba phần và nút mở đúng tệp trong tab Files', () => {
    const host = render([
      ev('user', {
        text: 'Đọc 3 tệp này',
        attachments: [
          { name: '3096.png', path: '.uploaded_artifacts/3096.png', sizeBytes: 214 * 1024, kind: 'image' },
          { name: '3101.txt', path: '.uploaded_artifacts/3101.txt', sizeBytes: 1229 },
          { name: 'khối.bin', path: '.uploaded_artifacts/khối.bin', sizeBytes: 40 },
        ],
      }),
    ])

    const chips = host.querySelectorAll('[data-testid="user-attachment-chip"]')
    expect(chips).toHaveLength(3)
    // Thứ tự trong hàng theo mockup `attachments-chip-row`: đường dẫn · dung lượng · loại.
    expect(chips[0].textContent).toContain('.uploaded_artifacts/3096.png')
    expect(chips[0].textContent).toContain('214 KB')
    expect(chips[0].textContent).toContain('ảnh')
    // Bản ghi cũ không khai `kind`: suy từ phần mở rộng.
    expect(chips[1].textContent).toContain('văn bản')
    // Không dám chắc loại thì nói "tệp", không gán bừa.
    expect(chips[2].textContent).toContain('tệp')

    const open = chips[0].querySelector('[data-testid="user-attachment-open-files"]')
    expect(open).toBeTruthy()
    click(open)

    // Đúng hành động đã có sẵn: `selectFile` mở tab Files với đường dẫn tương đối của box.
    expect(useUiStore.getState().selectedFilePath).toBe('.uploaded_artifacts/3096.png')
    expect(useUiStore.getState().activeTab).toBe('files')
  })

  it('tệp chỉ có tên, không có đường dẫn: không có nút mở (không bịa đường dẫn)', () => {
    const host = render([
      ev('user', { text: 'x', attachments: [{ name: 'chỉ-có-tên.txt' }] }),
    ])

    const chip = host.querySelector('[data-testid="user-attachment-chip"]')
    expect(chip?.textContent).toContain('chỉ-có-tên.txt')
    expect(chip?.querySelector('[data-testid="user-attachment-open-files"]')).toBeNull()
    expect(useUiStore.getState().selectedFilePath).toBeNull()
  })
})
