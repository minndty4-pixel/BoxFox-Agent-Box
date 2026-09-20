/**
 * F1 (đợt 7): một bản ghi màn hình hiện thành hai player.
 * `computer_screen_record action=start` trả về đường dẫn tệp đang ghi (không có durationSec);
 * hàng `stop` mới là tệp đã ghi xong. Chỉ hàng thứ hai được coi là media.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessStepView, extractToolMedia } from './HarnessStepView'
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

const START = ev('tool_end', {
  name: 'computer_screen_record',
  args: { action: 'start' },
  result: { ok: true, recordingId: 'rec-1', path: '/home/agent/workspace/.generated_artifacts/screen/rec-1.mp4', format: 'mp4' },
})
const STOP = ev('tool_end', {
  name: 'computer_screen_record',
  args: { action: 'stop' },
  result: { ok: true, recordingId: 'rec-1', path: '/home/agent/workspace/.generated_artifacts/screen/rec-1.mp4', durationSec: 6.73, bytes: 153403 },
})

describe('HarnessStepView — media của bản ghi', () => {
  it('bỏ qua payload action=start vì tệp chưa ghi xong', () => {
    expect(extractToolMedia(START)).toBeNull()
    expect(extractToolMedia(STOP)?.kind).toBe('video')
    expect(extractToolMedia(STOP)?.durationSec).toBe(6.73)
  })

  it('một bản ghi chỉ hiện một player dù có cả hàng start lẫn hàng stop', () => {
    const host = render(
      <HarnessStepView
        events={[
          ev('user', { text: 'ghi màn hình rồi dừng lại' }),
          ev('tool_start', { id: 'r1', name: 'computer_screen_record', args: { action: 'start' } }),
          START,
          ev('tool_start', { id: 'r2', name: 'computer_screen_record', args: { action: 'stop' } }),
          STOP,
          ev('assistant', { text: 'Đã ghi xong màn hình.', final: true }),
        ]}
        status="completed"
        error={null}
      />,
    )
    // Danh sách media cuối lượt: đúng một thẻ, không nhân đôi vì hàng `start`.
    expect(host.querySelectorAll('[data-final-media="true"] video').length).toBe(1)
    expect(host.querySelectorAll('video').length).toBe(2) // 1 trong hàng tool + 1 ở danh sách cuối lượt
  })
})
