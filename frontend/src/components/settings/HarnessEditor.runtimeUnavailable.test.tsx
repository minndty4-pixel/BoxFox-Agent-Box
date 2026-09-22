import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { HarnessEditor } from './HarnessEditor'
import { useHarnessStore } from '../../store/harnessStore'
import { useProviderStore } from '../../store/providerStore'
import { useRuntimeInfoStore } from '../../store/runtimeInfoStore'
import type { ProviderConnection, ProviderSnapshot } from '../../types/provider'

/**
 * Engine không trả lời: màn sửa harness phải ghi `unavailable` thay vì bày lại con số
 * của lần chạy trước (16 bước / 180 giây / 20 công cụ / retry 3 lần). Không được đoán.
 *
 * Mock riêng `lib/ownerDirectives.loadRuntimeInfo` (giữ nguyên các helper khác) để test
 * không phụ thuộc module cache dùng chung — hàm đó chỉ ghi cache khi nạp được, nên một
 * test nạp thành công trước đó sẽ làm hỏng phép thử nếu không mock.
 */
vi.mock('../../lib/ownerDirectives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ownerDirectives')>()
  return { ...actual, loadRuntimeInfo: async () => null, cachedRuntimeInfo: () => null }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONNECTION: ProviderConnection = {
  id: 'c1', providerId: 'anthropic', name: 'TokenHarbor', endpoint: 'https://tokenharbor.ai/v1',
  email: null, accountLabel: null, projectId: null, revision: 1, enabled: true, credentialPresent: true,
  authState: 'ready', projectState: 'not_applicable', discoveryState: 'ready', inferenceState: 'ready',
  lastTestedAt: null, lastDiscoveryAttemptAt: null, error: null, quota: null, models: [],
}
const SNAPSHOT: ProviderSnapshot = {
  providers: [], connections: [CONNECTION], aliases: [], keys: [], usage: [],
  defaultRoute: { connectionId: null, modelId: null, aliasId: null },
  health: { status: 'ok', version: 'test' },
}

const COPY_HARNESS = 'open-model-harness-copy-1'
const pristine = useHarnessStore.getState()

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useHarnessStore.setState(pristine)
  useProviderStore.setState({ snapshot: SNAPSHOT, loading: false, busy: false, error: null })
  useRuntimeInfoStore.setState({ info: null, status: 'idle', error: null })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/router/state')) {
      return new Response(JSON.stringify(SNAPSHOT), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error('engine down')
  }))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('HarnessEditor khi runtime-info không trả lời', () => {
  it('ghi unavailable ở mọi khối số và không bày con số cũ nào', async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <HarnessEditor harnessId={COPY_HARNESS} />
        </I18nProvider>
      )
    })

    expect(host.textContent).toContain('Tools unavailable')
    expect(host.textContent).toContain('The engine has not answered, so the tool list cannot be shown')
    expect(host.textContent).toContain('range and engine default are unavailable until the engine answers')
    expect(host.textContent).toContain('The retry policy is unavailable until runtime-info answers')

    // Không một con số nào của engine được đoán ra: không khoảng, không mặc định, không chi tiết retry.
    expect(host.textContent).not.toContain('allowed 1 – 60')
    expect(host.textContent).not.toContain('allowed 5 – 600')
    expect(host.textContent).not.toContain('engine default 16')
    expect(host.textContent).not.toContain('engine default 180')
    expect(host.textContent).not.toContain('1 s → 4 s → 12 s')
    expect(host.textContent).not.toContain('file_read')
    expect(useRuntimeInfoStore.getState().info).toBeNull()
    expect(useRuntimeInfoStore.getState().status).toBe('failed')
  })
})
