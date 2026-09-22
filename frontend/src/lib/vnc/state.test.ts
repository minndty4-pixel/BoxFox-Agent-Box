/**
 * Test cho máy trạng thái noVNC (logic thuần, không DOM).
 *
 * Vòng đời kết nối thật được test riêng ở `attempt.test.ts`.
 *
 * Chính sách ở đây là của Kế hoạch E1: thang thử lại KHÔNG còn trần lượt, chỉ
 * giữ ở nấc cuối 20 s; `exhausted` chỉ còn dành cho lý do không thể tự khỏi.
 */
import { describe, it, expect } from 'vitest'
import {
  disabledVncState,
  initialVncState,
  reduceVnc,
  retryDelayMs,
  VNC_HELP_AFTER_ATTEMPTS,
  VNC_RETRY_DELAYS_MS,
  VNC_RETRY_MAX_DELAY_MS,
  type VncOfflineReason,
  type VncState,
} from './state'

describe('initialVncState', () => {
  it('bắt đầu ở connecting, attempt = 1, seq = 0', () => {
    expect(initialVncState.phase).toBe('connecting')
    expect(initialVncState.attempt).toBe(1)
    expect(initialVncState.seq).toBe(0)
    expect(initialVncState.exhausted).toBe(false)
  })
})

describe('thang thử lại', () => {
  it('nấc cuối của thang đúng bằng VNC_RETRY_MAX_DELAY_MS (trần giữ mãi)', () => {
    expect(VNC_RETRY_DELAYS_MS[VNC_RETRY_DELAYS_MS.length - 1]).toBe(VNC_RETRY_MAX_DELAY_MS)
  })
})

describe('reduceVnc', () => {
  it('connected → live, reason = null, attempt về 1', () => {
    const next = reduceVnc(initialVncState, { type: 'connected' })
    expect(next.phase).toBe('live')
    expect(next.reason).toBeNull()
    expect(next.attempt).toBe(1)
    expect(next.exhausted).toBe(false)
  })

  it('timeout ở lần 1 → offline/timeout, chưa exhausted, retryDelayMs = 3000', () => {
    const next = reduceVnc(initialVncState, { type: 'timeout' })
    expect(next.phase).toBe('offline')
    expect(next.reason).toBe('timeout')
    expect(next.exhausted).toBe(false)
    expect(retryDelayMs(next)).toBe(3000)
  })

  it('chuỗi timeout → connectStarted → timeout → connectStarted → timeout cho khoảng nghỉ đúng 3000, 8000, 20000', () => {
    let state: VncState = initialVncState
    state = reduceVnc(state, { type: 'timeout' })
    expect(retryDelayMs(state)).toBe(3000)
    state = reduceVnc(state, { type: 'connectStarted' })
    state = reduceVnc(state, { type: 'timeout' })
    expect(retryDelayMs(state)).toBe(8000)
    state = reduceVnc(state, { type: 'connectStarted' })
    state = reduceVnc(state, { type: 'timeout' })
    expect(retryDelayMs(state)).toBe(20000)
  })

  it('thang 3 → 8 → 20 → 20 ở các lượt 1..5, KHÔNG bao giờ exhausted', () => {
    let state: VncState = initialVncState
    const ladder: number[] = []
    const exhaustedFlags: boolean[] = []
    for (let i = 0; i < 5; i++) {
      state = reduceVnc(state, { type: 'timeout' })
      ladder.push(retryDelayMs(state) as number)
      exhaustedFlags.push(state.exhausted)
      if (i < 4) state = reduceVnc(state, { type: 'connectStarted' })
    }
    // Lượt 4 và 5 đều 20 s — nấc cuối được GIỮ, không rơi vào null.
    expect(ladder).toEqual([3000, 8000, 20000, 20000, 20000])
    expect(exhaustedFlags).toEqual([false, false, false, false, false])
    // Và còn xa mới hết: lượt thứ 12 vẫn hẹn 20 s.
    for (let i = 0; i < 7; i++) {
      state = reduceVnc(state, { type: 'connectStarted' })
      state = reduceVnc(state, { type: 'timeout' })
    }
    expect(state.attempt).toBe(12)
    expect(state.exhausted).toBe(false)
    expect(retryDelayMs(state)).toBe(20000)
  })

  it('kênh đang live bị phía kia đóng → thang bắt đầu lại từ 3 s ở lượt 1', () => {
    const live = reduceVnc(initialVncState, { type: 'connected' })
    const next = reduceVnc(live, { type: 'closed' })
    expect(next.phase).toBe('offline')
    expect(next.reason).toBe('closed')
    expect(next.attempt).toBe(1)
    expect(next.exhausted).toBe(false)
    expect(retryDelayMs(next)).toBe(3000)
  })

  it('closed khi đang offline → trả về đúng object cũ (không đổi lý do)', () => {
    const offline = reduceVnc(initialVncState, { type: 'timeout' })
    const next = reduceVnc(offline, { type: 'closed' })
    expect(next).toBe(offline)
  })

  it("failed: 'error' (không nằm trong TERMINAL_REASONS) → thử lại được, không exhausted", () => {
    const next = reduceVnc(initialVncState, { type: 'failed', reason: 'error' })
    expect(next.phase).toBe('offline')
    expect(next.reason).toBe('error')
    expect(next.exhausted).toBe(false)
    expect(retryDelayMs(next)).toBe(3000)
  })

  it('failed: cả 6 lý do cấu hình/khả năng → exhausted = true, retryDelayMs = null', () => {
    for (const reason of [
      'security',
      'credentials',
      'mixedContent',
      'insecureContext',
      'unsupported',
      'disabled',
    ] as readonly VncOfflineReason[]) {
      const next = reduceVnc(initialVncState, { type: 'failed', reason })
      expect(next.phase).toBe('offline')
      expect(next.reason).toBe(reason)
      expect(next.exhausted).toBe(true)
      expect(retryDelayMs(next)).toBeNull()
    }
  })

  it("skip → offline/skipped, exhausted = true, không hẹn thử lại; manualRetry sau đó → connecting, attempt = 1, seq tăng", () => {
    const skipped = reduceVnc(initialVncState, { type: 'skip' })
    expect(skipped.phase).toBe('offline')
    expect(skipped.reason).toBe('skipped')
    expect(skipped.exhausted).toBe(true)
    expect(retryDelayMs(skipped)).toBeNull()

    const retried = reduceVnc(skipped, { type: 'manualRetry' })
    expect(retried.phase).toBe('connecting')
    expect(retried.attempt).toBe(1)
    expect(retried.exhausted).toBe(false)
    expect(retried.seq).toBeGreaterThan(skipped.seq)
    // Về nấc đầu: thất bại ngay sau khi thử tay thì chờ 3 s, không phải 20 s.
    expect(retryDelayMs(reduceVnc(retried, { type: 'timeout' }))).toBe(3000)
  })

  it('connected đặt lại attempt = 1 nên thang về nấc 3 s', () => {
    let state: VncState = initialVncState
    state = reduceVnc(state, { type: 'timeout' })
    state = reduceVnc(state, { type: 'connectStarted' })
    state = reduceVnc(state, { type: 'timeout' })
    expect(retryDelayMs(state)).toBe(8000)

    const back = reduceVnc(reduceVnc(state, { type: 'connectStarted' }), { type: 'connected' })
    expect(back.attempt).toBe(1)

    const dropped = reduceVnc(back, { type: 'closed' })
    expect(dropped.attempt).toBe(1)
    expect(retryDelayMs(dropped)).toBe(3000)
  })
})

describe('ngưỡng hiện link trợ giúp (VNC_HELP_AFTER_ATTEMPTS)', () => {
  /** Đưa máy trạng thái tới đúng `attempt` bằng chuỗi timeout/connectStarted. */
  function stateAtAttempt(attempt: number): VncState {
    let state: VncState = initialVncState
    while (state.attempt < attempt) {
      state = reduceVnc(state, { type: 'timeout' })
      state = reduceVnc(state, { type: 'connectStarted' })
    }
    return state
  }

  it('lượt 5 còn dưới ngưỡng, lượt 6 bằng đúng ngưỡng', () => {
    expect(VNC_HELP_AFTER_ATTEMPTS).toBe(6)
    expect(stateAtAttempt(5).attempt).toBe(5)
    expect(stateAtAttempt(5).attempt < VNC_HELP_AFTER_ATTEMPTS).toBe(true)
    expect(stateAtAttempt(6).attempt).toBe(6)
    expect(stateAtAttempt(6).attempt >= VNC_HELP_AFTER_ATTEMPTS).toBe(true)
  })
})

describe('disabledVncState', () => {
  it('nguồn mô phỏng: offline/disabled, không hẹn thử lại', () => {
    expect(disabledVncState.phase).toBe('offline')
    expect(disabledVncState.reason).toBe('disabled')
    expect(disabledVncState.exhausted).toBe(true)
    expect(retryDelayMs(disabledVncState)).toBeNull()
  })
})
