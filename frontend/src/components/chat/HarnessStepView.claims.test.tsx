/**
 * L14 — khối bằng chứng phải in CÂU của câu trả lời bị cổng ghim, không chỉ đường dẫn/lệnh.
 *
 * Trước ca này, mục `missing[]` chỉ hiện câu dịch của lý do + chi tiết + mã máy, nên người đọc
 * không biết cổng đã ghim câu nào (mock `dv23` mở đầu mỗi mục bằng chính câu ấy trong ngoặc kép).
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { HarnessEvent } from '../../store/harnessChatStore'
import { HarnessStepView } from './HarnessStepView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let seq = 0

function ev(type: string, data: Record<string, unknown> = {}, created?: number): HarnessEvent {
  seq += 1
  return { seq, type, data, created: created ?? 1000 + seq }
}

function render(events: HarnessEvent[]): HTMLElement {
  const node: ReactNode = <HarnessStepView events={events} status="idle" error={null} journal={null} />
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  seq = 0
})

const userTurn = ev('user', { text: 'Nhờ em đổi nhãn' })

const CLAIM_SENTENCE = 'Đã đối chiếu giao diện trước và sau khi đổi nhãn.'
const COMMAND_SENTENCE = 'Kiểm bằng `git status` trước khi trả lời.'

describe('HarnessStepView — câu bị ghim (L14)', () => {
  it('mục `claim_path_not_in_turn` in nguyên văn câu của câu trả lời trong ngoặc kép', () => {
    const host = render([
      userTurn,
      ev('assistant', {
        text: 'Xong.',
        final: true,
        evidence: {
          verdict: 'insufficient',
          turn: 1,
          mode: 'warn',
          checked: 1,
          missing: [{ reason: 'claim_path_not_in_turn', detail: 'src/ghost.py' }],
          claims: [
            { text: CLAIM_SENTENCE, line: 3, path: 'src/ghost.py', command: null, assertive: true, backed: false },
          ],
          changedFiles: [],
          artifacts: [],
        },
      }),
    ])

    const row = host.querySelector('[data-evidence-missing="claim_path_not_in_turn"]')
    expect(row).toBeTruthy()
    const claimLine = row?.querySelector('[data-evidence-claim="true"]')
    expect(claimLine?.textContent).toBe(`“${CLAIM_SENTENCE}”`)
    // Câu bị ghim đi TRƯỚC lý do và mã máy — thứ tự đọc của mock.
    const text = row?.textContent ?? ''
    expect(text.indexOf(CLAIM_SENTENCE)).toBeGreaterThanOrEqual(0)
    expect(text.indexOf(CLAIM_SENTENCE)).toBeLessThan(text.indexOf('claim_path_not_in_turn'))
    expect(text).toContain('src/ghost.py')
  })

  it('mục của LỆNH cũng tra được câu, và lý do không có bản ghi thì không in câu nào', () => {
    const host = render([
      userTurn,
      ev('assistant', {
        text: 'Xong.',
        final: true,
        evidence: {
          verdict: 'not_measurable',
          turn: 1,
          mode: 'warn',
          checked: 1,
          missing: [
            { reason: 'answer_references_unknown_command', detail: 'git status' },
            { reason: 'box_probe_failed', detail: 'unreachable: RuntimeError' },
          ],
          claims: [{ text: COMMAND_SENTENCE, line: 2, path: null, command: 'git status', assertive: true, backed: false }],
          changedFiles: [],
          artifacts: [],
        },
      }),
    ])

    const commandRow = host.querySelector('[data-evidence-missing="answer_references_unknown_command"]')
    expect(commandRow?.querySelector('[data-evidence-claim="true"]')?.textContent).toBe(`“${COMMAND_SENTENCE}”`)

    // Lý do của phép đo hỏng không phải một khẳng định: không có câu nào để in, mục giữ nguyên lối cũ.
    const probeRow = host.querySelector('[data-evidence-missing="box_probe_failed"]')
    expect(probeRow?.querySelector('[data-evidence-claim="true"]')).toBeNull()
    expect(probeRow?.textContent).toContain('unreachable: RuntimeError')
  })

  it('event cũ không có `claims` ⇒ không vỡ, chỉ mất câu bị ghim', () => {
    const host = render([
      userTurn,
      ev('assistant', {
        text: 'Xong.',
        final: true,
        evidence: {
          verdict: 'insufficient',
          turn: 1,
          mode: 'warn',
          checked: 1,
          missing: [{ reason: 'change_without_verification', detail: 'src/app.py' }],
          changedFiles: ['src/app.py'],
          artifacts: [],
        },
      }),
    ])

    const row = host.querySelector('[data-evidence-missing="change_without_verification"]')
    expect(row?.querySelector('[data-evidence-claim="true"]')).toBeNull()
    expect(row?.textContent).toContain('src/app.py')
  })
})
