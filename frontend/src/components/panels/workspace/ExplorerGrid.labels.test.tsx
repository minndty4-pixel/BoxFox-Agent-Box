/**
 * B2c — nhãn của chấm provenance trên thẻ lưới Explorer và trên chấm của thanh
 * công cụ (`LabelDot`) phải là MỘT nguồn i18n, và thẻ lưới phải hiện CẢ HAI nhãn
 * (integrity + confidentiality).
 *
 * Cách kiểm chứng không hard-code ngôn ngữ: render hai bề mặt trong CÙNG provider
 * rồi so `title`/`aria-label` của chúng — bằng nhau ở `en`, bằng nhau ở `vi`, và
 * đổi cùng nhau khi đổi ngôn ngữ. Ở `vi` thì chốt luôn chữ cụ thể để bắt trường
 * hợp cả hai bề mặt cùng sai.
 */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { LabelDot } from '../../LabelDot'
import { I18nProvider } from '../../../i18n'
import { useI18n, type Lang } from '../../../i18n/context'
import { CONFIDENTIALITY_META, INTEGRITY_META } from '../../../lib/labels'
import type { WorkspaceEntry, WorkspaceRepository } from '../../../lib/workspace'
import { ExplorerGrid } from './ExplorerGrid'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

const MTIME = '2026-08-28T12:00:00Z'

const OUT_OF_SCOPE_SECRET: WorkspaceEntry = {
  name: 'secret.py',
  kind: 'file',
  sizeBytes: 12,
  mtime: MTIME,
  integrity: 'khong_tin_duoc',
  confidentiality: 'bi_mat',
  ext: 'py',
  language: 'python',
}

const CLEAN_NO_CONF: WorkspaceEntry = {
  name: 'clean.txt',
  kind: 'file',
  sizeBytes: 3,
  mtime: MTIME,
  integrity: 'duoc_nguoi_dung_cho_phep',
  confidentiality: null,
  ext: 'txt',
  language: null,
}

const UNLABELLED: WorkspaceEntry = {
  name: 'plain.md',
  kind: 'file',
  sizeBytes: 1,
  mtime: MTIME,
  integrity: null,
  confidentiality: null,
  ext: 'md',
  language: 'markdown',
}

const ENTRIES = [OUT_OF_SCOPE_SECRET, CLEAN_NO_CONF, UNLABELLED]

function repo(): WorkspaceRepository {
  const noop = async () => {
    throw new Error('không dùng tới')
  }
  return {
    baseUrl: 'http://box.test',
    list: noop as unknown as WorkspaceRepository['list'],
    readText: noop as unknown as WorkspaceRepository['readText'],
    mediaUrl: (p) => p,
    thumbnailUrl: (p) => p,
    downloadUrl: (p) => p,
    zip: noop as unknown as WorkspaceRepository['zip'],
    upload: noop as unknown as WorkspaceRepository['upload'],
    unzip: noop as unknown as WorkspaceRepository['unzip'],
    mkdir: noop as unknown as WorkspaceRepository['mkdir'],
    touch: noop as unknown as WorkspaceRepository['touch'],
    rename: noop as unknown as WorkspaceRepository['rename'],
    move: noop as unknown as WorkspaceRepository['move'],
    deleteEntry: noop as unknown as WorkspaceRepository['deleteEntry'],
  }
}

/** Đổi ngôn ngữ ngay trong provider — hai bề mặt phải đổi cùng nhau. */
function LangSetter({ to }: { to: Lang }) {
  const { lang, setLang } = useI18n()
  useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

async function render(lang: Lang) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(
      <I18nProvider>
        <LangSetter to={lang} />
        {/* Chấm của thanh công cụ — bề mặt đối chiếu (`LabelDot`). */}
        <div data-testid="toolbar">
          <span data-testid="toolbar-both">
            <LabelDot integrity="khong_tin_duoc" confidentiality="bi_mat" />
          </span>
          <span data-testid="toolbar-integrity-only">
            <LabelDot integrity="duoc_nguoi_dung_cho_phep" />
          </span>
        </div>
        <ExplorerGrid
          entries={ENTRIES}
          cwd=""
          selected={new Set<string>()}
          repository={repo()}
          status="idle"
          error={null}
          canGoUp={false}
          onOpen={() => {}}
          onNavigate={() => {}}
          onToggleSelect={() => {}}
          onSelectRange={() => {}}
          onUploadFiles={() => {}}
          onGoUp={() => {}}
          onContextMenu={() => {}}
        />
      </I18nProvider>,
    )
  })
  return host
}

/** Thẻ lưới của một mục = `button` có chứa tên mục. */
function card(host: HTMLElement, name: string): HTMLElement {
  const found = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(name))
  if (!found) throw new Error(`Không thấy thẻ lưới "${name}".`)
  return found as HTMLElement
}

/** Các chấm (role=img) trong một phần tử, theo thứ tự DOM. */
function dots(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('[role="img"]')]
}

function titles(el: HTMLElement): string[] {
  return dots(el).map((d) => d.getAttribute('title') ?? '')
}

function probe(host: HTMLElement, id: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`Không thấy "${id}".`)
  return el
}

describe('ExplorerGrid — nhãn provenance dùng chung nguồn với `LabelDot` (B2c)', () => {
  it('thẻ lưới hiện cả integrity lẫn confidentiality, cùng nhãn với thanh công cụ', async () => {
    const host = await render('en')
    const toolbarTitles = titles(probe(host, 'toolbar-both'))
    expect(toolbarTitles).toHaveLength(2)

    const cardTitles = titles(card(host, 'secret.py'))
    expect(cardTitles).toHaveLength(2)
    expect(cardTitles).toEqual(toolbarTitles)

    // Mẫu chấm không đổi (chỉ là nhãn + độ phủ, không thiết kế lại).
    const [integrityDot, confidentialityDot] = dots(card(host, 'secret.py'))
    expect(integrityDot.className).toContain(INTEGRITY_META.khong_tin_duoc.dotClass)
    expect(confidentialityDot.className).toContain(CONFIDENTIALITY_META.bi_mat.dotClass)
    expect(confidentialityDot.getAttribute('aria-label')).toBe(confidentialityDot.getAttribute('title'))
  })

  it('mục chỉ có integrity: đúng một chấm, cùng nhãn với chấm integrity của thanh công cụ', async () => {
    const host = await render('en')
    const cardTitles = titles(card(host, 'clean.txt'))
    expect(cardTitles).toEqual(titles(probe(host, 'toolbar-integrity-only')))

    // Không có confidentiality → KHÔNG có chấm thứ hai.
    expect(dots(card(host, 'clean.txt'))).toHaveLength(1)
  })

  it('mục không nhãn: không chấm nào', async () => {
    const host = await render('en')
    expect(dots(card(host, 'plain.md'))).toHaveLength(0)
  })

  it('đổi ngôn ngữ sang `vi`: hai bề mặt đổi cùng nhau, chữ đúng tiếng Việt', async () => {
    const host = await render('vi')
    const toolbarTitles = titles(probe(host, 'toolbar-both'))
    expect(toolbarTitles).toEqual(['Integrity: Ngoài phạm vi — chưa xác minh', 'Confidentiality: Bí mật'])
    expect(titles(card(host, 'secret.py'))).toEqual(toolbarTitles)
    expect(titles(card(host, 'clean.txt'))).toEqual(['Integrity: Sạch — trong phạm vi người dùng cho phép'])
  })
})
