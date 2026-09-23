/**
 * Vòng 23 — mặt câu trả lời cuối CHỈ còn markdown của model (D-19/D-20, P4.2).
 *
 * Trước vòng này tệp kiểm này khẳng định khối `Bằng chứng`, huy hiệu cổng và những hàng đường dẫn
 * do app vẽ. Chủ nhà đã chốt bỏ hết chúng khỏi mặt câu trả lời: cổng vẫn chạy và vẫn phát dữ liệu
 * (`assistant.data.evidence` nguyên vẹn, dòng biên nhận ở đầu lượt vẫn đếm), nhưng mặt câu trả lời
 * không còn chữ nào của app. Tệp kiểm này giữ đúng phần còn lại:
 *  1. lượt mang `evidence` ⇒ dữ liệu vẫn tới (biên nhận), còn mặt câu trả lời thì không có khối nào;
 *  2. ảnh trong câu trả lời nằm ngay trong mạch chữ, bấm ra khung xem lớn (P4.1);
 *  3. liên kết tệp bằng chứng mở tab Files đúng tệp, không mở tab trình duyệt (P4.1);
 *  4. lượt KHÔNG mang trường `evidence` ⇒ cũng không có gì của app quanh câu trả lời, và câu trả lời
 *     của model vẫn nguyên văn (app không viết lại chữ của model).
 *
 * Chữ do app viết quanh lượt đi theo NGÔN NGỮ CÂU TRẢ LỜI (D-24/P5.3): câu trả lời tiếng Việt ⇒ biên
 * nhận tiếng Việt; câu trả lời tiếng Anh ⇒ biên nhận tiếng Anh.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { HarnessEvent } from '../../store/harnessChatStore'
import type { HarnessJournal } from '../../store/harnessChatStore'
import { useUiStore } from '../../store/uiStore'
import { HarnessStepView } from './HarnessStepView'
import type { LightboxMediaProps } from './MediaLightboxModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let seq = 0

function ev(type: string, data: Record<string, unknown> = {}, created?: number): HarnessEvent {
  seq += 1
  return { seq, type, data, created: created ?? 1000 + seq }
}

function render(
  events: HarnessEvent[],
  journal: HarnessJournal | null = null,
  onOpenLightbox?: (media: LightboxMediaProps) => void,
): HTMLElement {
  const node: ReactNode = (
    <HarnessStepView
      events={events}
      status="idle"
      error={null}
      journal={journal}
      onOpenLightbox={onOpenLightbox}
    />
  )
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

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  seq = 0
  vi.restoreAllMocks()
  useUiStore.setState({ tabIntentTargets: {}, selectedFilePath: null, activeTab: null })
})

const userTurn = ev('user', { text: 'Nhờ em sửa nhãn cuối lượt' })

/** Event `assistant` cuối lượt: `evidence` chỉ có khi cổng đã chấm lượt này. */
const finalAssistant = (text: string, evidence?: Record<string, unknown>) =>
  ev('assistant', evidence ? { text, final: true, evidence } : { text, final: true })

const DIFF_PATH = '.generated_artifacts/captures/evidence/sid8/sid8_1_harness.diff'

const sufficientEvidence = {
  verdict: 'sufficient',
  turn: 1,
  mode: 'warn',
  repair: false,
  checked: 2,
  missing: [],
  changedFiles: ['frontend/src/i18n/vi.ts'],
  artifacts: [
    {
      kind: 'diff',
      path: DIFF_PATH,
      step: 1,
      tool: 'file_write',
      changed: 'frontend/src/i18n/vi.ts',
      sha256: '5b8bf905137bbed26053db780bc52e5b88dbbb0eb9a41a7a093d06b53185774c',
      bytes: 22,
    },
  ],
}

/** Cặp sự kiện công cụ của một lần ghi tệp: chỗ duy nhất có `numbers` (added/removed/bytes). */
const writeToolEvents = (path: string, created = 2000) => [
  ev('tool_start', { id: 'w1', name: 'file_write', args: { path } }, created),
  ev(
    'tool_end',
    {
      id: 'w1',
      name: 'file_write',
      args: { path },
      result: {
        artifact: DIFF_PATH,
        numbers: {
          sha256After: '5b8bf905137bbed26053db780bc52e5b88dbbb0eb9a41a7a093d06b53185774c',
          added: 1,
          removed: 0,
          bytes: 22,
        },
      },
    },
    created + 0.106,
  ),
]

/** Mặt câu trả lời: CHỈ đầu lượt của app + khung chữ của model — không hàng, khối, dải nào khác. */
const FACE_APP_HOOKS = [
  '[data-evidence-badge]',
  '[data-evidence-note]',
  '[data-evidence-toggle]',
  '[data-evidence-artifacts]',
  '[data-evidence-command]',
  '[data-evidence-missing]',
  '[data-final-media]',
]

describe('HarnessStepView — mặt câu trả lời chỉ markdown (P4.2)', () => {
  it('lượt mang `evidence` ⇒ biên nhận vẫn đếm, mặt câu trả lời không còn khối nào của app', () => {
    const host = render([
      userTurn,
      ...writeToolEvents('frontend/src/i18n/vi.ts'),
      finalAssistant('Đã sửa nhãn cuối lượt.', sufficientEvidence),
    ])

    const face = host.querySelector('[data-final-answer="true"]')
    expect(face).toBeTruthy()
    for (const hook of FACE_APP_HOOKS) expect(host.querySelector(hook)).toBeNull()
    // Không còn hàng đường dẫn nào do app vẽ (khối bằng chứng cũ in chúng).
    expect(host.querySelector('[data-artifact-path]')).toBeNull()

    // Chữ của model vẫn nguyên văn, và mặt câu trả lời chỉ có ĐẦU LƯỢT + KHUNG CHỮ.
    expect(face?.textContent).toContain('Đã sửa nhãn cuối lượt.')
    expect(face?.children.length).toBe(2)
    expect(face?.querySelector('[data-final-text]')?.textContent).toContain('Đã sửa nhãn cuối lượt.')

    // Dữ liệu cổng vẫn tới người đọc qua dòng biên nhận ở ĐẦU LƯỢT (D-20: không vẽ ở mặt câu trả lời).
    const receipt = host.querySelector('[data-activity-receipt="true"]')?.textContent ?? ''
    expect(receipt).toContain('lệnh')
    expect(receipt).toContain('bằng chứng')
  })

  it('P5.3: cùng lượt ấy, câu trả lời tiếng Anh ⇒ biên nhận tiếng Anh (chữ app theo ngôn ngữ câu trả lời)', () => {
    const host = render([
      userTurn,
      ...writeToolEvents('frontend/src/i18n/vi.ts'),
      finalAssistant('Fixed the label at the end of the turn.', sufficientEvidence),
    ])

    const receipt = host.querySelector('[data-activity-receipt="true"]')?.textContent ?? ''
    expect(receipt).toContain('command')
    expect(receipt).toContain('evidence')
    expect(receipt).not.toContain('bằng chứng')
  })

  it('P4.1: ảnh trong câu trả lời hiện thành tile ngay trong mạch chữ, bấm ra khung xem lớn', () => {
    const capture = '.generated_artifacts/captures/tab/2e4f1a20/2e4f1a20_007_tab-runs-page.png'
    const onOpenLightbox = vi.fn()
    const host = render(
      [
        userTurn,
        finalAssistant(`![Công việc: bảng chạy đã đổi nhãn](${capture})`, sufficientEvidence),
      ],
      null,
      onOpenLightbox,
    )

    const tile = host.querySelector('[data-final-text] [data-capture-tile="true"]')
    expect(tile).toBeTruthy()
    expect(tile?.querySelector('[data-capture-label="true"]')?.textContent).toBe(
      'Công việc: bảng chạy đã đổi nhãn',
    )
    expect(tile?.querySelector('[data-capture-file="true"]')?.textContent).toBe('2e4f1a20_007_tab-runs-page.png')

    click(tile?.querySelector('[data-artifact-open="media"]'))
    expect(onOpenLightbox).toHaveBeenCalledTimes(1)
    expect(onOpenLightbox.mock.calls[0][0]).toEqual({
      type: 'image',
      src: `/__box/file/media?path=${encodeURIComponent(capture)}`,
      caption: 'Công việc: bảng chạy đã đổi nhãn',
      artifactPath: capture,
    })
  })

  it('P4.1: link tệp kết quả test trong câu trả lời mở tab Files đúng tệp', () => {
    const log = '.generated_artifacts/captures/evidence/sid8/sid8_9_pytest-result.txt'
    const showTab = vi.spyOn(useUiStore.getState(), 'showTab')
    const host = render([
      userTurn,
      finalAssistant(`- Kết quả test: [${log}](${log})`, sufficientEvidence),
    ])

    const button = host.querySelector(`[data-artifact-open="files"][data-artifact-path="${log}"]`)
    expect(button).toBeTruthy()
    // Đường cũ `<a target="_blank">` biến mất: bấm vào nó là mở một tab trắng.
    expect(host.querySelector('[data-final-text] a')).toBeNull()

    click(button)

    expect(showTab).toHaveBeenCalledWith('files', { path: log })
    // Cùng một sự thật, kiểm bằng trạng thái thật: đây là đường `tabIntentTargets.files` mà
    // `useWorkspaceFiles` đọc, và là thao tác người dùng nên không bị `autoOpenTabs` chặn.
    expect(useUiStore.getState().tabIntentTargets.files).toEqual({ path: log })
    expect(useUiStore.getState().activeTab).toBe('files')
  })

  it('lượt không mang trường `evidence` ⇒ cũng không có chữ nào của app quanh câu trả lời', () => {
    const host = render([userTurn, finalAssistant('Đã sửa nhãn cuối lượt.')])

    for (const hook of FACE_APP_HOOKS) expect(host.querySelector(hook)).toBeNull()
    expect(host.querySelector('[data-final-answer="true"]')?.textContent).toContain('Đã sửa nhãn cuối lượt.')
    // Không có trường `evidence` thì biên nhận KHÔNG được nói số mảnh bằng chứng nào.
    const receipt = host.querySelector('[data-activity-receipt="true"]')?.textContent ?? ''
    expect(receipt).not.toContain('bằng chứng')
    expect(receipt).not.toContain('evidence')
  })

  it('cờ `degraded` của nhật ký vẫn nói ra (nhật ký bền trong box không bị nuốt)', () => {
    const row = {
      seq: 3,
      kind: 'evidence',
      text: 'lượt 1: đã kiểm chứng — 1 mảnh bằng chứng',
      id: 'E:sid8-3',
      status: 'info',
      data: { verdict: 'sufficient', checked: 1, mode: 'warn', missing: [], changedFiles: [] },
      evidence: [
        { type: 'command', path: null, command: 'npx vitest run src/components/chat', note: 'exit 0' },
        { type: 'file', path: DIFF_PATH, command: null, note: 'diff' },
      ],
      turn: 1,
      step: 2,
    }
    const journal: HarnessJournal = {
      records: [row],
      lastSeq: 3,
      degraded: true,
      evidenceByTurn: { 1: row },
    }
    const host = render(
      [userTurn, finalAssistant('Đã sửa nhãn cuối lượt.', { verdict: 'sufficient', turn: 1, mode: 'warn', checked: 0 })],
      journal,
    )

    expect(host.querySelector('[data-journal-degraded="true"]')?.textContent).toContain(
      'was not written in this session',
    )
  })
})
