/**
 * B4 — kéo thanh chia cũng là hoạt động THẬT của người dùng.
 *
 * Trước bản sửa, `Resizer` không ghi mốc hoạt động, nên người dùng đang chỉnh bề
 * rộng vẫn bị agent mở tab mới (điều kiện 3 của hợp đồng §3 tưởng là "đang rảnh").
 * Test này chốt hai đường (chuột/kéo và bàn phím) đều ghi mốc, và chốt luôn mặt
 * còn lại: một `pointermove` không nằm trong cú kéo KHÔNG được tính là hoạt động.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useUiStore } from '../../store/uiStore'
import { Resizer } from './Resizer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  localStorage.clear()
  useUiStore.setState({
    lastUserActivityAt: 0,
    autoOpenTabs: true,
    autoOpenOnlyWhenIdle: true,
    pendingIntents: [],
    splitRatio: 0.6,
    pinnedTab: null,
  })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

/** Container giả có bề rộng xác định (jsdom luôn trả 0 nếu không ghim). */
function makeContainer(width: number): HTMLDivElement {
  const el = document.createElement('div')
  document.body.append(el)
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 600, width, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return el
}

function render(containerRef: React.RefObject<HTMLDivElement | null>): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <I18nProvider>
        <Resizer containerRef={containerRef} />
      </I18nProvider>,
    )
  })
  return host
}

function separator(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>('[role="separator"]')
  if (!el) throw new Error('Không thấy thanh chia.')
  return el
}

/** jsdom không có Pointer Events: gửi `MouseEvent` mang đúng tên sự kiện. */
function pointer(el: HTMLElement, type: string, clientX: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0 })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  act(() => {
    el.dispatchEvent(event)
  })
}

async function drag(el: HTMLElement, fromX: number, toX: number) {
  // `setPointerCapture` không có trong jsdom; ghim như trình duyệt thật đã làm.
  const target = el as HTMLElement & { setPointerCapture?: (id: number) => void }
  target.setPointerCapture = () => {}
  target.releasePointerCapture = () => {}
  pointer(el, 'pointerdown', fromX)
  pointer(el, 'pointermove', toX)
  pointer(el, 'pointerup', toX)
  await act(async () => {
    await Promise.resolve()
  })
}

describe('Resizer — kéo thanh chia ghi mốc hoạt động (B4)', () => {
  it('kéo bằng chuột: ghi mốc hoạt động và vẫn kẹp theo sàn pixel', async () => {
    const host = render({ current: makeContainer(1000) })
    const sep = separator(host)

    await drag(sep, 600, 320)

    expect(useUiStore.getState().lastUserActivityAt).toBeGreaterThan(0)
    // 320 px < sàn chat 400 px ⇒ vẫn kẹp về 0.4 (hành vi cũ giữ nguyên).
    expect(useUiStore.getState().splitRatio).toBeCloseTo(0.4, 5)
  })

  it('đang kéo thì agent không cướp màn hình: ý định mở tab xếp hàng', async () => {
    const host = render({ current: makeContainer(1000) })
    await drag(separator(host), 600, 700)

    expect(
      useUiStore.getState().requestTabIntent({ tab: 'plan', target: { identity: 'p' }, reason: 'plan_written' }),
    ).toBe('queued')
  })

  it('bàn phím (ArrowLeft/ArrowRight) cũng ghi mốc hoạt động', async () => {
    // Bề rộng 2000 để hai sàn pixel không chặn bước 0.02 (ở 1000 px, luật 0.45
    // kẹp cột phải còn 450 px nên bước âm bị hấp thụ — đúng hành vi cũ).
    const host = render({ current: makeContainer(2000) })
    const sep = separator(host)

    act(() => {
      sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(useUiStore.getState().lastUserActivityAt).toBeGreaterThan(0)
    expect(useUiStore.getState().splitRatio).toBeCloseTo(0.58, 5)

    act(() => {
      sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(useUiStore.getState().splitRatio).toBeCloseTo(0.6, 5)
  })

  it('phím khác không phải thao tác chỉnh bề rộng → không đổi gì', async () => {
    const host = render({ current: makeContainer(1000) })
    const sep = separator(host)

    act(() => {
      sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })
    expect(useUiStore.getState().lastUserActivityAt).toBe(0)
    expect(useUiStore.getState().splitRatio).toBe(0.6)
  })

  it('`pointermove` ngoài cú kéo không tính là hoạt động', async () => {
    const host = render({ current: makeContainer(1000) })
    pointer(separator(host), 'pointermove', 500)

    expect(useUiStore.getState().lastUserActivityAt).toBe(0)
  })

  it('container không đo được vẫn ghi mốc (cú kéo là thật, kể cả khi tỉ lệ không tính được)', async () => {
    const host = render({ current: makeContainer(0) })
    await drag(separator(host), 600, 700)

    expect(document.querySelector('[role="separator"]')).toBeTruthy()
    expect(useUiStore.getState().lastUserActivityAt).toBeGreaterThan(0)
    expect(useUiStore.getState().splitRatio).toBe(0.6)
  })
})
