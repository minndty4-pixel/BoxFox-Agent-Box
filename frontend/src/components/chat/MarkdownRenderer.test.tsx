import type { ComponentProps } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer, makeStreamingSafe } from './MarkdownRenderer'

type RendererProps = ComponentProps<typeof MarkdownRenderer>

function renderMarkdown(content: string, extra: Partial<RendererProps> = {}): HTMLElement {
  // React 19 yêu cầu cờ này để act đồng bộ trong jsdom.
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  act(() => {
    createRoot(host).render(<MarkdownRenderer variant="document" content={content} {...extra} />)
  })
  return host
}

function click(el: Element | null | undefined) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** Đường dẫn ảnh thật của box (P2.1): `.generated_artifacts/captures/<kind>/<sid8>/<sid8>_<step>_<slug>.png`. */
const CAPTURE_REL = '.generated_artifacts/captures/tab/2e4f1a20/2e4f1a20_007_tab-runs-page.png'
const CAPTURE_ABS = `/home/agent/workspace/${CAPTURE_REL}`
/** Tệp kết quả test (D-23/D-25) — bằng chứng văn bản, mở bằng tab Files. */
const EVIDENCE_REL = '.generated_artifacts/captures/evidence/2e4f1a20/2e4f1a20_009_pytest-result.txt'
/** Vòng 27 / C-2 2.4 — hồ sơ việc nghiên cứu nằm trong phòng `.research/<việc>/`. */
const DOSSIER_DOC = '.research/chuyen-tuyen-nhap-vien/v1-chuyen-tuyen-nhap-vien.md'
const DOSSIER_SOURCES = '.research/chuyen-tuyen-nhap-vien/sources.jsonl'
/** Tên tệp trong phòng hồ sơ tình cờ mang đuôi ảnh: vẫn là TỆP, không thành tile ảnh. */
const DOSSIER_IMAGE_NAME = '.research/chuyen-tuyen-nhap-vien/bia.png'

describe('MarkdownRenderer', () => {
  it('renders GFM, code, links, and KaTeX through the shared safe pipeline', () => {
    const host = renderMarkdown(
      '# Heading\n\n- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n`inline`\n\n```\nplain\n```\n\n[Safe](https://example.com) $x^2$',
    )

    expect(host.querySelector('h1')?.textContent).toBe('Heading')
    const table = host.querySelector('table')
    const inlineCode = host.querySelector('p code')
    expect(table).toBeTruthy()
    expect(table?.className).toContain('w-full')
    expect(inlineCode?.className).toContain('inline-block')
    expect(host.querySelector('pre code')?.textContent).toContain('plain')
    expect(host.querySelector('a')?.getAttribute('rel')).toBe('noreferrer')
    expect(host.querySelector('.katex')).toBeTruthy()
    expect(host.querySelector('.markdown-body')?.className).toContain('w-full')
  })

  it('document variant expands fully with w-full min-w-0', () => {
    const host = renderMarkdown('text')
    expect(host.querySelector('.markdown-body')?.className).toContain('w-full min-w-0')
  })

  it('does not render raw HTML', () => {
    const host = renderMarkdown('<script>window.bad = true</script>')
    expect(host.querySelector('script')).toBeNull()
  })

  it('closes incomplete streaming fences without changing complete documents', () => {
    expect(makeStreamingSafe('```ts\nconst x = 1')).toBe('```ts\nconst x = 1\n```')
    expect(makeStreamingSafe('complete')).toBe('complete')
  })

  it('P4.1: ảnh trong câu trả lời thành tile có nhãn model + tên tệp, bấm ra khung xem lớn', () => {
    const onOpenImage = vi.fn()
    const host = renderMarkdown(`![Công việc: bảng chạy đã đổi nhãn](${CAPTURE_REL})`, { onOpenImage })

    const tile = host.querySelector('[data-capture-tile="true"]')
    expect(tile?.getAttribute('data-artifact-path')).toBe(CAPTURE_REL)
    // Nhãn của model đọc được ngay, không phải rê chuột.
    expect(tile?.querySelector('[data-capture-label="true"]')?.textContent).toBe('Công việc: bảng chạy đã đổi nhãn')
    // Tên tệp là basename; đường dẫn đầy đủ nằm ở `title`.
    const fileLine = tile?.querySelector('[data-capture-file="true"]')
    expect(fileLine?.textContent).toBe('2e4f1a20_007_tab-runs-page.png')
    expect(fileLine?.getAttribute('title')).toBe(CAPTURE_REL)
    // Ảnh vẫn đi qua route media của box và giữ nhãn của model ở `alt`.
    const img = tile?.querySelector('img')
    expect(img?.getAttribute('src')).toBe(`/__box/file/media?path=${encodeURIComponent(CAPTURE_REL)}`)
    expect(img?.getAttribute('alt')).toBe('Công việc: bảng chạy đã đổi nhãn')

    click(tile?.querySelector('[data-artifact-open="media"]'))
    expect(onOpenImage).toHaveBeenCalledTimes(1)
    expect(onOpenImage.mock.calls[0][0]).toEqual({
      type: 'image',
      src: `/__box/file/media?path=${encodeURIComponent(CAPTURE_REL)}`,
      caption: 'Công việc: bảng chạy đã đổi nhãn',
      artifactPath: CAPTURE_REL,
    })
  })

  it('P4.1: nhiều ảnh trong cùng một đoạn ⇒ nhiều tile (lưới tự xuống dòng)', () => {
    const host = renderMarkdown(`![A](${CAPTURE_REL})\n\n![B](${CAPTURE_ABS})`, { onOpenImage: vi.fn() })

    const tiles = host.querySelectorAll('[data-capture-tile="true"]')
    expect(tiles.length).toBe(2)
    expect(tiles[0].className).toContain('inline-block')
    expect(tiles[1].className).toContain('inline-block')
    // Khuôn TUYỆT ĐỐI cũng về cùng một URL media (một tệp, một đường).
    expect(tiles[1].querySelector('img')?.getAttribute('src')).toBe(
      `/__box/file/media?path=${encodeURIComponent(CAPTURE_REL)}`,
    )
  })

  it('P4.1: link tới ảnh cũng thành tile (không mở tab trình duyệt)', () => {
    const onOpenImage = vi.fn()
    const host = renderMarkdown(`[Ảnh chụp bảng chạy](${CAPTURE_REL})`, { onOpenImage })

    expect(host.querySelector('[data-capture-tile="true"]')).toBeTruthy()
    expect(host.querySelector('a')).toBeNull()
    click(host.querySelector('[data-artifact-open="media"]'))
    expect(onOpenImage).toHaveBeenCalledTimes(1)
    expect(onOpenImage.mock.calls[0][0].caption).toBe('Ảnh chụp bảng chạy')
  })

  it('P4.1: link tệp bằng chứng mở tab Files đúng tệp, kèm nhãn nút của người gọi', () => {
    const onOpenFile = vi.fn()
    const host = renderMarkdown(`- Kết quả test: [${EVIDENCE_REL}](${EVIDENCE_REL})`, {
      onOpenFile,
      fileLinkLabel: 'mở trong Files',
    })

    const button = host.querySelector('[data-artifact-open="files"]')
    expect(button?.getAttribute('data-artifact-path')).toBe(EVIDENCE_REL)
    expect(button?.textContent).toContain('mở trong Files')
    // Đường cũ `<a target="_blank">` đã biến mất: bấm vào là hỏng.
    expect(host.querySelector('a')).toBeNull()

    click(button)
    expect(onOpenFile).toHaveBeenCalledWith(EVIDENCE_REL)
  })

  it('P4.1: khuôn tuyệt đối của cùng tệp cũng mở bằng tab Files, và tệp NGOÀI workspace thì không', () => {
    const onOpenFile = vi.fn()
    const host = renderMarkdown(
      `[log](${EVIDENCE_REL})\n\n[log tuyệt đối](/home/agent/workspace/${EVIDENCE_REL})\n\n[Ngoài](https://example.com/${EVIDENCE_REL})`,
      { onOpenFile },
    )

    const buttons = host.querySelectorAll('[data-artifact-open="files"]')
    expect(buttons.length).toBe(2)
    expect(buttons[1].getAttribute('data-artifact-path')).toBe(EVIDENCE_REL)
    // Link ngoài workspace vẫn là link thường — không biến mọi `a` thành nút của app.
    expect(host.querySelector('a')?.getAttribute('href')).toBe(`https://example.com/${EVIDENCE_REL}`)
    expect(host.querySelector('a')?.getAttribute('target')).toBe('_blank')
  })

  it('P4.1: ảnh lồng trong một liên kết KHÔNG thành nút nồng trong `<a>` (một cú bấm, một việc)', () => {
    const onOpenImage = vi.fn()
    const host = renderMarkdown(`[![Ảnh chụp bảng chạy](${CAPTURE_REL})](https://example.com/report)`, {
      onOpenImage,
    })

    // Ảnh vẫn hiện (đường dẫn vẫn qua route media), nhưng không có điều khiển nào lồng trong liên kết:
    // markup/ARIA hợp lệ, và một cú bấm chỉ làm MỘT việc — đi theo liên kết.
    const img = host.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe(`/__box/file/media?path=${encodeURIComponent(CAPTURE_REL)}`)
    expect(img?.getAttribute('alt')).toBe('Ảnh chụp bảng chạy')
    expect(host.querySelectorAll('button').length).toBe(0)
    expect(host.querySelectorAll('[data-artifact-open]').length).toBe(0)
    expect(host.querySelectorAll('[data-capture-tile="true"]').length).toBe(0)

    const anchor = host.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com/report')
    expect(anchor?.getAttribute('target')).toBe('_blank')
    click(anchor)
    expect(onOpenImage).not.toHaveBeenCalled()
  })

  it('P4.1: một hàm chuẩn hoá cho cả phân loại lẫn giá trị gửi đi (`?query`, `#neo`, `./`, đường dẫn trần)', () => {
    const onOpenImage = vi.fn()
    const onOpenFile = vi.fn()
    const host = renderMarkdown(
      [
        `![A](${CAPTURE_REL}?raw=1)`,
        `![B](./${CAPTURE_REL})`,
        `![C](shots/a.png)`,
        `[log](${EVIDENCE_REL}#L12)`,
        `[Ngoài](https://example.com/live.txt?raw=1)`,
      ].join('\n\n'),
      { onOpenImage, onOpenFile },
    )

    // Phân loại: ba ảnh thành tile, tệp `.txt#neo` thành nút Files, link ngoài vẫn là link thường.
    const tiles = [...host.querySelectorAll('[data-capture-tile="true"]')]
    expect(tiles.length).toBe(3)
    expect(tiles.map((tile) => tile.getAttribute('data-artifact-path'))).toEqual([
      CAPTURE_REL,
      CAPTURE_REL,
      'shots/a.png',
    ])
    // Giá trị GỬI ĐI cũng là khuôn sạch — route media nhận đúng đường dẫn, không kèm `?raw=1`/`./`.
    expect(tiles[0].querySelector('img')?.getAttribute('src')).toBe(
      `/__box/file/media?path=${encodeURIComponent(CAPTURE_REL)}`,
    )
    expect(tiles[1].querySelector('img')?.getAttribute('src')).toBe(
      `/__box/file/media?path=${encodeURIComponent(CAPTURE_REL)}`,
    )
    expect(tiles[2].querySelector('img')?.getAttribute('src')).toBe('/__box/file/media?path=shots%2Fa.png')

    click(tiles[0].querySelector('[data-artifact-open="media"]'))
    expect(onOpenImage.mock.calls[0][0]).toEqual({
      type: 'image',
      src: `/__box/file/media?path=${encodeURIComponent(CAPTURE_REL)}`,
      caption: 'A',
      artifactPath: CAPTURE_REL,
    })

    const button = host.querySelector('[data-artifact-open="files"]')
    expect(button?.getAttribute('data-artifact-path')).toBe(EVIDENCE_REL)
    click(button)
    expect(onOpenFile).toHaveBeenCalledWith(EVIDENCE_REL)

    // Đường dự phòng giữ NGUYÊN `href` thô của model (trình duyệt tự hiểu link của nó).
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/live.txt?raw=1')
  })

  it('C-2 2.4: mọi đường dẫn dưới `.research/` mở bằng tab Files, ảnh vẫn đi nhánh ảnh', () => {
    const onOpenFile = vi.fn()
    const onOpenImage = vi.fn()
    const host = renderMarkdown(
      [
        `- Hồ sơ: [${DOSSIER_DOC}](${DOSSIER_DOC})`,
        `[sổ nguồn](./${DOSSIER_SOURCES})`,
        `[hồ sơ tuyệt đối](/home/agent/workspace/${DOSSIER_DOC})`,
        `[bảng phụ](${DOSSIER_IMAGE_NAME})`,
        `![Ảnh chụp bảng chạy](${CAPTURE_REL})`,
      ].join('\n\n'),
      { onOpenFile, onOpenImage },
    )

    // Mọi đường dẫn hồ sơ (kể cả khuôn `./`, khuôn tuyệt đối, và tên tệp mang đuôi ảnh) đều là nút
    // Files đúng đường dẫn workspace — nhận diện hồ sơ đứng TRƯỚC phép thử ảnh, thứ tự không đổi.
    const buttons = [...host.querySelectorAll('[data-artifact-open="files"]')]
    expect(buttons.map((button) => button.getAttribute('data-artifact-path'))).toEqual([
      DOSSIER_DOC,
      DOSSIER_SOURCES,
      DOSSIER_DOC,
      DOSSIER_IMAGE_NAME,
    ])
    // ...nên KHÔNG còn `<a target="_blank">` nào cho chúng (bấm vào là mở tab trắng).
    expect(host.querySelector('a')).toBeNull()
    click(buttons[1])
    expect(onOpenFile).toHaveBeenCalledWith(DOSSIER_SOURCES)

    // Ảnh thật của box vẫn thành tile (đi nhánh `isImageLink`), không thành nút Files.
    const tile = host.querySelector('[data-capture-tile="true"]')
    expect(tile?.getAttribute('data-artifact-path')).toBe(CAPTURE_REL)
    expect(host.querySelectorAll('[data-artifact-open="files"]').length).toBe(4)
    click(tile?.querySelector('[data-artifact-open="media"]'))
    expect(onOpenImage).toHaveBeenCalledTimes(1)
  })

  it('P4.1: không truyền callback ⇒ hành vi cũ giữ nguyên (không phá chỗ dùng khác)', () => {
    const host = renderMarkdown(`![Ảnh](${CAPTURE_REL})\n\n[Kết quả](${EVIDENCE_REL})`)

    // Không có tile, không có nút Files: ảnh lớn trong mạch chữ và link cũ mở tab mới.
    expect(host.querySelector('[data-capture-tile="true"]')).toBeNull()
    expect(host.querySelector('[data-artifact-open="files"]')).toBeNull()
    expect(host.querySelector('img')?.className).toContain('w-full')
    expect(host.querySelectorAll('a').length).toBe(1)
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      `/__box/file/media?path=${encodeURIComponent(EVIDENCE_REL)}`,
    )
  })
})
