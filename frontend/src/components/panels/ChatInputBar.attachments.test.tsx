/**
 * A6 (kế hoạch v1 Phần A) — đường gửi: tệp phải nằm THẬT trên box trước khi lượt đi,
 * và text gửi đi là đúng những gì người dùng gõ.
 *
 * BUG-40 cũ: `[Attached Files: a.png]` chỉ là chữ trong prompt, box không có tệp nào.
 * Ba điều được đo ở đây:
 *   1. chọn 1 tệp ⇒ upload xong mới gọi `onSend`, `attachments[0].absolutePath` đúng, text sạch;
 *   2. upload lỗi ⇒ `onSend` KHÔNG được gọi, ô nhập giữ nguyên nội dung, có chip đỏ;
 *   3. ảnh: gửi nhiều ảnh, cắt còn 2 ảnh và tổng ≤ 800 000 ký tự.
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useComposerStore } from '../../store/composerStore'
import type { WorkspaceRepository, WorkspaceUploadOptions, WorkspaceUploadResult } from '../../lib/workspace/types'
import type { OutgoingAttachment } from '../../lib/chat/attachmentUpload'
import { ChatInputBar, MAX_TURN_IMAGE_CHARS, MAX_TURN_IMAGES } from './ChatInputBar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

function click(el: Element | null | undefined) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function typeInto(textarea: HTMLTextAreaElement, text: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  nativeSetter.call(textarea, text)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Chờ các macrotask (FileReader của ảnh + upload) rồi flush state React. */
async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Repo giả ghi lại lời gọi và trả `name` do box cấp (số RULE-5). */
function fakeRepo(
  handler?: (dir: string, filename: string) => WorkspaceUploadResult | Error,
): { repo: WorkspaceRepository; calls: Array<{ dir: string; filename: string; options?: WorkspaceUploadOptions }> } {
  const calls: Array<{ dir: string; filename: string; options?: WorkspaceUploadOptions }> = []
  const repo = {
    upload: vi.fn(
      async (dir: string, filename: string, body: Blob, options?: WorkspaceUploadOptions) => {
        calls.push({ dir, filename, options })
        const outcome = handler?.(dir, filename)
        if (outcome instanceof Error) throw outcome
        return outcome ?? { path: `${dir}/${filename}`, name: filename, sizeBytes: body.size }
      },
    ),
  } as unknown as WorkspaceRepository
  return { repo, calls }
}

/** `onSend` của adapter có ba tham số — khai báo kiểu để `vi.fn()` khớp hợp đồng. */
type SendFn = (prompt: string, images?: string[] | null, attachments?: OutgoingAttachment[]) => void | Promise<boolean>

function sendSpy(): ReturnType<typeof vi.fn<SendFn>> {
  return vi.fn<SendFn>()
}

function routerAdapter(onSend: SendFn) {
  return {
    models: [{ id: 'model:conn-1:gemini-3.8-flash-high', name: 'Gemini 3.8 Flash', provider: 'antigravity' }],
    activeModelId: 'model:conn-1:gemini-3.8-flash-high',
    isBusy: false,
    onModelChange: () => {},
    onSend,
    onStop: () => {},
  }
}

/** Chọn tệp qua đúng menu `+` rồi bấm Gửi — đi hết đường người dùng đi. */
function pickFile(host: HTMLElement, files: File[], kind: 'file' | 'image' = 'file') {
  click(host.querySelector('button[title="Thêm đính kèm / Tệp tin / Hình ảnh"]'))
  const input = document.querySelector(`[data-testid="attach-${kind}-input"]`) as HTMLInputElement
  setFiles(input, files)
}

function sendButton(host: HTMLElement): HTMLButtonElement {
  return host.querySelector('[data-testid="composer-send"]') as HTMLButtonElement
}

beforeEach(() => {
  useComposerStore.setState({ pendingElements: [] })
  useAgentStore.setState({ isBusy: false })
})

afterEach(() => {
  act(() => {
    roots.forEach((root) => root.unmount())
  })
  roots = []
  document.body.innerHTML = ''
})

describe('ChatInputBar — tệp đính kèm đi thật lên box (A6)', () => {
  it('chọn 1 tệp ⇒ upload TRƯỚC, onSend nhận absolutePath và text không còn [Attached Files', async () => {
    const { repo, calls } = fakeRepo(() => ({ path: '.uploaded_artifacts/1.md', name: '1.md', sizeBytes: 11 }))
    const onSend = sendSpy()
    const host = render(<ChatInputBar router={routerAdapter(onSend)} repository={repo} />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement

    typeInto(textarea, 'đọc tệp này giúp tôi')
    pickFile(host, [new File(['hello world'], 'notes.md')])
    await settle()

    click(sendButton(host))
    await settle()

    expect(calls).toEqual([
      { dir: '.uploaded_artifacts', filename: 'notes.md', options: { assignNumber: true, mkdirs: false } },
    ])
    expect(onSend).toHaveBeenCalledTimes(1)
    const [prompt, images, attachments] = onSend.mock.calls[0]
    expect(prompt).toBe('đọc tệp này giúp tôi')
    expect(prompt).not.toContain('[Attached Files')
    expect(images).toBeUndefined()
    expect(attachments).toEqual([
      {
        name: '1.md',
        path: '.uploaded_artifacts/1.md',
        absolutePath: '/home/agent/workspace/.uploaded_artifacts/1.md',
        sizeBytes: 11,
        kind: 'file',
      },
    ])
    // Ô nhập được xoá sau khi gửi thành công.
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('upload lỗi ⇒ onSend KHÔNG được gọi, ô nhập giữ nguyên, có chip đỏ nêu tên tệp', async () => {
    const { repo } = fakeRepo(() => new Error('Dung lượng vượt giới hạn 26214400 byte.'))
    const onSend = sendSpy()
    const host = render(<ChatInputBar router={routerAdapter(onSend)} repository={repo} />)
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement

    typeInto(textarea, 'gửi kèm báo cáo')
    pickFile(host, [new File(['x'], 'bao-cao.pdf')])
    await settle()

    click(sendButton(host))
    await settle()

    expect(onSend).not.toHaveBeenCalled()
    const error = host.querySelector('[data-testid="composer-attach-error"]')
    expect(error?.textContent ?? '').toContain('bao-cao.pdf')
    expect(error?.textContent ?? '').toContain('vượt giới hạn')
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('gửi kèm báo cáo')
  })

  it('tệp trong thư mục giữ cây: mkdirs + đích có thư mục cha', async () => {
    const { repo, calls } = fakeRepo()
    const onSend = sendSpy()
    const host = render(<ChatInputBar router={routerAdapter(onSend)} repository={repo} />)

    typeInto(host.querySelector('textarea') as HTMLTextAreaElement, 'gom tệp')
    click(host.querySelector('button[title="Thêm đính kèm / Tệp tin / Hình ảnh"]'))
    const input = document.querySelector('[data-testid="attach-folder-input"]') as HTMLInputElement
    const file = new File(['export {}'], 'a.ts')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'proj/src/a.ts', configurable: true })
    setFiles(input, [file])
    await settle()

    click(sendButton(host))
    await settle()

    expect(calls).toEqual([
      {
        dir: '.uploaded_artifacts/proj/src',
        filename: 'a.ts',
        options: { assignNumber: true, mkdirs: true },
      },
    ])
    expect((onSend.mock.calls[0][2] as Array<{ kind: string }>)[0].kind).toBe('folder-item')
  })

  it('ảnh: mọi ảnh có dataUrl được gửi, cắt còn 2 ảnh đầu và tổng ≤ 800 000 ký tự', async () => {
    const { repo } = fakeRepo()
    const onSend = sendSpy()
    const host = render(<ChatInputBar router={routerAdapter(onSend)} repository={repo} />)

    typeInto(host.querySelector('textarea') as HTMLTextAreaElement, 'xem 3 ảnh')
    // Ảnh 1–2 nhỏ, ảnh 3 bị cắt vì quá 2 ảnh.
    // `type: 'image/png'` — AttachmentPicker nhận diện ảnh bằng `file.type` và chỉ ảnh mới có dataUrl.
    pickFile(host, [
      new File(['a'], '1.png', { type: 'image/png' }),
      new File(['b'], '2.png', { type: 'image/png' }),
      new File(['c'], '3.png', { type: 'image/png' }),
    ], 'image')
    await settle()

    click(sendButton(host))
    await settle()

    const images = onSend.mock.calls[0][1] as string[]
    expect(MAX_TURN_IMAGES).toBe(2)
    expect(images).toHaveLength(2)
    images.forEach((dataUrl) => expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true))
  })

  it('ảnh quá lớn bị bỏ qua nhưng không chặn ảnh nhỏ phía sau', async () => {
    const { repo } = fakeRepo()
    const onSend = sendSpy()
    const host = render(<ChatInputBar router={routerAdapter(onSend)} repository={repo} />)

    typeInto(host.querySelector('textarea') as HTMLTextAreaElement, 'ảnh lớn + ảnh nhỏ')
    // Ảnh đầu ~ 900 000 ký tự base64 ⇒ vượt trần tổng; ảnh sau phải vẫn được gửi.
    pickFile(host, [
      new File(['x'.repeat(Math.ceil((MAX_TURN_IMAGE_CHARS * 3) / 4))], 'big.png', { type: 'image/png' }),
      new File(['b'], 'small.png', { type: 'image/png' }),
    ], 'image')
    await settle()

    click(sendButton(host))
    await settle()

    const images = onSend.mock.calls[0][1] as string[]
    expect(images).toHaveLength(1)
    expect(images[0].length).toBeLessThan(MAX_TURN_IMAGE_CHARS)
  })

  it('lệnh điều khiển không kéo theo upload tệp', async () => {
    const { repo, calls } = fakeRepo()
    const onSend = sendSpy()
    const host = render(<ChatInputBar router={routerAdapter(onSend)} repository={repo} />)

    pickFile(host, [new File(['x'], 'notes.md')])
    await settle()
    typeInto(host.querySelector('textarea') as HTMLTextAreaElement, '/stop')

    click(sendButton(host))
    await settle()

    expect(calls).toEqual([])
    expect(onSend).toHaveBeenCalledWith('/stop', undefined, undefined)
  })
})
