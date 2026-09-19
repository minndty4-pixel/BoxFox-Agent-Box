import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useAgentStore } from '../../store/agentStore'
import { useHarnessChatStore } from '../../store/harnessChatStore'
import { useProviderStore } from '../../store/providerStore'
import { useRouterChatStore } from '../../store/routerChatStore'
import type { ProviderSnapshot } from '../../types/provider'
import {
  ContextUsageBar,
  findRouterContextWindow,
  formatTokenCount,
  resolveContextWindow,
} from './ContextUsageBar'

/**
 * ContextUsageBar — §D-U3/BUG-4/BUG-22 của `docs/plan/fix-plan-e2e-defects.md`:
 *  • cỡ context window lấy từ metadata router trước, bảng tĩnh/đoán tên chỉ là
 *    phương án cuối và phải ghi rõ là ước lượng;
 *  • router chưa báo thì hiện `unknown`, KHÔNG bịa số và không vẽ phần trăm;
 *  • không còn affordance "auto-compact" giả (backend không có cờ đó);
 *  • nhãn không bị cắt cụt khi cột chat hẹp (900px).
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SESSION_ID = 'sess-context-1'

const originalHarnessSend = useHarnessChatStore.getState().send
let roots: Root[] = []

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(<I18nProvider>{node}</I18nProvider>)
  })
  return host
}

function snapshotWith(contextWindow: number | null): ProviderSnapshot {
  return {
    providers: [],
    connections: [
      {
        id: 'conn-1',
        providerId: 'antigravity',
        name: 'Antigravity',
        endpoint: null,
        email: null,
        accountLabel: null,
        projectId: null,
        revision: 1,
        enabled: true,
        credentialPresent: true,
        authState: 'ready',
        projectState: 'ready',
        discoveryState: 'ready',
        inferenceState: 'ready',
        models: [
          {
            id: 'gemini-3.8-flash-high',
            name: 'Gemini 3.8 Flash',
            enabled: true,
            source: 'live',
            thinkingLevels: ['low', 'medium', 'high'],
            // Trường mới của router (BUG-4/R2) — frontend đọc thẳng giá trị này.
            contextWindow,
            capabilities: {},
          } as never,
        ],
        lastTestedAt: null,
        error: null,
        quota: null,
      },
    ],
    providerConfigs: [],
    aliases: [
      {
        id: 'alias-1',
        name: 'fast',
        enabled: true,
        targets: [{ connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' }],
      } as never,
    ],
    defaultRoute: { connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high', aliasId: null },
    keys: [],
    usage: [],
    health: { status: 'ok', version: '0.1.0' },
  } as unknown as ProviderSnapshot
}

function seedRun(overrides: Partial<{ lastModelLabel: string; contextEstimate: number; status: string }> = {}) {
  const { lastModelLabel = 'Gemini 3.8 Flash (High)', contextEstimate = 28_600, status = 'idle' } = overrides
  useHarnessChatStore.setState({
    sessions: {
      [SESSION_ID]: {
        id: 'sess-1',
        status,
        events: [{ seq: 1, type: 'step', data: { contextEstimate }, created: 1 }],
        error: null,
        lastModelLabel,
      },
    },
  })
}

function limitLabelText(host: HTMLElement): string {
  const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement | null
  if (!label) throw new Error('Không tìm thấy nhãn context window')
  return label.textContent ?? ''
}

beforeEach(() => {
  useAgentStore.setState({ activeSessionId: SESSION_ID, context: undefined })
  useProviderStore.setState({ snapshot: null })
  useRouterChatStore.setState({ selection: null })
  useHarnessChatStore.setState({ sessions: {} })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useProviderStore.setState({ snapshot: null })
  useRouterChatStore.setState({ selection: null })
  useHarnessChatStore.setState({ sessions: {}, send: originalHarnessSend })
  vi.restoreAllMocks()
})

describe('ContextUsageBar — nguồn cỡ context window (§D-U3)', () => {
  it('ưu tiên số router báo, rồi bảng tĩnh, cuối cùng mới đoán theo tên', () => {
    expect(resolveContextWindow(1_000_000, 'gemini-3.8-flash-high')).toEqual({ tokens: 1_000_000, source: 'router' })
    expect(resolveContextWindow(0, 'gemini-3.8-flash-high')).toEqual({ tokens: 1_000_000, source: 'heuristic' })
    expect(resolveContextWindow(null, 'claude-3.7-sonnet')).toEqual({ tokens: 200_000, source: 'catalog' })
    expect(resolveContextWindow(null, 'Claude 3.7 Sonnet')).toEqual({ tokens: 200_000, source: 'catalog' })
    expect(resolveContextWindow(null, 'vendor-gemini-x')).toEqual({ tokens: 1_000_000, source: 'heuristic' })
    expect(resolveContextWindow(null, 'deepseek-v9')).toEqual({ tokens: 64_000, source: 'heuristic' })
  })

  it('không đoán bừa: model lạ trả về unknown thay vì 128k mặc định', () => {
    expect(resolveContextWindow(null, 'acme-mystery-model-v9')).toEqual({ tokens: null, source: 'unknown' })
    expect(resolveContextWindow(null, null)).toEqual({ tokens: null, source: 'unknown' })
  })

  it('đọc contextWindow từ snapshot router theo model, alias và nhãn harness', () => {
    const snapshot = snapshotWith(1_000_000)
    expect(findRouterContextWindow(snapshot, { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' })).toBe(1_000_000)
    expect(findRouterContextWindow(snapshot, { kind: 'alias', aliasId: 'alias-1' })).toBe(1_000_000)
    // Nhãn harness kèm hậu tố mức thinking vẫn phải khớp được.
    expect(findRouterContextWindow(snapshot, null, 'Gemini 3.8 Flash (High)')).toBe(1_000_000)
    expect(findRouterContextWindow(snapshotWith(null), null, 'Gemini 3.8 Flash')).toBeNull()
    expect(findRouterContextWindow(null, null, 'Gemini 3.8 Flash')).toBeNull()
    expect(findRouterContextWindow(snapshot, null, 'model-không-có-trong-snapshot')).toBeNull()
  })

  it('định dạng token count ổn định giữa thanh và modal', () => {
    expect(formatTokenCount(0)).toBe('0.0k')
    expect(formatTokenCount(28_600)).toBe('28.6k')
    expect(formatTokenCount(100_000)).toBe('100k')
    expect(formatTokenCount(200_000)).toBe('200k')
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(2_000_000)).toBe('2.0M')
  })
})

describe('ContextUsageBar — nhãn hiển thị', () => {
  it('dùng số của router và KHÔNG đánh dấu ước lượng', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    seedRun()

    const host = render(<ContextUsageBar />)
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(limitLabelText(host)).toBe('28.6k / 1.0M (3%)')
    expect(label.getAttribute('title')).toBeNull()
    expect(label.getAttribute('class')).toContain('whitespace-nowrap')
  })

  it('router chưa báo thì hiện `unknown`, không vẽ phần trăm', () => {
    useProviderStore.setState({ snapshot: snapshotWith(null) })
    seedRun({ lastModelLabel: 'acme-mystery-model-v9' })

    const host = render(<ContextUsageBar />)
    expect(limitLabelText(host)).toContain('unknown')
    expect(limitLabelText(host)).not.toMatch(/\(\d+%\)/)
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(label.getAttribute('title')).toContain('has not reported a context window')
  })

  it('bảng tĩnh chỉ là ước lượng và phải được ghi rõ', () => {
    useProviderStore.setState({ snapshot: null })
    seedRun({ lastModelLabel: 'claude-3.7-sonnet' })

    const host = render(<ContextUsageBar />)
    expect(limitLabelText(host)).toContain('200k')
    expect(limitLabelText(host)).toContain('est.')
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(label.getAttribute('title')).toContain('static catalog')
  })

  it('nhãn không còn phần tử bị ẩn theo breakpoint (lỗi cắt cụt ở 900px)', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    seedRun()

    const host = render(<ContextUsageBar />)
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    // Lỗi cũ: phần `/ <limit>` mang `hidden xl:inline` nên ở 900px chỉ còn `28.6k (14`.
    const hidden = Array.from(label.querySelectorAll('[class*="hidden"]'))
    expect(hidden.some((el) => (el.textContent ?? '').includes('/ 1.0M'))).toBe(false)
    expect(hidden.some((el) => (el.textContent ?? '').includes('(3%)'))).toBe(false)
    expect(limitLabelText(host)).toContain('/ 1.0M')
    expect(limitLabelText(host)).toContain('(3%)')
  })
})

describe('ContextUsageBar — bong bóng cảnh báo ngưỡng', () => {
  it('không còn toggle auto-compact giả và không hứa hẹn số token tiết kiệm bịa', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    seedRun({ contextEstimate: 900_000 })

    const host = render(<ContextUsageBar />)
    // 90% → bong bóng ngưỡng phải hiện.
    expect(host.textContent).toContain('Context threshold alert')
    expect(host.textContent).not.toMatch(/auto.compact/i)
    expect(host.textContent).not.toContain('45k')
    // Hành động còn lại là lệnh compact thật.
    expect(host.textContent).toContain('Compact now')
    expect(limitLabelText(host)).toBe('900k / 1.0M (90%)')
  })

  it('nút Compact gửi /compact qua harness, không bật cờ UI nào', () => {
    const send = vi.fn(async () => {})
    useHarnessChatStore.setState({ send })
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    seedRun({ contextEstimate: 900_000 })

    const host = render(<ContextUsageBar />)
    const compactNow = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Compact now'))
    expect(compactNow).toBeTruthy()
    act(() => {
      compactNow!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(send).toHaveBeenCalledWith(SESSION_ID, '/compact', null)
  })
})
