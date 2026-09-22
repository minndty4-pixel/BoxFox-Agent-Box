/**
 * Khung xem phương tiện (D1 + D2 + D3 của Kế hoạch D).
 *
 * Đây là những ca ĐẦU TIÊN cho `MediaLightboxModal` (trước đợt này tệp có 0 ca).
 * Lý do tồn tại: một bản ghi `.mp4` từng rơi vào nhánh ảnh (`<img alt="Sandbox Screen
 * Recording">`) và nút Download từng lưu nó thành `.png`, vì `type` là trường tuỳ chọn
 * và người gọi quên gửi. Ba việc dưới đây khoá đúng ba lỗi đó:
 * - D1: `type` bắt buộc — nhánh ảnh/video chọn theo `type` thật, không có mặc định.
 * - D2: đuôi tệp khi tải về suy từ **chính nguồn** trước, rồi mới tới `type`, cuối cùng là `png`.
 * - D3: bản ghi thiếu số thời lượng phải nói thật là thiếu, và lỗi phát phải có câu trả lời.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaLightboxModal } from './MediaLightboxModal'
import { I18nProvider } from '../../i18n'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let anchors: HTMLAnchorElement[] = []

function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<I18nProvider>{node}</I18nProvider>))
  roots.push(root)
  return host
}

function click(el: Element | null) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function downloadButton(host: HTMLElement): Element | null {
  return host.querySelector('button[title="Download Media File"]')
}

/** Bấm Download rồi đọc `download` của thẻ <a> mà khung xem vừa tạo. */
function downloadedName(host: HTMLElement): string {
  anchors = []
  click(downloadButton(host))
  const anchor = anchors[anchors.length - 1]
  return anchor?.download ?? ''
}

beforeEach(() => {
  anchors = []
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const el = realCreate(tag, options as ElementCreationOptions)
    if (tag === 'a') anchors.push(el as HTMLAnchorElement)
    return el
  }) as typeof document.createElement)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

const RECORDING_SRC = '/__box/file/media?path=%2Fhome%2Fagent%2Fworkspace%2F.generated_artifacts%2Fcaptures%2Fscreen%2F1789971805978-screen.mp4'
const CAPTURE_SRC = '/__box/file/media?path=%2Fhome%2Fagent%2Fworkspace%2F.generated_artifacts%2Fcaptures%2Fscreen%2F1789971811705-screen.png'

describe('MediaLightboxModal — D1 nhánh ảnh/video', () => {
  it('D1.1 type="video" mở nhánh <video> kèm thanh kéo tiến độ', () => {
    const host = render(<MediaLightboxModal type="video" src={RECORDING_SRC} caption="Sandbox Screen Recording" />)

    expect(host.querySelector('video')).toBeTruthy()
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('input[type="range"]')).toBeTruthy()
  })

  it('D1.2 type="image" mở nhánh <img>, không có player', () => {
    const host = render(<MediaLightboxModal type="image" src={CAPTURE_SRC} caption="Sandbox Desktop Screen Capture" />)

    expect(host.querySelector('img')).toBeTruthy()
    expect(host.querySelector('video')).toBeNull()
    expect(host.querySelector('input[type="range"]')).toBeNull()
  })

  it('D1.3 đúng một nhánh cho mỗi loại khi cùng một nguồn đổi type', () => {
    const asVideo = render(<MediaLightboxModal type="video" src={CAPTURE_SRC} />)
    expect(asVideo.querySelectorAll('video').length).toBe(1)
    expect(asVideo.querySelectorAll('img').length).toBe(0)

    const asImage = render(<MediaLightboxModal type="image" src={RECORDING_SRC} />)
    expect(asImage.querySelectorAll('img').length).toBe(1)
    expect(asImage.querySelectorAll('video').length).toBe(0)
  })
})

describe('MediaLightboxModal — D2 đuôi tệp khi tải về', () => {
  it('D2.1 đọc đuôi thật của đường dẫn trước: .mp4 ra .mp4', () => {
    const host = render(<MediaLightboxModal type="video" src={RECORDING_SRC} />)
    expect(downloadedName(host)).toMatch(/^boxfox-video-capture-\d+\.mp4$/)
  })

  it('D2.2 bản ghi bị mất type vẫn ra .mp4, không còn .png', () => {
    // Đúng lỗi đã xảy ra: `type` mặc định là 'image' cho một tệp `.mp4` → tên tải về thành `.png`.
    const host = render(<MediaLightboxModal type="image" src={RECORDING_SRC} />)
    expect(downloadedName(host)).toMatch(/\.mp4$/)
  })

  it('D2.3 nguồn không có đuôi đọc được thì theo type, rồi cuối cùng mới là .png', () => {
    const host = render(<MediaLightboxModal type="image" src="/__box/file/media?path=screen" />)
    expect(downloadedName(host)).toMatch(/^boxfox-image-capture-\d+\.png$/)
  })
})

describe('MediaLightboxModal — D3 bản ghi thiếu số và lỗi phát', () => {
  it('D3.1 thiếu duration: thanh kéo vẫn dùng được và chú thích nói thật là thiếu số', () => {
    const host = render(<MediaLightboxModal type="video" src={RECORDING_SRC} caption="Sandbox Screen Recording" />)

    const scrubber = host.querySelector('input[type="range"]') as HTMLInputElement | null
    expect(scrubber).toBeTruthy()
    expect(scrubber?.getAttribute('max')).toBe('100')

    const note = host.querySelector('[data-lightbox-duration-note="true"]')
    expect(note?.textContent).toContain('Duration unknown')
    expect(note?.textContent).toContain('did not stop cleanly')
  })

  it('D3.2 trình duyệt báo lỗi phát thì hiện câu nói thật thay vì khung trắng', () => {
    const host = render(<MediaLightboxModal type="video" src={RECORDING_SRC} />)

    const video = host.querySelector('video')!
    act(() => {
      video.dispatchEvent(new Event('error'))
    })

    const note = host.querySelector('[data-lightbox-play-error="true"]')
    expect(note?.textContent).toContain('could not be played here')
    expect(note?.textContent).toContain('download it to watch')
  })
})
