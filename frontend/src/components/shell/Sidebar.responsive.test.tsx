import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useUiStore } from '../../store/uiStore'
import { Sidebar } from './Sidebar'
import {
  COMPACT_VIEWPORT_MAX_PX,
  NARROW_VIEWPORT_MAX_PX,
  isCompactViewport,
  isNarrowViewport,
} from './useViewportWidth'

/**
 * §D-U4/BUG-23/BUG-25 của `docs/plan/fix-plan-e2e-defects.md`:
 *  • ở 390×844 sidebar 260px bóp cột chat còn ~120px → dưới ~1024px sidebar
 *    thu về thanh biểu tượng, panel đầy đủ chỉ mở dạng overlay;
 *  • nhãn tài khoản không được hiện chuỗi literal `undefined user`.
 *
 * Test này tách riêng khỏi `Sidebar.test.tsx` (bộ cũ đang có 3 test hỏng sẵn
 * không liên quan) để số lượng hỏng nền vẫn đọc được.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { agentApiMock } = vi.hoisted(() => ({ agentApiMock: vi.fn() }))
vi.mock('../../lib/agentApi', () => ({ agentApi: agentApiMock }))

let roots: Root[] = []

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

function setViewportWidth(width: number) {
  window.innerWidth = width
}

function fullPanelOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector('aside.w-\\[260px\\]')
}

function railOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector('aside.w-14')
}

beforeEach(() => {
  setViewportWidth(1280)
  useUiStore.setState({ userEmail: '', sidebarCollapsed: false })
  agentApiMock.mockReset()
  agentApiMock.mockImplementation(async () => ({ sessions: [] }))
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  setViewportWidth(1280)
  useUiStore.setState({ userEmail: '', sidebarCollapsed: false })
  vi.restoreAllMocks()
})

describe('useViewportWidth — phân loại bề rộng', () => {
  it('biên hẹp/compact tính bằng px, chưa đo được (0) thì không coi là hẹp', () => {
    expect(NARROW_VIEWPORT_MAX_PX).toBe(1024)
    expect(COMPACT_VIEWPORT_MAX_PX).toBe(768)
    expect(isNarrowViewport(390)).toBe(true)
    expect(isNarrowViewport(1023)).toBe(true)
    expect(isNarrowViewport(1024)).toBe(false)
    expect(isCompactViewport(390)).toBe(true)
    expect(isCompactViewport(768)).toBe(false)
    // jsdom/SSR chưa có layout: 0 nghĩa là "chưa đo", không nháy thanh biểu tượng.
    expect(isNarrowViewport(0)).toBe(false)
    expect(isCompactViewport(0)).toBe(false)
  })
})

describe('Sidebar — bố cục theo bề rộng (§D-U4)', () => {
  it('dưới 1024px chỉ còn thanh biểu tượng, không dựng cột 260px', () => {
    setViewportWidth(390)
    const host = render(<Sidebar />)
    expect(railOf(host)).toBeTruthy()
    expect(fullPanelOf(host)).toBeNull()
  })

  it('mở panel đầy đủ dạng overlay ở màn hẹp và đóng lại được', () => {
    setViewportWidth(390)
    const host = render(<Sidebar />)
    const expandButton = host.querySelector('aside.w-14 button[title="Expand sidebar"]') as HTMLButtonElement | null
    expect(expandButton).toBeTruthy()

    act(() => {
      expandButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const panel = fullPanelOf(host)
    expect(panel).toBeTruthy()
    expect(panel?.getAttribute('class')).toContain('fixed')

    // Lớp phủ đóng panel.
    const overlay = host.querySelector('div.fixed.inset-0')
    expect(overlay).toBeTruthy()
    act(() => {
      overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(fullPanelOf(host)).toBeNull()
  })

  it('ở màn rộng vẫn giữ nguyên cột 260px như trước', () => {
    setViewportWidth(1280)
    const host = render(<Sidebar />)
    expect(fullPanelOf(host)).toBeTruthy()
    expect(railOf(host)).toBeNull()
  })
})

describe('Sidebar — nhãn tài khoản (§D-U4/BUG-25)', () => {
  it('không hiện chuỗi literal `undefined user` khi chưa có email', () => {
    setViewportWidth(1280)
    useUiStore.setState({ userEmail: '' })
    const host = render(<Sidebar />)
    expect(host.textContent).not.toContain('undefined user')
    expect(host.textContent).toContain('No email set')
  })

  it('hiện email thật khi có', () => {
    setViewportWidth(1280)
    useUiStore.setState({ userEmail: 'dev@boxfox.local' })
    const host = render(<Sidebar />)
    expect(host.textContent).toContain('dev@boxfox.local')
  })

  it('menu tài khoản dùng khoá i18n cho hồ sơ tài khoản', () => {
    setViewportWidth(1280)
    const host = render(<Sidebar />)
    const accountButton = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('No email set'),
    ) as HTMLButtonElement
    expect(accountButton).toBeTruthy()

    act(() => {
      accountButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.textContent).toContain('Account profile')
  })
})
