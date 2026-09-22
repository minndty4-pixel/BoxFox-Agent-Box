/**
 * T15 — nhãn đích của đường ống peer đọc được CẢ HAI hình dạng đích.
 *
 * Đích trong event thật là chuỗi (`'role:review'`, `'main'`, `'peer:<sessionId>'`) hoặc vật
 * thể (`{sessionId, role}` — hình dạng của `targets` trong event `peer_wait`). Bản cũ
 * `String(...)` thẳng vật thể, nên nhãn chờ trên giao diện in ra `[object Object]`; lượt
 * sống 2026-09-22 (`e94f1af0…`) bắt được đúng lỗi đó.
 */
import { describe, expect, it } from 'vitest'
import { openPeerWait, peerLabel, peerLabels, waitFromChildRow } from './peerPipeline'

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

  it('đường lùi từ hàng sổ con vẫn là chuỗi `peer:<sessionId>`', () => {
    const wait = waitFromChildRow({ waiting_for: ['peer:abc123'], waitingSince: 1000 })
    expect(wait?.roles).toEqual(['peer:abc123'])
  })
})
