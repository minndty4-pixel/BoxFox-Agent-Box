/**
 * Vòng 23 — câu bị cổng ghim: app KHÔNG còn vẽ chúng (D-19/D-20), nhưng phép ĐẾM thì còn.
 *
 * Vòng 14 dựng hàng `data-evidence-claim` trong khối `Bằng chứng` để in nguyên văn câu của câu trả
 * lời mà cổng đã ghim. Vòng 23 chủ nhà chốt bỏ khối ấy khỏi mặt câu trả lời, nên hàng đó không còn
 * — nhưng ba thứ dưới đây vẫn sống và vẫn phải đúng:
 *  1. `CLAIM_REASON_CODES`/`claimMissing`: số "khẳng định chưa kiểm" của dòng biên nhận đếm từ đúng
 *     năm mã ấy; lý do của phép đo hỏng (`box_probe_failed`…) KHÔNG được đếm thành khẳng định;
 *  2. `chargedClaimText`: tra `missing[].detail` ngược về câu của câu trả lời — giữ lại cho vòng
 *     "agent verify" mà D-20 hứa (huy hiệu bỏ, dữ liệu cổng vẫn phát);
 *  3. `evidenceReasonText`: mã lạ in nguyên mã máy, không bao giờ in khoá i18n.
 *
 * Cộng thêm một ca DOM ghim chính điều D-19 nói: payload có `claims[]` mà mặt câu trả lời vẫn không
 * có một hàng nào của app.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { TKey, TVars } from '../../i18n/context'
import type { HarnessEvent } from '../../store/harnessChatStore'
import {
  CLAIM_REASON_CODES,
  HarnessStepView,
  chargedClaimText,
  claimMissing,
  evidenceReasonText,
  readAnswerEvidence,
} from './HarnessStepView'

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

/** `t` giả: đúng một khoá có câu, mọi khoá khác trả CHÍNH khoá (như `lookup` trượt cả hai từ điển). */
const fakeT = (known: Record<string, string>) => (key: TKey, _vars?: TVars) => known[key] ?? key

describe('HarnessStepView — phép đếm và phép tra của câu bị ghim', () => {
  it('chỉ năm mã khẳng định mới đếm; lý do của phép đo hỏng không phải khẳng định', () => {
    expect([...CLAIM_REASON_CODES].sort()).toEqual([
      'answer_references_unknown_command',
      'change_without_verification',
      'claim_path_missing',
      'claim_path_not_in_turn',
      'ui_change_without_capture',
    ])
    const missing = [
      { reason: 'change_without_verification', detail: 'src/app.py' },
      { reason: 'ui_change_without_capture', detail: 'frontend/src/App.tsx' },
      { reason: 'box_probe_failed', detail: 'timeout sau 20s' },
      { reason: 'answer_too_long', detail: '' },
      { reason: 'no_evidence_for_tools', detail: '' },
      { reason: 'no_change', detail: '' },
      { reason: 'verdict_from_the_future', detail: '' },
    ]
    expect(claimMissing(missing).map((item) => item.reason)).toEqual([
      'change_without_verification',
      'ui_change_without_capture',
    ])
  })

  it('tra `missing[].detail` ngược về câu của câu trả lời, theo cả đường dẫn lẫn lệnh', () => {
    const claims = [
      { text: CLAIM_SENTENCE, path: 'src/ghost.py', command: null },
      { text: COMMAND_SENTENCE, path: null, command: 'git status' },
    ]
    expect(chargedClaimText(claims, { reason: 'claim_path_not_in_turn', detail: 'src/ghost.py' })).toBe(CLAIM_SENTENCE)
    expect(chargedClaimText(claims, { reason: 'answer_references_unknown_command', detail: 'git status' })).toBe(
      COMMAND_SENTENCE,
    )
    // Lý do của phép đo hỏng không có bản ghi ⇒ `null`, chỗ vẽ không được bịa câu nào.
    expect(chargedClaimText(claims, { reason: 'box_probe_failed', detail: 'unreachable: RuntimeError' })).toBeNull()
    expect(chargedClaimText(claims, { reason: 'change_without_verification', detail: '   ' })).toBeNull()
  })

  it('mã lý do chưa có câu dịch ⇒ in nguyên mã máy, không in khoá i18n', () => {
    const t = fakeT({
      'chat.evidenceReason.change_without_verification': 'files changed but no command re-checked them',
    } as Record<string, string>)
    expect(evidenceReasonText(t, 'change_without_verification')).toBe('files changed but no command re-checked them')
    // `t()` của app trả chính khoá khi trượt cả hai từ điển — người đọc phải thấy mã máy, không thấy khoá.
    expect(evidenceReasonText(t, 'verdict_from_the_future')).toBe('verdict_from_the_future')
    expect(evidenceReasonText(t, 'verdict_from_the_future')).not.toContain('chat.evidenceReason')
  })

  it('`readAnswerEvidence` giữ `claims[]` đã cắt khoảng trắng, bỏ bản ghi không có câu', () => {
    const event = ev('assistant', {
      text: 'Xong.',
      final: true,
      evidence: {
        verdict: 'insufficient',
        turn: 1,
        mode: 'warn',
        checked: 1,
        missing: [{ reason: 'answer_references_unknown_command', detail: 'git status' }],
        claims: [
          { text: `  ${COMMAND_SENTENCE}  `, line: 2, path: null, command: 'git status' },
          { text: '   ', line: 3, path: 'src/ghost.py', command: null },
          { nonsense: true },
        ],
      },
    })

    const parsed = readAnswerEvidence(event)
    expect(parsed?.claims).toEqual([{ text: COMMAND_SENTENCE, path: null, command: 'git status' }])
    expect(parsed?.missing.map((item) => item.reason)).toEqual(['answer_references_unknown_command'])
  })

  it('D-19: payload có `claims[]` mà mặt câu trả lời vẫn không có hàng nào của app', () => {
    const answerText = `Xong. ${CLAIM_SENTENCE}`
    const host = render([
      userTurn,
      ev('assistant', {
        text: answerText,
        final: true,
        evidence: {
          verdict: 'insufficient',
          turn: 1,
          mode: 'warn',
          checked: 1,
          missing: [{ reason: 'claim_path_not_in_turn', detail: 'src/ghost.py' }],
          claims: [{ text: CLAIM_SENTENCE, line: 3, path: 'src/ghost.py', command: null }],
          changedFiles: [],
          artifacts: [],
        },
      }),
    ])

    const face = host.querySelector('[data-final-answer="true"]')
    expect(face?.textContent).toContain(answerText)
    // Câu ấy có mặt vì CHÍNH model viết nó, không phải vì app ghim lại: không ngoặc kép của app,
    // không hàng `data-evidence-claim`, không mục `data-evidence-missing`.
    expect(host.querySelector('[data-evidence-claim]')).toBeNull()
    expect(host.querySelector('[data-evidence-missing]')).toBeNull()
    expect(face?.textContent).not.toContain('“')
    // Dữ liệu cổng vẫn tới: biên nhận đầu lượt vẫn nói 1 khẳng định chưa kiểm (tiếng Việt, P5.3).
    expect(host.querySelector('[data-activity-receipt="true"]')?.textContent).toContain('1 khẳng định chưa kiểm')
  })
})
