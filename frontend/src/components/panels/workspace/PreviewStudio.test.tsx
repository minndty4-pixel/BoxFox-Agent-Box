/**
 * Studio xem trước: file vượt trần đọc 1 MiB phải nói thẳng "vượt 1 MiB — tải về
 * để xem" (kèm link tải), header phải mang huy hiệu integrity/confidentiality của
 * entry. Render qua raw `createRoot` + `act`.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import type { WorkspaceEntry, WorkspaceRepository } from '../../../lib/workspace'
import { PreviewStudio } from './PreviewStudio'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ENTRY: WorkspaceEntry = {
  name: 'big.log',
  kind: 'file',
  sizeBytes: 2 * 1024 * 1024,
  mtime: '2026-08-28T12:00:00Z',
  integrity: 'khong_tin_duoc',
  confidentiality: 'bi_mat',
  ext: 'log',
  language: null,
}

function repo(): WorkspaceRepository {
  return {
    baseUrl: 'http://box.test',
    list: vi.fn(async () => ({ breadcrumb: [], entries: [] })),
    readText: vi.fn(async () => ({ content: '', sizeBytes: 0, mime: 'text/plain', language: null, binary: false })),
    mediaUrl: (p: string) => `http://box.test/__box/file/media?path=${encodeURIComponent(p)}`,
    thumbnailUrl: (p: string) => `http://box.test/__box/file/thumbnail?path=${encodeURIComponent(p)}`,
    downloadUrl: (p: string) => `http://box.test/__box/file/download?path=${encodeURIComponent(p)}`,
    zip: vi.fn(async () => new Blob(['zip'])),
    upload: vi.fn(async (targetDir: string, filename: string) => ({ path: `${targetDir}/${filename}`, sizeBytes: 0 })),
    unzip: vi.fn(async () => ({ extracted: 0, skipped: 0, warnings: [] })),
    mkdir: vi.fn(async (p: string) => ({ path: p, type: 'directory' as const })),
    touch: vi.fn(async (p: string) => ({ path: p, type: 'file' as const, size: 0 })),
    rename: vi.fn(async (p: string, name: string) => ({ path: p, newPath: name })),
    move: vi.fn(async (p: string, destination: string) => ({ path: p, newPath: `${destination}/${p}` })),
    deleteEntry: vi.fn(async (p: string) => ({ path: p, trashPath: `.trash/1-${p}` })),
  }
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

function renderPreview(props: Partial<Parameters<typeof PreviewStudio>[0]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const repository = repo()
  act(() => {
    root.render(
      <I18nProvider>
        <PreviewStudio
          path="big.log"
          entry={ENTRY}
          content={null}
          kind="text"
          repository={repository}
          onClose={vi.fn()}
          onOpenInIde={vi.fn()}
          {...props}
        />
      </I18nProvider>,
    )
  })
  return { host, repository }
}

describe('PreviewStudio — trạng thái thật', () => {
  it('file vượt 1 MiB hiện đúng câu "vượt 1 MiB — tải về để xem"', () => {
    const { host, repository } = renderPreview({ notice: 'too-large' })
    expect(host.textContent).toContain('File exceeds 1 MiB — download to view')
    const link = host.querySelector('a[download]') as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe(repository.downloadUrl('big.log'))
  })

  it('không có thông báo thì mới render nội dung văn bản', () => {
    const { host } = renderPreview({
      content: { content: 'dòng một\ndòng hai', sizeBytes: 18, mime: 'text/plain', language: null, binary: false },
    })
    expect(host.textContent).toContain('dòng một')
    expect(host.textContent).not.toContain('File exceeds 1 MiB')
  })

  it('header mang huy hiệu integrity + confidentiality của entry', () => {
    const { host } = renderPreview({ notice: 'too-large' })
    expect(host.textContent).toContain('Không tin được')
    expect(host.textContent).toContain('Bí mật')
  })

  it('file đọc hỏng thì hiện khối không xem trước kèm link tải, không nói vượt 1 MiB', () => {
    const { host } = renderPreview({ notice: 'read-failed' })
    expect(host.textContent).toContain('No preview for this file.')
    expect(host.textContent).not.toContain('File exceeds 1 MiB')
  })
})
