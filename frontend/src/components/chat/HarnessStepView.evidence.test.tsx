/**
 * P4.2/P4.3/P4.4 — cổng bằng chứng sống trên giao diện.
 *
 * Bốn chuyện người đọc phải phân biệt được, và cả bốn đều nằm trong DOM này:
 *  1. lượt có `evidence.verdict='sufficient'` ⇒ nhãn XANH + danh sách mảnh bằng chứng mở được;
 *  2. lượt `insufficient` ⇒ nhãn VÀNG + lý do đã dịch sang tiếng người + mục `data-evidence-missing`;
 *  3. lượt KHÔNG mang trường `evidence` (phiên cũ / công tắc đo tắt) ⇒ nhãn VÀNG, **không bao giờ
 *     xanh**, và khối bằng chứng vắng mặt thật — không dựng mục rỗng cho đủ hình;
 *  4. bấm một mục tệp ⇒ mở đúng đường dẫn đó trong tab Files.
 *
 * Thêm hai ca phụ cho hai đường dữ liệu khác của cùng một sự thật: `not_measurable` (xám) và hàng
 * `E:` từ nhật ký (lệnh + tệp + nhật ký `degraded`).
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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let seq = 0

function ev(type: string, data: Record<string, unknown> = {}, created?: number): HarnessEvent {
  seq += 1
  return { seq, type, data, created: created ?? 1000 + seq }
}

function render(events: HarnessEvent[], journal: HarnessJournal | null = null): HTMLElement {
  const node: ReactNode = (
    <HarnessStepView events={events} status="idle" error={null} journal={journal} />
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

function click(el: Element | null) {
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
const finalAssistant = (evidence?: Record<string, unknown>) =>
  ev('assistant', evidence ? { text: 'Đã sửa nhãn cuối lượt.', final: true, evidence } : { text: 'Đã sửa nhãn cuối lượt.', final: true })

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

describe('HarnessStepView — cổng bằng chứng (P4)', () => {
  it('sufficient ⇒ nhãn xanh `đã kiểm chứng` + danh sách mảnh bằng chứng', () => {
    const host = render([userTurn, ...writeToolEvents(DIFF_PATH), finalAssistant(sufficientEvidence)])

    const badge = host.querySelector('[data-evidence-badge]')
    expect(badge?.getAttribute('data-evidence-badge')).toBe('verified')
    // Hook thứ hai giữ nguyên `verdict` THẬT của backend để test đối chiếu được cả hai.
    expect(badge?.getAttribute('data-evidence-verdict')).toBe('sufficient')
    expect(badge?.getAttribute('role')).toBe('status')
    expect(badge?.textContent).toContain('đã kiểm chứng')
    expect(badge?.className).toContain('text-emerald-400')

    expect(host.querySelector('[data-evidence-artifacts="true"]')).toBeTruthy()
    const items = host.querySelectorAll('[data-artifact-path]')
    expect(items).toHaveLength(2)
    expect([...items].map((item) => item.getAttribute('data-artifact-path'))).toEqual([
      'frontend/src/i18n/vi.ts',
      DIFF_PATH,
    ])
    // Nhóm khẳng định thiếu bằng chứng vẫn hiện, kèm câu nói thật là nó rỗng.
    expect(host.querySelector('[data-evidence-missing]')).toBeNull()
    expect(host.querySelector('[data-evidence-missing-empty="true"]')?.textContent).toContain('không có khẳng định nào thiếu')
    // Biên nhận của khối đếm đúng số mục đang có, và nói rõ công tắc cổng lúc chấm.
    expect(host.querySelector('[data-evidence-toggle="true"]')?.textContent).toContain('2 bằng chứng')
    expect(host.querySelector('[data-evidence-toggle="true"]')?.textContent).toContain('BOXFOX_EVIDENCE_GATE = warn')
    // Số đo thật của mảnh bằng chứng: vân tay nội dung, số dòng thêm/bớt, số byte.
    const diffRow = [...items].map((item) => item.textContent).find((text) => text?.includes(DIFF_PATH))
    expect(diffRow).toContain('sha256 5b8bf90513…')
    expect(diffRow).toContain('+1')
    expect(diffRow).toContain('−0')
    expect(diffRow).toContain('22 B')
  })

  it('insufficient ⇒ nhãn vàng + lý do dịch sang tiếng người + mục `data-evidence-missing`', () => {
    const host = render([
      userTurn,
      finalAssistant({
        verdict: 'insufficient',
        turn: 1,
        mode: 'warn',
        checked: 1,
        missing: [
          { reason: 'change_without_verification', detail: 'src/app.py' },
          { reason: 'ui_change_without_capture', detail: 'frontend/src/App.tsx' },
        ],
        changedFiles: ['src/app.py'],
        artifacts: [{ kind: 'diff', path: DIFF_PATH }],
      }),
    ])

    const badge = host.querySelector('[data-evidence-badge]')
    expect(badge?.getAttribute('data-evidence-badge')).toBe('unverified')
    expect(badge?.getAttribute('data-evidence-verdict')).toBe('insufficient')
    expect(badge?.textContent).toContain('chưa kiểm chứng')
    expect(badge?.className).toContain('text-amber-400')
    // Lý do phải đọc được KHÔNG cần hover: câu dịch + mã máy để đối chiếu log.
    expect(badge?.getAttribute('title')).toContain('tệp đã đổi nhưng không có lệnh nào kiểm lại')
    expect(badge?.getAttribute('title')).toContain('giao diện đã đổi nhưng chưa có ảnh chụp sau thay đổi')

    const rows = host.querySelectorAll('[data-evidence-missing]')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-evidence-missing')).toBe('change_without_verification')
    expect(rows[0].textContent).toContain('tệp đã đổi nhưng không có lệnh nào kiểm lại')
    expect(rows[0].textContent).toContain('src/app.py')
    expect(rows[1].getAttribute('data-evidence-missing')).toBe('ui_change_without_capture')
    expect(host.querySelector('[data-evidence-missing-empty="true"]')).toBeNull()
    // Câu trả lời của model KHÔNG bị cổng sửa: nội dung vẫn nguyên văn.
    expect(host.querySelector('[data-final-answer="true"]')?.textContent).toContain('Đã sửa nhãn cuối lượt.')
  })

  it('lượt không có trường `evidence` ⇒ nhãn vàng, KHÔNG BAO GIỜ xanh, và khối bằng chứng vắng mặt', () => {
    const host = render([userTurn, finalAssistant()])

    const badge = host.querySelector('[data-evidence-badge]')
    expect(badge?.getAttribute('data-evidence-badge')).toBe('unverified')
    expect(badge?.getAttribute('data-evidence-verdict')).toBeNull()
    expect(badge?.textContent).toContain('chưa kiểm chứng')
    expect(badge?.className).not.toContain('text-emerald-400')
    // Vắng khối là THẬT: không bịa một mục bằng chứng rỗng cho đủ hình.
    expect(host.querySelector('[data-evidence-artifacts="true"]')).toBeNull()
    expect(host.querySelector('[data-evidence-note="true"]')?.textContent).toContain('phiên cũ, hoặc công tắc đo đang tắt')
  })

  it('bấm mục tệp ⇒ `showTab("files", {path})` đúng tham số', () => {
    const showTab = vi.spyOn(useUiStore.getState(), 'showTab')
    const host = render([userTurn, finalAssistant(sufficientEvidence)])

    const row = host.querySelector(`[data-artifact-path="frontend/src/i18n/vi.ts"]`)
    click(row?.querySelector('[data-artifact-open="files"]') ?? null)

    expect(showTab).toHaveBeenCalledWith('files', { path: 'frontend/src/i18n/vi.ts' })
    // Cùng một sự thật, kiểm bằng trạng thái thật: đây là đường `tabIntentTargets.files` mà
    // `useWorkspaceFiles` đọc, và là thao tác người dùng nên không bị `autoOpenTabs` chặn.
    expect(useUiStore.getState().tabIntentTargets.files).toEqual({ path: 'frontend/src/i18n/vi.ts' })
    expect(useUiStore.getState().activeTab).toBe('files')
  })

  it('not_measurable ⇒ nhãn xám `chưa đo được`', () => {
    const host = render([
      userTurn,
      finalAssistant({
        verdict: 'not_measurable',
        turn: 1,
        mode: 'warn',
        checked: 0,
        missing: [{ reason: 'box_unreachable', detail: 'docker exec: no such container' }],
        changedFiles: [],
        artifacts: [],
      }),
    ])

    const badge = host.querySelector('[data-evidence-badge]')
    expect(badge?.getAttribute('data-evidence-badge')).toBe('not_measurable')
    expect(badge?.getAttribute('data-evidence-verdict')).toBe('not_measurable')
    expect(badge?.textContent).toContain('chưa đo được')
    expect(badge?.className).toContain('text-zinc-400')
    expect(host.querySelector('[data-evidence-missing="box_unreachable"]')?.textContent).toContain('không kết nối được box')
  })

  it('hàng `E:` của nhật ký kể được lệnh đã chạy, và nhật ký `degraded` thì nói ra', () => {
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
    const host = render([userTurn, finalAssistant({ verdict: 'sufficient', turn: 1, mode: 'warn', checked: 0 })], journal)

    // Lệnh không có đường dẫn nên nằm ở nhóm riêng, không lẫn vào danh sách tệp.
    const command = host.querySelector('[data-evidence-command]')
    expect(command?.getAttribute('data-evidence-command')).toBe('npx vitest run src/components/chat')
    expect(command?.textContent).toContain('exit 0')
    const paths = [...host.querySelectorAll('[data-artifact-path]')].map((item) => item.getAttribute('data-artifact-path'))
    expect(paths).toEqual([DIFF_PATH])
    expect(host.querySelector('[data-evidence-toggle="true"]')?.textContent).toContain('2 bằng chứng')
    // Cờ `degraded` của khối `journal` không bị nuốt: người đọc biết nhật ký bền đang hỏng.
    expect(host.querySelector('[data-journal-degraded="true"]')?.textContent).toContain('chưa ghi được ở phiên này')
  })

  it('mã thoát và thời lượng lấy từ chính lượt, không in nhãn rỗng của payload', () => {
    const command = 'npx vitest run src/components/chat'
    // Hàng `E:` sống ghim đúng chuỗi này khi payload lệnh không mang mã thoát — nhãn đó là rác.
    const row = {
      seq: 5,
      kind: 'evidence',
      text: 'lượt 1: đã kiểm chứng — 1 mảnh bằng chứng',
      id: 'E:sid8-5',
      status: 'info',
      data: { verdict: 'sufficient', checked: 1, mode: 'warn', missing: [], changedFiles: [] },
      evidence: [{ type: 'command', path: null, command, note: 'exit None' }],
      turn: 1,
      step: 2,
    }
    const journal: HarnessJournal = { records: [row], lastSeq: 5, degraded: false, evidenceByTurn: { 1: row } }
    const host = render(
      [
        userTurn,
        ev('tool_start', { id: 'c1', name: 'terminal_exec', args: { command } }, 2000),
        ev('tool_end', { id: 'c1', name: 'terminal_exec', args: { command }, result: { exit_code: 0 } }, 2002.9),
        finalAssistant({ verdict: 'sufficient', turn: 1, mode: 'warn', checked: 0 }),
      ],
      journal,
    )

    const rendered = host.querySelector('[data-evidence-command]')
    expect(rendered?.getAttribute('data-evidence-command')).toBe(command)
    expect(rendered?.textContent).toContain('exit 0')
    expect(rendered?.textContent).toContain('2.9s')
    expect(rendered?.textContent).not.toContain('None')
  })

  it('not_measurable ⇒ biên nhận nói `chưa đo được`, không đếm lý do đo hỏng thành khẳng định', () => {
    const host = render([
      userTurn,
      finalAssistant({
        verdict: 'not_measurable',
        turn: 1,
        mode: 'warn',
        checked: 0,
        missing: [{ reason: 'box_probe_failed', detail: 'timeout sau 20s' }],
        changedFiles: [],
        artifacts: [],
      }),
    ])

    const receipt = host.querySelector('[data-evidence-toggle="true"]')?.textContent ?? ''
    expect(receipt).toContain('chưa đo được')
    expect(receipt).not.toContain('khẳng định chưa kiểm')
    expect(host.querySelector('[data-evidence-missing-title="true"]')?.textContent).toBe('Chưa đo được lượt này')
    // Lý do của phép đo vẫn hiện nguyên vẹn: đổi cách đếm không được phép giấu lý do.
    const item = host.querySelector('[data-evidence-missing="box_probe_failed"]')
    expect(item?.textContent).toContain('phép dò bằng chứng trong box bị lỗi')
    expect(item?.textContent).toContain('box_probe_failed')
  })

  it('lý do là khẳng định vẫn đếm và vẫn mang tiêu đề khẳng định', () => {
    const host = render([
      userTurn,
      finalAssistant({
        verdict: 'insufficient',
        turn: 1,
        mode: 'warn',
        checked: 0,
        missing: [
          { reason: 'change_without_verification', detail: 'src/app.py' },
          { reason: 'box_probe_failed', detail: 'timeout' },
        ],
        changedFiles: ['src/app.py'],
        artifacts: [],
      }),
    ])

    const receipt = host.querySelector('[data-evidence-toggle="true"]')?.textContent ?? ''
    expect(receipt).toContain('1 khẳng định chưa kiểm')
    expect(host.querySelector('[data-evidence-missing-title="true"]')?.textContent).toBe('Khẳng định chưa có bằng chứng')
  })

  it('mã lý do chưa có câu dịch ⇒ in nguyên mã máy, không in khoá i18n', () => {
    const host = render([
      userTurn,
      finalAssistant({
        verdict: 'insufficient',
        turn: 1,
        mode: 'warn',
        checked: 0,
        missing: [{ reason: 'verdict_from_the_future', detail: '' }],
        changedFiles: [],
        artifacts: [],
      }),
    ])

    const item = host.querySelector('[data-evidence-missing="verdict_from_the_future"]')
    expect(item?.textContent).toContain('verdict_from_the_future')
    expect(item?.textContent).not.toContain('chat.evidenceReason')
  })
})
