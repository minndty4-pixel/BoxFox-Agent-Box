/**
 * Harness thử lại yêu cầu model sau khi socket đứt giữa câu trả lời.
 *
 * Lượt thử đầu đã phát một phần văn bản; event `notice` với `reset: true` báo rằng
 * phần đó bị bỏ. Không có bước làm sạch này, câu trả lời mới bị DÁN vào phần cũ
 * (đúng triệu chứng văn bản lặp mà chủ sở hữu báo) và người dùng không biết vì sao
 * câu trả lời bắt đầu lại.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessStepView } from './HarnessStepView'
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

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

describe('HarnessStepView — notice thử lại', () => {
  it('hiện một dòng thông báo, không phải bảng màu mới', () => {
    const host = render(
      <HarnessStepView
        events={[
          ev('user', { text: 'viết kế hoạch' }),
          ev('notice', { code: 'UPSTREAM_RETRY', reset: true, message: 'UPSTREAM_UNREACHABLE: đang thử lại' }),
          ev('assistant', { text: 'Kế hoạch mới.', final: true }),
        ]}
        status="completed"
        error={null}
      />,
    )
    const notice = host.querySelector('[data-timeline="notice"]') as HTMLElement | null
    expect(notice).toBeTruthy()
    expect(notice?.getAttribute('data-notice-code')).toBe('UPSTREAM_RETRY')
    expect(notice?.textContent).toContain('đang thử lại')
  })

  it('bỏ văn bản đang stream của lần thử hỏng, không dán vào câu trả lời mới', () => {
    const host = render(
      <HarnessStepView
        events={[
          ev('user', { text: 'viết kế hoạch' }),
          ev('assistant_delta', { text: 'Kế hoạch chi' }),
          ev('assistant_delta', { text: ' tiết cho' }),
          ev('notice', { code: 'UPSTREAM_RETRY', reset: true, message: 'thử lại' }),
          ev('assistant_delta', { text: 'Xin chào, đây là kế hoạch mới.' }),
          ev('assistant', { text: 'Xin chào, đây là kế hoạch mới.', final: true }),
        ]}
        status="completed"
        error={null}
      />,
    )
    const text = (host.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toContain('Xin chào, đây là kế hoạch mới.')
    // Phần đã phát trước khi thử lại không được còn trên màn hình.
    expect(text).not.toContain('Kế hoạch chi tiết cho')
    expect(host.querySelectorAll('[data-timeline="assistant-text"]').length).toBe(0)
  })
})
