import { describe, expect, it, vi } from 'vitest'
import { absoluteWorkspacePath, DEFAULT_ATTACHMENT_DIR, uploadAttachments } from './attachmentUpload'
import type { AttachmentCandidate, AttachmentUploadDeps } from './attachmentUpload'
import type { WorkspaceUploadOptions, WorkspaceUploadResult } from '../workspace/types'

/** Repo giả: ghi lại từng lời gọi và trả đúng hợp đồng của box (có `name` do box cấp). */
function fakeRepo(
  handler?: (dir: string, filename: string) => WorkspaceUploadResult | Error,
): { repo: AttachmentUploadDeps['repo']; calls: Array<[string, string, File, WorkspaceUploadOptions | undefined]> } {
  const calls: Array<[string, string, File, WorkspaceUploadOptions | undefined]> = []
  const repo = {
    upload: vi.fn(
      async (
        dir: string,
        filename: string,
        body: Blob,
        options?: WorkspaceUploadOptions,
      ): Promise<WorkspaceUploadResult> => {
        calls.push([dir, filename, body as File, options])
        const outcome = handler?.(dir, filename)
        if (outcome instanceof Error) throw outcome
        return outcome ?? { path: `${dir}/${filename}`, name: filename, sizeBytes: (body as File).size }
      },
    ),
  } as unknown as AttachmentUploadDeps['repo']
  return { repo, calls }
}

function candidate(name: string, size = 4, relativePath?: string): AttachmentCandidate {
  return { name, file: new File(['x'.repeat(size)], name), relativePath }
}

describe('uploadAttachments', () => {
  it('tải 2 tệp rời + 1 tệp trong thư mục: 3 lời gọi, đúng thứ tự, đúng đích', async () => {
    const { repo, calls } = fakeRepo()
    const progress = vi.fn()
    const out = await uploadAttachments([candidate('a.md', 3), candidate('b.txt', 5), candidate('c.ts', 7, 'proj/src/c.ts')], {
      repo,
      onProgress: progress,
    })

    expect(calls.map(([dir, name]) => [dir, name])).toEqual([
      [DEFAULT_ATTACHMENT_DIR, 'a.md'],
      [DEFAULT_ATTACHMENT_DIR, 'b.txt'],
      [`${DEFAULT_ATTACHMENT_DIR}/proj/src`, 'c.ts'],
    ])
    // Tệp rời giữ nguyên tên (không mkdirs); tệp trong thư mục bật mkdirs để giữ cây.
    expect(calls[0][3]).toEqual({ assignNumber: true, mkdirs: false })
    expect(calls[2][3]).toEqual({ assignNumber: true, mkdirs: true })
    expect(progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])

    expect(out).toEqual([
      {
        name: 'a.md',
        path: `${DEFAULT_ATTACHMENT_DIR}/a.md`,
        absolutePath: `${absoluteWorkspacePath('')}${DEFAULT_ATTACHMENT_DIR}/a.md`,
        sizeBytes: 3,
        kind: 'file',
      },
      {
        name: 'b.txt',
        path: `${DEFAULT_ATTACHMENT_DIR}/b.txt`,
        absolutePath: `${absoluteWorkspacePath('')}${DEFAULT_ATTACHMENT_DIR}/b.txt`,
        sizeBytes: 5,
        kind: 'file',
      },
      {
        name: 'c.ts',
        path: `${DEFAULT_ATTACHMENT_DIR}/proj/src/c.ts`,
        absolutePath: `${absoluteWorkspacePath('')}${DEFAULT_ATTACHMENT_DIR}/proj/src/c.ts`,
        sizeBytes: 7,
        kind: 'folder-item',
      },
    ])
  })

  it('absolutePath dùng gốc workspace thật của box, không phải chuỗi rải trong component', () => {
    expect(absoluteWorkspacePath('.uploaded_artifacts/12.md')).toBe('/home/agent/workspace/.uploaded_artifacts/12.md')
  })

  it('tên tệp do BOX cấp (số RULE-5) được dùng thay tên client, và targetDir đổi được', async () => {
    const { repo } = fakeRepo(() => ({ path: '.uploaded_artifacts/proj/7.md', name: '7.md', sizeBytes: 9 }))
    const out = await uploadAttachments([candidate('ghi chú.md', 9)], { repo, targetDir: '.uploaded_artifacts' })
    expect(out[0]).toEqual({
      name: '7.md',
      path: '.uploaded_artifacts/proj/7.md',
      absolutePath: '/home/agent/workspace/.uploaded_artifacts/proj/7.md',
      sizeBytes: 9,
      kind: 'file',
    })
  })

  it('một tệp lỗi ⇒ ném lỗi kèm tên tệp và KHÔNG trả mảng nửa vời', async () => {
    const { repo, calls } = fakeRepo((_dir, filename) =>
      filename === 'b.txt' ? new Error('Dung lượng vượt giới hạn 26214400 byte.') : { path: `x/${filename}`, name: filename, sizeBytes: 1 },
    )
    await expect(uploadAttachments([candidate('a.md'), candidate('b.txt'), candidate('c.ts')], { repo })).rejects.toThrow(
      /Không tải lên được «b\.txt».*vượt giới hạn/,
    )
    // Dừng ngay tại tệp lỗi: tệp thứ ba không được tải lên.
    expect(calls.map(([, name]) => name)).toEqual(['a.md', 'b.txt'])
  })

  it('không có tệp nào ⇒ không gọi box lần nào', async () => {
    const { repo, calls } = fakeRepo()
    await expect(uploadAttachments([], { repo })).resolves.toEqual([])
    expect(calls).toEqual([])
  })

  it('tệp ngay trong gốc thư mục vừa chọn vẫn giữ được cây (đích = targetDir)', async () => {
    const { repo, calls } = fakeRepo()
    const out = await uploadAttachments([candidate('a.ts', 2, 'a.ts')], { repo })
    expect(calls[0][0]).toBe(DEFAULT_ATTACHMENT_DIR)
    expect(calls[0][3]).toEqual({ assignNumber: true, mkdirs: true })
    expect(out[0].kind).toBe('folder-item')
  })
})
