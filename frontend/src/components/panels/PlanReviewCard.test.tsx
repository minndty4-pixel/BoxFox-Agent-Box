/**
 * Thẻ "Phản biện độc lập" — bốn mặt, và luật quan trọng nhất: chỗ thiếu dữ liệu KHÔNG được biến thành
 * một lời khẳng định. `unknown` chỉ có MỘT hàng nói "chưa biết", không tô đỏ, không đoán là "chưa
 * phản biện"; lỗi thiếu mức hiện "severity unknown" thay vì bị hạ xuống "low".
 *
 * Render bằng `createRoot` + `act` như các test panel khác của repo (không có @testing-library).
 * `I18nProvider` mặc định tiếng Anh, nên mọi câu ghim ở đây là chữ của `en.ts`.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { PlanReviewCard } from './PlanReviewCard'
import type { PlanVerification } from '../../lib/plans'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function verificationFor(overrides: Partial<PlanVerification> = {}): PlanVerification {
  return { state: 'none', at: null, criticSessionId: null, issues: [], ...overrides }
}

function renderCard(
  verification: PlanVerification | null,
  props: { onRun?: () => void; runPending?: boolean; runError?: string | null } = {},
) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <I18nProvider>
        <PlanReviewCard
          verification={verification}
          version={3}
          path=".plans/owner-rules/v3.md"
          onRun={props.onRun}
          runPending={props.runPending}
          runError={props.runError}
        />
      </I18nProvider>,
    )
  })
  return host
}

function text(host: HTMLElement, testId: string): string {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''
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
})

describe('PlanReviewCard', () => {
  it('mặt `none`: câu chỉ dẫn + yêu cầu tối thiểu; KHÔNG có hàng lỗi nào', () => {
    const host = renderCard(verificationFor({ state: 'none' }))

    expect(text(host, 'plan-review-card-state')).toBe('Not reviewed')
    expect(text(host, 'plan-review-card')).toMatch(/no review session has read version v3 yet/u)
    expect(text(host, 'plan-review-card')).toContain(
      'Minimum requirement: one plan-review session · reads .plans/owner-rules/v3.md · writes the result into the review ledger',
    )
    expect(host.querySelector('[data-testid="plan-review-finding-1"]')).toBeNull()
    expect(host.querySelector('[data-testid="plan-review-run"]')).toBeNull()
    expect(host.querySelector('[data-testid="plan-review-card"]')?.className).not.toMatch(/rose/u)
  })

  it('mặt `none` có đường chạy phiên thì mới vẽ nút `plan-review-run` (và tắt khi đang chờ)', () => {
    const onRun = vi.fn()
    const host = renderCard(verificationFor({ state: 'none' }), { onRun })

    const button = host.querySelector('[data-testid="plan-review-run"]')
    expect(button?.textContent).toBe('Run review session')
    click(button)
    expect(onRun).toHaveBeenCalledTimes(1)

    const waiting = renderCard(verificationFor({ state: 'none' }), { onRun, runPending: true })
    const pendingButton = waiting.querySelector('[data-testid="plan-review-run"]') as HTMLButtonElement | null
    expect(pendingButton?.disabled).toBe(true)
    expect(pendingButton?.textContent).toBe('Starting the review session…')
  })

  it('mặt `revise`: đúng một hàng mỗi lỗi (thứ tự dữ liệu), chip mức + mã lỗi + cách sửa, số đếm khớp', () => {
    const host = renderCard(
      verificationFor({
        state: 'revise',
        at: '2026-09-23T03:12:00Z',
        criticSessionId: '5cc2b0cf',
        issues: [
          {
            severity: 'high',
            text: 'M3 gộp hai việc vào một bước — không đo được là đã xong hay chưa.',
            fix: 'Tách M3a và M3b.',
            code: 'step-not-measurable',
          },
          { severity: 'low', text: 'M5 ghi “chạy test” nhưng không nêu lệnh cụ thể.' },
          { severity: 'low', text: 'M8 không nói chạy trong conda env nào.', fix: 'Ghi rõ conda activate ld.' },
        ],
      }),
    )

    expect(text(host, 'plan-review-card-state')).toBe('Needs changes')
    const rows = Array.from(host.querySelectorAll('[data-testid^="plan-review-finding-"]'))
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('M3 gộp hai việc vào một bước — không đo được là đã xong hay chưa.')
    expect(rows[0].textContent).toContain('high')
    expect(rows[0].textContent).toContain('step-not-measurable')
    expect(rows[0].textContent).toContain('Fix: Tách M3a và M3b.')
    expect(rows[1].textContent).toContain('low')
    // Không có `fix`/`code` thì hai dòng đó vắng mặt — không bịa mã lỗi cho vừa mắt.
    expect(rows[1].textContent).not.toContain('Fix:')
    expect(rows[2].textContent).toContain('M8 không nói chạy trong conda env nào.')
    expect(rows[2].textContent).toContain('Fix: Ghi rõ conda activate ld.')
    expect(text(host, 'plan-review-card')).toMatch(/3 issue\(s\) · 1 high · 2 low/u)
    expect(text(host, 'plan-review-card')).toContain('plan-review')
  })

  it('mặt `ok` không lỗi: một câu nói đúng thế, không hàng lỗi, không đoạn chỉ dẫn', () => {
    const host = renderCard(verificationFor({ state: 'ok', at: '2026-09-23T03:12:00Z', criticSessionId: 'critic-1' }))

    expect(text(host, 'plan-review-card-state')).toContain('Reviewed · plan-review')
    expect(text(host, 'plan-review-card')).toContain('listed no issues')
    expect(host.querySelector('[data-testid="plan-review-finding-1"]')).toBeNull()
    expect(text(host, 'plan-review-card')).not.toMatch(/Minimum requirement/u)
  })

  it('mặt `unknown`: ĐÚNG một hàng "chưa biết", không đoán, không tô đỏ', () => {
    const host = renderCard(verificationFor({ state: 'unknown' }))

    expect(text(host, 'plan-review-card')).toMatch(/could not be read, so whether this version has been reviewed is unknown/u)
    expect(host.querySelector('[data-testid="plan-review-card-state"]')).toBeNull()
    expect(host.querySelectorAll('[data-testid^="plan-review-finding-"]')).toHaveLength(0)
    expect(host.querySelector('[data-testid="plan-review-run"]')).toBeNull()
    expect(host.querySelector('[data-testid="plan-review-card"]')?.className).not.toMatch(/rose/u)
  })

  it('mức lạ đọc thành "severity unknown", KHÔNG hạ xuống `low`', () => {
    const host = renderCard(verificationFor({ state: 'revise', issues: [{ severity: 'unknown', text: 'không rõ mức' }] }))

    const row = text(host, 'plan-review-finding-1')
    expect(row).toContain('severity unknown')
    expect(row).not.toMatch(/\blow\b/u)
  })

  it('`verification === null` (vừa đổi bản): "đang đọc sổ", KHÔNG mượn câu "sổ không đọc được"', () => {
    const host = renderCard(null)

    expect(text(host, 'plan-review-card-reading')).toContain('Reading the review ledger for version v3')
    // Hai chuyện khác nhau phải là hai câu khác nhau: chưa đọc xong ≠ sổ không đọc được.
    expect(text(host, 'plan-review-card')).not.toMatch(/could not be read/u)
    expect(host.querySelector('[data-testid="plan-review-card-state"]')).toBeNull()
    expect(host.querySelectorAll('[data-testid^="plan-review-finding-"]')).toHaveLength(0)
  })

  it('mặt "đang đọc" vẫn có nút chạy phiên khi có đường — hành động không phụ thuộc lượt đọc', () => {
    const onRun = vi.fn()
    const host = renderCard(null, { onRun })

    click(host.querySelector('[data-testid="plan-review-run"]'))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('cú bấm chạy phiên hỏng: câu lỗi hiện dưới nút, nguyên văn; không lỗi thì không có dòng nào', () => {
    const host = renderCard(verificationFor({ state: 'none' }), {
      onRun: vi.fn(),
      runError: 'PLAN_VERIFY_FAILED: no reviewer session',
    })

    expect(text(host, 'plan-verify-error')).toBe(
      'Could not start the review session: PLAN_VERIFY_FAILED: no reviewer session',
    )

    const clean = renderCard(verificationFor({ state: 'none' }), { onRun: vi.fn() })
    expect(clean.querySelector('[data-testid="plan-verify-error"]')).toBeNull()
  })
})
