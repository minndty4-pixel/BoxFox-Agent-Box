/**
 * Chip trong transcript phải bấm được (đợt 4): chip sub-agent → tab Sub-agents,
 * chip kế hoạch → tab Plan, hàng quyết định → tab Decisions kèm `requestId`.
 * Trước đây các chip này chỉ nằm đó, không có `onClick`.
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { HarnessEvent } from '../../store/harnessChatStore'
import { HarnessStepView, type TranscriptTabId } from './HarnessStepView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let seq = 0

function ev(type: string, data: Record<string, unknown> = {}, created?: number): HarnessEvent {
  seq += 1
  return { seq, type, data, created: created ?? 1000 + seq }
}

function render(
  events: HarnessEvent[],
  onOpenTab: (tab: TranscriptTabId, target?: Record<string, unknown> | null) => void,
  sessionId: string | null = null,
): HTMLElement {
  const node: ReactNode = (
    <HarnessStepView
      events={events}
      status="idle"
      error={null}
      onOpenTab={onOpenTab}
      sessionId={sessionId}
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
})

const userTurn = ev('user', { text: 'Nhờ em kiểm tra' })

describe('HarnessStepView — chip mở tab (đợt 4)', () => {
  it('chip chuyên gia mở tab Sub-agents kèm sessionId', () => {
    const onOpenTab = vi.fn()
    const host = render(
      [userTurn, ev('child', { sessionId: 'child-42', role: 'reviewer', status: 'running' })],
      onOpenTab,
    )

    const chip = host.querySelector('[data-timeline="child"]')
    expect(chip).toBeTruthy()
    click(chip)

    expect(onOpenTab).toHaveBeenCalledWith('subagents', { sessionId: 'child-42' })
  })

  it('chip kế hoạch mở tab Plan kèm identity trần', () => {
    const onOpenTab = vi.fn()
    const host = render(
      [
        userTurn,
        ev('plan_written', {
          identity: 'agent-box-plan',
          version: 2,
          slug: 'agent-box-plan',
          relativePath: 'agent-box-plan/v2-agent-box-plan.md',
        }),
      ],
      onOpenTab,
    )

    const chip = host.querySelector('[data-timeline="plan"]')
    expect(chip).toBeTruthy()
    // Identity trần, không kèm `vN-` — đúng như `GET /__box/plans`.
    expect(chip?.getAttribute('data-plan-identity')).toBe('agent-box-plan')
    click(chip)

    expect(onOpenTab).toHaveBeenCalledWith('plan', { identity: 'agent-box-plan' })
  })

  it('hàng quyết định đang chờ mở tab Decisions kèm requestId', () => {
    const onOpenTab = vi.fn()
    const host = render(
      [
        userTurn,
        ev('decision_requested', {
          decisionId: 'd-77',
          kind: 'question',
          question: 'Chọn cách ghi log?',
          options: [{ id: 'a', label: 'JSON', kind: 'approve' }],
          deadline: 1_758_300_000,
          defaultChoice: 'reject',
        }),
      ],
      onOpenTab,
    )

    const row = host.querySelector('[data-timeline="decision"]')
    expect(row?.getAttribute('data-decision-id')).toBe('d-77')
    expect(row?.getAttribute('data-decision-status')).toBe('pending')
    expect(row?.textContent).toContain('Chọn cách ghi log?')

    const button = row?.querySelector('button')
    click(button ?? null)

    expect(onOpenTab).toHaveBeenCalledWith('decisions', { requestId: 'd-77' })
    expect(onOpenTab).toHaveBeenCalledTimes(1)
  })

  it('quyết định đã xong hiện trạng thái thật và chỉ còn một hàng', () => {
    const onOpenTab = vi.fn()
    const host = render(
      [
        userTurn,
        ev('decision_requested', { decisionId: 'd-78', kind: 'question', question: 'Chọn cách ghi log?' }),
        ev('decision_resolved', {
          decisionId: 'd-78',
          choice: 'a',
          status: 'approved',
          note: '',
          reason: 'user',
          resolvedAt: 1_758_300_100,
        }),
      ],
      onOpenTab,
    )

    const rows = host.querySelectorAll('[data-timeline="decision"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('data-decision-status')).toBe('approved')
    expect(rows[0].textContent).toContain('Approved')
  })

  it('quá hạn hiện là Expired, không phải Approved', () => {
    const host = render(
      [
        userTurn,
        ev('decision_requested', { decisionId: 'd-79', kind: 'approval', action: 'write_file(/etc/hosts)' }),
        ev('decision_resolved', {
          decisionId: 'd-79',
          choice: 'reject',
          status: 'rejected',
          reason: 'timeout',
          resolvedAt: 1_758_300_900,
        }),
      ],
      vi.fn(),
    )

    const row = host.querySelector('[data-timeline="decision"]')
    expect(row?.textContent).toContain('Expired')
    expect(row?.textContent).not.toContain('Approved')
    // Không còn chấm nhấp nháy khi đã có kết quả.
    expect(row?.querySelector('.animate-pulse')).toBeNull()
  })

  it('không có `onOpenTab` thì không ném lỗi khi bấm', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    act(() => {
      root.render(
        <I18nProvider>
          <HarnessStepView
            events={[userTurn, ev('plan_written', { identity: 'p', version: 1 })]}
            status="idle"
            error={null}
          />
        </I18nProvider>,
      )
    })

    expect(() => click(host.querySelector('[data-timeline="plan"]'))).not.toThrow()
  })

  // T15 — chip chuyên gia phải kể đường ống peer, nhưng không được hứa hão: con còn chạy thì
  // mũi tên là Ý ĐỊNH, con đóng sổ thì đọc biên nhận THẬT trong `deliveries[]`.
  it('con đang chạy: chip nói `sẽ giao cho …` (ý định, chưa giao)', () => {
    const host = render(
      [
        userTurn,
        ev('child', {
          sessionId: 'child-43',
          role: 'testing',
          status: 'started',
          turn: 1,
          deliverTo: ['main', 'role:review'],
        }),
      ],
      vi.fn(),
    )

    const chip = host.querySelector('[data-timeline="child"]')
    expect(chip?.getAttribute('data-child-targets')).toBe('main,review')
    expect(chip?.textContent ?? '').toContain('Specialist: testing (started)')
    expect(chip?.textContent ?? '').toContain('sẽ giao cho main, review')
    expect(chip?.textContent ?? '').not.toContain('đã giao cho')
  })

  it('con đóng sổ: chip đọc `deliveries[]` thật, đích là sessionId nên hiện vai/main', () => {
    const host = render(
      [
        userTurn,
        ev('child', {
          sessionId: 'child-44',
          role: 'Build',
          status: 'completed',
          turn: 1,
          deliverTo: ['main', 'role:review'],
          // Đích thật là `sessionId`: `sess-1` = phiên cha (main), `child-99` = em review.
          deliveries: [
            { recipient: 'sess-1', state: 'injected', chars: 900, truncated: false },
            { recipient: 'child-99', state: 'pending', chars: 900, truncated: false },
          ],
        }),
        ev('child', { sessionId: 'child-99', role: 'review', status: 'running', turn: 1 }),
      ],
      vi.fn(),
      'sess-1',
    )

    const chip = host.querySelector('[data-timeline="child"]')
    expect(chip?.getAttribute('data-child-targets')).toBe('main,review')
    expect(chip?.textContent ?? '').toContain('đã giao cho main, review')
    expect(chip?.textContent ?? '').not.toContain('sẽ giao cho')
  })

  it('người nhận bị bỏ qua được kể ra kèm lý do, không đội lốt "đã giao"', () => {
    const host = render(
      [
        userTurn,
        ev('child', {
          sessionId: 'child-46',
          role: 'Build',
          status: 'completed',
          turn: 1,
          deliverTo: ['role:review'],
          deliveries: [
            { recipient: 'review', state: 'skipped', chars: 0, truncated: false, reason: 'no_such_peer' },
          ],
        }),
      ],
      vi.fn(),
    )

    const chip = host.querySelector('[data-timeline="child"]')
    expect(chip?.textContent ?? '').toContain('không giao được cho review · không có người nhận')
    expect(chip?.textContent ?? '').not.toContain('đã giao cho')
  })

  it('bản ghi cũ không có dữ liệu đường ống peer thì chip giữ nguyên như trước', () => {
    const host = render(
      [userTurn, ev('child', { sessionId: 'child-45', role: 'Explore', status: 'started' })],
      vi.fn(),
    )

    const chip = host.querySelector('[data-timeline="child"]')
    expect(chip?.textContent ?? '').toBe('Specialist: Explore (started)')
    expect(chip?.getAttribute('data-child-targets')).toBeNull()
  })
})
