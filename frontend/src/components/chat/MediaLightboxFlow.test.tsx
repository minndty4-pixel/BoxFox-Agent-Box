/**
 * Đường đi thật của Kế hoạch D: từ một lượt trợ lý trong dòng thời gian tới khung xem phương tiện.
 *
 * Hai ca ở đây cố ý KHÔNG dựng `MediaLightboxModal` bằng tay. Chúng đi đúng đường
 * `HarnessStepView` → `onOpenLightbox(media)` → `MediaLightboxModal`, vì đó là chỗ lỗi
 * cũ nằm: người gọi quên gửi `type`, mà `type` lại có mặc định `'image'`, nên một bản
 * ghi `.mp4` rơi vào nhánh ảnh và hiện `<img alt="Sandbox Screen Recording">`.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessStepView } from './HarnessStepView'
import { MediaLightboxModal, type LightboxMediaProps } from './MediaLightboxModal'
import { I18nProvider } from '../../i18n'
import type { HarnessEvent } from '../../store/harnessChatStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let seq = 0

function ev(type: string, data: Record<string, unknown> = {}): HarnessEvent {
  seq += 1
  return { seq, type, data, created: 1000 + seq }
}

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

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

const RECORDING = '/home/agent/workspace/.generated_artifacts/captures/screen/1789971805978-screen.mp4'
const CAPTURE = '/home/agent/workspace/.generated_artifacts/captures/screen/1789971811705-screen.png'

function turnEvents(path: string, name: string, extra: Record<string, unknown>): HarnessEvent[] {
  return [
    ev('user', { text: 'chụp cho tôi xem màn hình' }),
    ev('tool_end', { name, args: { action: 'capture' }, result: { ok: true, path, ...extra } }),
    ev('assistant', { text: 'Đây là ảnh chụp màn hình.', final: true }),
  ]
}

/** Dựng lượt trợ lý, lấy đúng đối tượng mà người dùng bấm vào, rồi mở khung xem từ đó. */
function openFromTurn(events: HarnessEvent[]): { opened: LightboxMediaProps; modal: HTMLElement } {
  const opened: LightboxMediaProps[] = []
  const host = render(
    <HarnessStepView
      events={events}
      status="completed"
      error={null}
      onOpenLightbox={media => opened.push(media)}
    />,
  )

  click(host.querySelector('[data-activity-toggle="true"]'))
  click(host.querySelector('[data-media-toggle="true"]'))
  // Khung ảnh đã mở mang `data-media-open` — bấm đúng nó, không bấm nút thu hàng.
  click(host.querySelector('[data-media-open="true"]'))

  expect(opened.length).toBe(1)
  const modal = render(<MediaLightboxModal {...opened[0]} />)
  return { opened: opened[0], modal }
}

describe('HarnessStepView → MediaLightboxModal — đường đi thật', () => {
  it('bản ghi .mp4 của lượt mở ra player video, không phải ảnh', () => {
    const { opened, modal } = openFromTurn(
      turnEvents(RECORDING, 'computer_screen_record', { durationSec: 40.87, bytes: 153403 }),
    )

    expect(opened.type).toBe('video')
    expect(modal.querySelector('video')).toBeTruthy()
    expect(modal.querySelector('img')).toBeNull()
    expect(modal.querySelector('input[type="range"]')).toBeTruthy()
    // Tiêu đề và dòng chú thích phải nói đúng đây là bản ghi màn hình của máy ảo.
    const text = (modal.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toContain('Session Screen Recording')
    expect(text).toContain('Sandbox Screen Recording')
  })

  it('ảnh chụp .png của lượt mở ra ảnh, không có thanh kéo tiến độ', () => {
    const { opened, modal } = openFromTurn(turnEvents(CAPTURE, 'computer_screenshot', {}))

    expect(opened.type).toBe('image')
    expect(modal.querySelector('img')).toBeTruthy()
    expect(modal.querySelector('video')).toBeNull()
    expect(modal.querySelector('input[type="range"]')).toBeNull()
  })
})
