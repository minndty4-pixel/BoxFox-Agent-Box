/**
 * Hợp đồng §3: gõ trong khung soạn tin là hoạt động thật của người dùng, nên ý
 * định tự mở tab của agent phải xếp hàng thay vì cướp màn hình. Việc ghi mốc
 * hoạt động không được đổi bất cứ thứ gì nhìn thấy.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useUiStore } from '../../store/uiStore'
import { ChatInputBar } from './ChatInputBar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

beforeEach(() => {
  localStorage.clear()
  useUiStore.setState({ lastUserActivityAt: 0, autoOpenOnlyWhenIdle: true, autoOpenTabs: true })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

describe('ChatInputBar — ghi mốc hoạt động cho luật tự mở tab', () => {
  it('gõ phím trong khung soạn tin làm ý định tự mở tab xếp hàng', () => {
    const host = render(<ChatInputBar />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()

    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })

    expect(useUiStore.getState().lastUserActivityAt).toBeGreaterThan(0)
    expect(
      useUiStore.getState().requestTabIntent({ tab: 'plan', target: { identity: 'p' }, reason: 'plan_written' }),
    ).toBe('queued')
    expect(useUiStore.getState().pendingIntents).toHaveLength(1)
  })

  it('không gõ gì thì mốc hoạt động vẫn nguyên, tab mở được ngay', () => {
    render(<ChatInputBar />)

    expect(useUiStore.getState().lastUserActivityAt).toBe(0)
    expect(useUiStore.getState().requestTabIntent({ tab: 'plan', reason: 'plan_written' })).toBe('opened')
  })

  it('thao tác trong khung soạn tin không đổi giao diện khung chat', () => {
    const host = render(<ChatInputBar />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null
    const before = host.innerHTML

    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
    })

    expect(host.innerHTML).toBe(before)
  })
})
