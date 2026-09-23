/**
 * F1 (đợt 7): một bản ghi màn hình hiện thành hai player.
 * `computer_screen_record action=start` trả về đường dẫn tệp đang ghi (không có durationSec);
 * hàng `stop` mới là tệp đã ghi xong. Chỉ hàng thứ hai được coi là media.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessStepView, extractToolMedia, formatMediaLabel } from './HarnessStepView'
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

function click(el: Element | null | undefined) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** R2 (yêu cầu 5): lượt đã xong thì khối hoạt động đang gấp — mở ra rồi mới đọc hàng bên trong. */
function openActivity(host: HTMLElement) {
  click(host.querySelector('[data-activity-toggle="true"]'))
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

// Đường dẫn THẬT của bộ quay (`deploy/docker/capture.py:148-150`):
// `.generated_artifacts/captures/screen/<epoch-ms>-screen.mp4` — không phải `.generated_artifacts/screen/rec-1.mp4`.
const RECORDING_PATH = '/home/agent/workspace/.generated_artifacts/captures/screen/1789971805978-screen.mp4'

const START = ev('tool_end', {
  name: 'computer_screen_record',
  args: { action: 'start' },
  result: { ok: true, recordingId: 'rec-1', path: RECORDING_PATH, format: 'mp4' },
})
const STOP = ev('tool_end', {
  name: 'computer_screen_record',
  args: { action: 'stop' },
  result: { ok: true, recordingId: 'rec-1', path: RECORDING_PATH, durationSec: 40.87, bytes: 153403 },
})

describe('HarnessStepView — media của bản ghi', () => {
  it('bỏ qua payload action=start vì tệp chưa ghi xong', () => {
    expect(extractToolMedia(START)).toBeNull()
    expect(extractToolMedia(STOP)?.kind).toBe('video')
    expect(extractToolMedia(STOP)?.durationSec).toBe(40.87)
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
    // Mốc 1 (R2): lượt đã xong nên khối hoạt động gấp — chưa có player nào.
    expect(host.querySelectorAll('video').length).toBe(0)

    openActivity(host)

    // Mốc 2 (R1): hàng media đang gấp — vẫn chưa có player, chỉ có nhãn thật của bản ghi.
    expect(host.querySelector('[data-media-label="true"]')?.textContent).toBe('40.87s · MP4')
    expect(host.querySelectorAll('video').length).toBe(0)

    click(host.querySelector('[data-media-toggle="true"]'))

    expect(host.querySelectorAll('video').length).toBe(1)

    // Mốc 3 (R3, vòng 23 — D-19): mặt câu trả lời KHÔNG còn lưới ảnh do app vẽ. Bản ghi vẫn chỉ
    // hiện đúng MỘT player, và mở chi tiết câu trả lời không dựng thêm cái nào.
    click(host.querySelector('[data-final-expander="true"]'))

    expect(host.querySelectorAll('[data-final-media="true"]').length).toBe(0)
    expect(host.querySelectorAll('video').length).toBe(1)
    expect(host.querySelector('[data-final-text]')?.textContent).toContain('Đã ghi xong màn hình.')
  })

  it('D3.1 bản ghi không chạy stop vẫn có dòng media, để trống thời lượng và nói thật là chưa trọn', () => {
    // Đúng ca `1789929795687-screen.mp4` (7 438 731 byte, 560 s): tệp CÓ THẬT nhưng `stop`
    // không trả `durationSec`. Trước đợt này `extractToolMedia` trả `null` → không có đường nào mở tệp.
    const unfinished = ev('tool_end', {
      name: 'computer_screen_record',
      args: { action: 'stop' },
      result: { ok: true, recordingId: 'rec-2', path: '/home/agent/workspace/.generated_artifacts/captures/screen/1789929795687-screen.mp4', bytes: 7438731 },
    })

    const media = extractToolMedia(unfinished)

    expect(media).toBeTruthy()
    expect(media?.kind).toBe('video')
    expect(media?.durationSec).toBeUndefined()
    expect(media?.unfinished).toBe(true)
    // Nhãn không bịa số: thiếu số thời lượng thì chỉ in định dạng.
    expect(formatMediaLabel(media!)).toBe('MP4')
    expect(media?.src).toContain('/__box/file/media?path=')
  })

  it('D3.2 hàng hỏng (ok:false) hoặc không có tệp thì KHÔNG có dòng media', () => {
    expect(
      extractToolMedia(
        ev('tool_end', {
          name: 'computer_screen_record',
          args: { action: 'stop' },
          result: { ok: false, error: 'recording not found' },
        }),
      ),
    ).toBeNull()
    expect(
      extractToolMedia(
        ev('tool_end', {
          name: 'computer_screen_record',
          args: { action: 'stop' },
          result: { ok: true, recordingId: 'rec-3' },
        }),
      ),
    ).toBeNull()
  })

  it('D3.3 lượt chết trước khi kịp `stop`: hàng `start` vẫn mở được tệp, và vẫn chỉ một player', () => {
    // Ca sống `1789929795687-screen.mp4` (7 438 731 byte, 560 s): lượt hết hạn (DEADLINE) sau khi
    // `start` trả đường dẫn, KHÔNG có hàng `stop` nào trong dữ liệu. Trước đợt này hàng `start`
    // luôn bị vứt → không có đường nào mở tệp dài nhất của chủ sở hữu.
    const host = render(
      <HarnessStepView
        events={[
          ev('user', { text: 'ghi màn hình rồi làm tiếp' }),
          ev('tool_start', { id: 'r1', name: 'computer_screen_record', args: { action: 'start' } }),
          START,
          ev('error', { code: 'DEADLINE', message: 'DEADLINE: the turn ran out of time' }),
        ]}
        status="failed"
        error={null}
      />,
    )

    openActivity(host)

    // Hàng gấp có thật, nói thật là chưa trọn, và không bịa số thời lượng.
    const row = host.querySelector('[data-media-collapsed="true"]')
    expect(row).not.toBeNull()
    expect(row?.getAttribute('data-media-unfinished')).toBe('true')
    expect(host.querySelectorAll('[data-media-label="true"]')[0]?.textContent).toBe('MP4')
    expect(host.querySelectorAll('video').length).toBe(0)

    click(host.querySelector('[data-media-toggle="true"]'))

    const video = host.querySelector('video')
    expect(host.querySelectorAll('video').length).toBe(1)
    expect(video?.getAttribute('src')).toContain('/__box/file/media?path=')
    expect(video?.getAttribute('src')).toContain('1789971805978-screen.mp4')
    // Mở chi tiết hàng tool vẫn chỉ ra đúng tệp thật.
    expect(host.querySelector('[data-timeline=tool]')?.textContent).toContain(RECORDING_PATH)
  })

  it('D3.4 có hàng `stop` cho cùng tệp thì hàng `start` không thêm player thứ hai', () => {
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

    openActivity(host)

    // Đúng MỘT hàng gấp cho cả hai hàng tool — hàng `start` nhường hàng `stop`.
    expect(host.querySelectorAll('[data-media-collapsed="true"]').length).toBe(1)
    expect(host.querySelectorAll('[data-media-label="true"]')[0]?.textContent).toBe('40.87s · MP4')
    expect(host.querySelectorAll('[data-media-unfinished]').length).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 * Vòng 23 — P4.3 (nhãn lấy từ chữ của model, loại đọc từ đường dẫn box)
 * và P5.3 (chữ app đi theo ngôn ngữ câu trả lời)
 * ------------------------------------------------------------------ */

/** Đường dẫn THẬT của `computer_screen_capture` (`deploy/docker/capture.py`): tương đối, có `<kind>`. */
const CAPTURE_TAB = '.generated_artifacts/captures/tab/2e4f1a20/2e4f1a20_007_tab-runs-page.png'
const MODEL_CAPTION = 'Trang chạy bài test sau khi đổi nhãn'

const captureEnd = (args: Record<string, unknown>, result: Record<string, unknown>) =>
  ev('tool_end', { name: 'computer_screen_capture', args, result })

describe('HarnessStepView — nhãn media (P4.3/P5.3)', () => {
  it('P4.3 nhãn là CHỮ CỦA MODEL; không có chữ thì để `null` và giữ loại cho tầng giao diện', () => {
    const withCaption = captureEnd({ caption: MODEL_CAPTION }, { ok: true, artifact: CAPTURE_TAB, bytes: 41600 })
    const withoutCaption = captureEnd({}, { ok: true, artifact: CAPTURE_TAB, bytes: 41600 })
    const blankCaption = captureEnd({ caption: '   ' }, { ok: true, artifact: CAPTURE_TAB })

    expect(extractToolMedia(withCaption)?.caption).toBe(MODEL_CAPTION)
    expect(extractToolMedia(withoutCaption)?.caption).toBeNull()
    // Khoảng trắng không phải chữ của model.
    expect(extractToolMedia(blankCaption)?.caption).toBeNull()
    // Bản ghi: loại riêng, và hàng `stop` không gửi chữ nào nên nhãn cũng là `null` — app không bịa.
    expect(extractToolMedia(STOP)?.caption).toBeNull()
    expect(extractToolMedia(STOP)?.captionKind).toBe('record')
  })

  it('P4.3 loại ảnh chụp đọc từ chính đường dẫn box ghi; không rõ thì KHÔNG bịa loại khác', () => {
    const kindOf = (kind: string, name = 'computer_screen_capture') =>
      extractToolMedia(
        ev('tool_end', {
          name,
          args: {},
          result: {
            ok: true,
            artifact: `/home/agent/workspace/.generated_artifacts/captures/${kind}/2e4f1a20/2e4f1a20_007_shot.png`,
          },
        }),
      )?.captionKind

    expect(kindOf('window')).toBe('capture-window')
    expect(kindOf('tab')).toBe('capture-tab')
    expect(kindOf('screen')).toBe('capture-screen')
    // Khuôn lạ (phiên rất cũ, hoặc thư mục khác) ⇒ nói về ảnh chụp màn hình, không đoán bừa.
    expect(kindOf('legacy')).toBe('capture-screen')
    // Trang web không đi qua `capture.py`: loại do chính tên công cụ quyết định.
    expect(kindOf('tab', 'browser_use')).toBe('browser')
  })

  it('P5.3 câu trả lời tiếng Việt ⇒ nhãn tiếng Việt; câu trả lời tiếng Anh ⇒ nhãn tiếng Anh', () => {
    const shots = [
      ev('tool_start', { id: 'c1', name: 'computer_screen_capture', args: {} }),
      captureEnd({}, { ok: true, artifact: CAPTURE_TAB, dimensions: { width: 1440, height: 900 } }),
    ]
    const turn = (ask: string, answer: string) =>
      render(
        <HarnessStepView
          events={[ev('user', { text: ask }), ...shots, ev('assistant', { text: answer, final: true })]}
          status="completed"
          error={null}
        />,
      )

    const viHost = turn(
      'Chụp lại trang chạy bài test giúp em',
      'Em đã chụp lại trang chạy bài test sau khi đổi nhãn, ảnh nằm trong mục bằng chứng của lượt.',
    )
    openActivity(viHost)
    expect(viHost.querySelector('[data-media-thumb="true"]')?.getAttribute('alt')).toBe('Ảnh chụp tab')

    const enHost = turn(
      'Take a screenshot of the test page',
      'I captured the test page right after the label change and it is attached to this turn as evidence.',
    )
    openActivity(enHost)
    expect(enHost.querySelector('[data-media-thumb="true"]')?.getAttribute('alt')).toBe('Tab capture')
  })

  it('P5.3 chữ của model thắng từ điển, và đi nguyên vẹn vào nhãn của khung xem lớn', () => {
    const onOpenLightbox = vi.fn()
    const host = render(
      <HarnessStepView
        events={[
          ev('user', { text: 'Chụp lại trang chạy bài test giúp em' }),
          ev('tool_start', { id: 'c1', name: 'computer_screen_capture', args: { caption: MODEL_CAPTION } }),
          captureEnd({ caption: MODEL_CAPTION }, { ok: true, artifact: CAPTURE_TAB }),
          ev('assistant', { text: 'Em đã chụp lại trang chạy bài test sau khi đổi nhãn cho chủ nhà xem.', final: true }),
        ]}
        status="completed"
        error={null}
        onOpenLightbox={onOpenLightbox}
      />,
    )

    openActivity(host)
    expect(host.querySelector('[data-media-thumb="true"]')?.getAttribute('alt')).toBe(MODEL_CAPTION)

    click(host.querySelector('[data-media-toggle="true"]'))
    click(host.querySelector('[data-media-open="true"]'))

    expect(onOpenLightbox).toHaveBeenCalledTimes(1)
    expect(onOpenLightbox.mock.calls[0][0].caption).toBe(MODEL_CAPTION)
    expect(onOpenLightbox.mock.calls[0][0].artifactPath).toBe(CAPTURE_TAB)
  })
})
