/**
 * T4 — bảng Sub-agents phải gom con theo LƯỢT.
 *
 * Lỗi người dùng gặp (BUG-43): đang hỏi câu 3 mà bảng vẫn liệt kê con của câu 1,
 * vì `childrenMap` cũ dựng một danh sách phẳng từ MỌI event `child` của cả run.
 *
 * Bản ghi CŨ không mang `turn` trên event con, nên luật gán lượt phải trùng với
 * transcript (`HarnessStepView.buildHarnessTurns`): lượt của event `user` gần nhất
 * đứng trước. Lệch luật là bảng và khung chat nói hai chuyện khác nhau.
 *
 * T15 — đường ống peer: hàng con phải cho thấy "đang chờ <role> giao kết quả",
 * mũi tên "đã giao cho …" và huy hiệu "đã nhận từ <role>"; nhãn chờ phải TẮT khi
 * `peer_wait_end` tới hoặc khi hàng sổ con của cha không còn `waiting_for`
 * (đồng hồ chạy mãi khi mất event kết thúc là rủi ro đã ghi trong kế hoạch).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useHarnessChatStore } from '../../store/harnessChatStore'
import { useUiStore } from '../../store/uiStore'
import { SubagentInspectorPanel } from './SubagentInspectorPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHAT_ID = 'chat-subagents-turns'

let roots: Root[] = []
const fetchMock = vi.fn()

function ev(seq: number, type: string, data: Record<string, unknown>) {
  return { seq, type, data, created: seq * 100 }
}

/** Event `user` của đợt 22 mang `turn`; bản ghi cũ thì không. */
function userEvent(seq: number, text: string, turn?: number) {
  return ev(seq, 'user', turn === undefined ? { text } : { text, turn })
}

function childEvent(
  seq: number,
  sessionId: string,
  role: string,
  data: Record<string, unknown> = {},
) {
  return ev(seq, 'child', { sessionId, role, status: 'started', goal: `việc của ${role}`, ...data })
}

function seed(events: unknown[]) {
  useHarnessChatStore.setState({
    sessions: {
      [CHAT_ID]: { id: 'sess-1', status: 'running', events: events as never, error: null },
    },
  })
}

function seedMore(events: unknown[]) {
  const current = useHarnessChatStore.getState().sessions[CHAT_ID]?.events ?? []
  seed([...current, ...events])
}

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <I18nProvider>
        <SubagentInspectorPanel />
      </I18nProvider>,
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

function rows(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-child-session-id]')].map(
    (node) => node.getAttribute('data-child-session-id') ?? '',
  )
}

function turnBlocks(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-testid="subagents-turn-block"]')].map(
    (node) => node.getAttribute('data-turn') ?? '',
  )
}

function row(host: HTMLElement, sessionId: string): HTMLElement | null {
  return host.querySelector(`[data-child-session-id="${sessionId}"]`)
}

function toggleAllTurns(host: HTMLElement) {
  const box = host.querySelector<HTMLInputElement>('[data-testid="subagents-all-turns"] input')
  act(() => {
    box?.click()
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ events: [] }),
  }))
  useAgentStore.setState({ activeSessionId: CHAT_ID })
  useUiStore.setState({ tabIntentTargets: {}, openTabs: ['subagents'], activeTab: 'subagents' })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useHarnessChatStore.setState({ sessions: {} })
  vi.unstubAllGlobals()
})

describe('SubagentInspectorPanel — gom con theo lượt (T4)', () => {
  it('lượt mới không có con thì bảng trống, không còn hàng của lượt trước', async () => {
    seed([
      userEvent(1, 'nhờ em tra hồ sơ', 1),
      childEvent(2, 'child-A', 'Explore', { turn: 1 }),
      childEvent(3, 'child-B', 'Build', { turn: 1 }),
      userEvent(4, '2 + 2 = ?', 2),
      childEvent(5, 'child-C', 'review', { turn: 2 }),
      userEvent(6, 'cảm ơn', 3),
      ev(7, 'turn_end', { turn: 3, step: 2, stepsUsed: 2 }),
    ])

    const host = await render()

    // Đúng lượt đang xem (lượt 3) và chỉ nó.
    expect(turnBlocks(host)).toEqual(['3'])
    // Đây chính là BUG-43: hàng của lượt 1/2 không được lọt vào lượt 3.
    expect(rows(host)).toEqual([])
    expect(host.querySelector('[data-child-session-id="child-A"]')).toBeNull()
    expect(host.querySelector('[data-child-session-id="child-C"]')).toBeNull()

    const empty = host.querySelector('[data-testid="subagents-turn-empty"]')
    expect(empty).toBeTruthy()
    expect(empty?.textContent ?? '').toContain('không giao việc')
    expect(empty?.textContent ?? '').toContain('tất cả lượt')
  })

  it('hai lượt, mỗi lượt hai con: gom đúng và đếm đúng từng lượt', async () => {
    seed([
      userEvent(1, 'lượt một', 1),
      childEvent(2, 'child-A', 'Explore', { turn: 1 }),
      childEvent(3, 'child-B', 'Build', { turn: 1 }),
      userEvent(4, 'lượt hai', 2),
      childEvent(5, 'child-C', 'review', { turn: 2 }),
      childEvent(6, 'child-D', 'testing', { turn: 2 }),
    ])

    const host = await render()

    // Mặc định: lượt mới nhất — đúng hai con của lượt đó.
    expect(turnBlocks(host)).toEqual(['2'])
    expect(rows(host)).toEqual(['child-C', 'child-D'])

    toggleAllTurns(host)

    expect(turnBlocks(host)).toEqual(['1', '2'])
    expect(rows(host)).toEqual(['child-A', 'child-B', 'child-C', 'child-D'])
    const headers = [...host.querySelectorAll('[data-testid="subagents-turn-header"]')].map(
      (node) => node.textContent ?? '',
    )
    expect(headers[0]).toContain('Lượt 1 · 2 con')
    expect(headers[1]).toContain('Lượt 2 · 2 con')
    expect(row(host, 'child-A')?.getAttribute('data-child-turn')).toBe('1')
    expect(row(host, 'child-C')?.getAttribute('data-child-turn')).toBe('2')
  })

  it('bản ghi cũ không có `turn`: con theo lượt của event `user` gần nhất đứng trước', async () => {
    seed([
      userEvent(1, 'lượt một'),
      childEvent(2, 'child-X', 'Explore'),
      userEvent(3, 'lượt hai'),
      childEvent(4, 'child-Y', 'Build'),
    ])

    const host = await render()

    expect(turnBlocks(host)).toEqual(['2'])
    expect(rows(host)).toEqual(['child-Y'])

    toggleAllTurns(host)

    expect(turnBlocks(host)).toEqual(['1', '2'])
    expect(row(host, 'child-X')?.getAttribute('data-child-turn')).toBe('1')
    expect(row(host, 'child-Y')?.getAttribute('data-child-turn')).toBe('2')
  })

  it('chip lượt đổi được phạm vi đang xem', async () => {
    seed([
      userEvent(1, 'lượt một', 1),
      childEvent(2, 'child-A', 'Explore', { turn: 1 }),
      userEvent(3, 'lượt hai', 2),
      childEvent(4, 'child-C', 'review', { turn: 2 }),
    ])

    const host = await render()
    expect(rows(host)).toEqual(['child-C'])

    const chip = host.querySelector('[data-testid="subagents-turn-chip"][data-turn="1"]')
    expect(chip?.getAttribute('data-selected')).toBe('false')
    act(() => {
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rows(host)).toEqual(['child-A'])
    expect(
      host
        .querySelector('[data-testid="subagents-turn-chip"][data-turn="1"]')
        ?.getAttribute('data-selected'),
    ).toBe('true')
  })

  it('trạng thái `partial` không bị vẽ như lượt hỏng', async () => {
    seed([
      userEvent(1, 'việc dài', 1),
      childEvent(2, 'child-P', 'Build', { turn: 1 }),
      childEvent(3, 'child-P', 'Build', { turn: 1, status: 'partial' }),
    ])

    const host = await render()

    // Trước bản sửa, `partial` rơi vào nhánh cuối và bị tô đỏ như `failed` (D-1).
    expect(row(host, 'child-P')?.getAttribute('data-child-status')).toBe('partial')
  })
})

describe('SubagentInspectorPanel — đường ống peer (T15)', () => {
  it('`peer_wait` hiện nhãn chờ peer kèm lưới an toàn', async () => {
    fetchMock.mockImplementation(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: String(url).includes('child-W')
          ? [
              ev(1, 'peer_wait', {
                targets: ['role:review'],
                mode: 'wait',
                waitsUntilDelivery: true,
                safetySeconds: 300,
                turn: 1,
              }),
            ]
          : [],
      }),
    }))
    seed([
      userEvent(1, 'nhờ em soát', 1),
      childEvent(2, 'child-W', 'testing', { turn: 1 }),
    ])

    const host = await render()
    const wait = row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')

    expect(wait).toBeTruthy()
    expect(wait?.textContent ?? '').toContain('đang chờ review giao kết quả')
    expect(wait?.textContent ?? '').toContain('lưới an toàn còn 5:00')
  })

  it('`peer_wait_end` tắt nhãn chờ (không để đồng hồ chạy mãi)', async () => {
    fetchMock.mockImplementation(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: String(url).includes('child-W')
          ? [
              ev(1, 'peer_wait', {
                targets: ['role:review'],
                mode: 'wait',
                waitsUntilDelivery: true,
                safetySeconds: 300,
                turn: 1,
              }),
              ev(2, 'peer_wait_end', { status: 'done', waitedMs: 4200, done: ['review'], pending: [] }),
            ]
          : [],
      }),
    }))
    seed([
      userEvent(1, 'nhờ em soát', 1),
      childEvent(2, 'child-W', 'testing', { turn: 1 }),
    ])

    const host = await render()

    expect(row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')).toBeNull()
  })

  it('người chờ tự đặt hạn riêng thì không hiện dòng lưới an toàn', async () => {
    fetchMock.mockImplementation(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: String(url).includes('child-W')
          ? [
              ev(1, 'peer_wait', {
                targets: ['role:review'],
                mode: 'wait',
                waitsUntilDelivery: false,
                deadline: null,
                turn: 1,
              }),
            ]
          : [],
      }),
    }))
    seed([
      userEvent(1, 'nhờ em soát', 1),
      childEvent(2, 'child-W', 'testing', { turn: 1 }),
    ])

    const host = await render()
    const wait = row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')

    expect(wait?.textContent ?? '').toContain('đang chờ review giao kết quả')
    expect(wait?.textContent ?? '').not.toContain('lưới an toàn')
  })

  it('hàng sổ con còn `waiting_for` thì hiện nhãn, mất `waiting_for` thì tắt', async () => {
    seed([
      userEvent(1, 'nhờ em soát', 1),
      childEvent(2, 'child-W', 'testing', {
        turn: 1,
        waiting_for: ['role:review'],
        waitingSince: 1000,
      }),
    ])

    const host = await render()
    expect(row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')).toBeTruthy()

    act(() => {
      seedMore([
        childEvent(3, 'child-W', 'testing', {
          turn: 1,
          status: 'completed',
          waiting_for: [],
          deliverables: 'xong',
        }),
      ])
    })

    expect(row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')).toBeNull()
    expect(row(host, 'child-W')?.getAttribute('data-child-status')).toBe('completed')
  })

  it('`deliveredTo`/`deliveries[]` vẽ mũi tên giao kết quả và huy hiệu đã nhận', async () => {
    seed([
      userEvent(1, 'nhờ hai em', 1),
      childEvent(2, 'child-a', 'Build', {
        turn: 1,
        status: 'completed',
        deliveredTo: ['role:review', 'main'],
        deliveries: [{ recipient: 'role:review', chars: 1200, deliveryId: 'rc_1' }],
      }),
      childEvent(3, 'child-b', 'review', { turn: 1, status: 'completed' }),
    ])

    const host = await render()

    const arrow = row(host, 'child-a')?.querySelector('[data-testid="child-delivers-to"]')
    expect(arrow?.textContent ?? '').toContain('đã giao cho review, main')

    const receipt = row(host, 'child-b')?.querySelector('[data-testid="child-receipt"]')
    expect(receipt?.textContent ?? '').toContain('đã nhận từ Build')
    expect(receipt?.textContent ?? '').toContain('1200 chars')
  })
})
