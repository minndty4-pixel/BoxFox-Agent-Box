/**
 * `agentApi` phải giữ NGUYÊN câu lỗi cũ (chỗ gọi đang in `String(err)` khắp nơi) nhưng mang thêm
 * `status`/`code`/`body` — nhờ đó người gọi phân biệt được 409 "bị khoá" với 409 lỗi vặt khác.
 */
import { describe, expect, it, vi } from 'vitest'
import { ApiError, agentApi } from './agentApi'

function stubFailure(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('agentApi', () => {
  it('lỗi HTTP kèm mã lỗi: giữ câu cũ, thêm `status`/`code`/`body` đọc được', async () => {
    stubFailure(409, { blocked: true, code: 'PLAN_APPROVAL_UNVERIFIED', reason: 'chưa phản biện' })
    try {
      const failure = await agentApi('/plans/review', {}).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(ApiError)
      expect(failure).toMatchObject({ status: 409, code: 'PLAN_APPROVAL_UNVERIFIED' })
      expect((failure as ApiError).body).toEqual({
        blocked: true,
        code: 'PLAN_APPROVAL_UNVERIFIED',
        reason: 'chưa phản biện',
      })
      expect((failure as Error).message).toBe('PLAN_APPROVAL_UNVERIFIED: Harness HTTP 409')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('không đọc được thân lỗi: vẫn ra đúng câu "Harness engine unavailable…" như trước', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('bad json')
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const failure = await agentApi('/plans/status').catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(ApiError)
      expect((failure as Error).message).toBe('Harness engine unavailable. Start the BoxFox launcher.')
      expect((failure as ApiError).status).toBe(502)
      expect((failure as ApiError).code).toBeUndefined()
      expect((failure as ApiError).body).toEqual({ error: 'Harness engine unavailable. Start the BoxFox launcher.' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('mã lỗi đã nằm sẵn trong câu thì không lặp lại lần hai', async () => {
    stubFailure(500, { error: 'SESSION_NOT_FOUND: no such session', code: 'SESSION_NOT_FOUND' })
    try {
      const failure = await agentApi('/sessions/x').catch((error: unknown) => error)

      expect((failure as Error).message).toBe('SESSION_NOT_FOUND: no such session')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('thành công thì trả JSON nguyên trạng', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'draft' }) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(agentApi('/plans/status')).resolves.toEqual({ state: 'draft' })
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('/api/agent/plans/status')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
