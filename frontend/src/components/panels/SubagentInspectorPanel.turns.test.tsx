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
 * T15 — đường ống peer: hàng con phải cho thấy "đang chờ <role> giao kết quả", mũi tên giao
 * kết quả và huy hiệu biên nhận. Nhãn chờ là trạng thái SỐNG, đọc từ luồng của CHÍNH em đang
 * xem (`peer_wait` → `peer_wait_end`); backend không phát `waiting_for` trong event `child` nào
 * nên không có đường lùi từ hàng sổ con, và mũi tên cũng đọc `deliveries[]` thật chứ không đọc
 * `deliveredTo` (khoá chỉ có ở frontend cũ).
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

function receipt(host: HTMLElement, sessionId: string): HTMLElement | null {
  return host.querySelector(`[data-child-session-id="${sessionId}"] [data-testid="child-receipt"]`)
}

function arrow(host: HTMLElement, sessionId: string): HTMLElement | null {
  return host.querySelector(`[data-child-session-id="${sessionId}"] [data-testid="child-delivers-to"]`)
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
    // Huy hiệu ở đầu cột chi tiết cũng phải cùng một màu với danh sách (xanh da trời), không đỏ.
    const badge = [...host.querySelectorAll('span')].find(
      (node) =>
        node.className.includes('uppercase') && node.textContent?.trim() === 'partial',
    )
    expect(badge).toBeTruthy()
    expect(badge?.className).toContain('text-sky-400')
    expect(badge?.className).not.toContain('text-red-400')
  })

  it('đổi phiên chat thì bộ lọc lượt của phiên cũ không để bảng trống', async () => {
    useHarnessChatStore.setState({
      sessions: {
        'chat-A': {
          id: 'sess-A',
          status: 'idle',
          error: null,
          events: [
            userEvent(1, 'lượt một của A', 1),
            childEvent(2, 'child-A1', 'Explore', { turn: 1 }),
            userEvent(3, 'lượt hai của A', 2),
            childEvent(4, 'child-A2', 'Build', { turn: 2 }),
          ] as never,
        },
        'chat-B': {
          id: 'sess-B',
          status: 'idle',
          error: null,
          events: [
            userEvent(1, 'lượt năm của B', 5),
            childEvent(2, 'child-B1', 'review', { turn: 5 }),
          ] as never,
        },
      },
    })
    useAgentStore.setState({ activeSessionId: 'chat-A' })

    const host = await render()
    // Người dùng chọn lượt 1 của chat A: bộ lọc đang trỏ vào một lượt mà chat B không có.
    act(() => {
      host
        .querySelector('[data-testid="subagents-turn-chip"][data-turn="1"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(rows(host)).toEqual(['child-A1'])

    act(() => {
      useAgentStore.setState({ activeSessionId: 'chat-B' })
    })

    // Không được trống: phải tự về lượt mới nhất của phiên mới.
    expect(turnBlocks(host)).toEqual(['5'])
    expect(rows(host)).toEqual(['child-B1'])
    expect(
      host
        .querySelector('[data-testid="subagents-turn-chip"][data-turn="5"]')
        ?.getAttribute('data-selected'),
    ).toBe('true')
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

  it('lưới an toàn đếm theo `deadline` epoch GIÂY của backend, không đứng im ở 5:00', async () => {
    // `deadline` thật của đợt 22 là epoch GIÂY (`1790098963.461`). Bản cũ đòi >= 1e12 (ms) nên
    // vứt mốc này đi và luôn hiện đúng `safetySeconds` — "lưới an toàn còn 5:00" mãi mãi.
    const deadlineSeconds = Math.round(Date.now() / 1000) + 120
    fetchMock.mockImplementation(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: String(url).includes('child-W')
          ? [
              ev(1, 'peer_wait', {
                targets: [{ sessionId: 'child-R', role: 'review' }],
                mode: 'wait',
                waitsUntilDelivery: true,
                safetySeconds: 300,
                deadline: deadlineSeconds,
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
    const text = row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')?.textContent ?? ''
    const match = /lưới an toàn còn (\d+):(\d{2})/.exec(text)

    expect(match).toBeTruthy()
    const remaining = Number(match?.[1]) * 60 + Number(match?.[2])
    expect(remaining).toBeGreaterThan(115)
    expect(remaining).toBeLessThanOrEqual(120)
  })

  it('chỉ em ĐANG ĐƯỢC ĐỌC mới có nhãn chờ — hàng khác không mượn trạng thái đó', async () => {
    // `waiting_for` là cột sổ con, KHÔNG xuất hiện trong event `child` nào, nên nhãn chờ chỉ có
    // một nguồn sống: luồng của chính em đang poll. Hàng em kia không được mượn nhãn ấy.
    fetchMock.mockImplementation(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: String(url).includes('child-W')
          ? [
              ev(1, 'peer_wait', {
                targets: [{ sessionId: 'child-R', role: 'review' }],
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
      userEvent(1, 'nhờ hai em', 1),
      childEvent(2, 'child-W', 'testing', { turn: 1 }),
      // `waiting_for` là hình dạng KHÔNG có thật trong event `child` nào của backend; hàng này
      // cố tình mang nó để khoá lại rằng bản sửa đã bỏ hẳn đường lùi ấy (D-2 của vòng soát).
      childEvent(3, 'child-R', 'review', {
        turn: 1,
        waiting_for: ['role:review'],
        waitingSince: 1000,
      }),
    ])

    const host = await render()

    expect(row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')).toBeTruthy()
    expect(row(host, 'child-R')?.querySelector('[data-testid="child-peer-wait"]')).toBeNull()
  })

  it('con đang chạy: mũi tên nói Ý ĐỊNH `sẽ giao cho …`, không nói đã giao', async () => {
    seed([
      userEvent(1, 'nhờ hai em', 1),
      childEvent(2, 'child-a', 'Build', {
        turn: 1,
        status: 'started',
        deliverTo: ['main', 'role:testing'],
      }),
      childEvent(3, 'child-t', 'testing', { turn: 1, status: 'started' }),
    ])

    const host = await render()
    const text = arrow(host, 'child-a')?.textContent ?? ''

    expect(text).toContain('sẽ giao cho main, testing')
    expect(text).not.toContain('đã giao cho')
  })

  it('con đóng sổ: mũi tên đọc `deliveries[]` thật, người nhận bị bỏ được kể ra', async () => {
    seed([
      userEvent(1, 'nhờ hai em', 1),
      childEvent(2, 'child-a', 'Build', {
        turn: 1,
        status: 'completed',
        deliverTo: ['main', 'role:testing', 'role:review'],
        // Đích THẬT là `sessionId`: `sess-1` là chính phiên cha (⇒ "main"), `child-t` là em testing.
        deliveries: [
          { recipient: 'sess-1', state: 'injected', chars: 1298, truncated: false },
          { recipient: 'child-t', state: 'pending', chars: 1298, truncated: false },
          { recipient: 'review', state: 'skipped', chars: 0, truncated: false, reason: 'no_such_peer' },
        ],
      }),
      childEvent(3, 'child-t', 'testing', { turn: 1, status: 'started' }),
    ])

    const host = await render()
    const text = arrow(host, 'child-a')?.textContent ?? ''

    expect(text).toContain('đã giao cho main, testing')
    expect(text).toContain('không giao được cho review · không có người nhận')
    expect(text).not.toContain('sẽ giao cho')
  })

  it('biên nhận chỉ nói "đã nhận" khi hàng thật sự `injected`', async () => {
    seed([
      userEvent(1, 'nhờ ba em', 1),
      childEvent(2, 'giver', 'Build', {
        turn: 1,
        status: 'completed',
        deliveries: [
          { recipient: 'got-it', state: 'injected', chars: 1200 },
          { recipient: 'on-the-way', state: 'pending', chars: 900 },
          { recipient: 'never', state: 'skipped', chars: 0, reason: 'recipient_not_running' },
        ],
      }),
      childEvent(3, 'got-it', 'review', { turn: 1, status: 'completed' }),
      childEvent(4, 'on-the-way', 'testing', { turn: 1, status: 'running' }),
      childEvent(5, 'never', 'research', { turn: 1, status: 'completed' }),
    ])

    const host = await render()

    expect(receipt(host, 'got-it')?.textContent ?? '').toContain('đã nhận từ Build · 1200 chars')
    expect(receipt(host, 'got-it')?.getAttribute('data-receipt-state')).toBe('injected')
    expect(receipt(host, 'on-the-way')?.textContent ?? '').toContain('sẽ nhận từ Build · 900 chars')
    expect(receipt(host, 'on-the-way')?.getAttribute('data-receipt-state')).toBe('pending')
    expect(receipt(host, 'never')?.textContent ?? '').toContain(
      'không nhận được từ Build · người nhận đã đóng',
    )
    expect(receipt(host, 'never')?.getAttribute('data-receipt-state')).toBe('skipped')
  })

  it('luồng của em nói `pending` còn hàng sổ con nói `injected`: giữ một huy hiệu, bản đi xa hơn', async () => {
    fetchMock.mockImplementation(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: String(url).includes('receiver')
          ? [
              ev(1, 'peer_delivery', {
                from: 'giver',
                role: 'Build',
                chars: 1522,
                state: 'pending',
                deliveryId: 16,
              }),
            ]
          : [],
      }),
    }))
    // `receiver` đứng trước để nó là em đang được đọc (bảng poll luồng của em đầu tiên).
    seed([
      userEvent(1, 'nhờ hai em', 1),
      childEvent(2, 'receiver', 'testing', { turn: 1, status: 'running' }),
      childEvent(3, 'giver', 'Build', {
        turn: 1,
        status: 'completed',
        deliveries: [{ recipient: 'receiver', state: 'injected', chars: 1522 }],
      }),
    ])

    const host = await render()
    const badges = host.querySelectorAll(
      '[data-child-session-id="receiver"] [data-testid="child-receipt"]',
    )

    expect(badges).toHaveLength(1)
    expect(badges[0].getAttribute('data-receipt-state')).toBe('injected')
    expect(badges[0].textContent ?? '').toContain('đã nhận từ Build · 1522 chars')
  })

  it('`peer_wait` với `targets` dạng VẬT THỂ hiện tên vai, không hiện `[object Object]`', async () => {
    // Lượt sống 2026-09-22 (`e94f1af0…`): event `peer_wait` thật mang
    // `targets: [{sessionId, role}]`, và nhãn trên hàng con in ra `[object Object]`
    // vì bản cũ `String(...)` thẳng vật thể. Ca này khoá đúng hình dạng thật đó.
    fetchMock.mockImplementation(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        events: String(url).includes('child-W')
          ? [
              ev(1, 'peer_wait', {
                targets: [{ sessionId: 'child-R', role: 'review' }],
                mode: 'all',
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
      childEvent(3, 'child-R', 'review', { turn: 1 }),
    ])

    const host = await render()
    const wait = row(host, 'child-W')?.querySelector('[data-testid="child-peer-wait"]')
    const text = wait?.textContent ?? ''

    expect(text).toContain('đang chờ review giao kết quả')
    expect(text).not.toContain('[object Object]')
  })
})

/**
 * Vòng 27 / C-5 — chỉ thị giữa lượt (`user` với `{steer:true}`) không phải một mốc lượt: harness
 * không tăng `_turn_index` cho nó, nên bảng Sub-agents cũng không được tách nhánh đang chạy sang
 * một lượt ma. Con mở TRƯỚC và SAU chỉ thị vẫn thuộc cùng lượt đó.
 */
describe('SubagentInspectorPanel — chỉ thị giữa lượt không mở lượt mới (C-5)', () => {
  it('con sau chỉ thị vẫn nằm cùng lượt với con trước chỉ thị', async () => {
    seed([
      userEvent(1, 'nhờ em nghiên cứu chuyển tuyến', 1),
      childEvent(2, 'child-law', 'research', { turn: 1 }),
      ev(3, 'user', { text: 'dừng nhánh luật', steer: true, control: true, turn: 1 }),
      childEvent(4, 'child-health', 'research', { turn: 1 }),
    ])

    const host = await render()

    expect(turnBlocks(host)).toEqual(['1'])
    expect(rows(host).sort()).toEqual(['child-health', 'child-law'])
  })
})
