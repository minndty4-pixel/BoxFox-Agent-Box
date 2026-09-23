/**
 * T15 — đường ống peer: nhãn đích, lưới an toàn, biên nhận và mũi tên giao kết quả.
 *
 * Hình dạng dưới đây là hình dạng THẬT đọc từ DB sống (`~/BoxFox/harness/sessions.sqlite`):
 *   `peer_wait`     → `targets: [{sessionId, role}]`, `deadline` là epoch GIÂY (`1790098963.461`).
 *   `peer_delivery` → `state: 'pending'` lúc hàng còn nằm trong hộp thư người nhận.
 *   `child` (đóng)  → `deliveries: [{recipient: <sessionId>, state, chars, truncated}]`, kèm
 *                     `reason` khi `state === 'skipped'`.
 */
import { describe, expect, it } from 'vitest'
import {
  deadlineMs,
  deliveryLabel,
  formatClock,
  hasAbsoluteDeadline,
  mergeReceipts,
  openPeerWait,
  peerDeliveries,
  peerDeliveryView,
  peerLabel,
  peerLabels,
  peerReceipts,
  peerSkipReason,
  receiptsFromDeliveries,
  safetyNetSeconds,
  shortPeerId,
} from './peerPipeline'

describe('peerPipeline — nhãn đích (T15)', () => {
  it('đọc tên vai từ vật thể `{sessionId, role}`', () => {
    expect(peerLabel({ sessionId: 'abc123', role: 'review' })).toBe('review')
    expect(peerLabels([{ sessionId: 'abc123', role: 'review' }, 'role:testing', 'main']))
      .toEqual(['review', 'testing', 'main'])
  })

  it('vật thể không có vai thì bỏ, KHÔNG bao giờ trả `[object Object]`', () => {
    expect(peerLabel({ sessionId: 'abc123' })).toBe('abc123')
    expect(peerLabel({ note: 'không có đích' })).toBe('')
    expect(peerLabels([{}, null, undefined, 7])).toEqual(['7'])
  })

  it('`peer_wait` thật (targets dạng vật thể) cho ra tên vai', () => {
    const wait = openPeerWait([
      { seq: 1, type: 'peer_wait', created: 1000, data: { targets: [{ sessionId: 's1', role: 'review' }],
                                                            waitsUntilDelivery: true, safetySeconds: 300 } },
    ] as never)
    expect(wait?.roles).toEqual(['review'])
  })
})

describe('peerPipeline — lưới an toàn (deadline)', () => {
  const liveDeadline = 1_790_098_963.461

  it('nhận `deadline` epoch GIÂY của backend đợt 22', () => {
    expect(deadlineMs(liveDeadline)).toBe(1_790_098_963_461)
    expect(hasAbsoluteDeadline({ roles: ['review'], waitsUntilDelivery: true, safetySeconds: 300,
                                 deadline: liveDeadline, startedAt: null, turn: 1 })).toBe(true)
  })

  it('vẫn nhận `deadline` epoch ms, và từ chối số không phải mốc thật', () => {
    expect(deadlineMs(1_790_098_963_461)).toBe(1_790_098_963_461)
    expect(deadlineMs(1000)).toBeNull()
    expect(deadlineMs(null)).toBeNull()
  })

  it('đồng hồ đếm theo `deadline`, không đứng im ở `safetySeconds`', () => {
    const wait = { roles: ['review'], waitsUntilDelivery: true, safetySeconds: 300,
                   deadline: liveDeadline, startedAt: null, turn: 1 }
    // Chốt: nếu đơn vị giây bị bỏ qua thì con số dưới đây luôn là 300 (5:00) — đúng lỗi cũ.
    expect(safetyNetSeconds(wait, liveDeadline * 1000 - 120_000)).toBe(120)
    expect(formatClock(120)).toBe('2:00')
    expect(safetyNetSeconds(wait, liveDeadline * 1000 + 60_000)).toBe(0)
  })
})

describe('peerPipeline — biên nhận giao hàng (T15)', () => {
  it('`peer_delivery` thật mang trạng thái `pending`, không tự nói "đã nhận"', () => {
    const receipts = peerReceipts([
      { seq: 1, type: 'peer_delivery', created: 10,
        data: { from: 'sid-giver', role: 'review', chars: 185, deliveryId: 16, state: 'pending' } },
    ] as never)

    expect(receipts).toEqual([{ role: 'review', chars: 185, deliveryId: '16', state: 'pending',
                                reason: null }])
  })

  it('thiếu `state` thì coi là `pending`; `skipped` giữ mã lý do', () => {
    const receipts = peerReceipts([
      { seq: 1, type: 'peer_delivery', created: 10, data: { role: 'review', chars: 20 } },
      { seq: 2, type: 'peer_delivery', created: 11,
        data: { role: 'testing', chars: 0, state: 'skipped', reason: 'recipient_not_running' } },
    ] as never)

    expect(receipts.map((receipt) => receipt.state)).toEqual(['pending', 'skipped'])
    expect(receipts[1].reason).toBe('recipient_not_running')
  })

  it('`receiptsFromDeliveries` đọc trạng thái thật và nhận `skipped` địa chỉ dạng vai', () => {
    const rows = [
      { recipient: 'child-me', state: 'injected', chars: 1200, truncated: false },
      { recipient: 'role:me', state: 'pending', chars: 900 },
      { recipient: 'me', state: 'skipped', chars: 0, reason: 'no_such_peer' },
      { recipient: 'child-khac', state: 'injected', chars: 5 },
    ]

    const receipts = receiptsFromDeliveries(rows, 'me', 'child-me')
    expect(receipts.map((receipt) => receipt.state)).toEqual(['injected', 'pending', 'skipped'])
    expect(receipts[0].chars).toBe(1200)
    expect(receipts[2].reason).toBe('no_such_peer')
  })

  it('hai nguồn nói về cùng một lần giao thì giữ trạng thái đi xa nhất', () => {
    const pending = { role: 'review', chars: 1522, deliveryId: '16', state: 'pending' as const,
                      reason: null }
    const injected = { role: 'review', chars: 1522, deliveryId: null, state: 'injected' as const,
                       reason: null }

    expect(mergeReceipts([pending], [injected]).map((receipt) => receipt.state)).toEqual(['injected'])
    expect(mergeReceipts([injected], [pending]).map((receipt) => receipt.state)).toEqual(['injected'])
    expect(mergeReceipts([pending], [])).toHaveLength(1)
  })

  it('mã lý do lạ trả `null` để người gọi hiện nguyên mã, không bịa', () => {
    expect(peerSkipReason('recipient_not_running')).toBe('recipient_not_running')
    expect(peerSkipReason('no_such_peer')).toBe('no_such_peer')
    expect(peerSkipReason('ly_do_moi')).toBeNull()
    expect(peerSkipReason(null)).toBeNull()
  })
})

describe('peerPipeline — mũi tên giao kết quả (T15)', () => {
  it('`deliveries[]` thật tách thành đã giao và bỏ qua, kèm lý do', () => {
    const rows = peerDeliveries([
      { recipient: '944d6bde2616450ca8c1baf76edb1ee4', state: 'pending', chars: 185, truncated: false },
      { recipient: '4f472fe42e2640b08319766ff4f7faa2', state: 'injected', chars: 1366 },
      { recipient: 'review', state: 'skipped', chars: 0, reason: 'no_such_peer' },
    ])

    expect(rows.map((row) => row.state)).toEqual(['pending', 'injected', 'skipped'])

    const view = peerDeliveryView(rows, (recipient) => recipient.slice(0, 8))
    expect(view.delivered).toEqual(['944d6bde', '4f472fe4'])
    expect(view.skipped).toEqual([{ target: 'review', reason: 'no_such_peer' }])
  })

  it('mục méo trong `deliveries` bị bỏ, không dựng hàng giả', () => {
    expect(peerDeliveries([null, 7, { state: 'injected' }, { recipient: '  ', state: 'pending' }]))
      .toEqual([])
    expect(peerDeliveries('không phải mảng')).toEqual([])
  })

  it('`main` là phiên cha; em cùng lượt đọc theo sessionId; còn lại trả `null`', () => {
    const roles = new Map([['child-R', 'review']])
    const roleOf = (sessionId: string) => roles.get(sessionId) ?? null

    expect(deliveryLabel('sess-1', 'sess-1', roleOf)).toBe('main')
    expect(deliveryLabel('child-R', 'sess-1', roleOf)).toBe('review')
    expect(deliveryLabel('child-X', 'sess-1', roleOf)).toBeNull()
    // Không biết phiên cha (bản ghi cũ) thì không được đoán bừa `main`.
    expect(deliveryLabel('child-R', null, roleOf)).toBe('review')
  })

  it('id không đọc được thì cắt ngắn, tên vai giữ nguyên', () => {
    expect(shortPeerId('944d6bde2616450ca8c1baf76edb1ee4')).toBe('944d6bde…')
    expect(shortPeerId('review')).toBe('review')
  })
})
