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

function snapshotWith(
  contextWindow: number | null,
  model: Partial<{ id: string; name: string; contextWindowSource: string | null }> = {},
): ProviderSnapshot {
  const modelId = model.id ?? 'gemini-3.8-flash-high'
  const modelName = model.name ?? 'Gemini 3.8 Flash'
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
            id: modelId,
            name: modelName,
            enabled: true,
            source: 'live',
            thinkingLevels: ['low', 'medium', 'high'],
            // Hai trường của router (BUG-4/R2 + vòng 18): số đang dùng và NHÃN NGUỒN.
            contextWindow,
            contextWindowSource: model.contextWindowSource ?? null,
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
        targets: [{ connectionId: 'conn-1', modelId }],
      } as never,
    ],
    defaultRoute: { connectionId: 'conn-1', modelId, aliasId: null },
    keys: [],
    usage: [],
    health: { status: 'ok', version: '0.1.0' },
  } as unknown as ProviderSnapshot
}

function seedRun(overrides: Partial<{ lastModelLabel: string; contextEstimate: number; status: string
  contextWindow: number | null; contextWindowSource: string | null }> = {}) {
  const { lastModelLabel = 'Gemini 3.8 Flash (High)', contextEstimate = 28_600, status = 'idle',
          contextWindow = null, contextWindowSource = null } = overrides
  useHarnessChatStore.setState({
    sessions: {
      [SESSION_ID]: {
        id: 'sess-1',
        status,
        events: [{ seq: 1, type: 'step', data: { contextEstimate }, created: 1 }],
        error: null,
        lastModelLabel,
        // `config` phiên: cặp (số, nguồn) mà harness đang thật sự nén theo.
        contextWindow,
        contextWindowSource,
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
  it('ưu tiên số đang có hiệu lực trong phiên, rồi dòng router, rồi bảng tĩnh', () => {
    // Bản ghi phiên thắng: đó là con số harness THẬT SỰ đang nén theo.
    expect(resolveContextWindow({ tokens: 1_000_000, basis: 'documented' }, 'deepseek-v4-flash',
      { contextWindow: 32_768, contextWindowSource: 'manual' })).toEqual({ tokens: 32_768, basis: 'manual', estimated: false })
    expect(resolveContextWindow({ tokens: 1_000_000, basis: 'documented' }, 'deepseek-v4-flash',
      { contextWindow: 128_000, contextWindowSource: 'fallback' })).toEqual({ tokens: 128_000, basis: 'fallback', estimated: true })
    // Không có bản ghi phiên thì dòng router trả lời, kèm đúng nhãn nguồn của router.
    expect(resolveContextWindow({ tokens: 1_048_576, basis: 'documented' }, 'deepseek-v4-flash'))
      .toEqual({ tokens: 1_048_576, basis: 'documented', estimated: true })
    expect(resolveContextWindow({ tokens: 1_000_000, basis: 'reported' }, 'gemini-3.8-flash-high'))
      .toEqual({ tokens: 1_000_000, basis: 'reported', estimated: false })
    // Danh mục tĩnh vẫn là phương án cuối, và vẫn phải ghi rõ là ước lượng.
    expect(resolveContextWindow(null, 'claude-3.7-sonnet')).toEqual({ tokens: 200_000, basis: 'catalog', estimated: true })
    expect(resolveContextWindow(null, 'Claude 3.7 Sonnet')).toEqual({ tokens: 200_000, basis: 'catalog', estimated: true })
  })

  it('bảng đoán theo tên đã bị xoá: tên không nguồn nào biết trả về unknown', () => {
    // Trước đợt 18: 'gemini'→1M, 'claude'→200k, 'deepseek'/'qwen'→64k. Đó là câu trả lời
    // thứ tư cho cùng một câu hỏi, và là câu trả lời sai (harness nén ở 128 000).
    expect(resolveContextWindow(null, 'vendor-gemini-x')).toEqual({ tokens: null, basis: 'unknown', estimated: false })
    expect(resolveContextWindow(null, 'deepseek-v9')).toEqual({ tokens: null, basis: 'unknown', estimated: false })
    expect(resolveContextWindow(null, 'acme-mystery-model-v9')).toEqual({ tokens: null, basis: 'unknown', estimated: false })
    expect(resolveContextWindow(null, null)).toEqual({ tokens: null, basis: 'unknown', estimated: false })
  })

  it('đọc contextWindow từ snapshot router theo model, alias và nhãn harness', () => {
    const snapshot = snapshotWith(1_000_000)
    expect(findRouterContextWindow(snapshot, { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' }))
      .toEqual({ tokens: 1_000_000, basis: 'reported' })
    expect(findRouterContextWindow(snapshot, { kind: 'alias', aliasId: 'alias-1' })).toEqual({ tokens: 1_000_000, basis: 'reported' })
    // Nhãn harness kèm hậu tố mức thinking vẫn phải khớp được.
    expect(findRouterContextWindow(snapshot, null, 'Gemini 3.8 Flash (High)')).toEqual({ tokens: 1_000_000, basis: 'reported' })
    expect(findRouterContextWindow(snapshotWith(null), null, 'Gemini 3.8 Flash')).toBeNull()
    expect(findRouterContextWindow(null, null, 'Gemini 3.8 Flash')).toBeNull()
    expect(findRouterContextWindow(snapshot, null, 'model-không-có-trong-snapshot')).toBeNull()
  })

  /**
   * Vòng 29 — tuyến `{providerId, modelId}` chạy trên BẤT KỲ connection dùng được nào của nhóm
   * (router tự luân phiên, tự chuyển khoá khi hết hạn mức), nên con số hiển thị phải là con số
   * NHỎ NHẤT của nhóm. Hứa cửa sổ của connection rộng nhất là hứa điều lượt không giữ được.
   */
  it('tuyến provider: lấy cửa sổ NHỎ NHẤT trong nhóm, bỏ connection không dùng được', () => {
    const snapshot = snapshotWith(1_000_000)
    const [first] = snapshot.connections
    snapshot.connections.push(
      // Cùng provider, cửa sổ nhỏ hơn → phải thắng.
      { ...first, id: 'conn-2', name: 'Antigravity (key 2)', models: [{ ...first.models[0], contextWindow: 200_000 }] } as never,
      // Cùng provider nhưng đã tắt → không bao giờ nhận lượt, không được kéo số xuống.
      { ...first, id: 'conn-off', enabled: false, models: [{ ...first.models[0], contextWindow: 32_768 }] } as never,
      // Provider KHÁC, cùng model id, cửa sổ nhỏ hơn → không thuộc nhóm.
      { ...first, id: 'conn-other', providerId: 'openrouter', name: 'OpenRouter', models: [{ ...first.models[0], contextWindow: 8_192 }] } as never,
    )

    expect(findRouterContextWindow(snapshot, { kind: 'provider', providerId: 'antigravity', modelId: 'gemini-3.8-flash-high' }))
      .toEqual({ tokens: 200_000, basis: 'reported' })
    // Cả nhóm chỉ còn một đích dùng được thì số của đích đó là câu trả lời.
    expect(findRouterContextWindow(snapshotWith(1_000_000), { kind: 'provider', providerId: 'antigravity', modelId: 'gemini-3.8-flash-high' }))
      .toEqual({ tokens: 1_000_000, basis: 'reported' })
    // Nhóm không còn connection nào báo số → rơi xuống nhãn harness, không bịa số.
    expect(findRouterContextWindow(snapshotWith(null), { kind: 'provider', providerId: 'antigravity', modelId: 'gemini-3.8-flash-high' }, 'Gemini 3.8 Flash'))
      .toEqual(null)
    expect(findRouterContextWindow(snapshotWith(1_000_000), { kind: 'provider', providerId: 'opencode', modelId: 'gemini-3.8-flash-high' }))
      .toBeNull()
  })

  it('tuyến provider: connection dò hỏng vẫn tính nếu model là thứ người dùng gõ tay', () => {
    const snapshot = snapshotWith(1_000_000)
    const [first] = snapshot.connections
    snapshot.connections.push(
      // Dò hỏng nhưng model gõ tay: `validTarget` vẫn định tuyến ⇒ cửa sổ của nó phải được tính.
      { ...first, id: 'conn-hand', name: 'Antigravity (key 2)', discoveryState: 'degraded', models: [{ ...first.models[0], source: 'custom', contextWindow: 128_000 }] } as never,
      // Dò hỏng với model dò được: router từ chối ⇒ không được kéo số xuống.
      { ...first, id: 'conn-live', name: 'Antigravity (key 3)', discoveryState: 'failed', models: [{ ...first.models[0], source: 'live', contextWindow: 4_096 }] } as never,
    )

    expect(findRouterContextWindow(snapshot, { kind: 'provider', providerId: 'antigravity', modelId: 'gemini-3.8-flash-high' }))
      .toEqual({ tokens: 128_000, basis: 'reported' })
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

  it('số của bảng BoxFox hiện kèm `est.` và tooltip nói rõ số ấy từ đâu', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_048_576, { contextWindowSource: 'documented' }) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    seedRun()

    const host = render(<ContextUsageBar />)
    // Chữ `est.` nằm trong một `<span class="ml-1">` nên `textContent` không có dấu cách.
    expect(limitLabelText(host)).toContain('28.6k / 1.0M (3%)')
    expect(limitLabelText(host)).toContain('est.')
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(label.getAttribute('title')).toContain('BoxFox model table')
    expect(label.getAttribute('title')).toContain('not from the provider')
  })

  it('nguồn sàn của phiên: hiện số ĐANG CÓ HIỆU LỰC thay vì `unknown`', () => {
    // Đây là chỗ đóng vênh thứ hai: harness nén ở sàn 128 000 nhưng thanh cũ ghi
    // "unknown" vì router không báo gì cho model lạ.
    useProviderStore.setState({ snapshot: snapshotWith(null) })
    seedRun({ lastModelLabel: 'acme-mystery-model-v9', contextWindow: 128_000, contextWindowSource: 'fallback' })

    const host = render(<ContextUsageBar />)
    expect(limitLabelText(host)).toContain('28.6k / 128k (22%)')
    expect(limitLabelText(host)).toContain('est.')
    expect(limitLabelText(host)).not.toContain('unknown')
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(label.getAttribute('title')).toContain('holding 128k tokens')
    expect(label.getAttribute('title')).toContain('not a provider number')
  })

  /**
   * Lỗi b18-review #4: bản ghi phiên CÓ số mà KHÔNG có nhãn nguồn (phiên cũ,
   * `route: {}` nên bản vá lúc khởi động bỏ qua) từng được đọc là `reported` —
   * tức số 128 000 của sàn hiện ra như thể nhà cung cấp báo, không `est.`, không
   * tooltip. Chưa ai báo con số ấy, nên nó phải mang dấu ước lượng.
   */
  it('bản ghi phiên không có nhãn nguồn: KHÔNG được đọc là `reported`', () => {
    useProviderStore.setState({ snapshot: snapshotWith(null) })
    seedRun({ lastModelLabel: 'acme-mystery-model-v9', contextWindow: 128_000, contextWindowSource: null })

    const host = render(<ContextUsageBar />)
    expect(limitLabelText(host)).toContain('28.6k / 128k (22%)')
    expect(limitLabelText(host)).toContain('est.')
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(label.getAttribute('title')).toContain('holding 128k tokens')

    // Cùng lý do: một nhãn lạ cũng không được biến thành `reported`.
    act(() => seedRun({ lastModelLabel: 'acme-mystery-model-v9', contextWindow: 262_144, contextWindowSource: 'something-else' }))
    expect(resolveContextWindow(null, 'acme-mystery-model-v9', { contextWindow: 262_144, contextWindowSource: 'something-else' }))
      .toEqual({ tokens: 262_144, basis: 'fallback', estimated: true })
    // Nhưng nhãn `reported` thật thì giữ nguyên: không `est.`, không tooltip.
    expect(resolveContextWindow(null, 'acme-mystery-model-v9', { contextWindow: 262_144, contextWindowSource: 'reported' }))
      .toEqual({ tokens: 262_144, basis: 'reported', estimated: false })
  })

  it('người dùng tự khai (`manual`): không `est.`, tooltip nói số ấy do người dùng đặt', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_048_576, { contextWindowSource: 'documented' }) })
    seedRun({ contextWindow: 32_768, contextWindowSource: 'manual' })

    const host = render(<ContextUsageBar />)
    // Số người dùng khai thắng cả bảng tên 1M của router — đúng thứ tự mà harness áp.
    expect(limitLabelText(host)).toBe('28.6k / 32.8k (87%)')
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(label.getAttribute('title')).toContain('You set this context window')
    expect(label.querySelector('span.hidden')).toBeNull()
  })

  it('nhãn harness "<connection> · <model> (High)" khớp đúng dòng router', () => {
    useProviderStore.setState({
      snapshot: snapshotWith(1_048_576, { id: 'deepseek-flash', name: 'DeepSeek V4 Flash', contextWindowSource: 'documented' }),
    })
    seedRun({ lastModelLabel: 'DeepSeek · deepseek-flash (High)' })

    const host = render(<ContextUsageBar />)
    expect(limitLabelText(host)).toContain('28.6k / 1.0M (3%)')
    expect(limitLabelText(host)).toContain('est.')
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    expect(label.getAttribute('title')).toContain('BoxFox model table')
  })

  it('nhãn tuyến provider dùng số nhỏ nhất của nhóm, không phải số của connection đầu', () => {
    const snapshot = snapshotWith(1_000_000)
    const [first] = snapshot.connections
    snapshot.connections.push(
      { ...first, id: 'conn-2', name: 'Antigravity (key 2)', models: [{ ...first.models[0], contextWindow: 200_000 }] } as never,
    )
    useProviderStore.setState({ snapshot })
    useRouterChatStore.setState({ selection: { kind: 'provider', providerId: 'antigravity', modelId: 'gemini-3.8-flash-high' } })
    seedRun()

    const host = render(<ContextUsageBar />)
    expect(limitLabelText(host)).toContain('28.6k / 200k (14%)')
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

describe('ContextUsageBar — bố cục theo bề rộng KHUNG CHỨA, không theo viewport (NEW-1)', () => {
  /**
   * NEW-1: ở viewport 900px nhưng khung chat chỉ ~384px (panel workspace mở),
   * media query `sm:` cũ vẫn bày bản đầy đủ nên nút Compact bị `overflow-hidden`
   * của hàng cắt cụt (đo được: mép phải nút 470px so với mép phải khung 440px).
   *
   * jsdom không dựng layout nên không đo được pixel; thay vào đó khẳng định
   * các bất biến cấu trúc khiến việc cắt cụt là KHÔNG THỂ:
   *  1. hàng của thanh là một CSS container (`@container`) và mọi biến thể
   *     condensed/full đọc theo container (`@lg:`), không còn `sm:`/`md:` viewport;
   *  2. các nút co giãn được mang lớp co (`min-w-0`) còn nút Compact là phần tử
   *     duy nhất giữ nguyên kích thước (`shrink-0`) và không mang lớp ẩn/cắt nào.
   */
  const CONTAINER_VARIANT = '@lg'

  function viewportBreakpointClasses(el: Element | null): string[] {
    return (el?.className ?? '')
      .split(/\s+/)
      .filter((cls) => /^(sm|md|lg|xl|2xl):/.test(cls))
  }

  it('hàng của thanh là CSS container và không node nào còn breakpoint theo viewport', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    seedRun()

    const host = render(<ContextUsageBar />)
    const row = host.querySelector('[data-testid="context-usage-row"]') as HTMLElement
    expect(row).toBeTruthy()
    // `@container` = container-type: inline-size — bề rộng thật của khung chat.
    expect(row.className).toContain('@container')

    for (const testid of ['context-usage-row', 'context-usage-progress', 'context-usage-actions', 'context-usage-label', 'context-usage-compact']) {
      const el = host.querySelector(`[data-testid="${testid}"]`)
      expect(el, testid).toBeTruthy()
      expect(viewportBreakpointClasses(el), testid).toEqual([])
    }
  })

  it('biến thể condensed/full chuyển theo container (`@lg:`), không theo viewport', () => {
    useProviderStore.setState({ snapshot: snapshotWith(null) })
    // Nguồn danh mục tĩnh: đây là nguồn duy nhất ngoài router còn vẽ chữ `est.` — model
    // không nguồn nào biết thì nhãn ghi thẳng `unknown`, không phải một con số ước lượng.
    seedRun({ lastModelLabel: 'claude-3.7-sonnet' })

    const host = render(<ContextUsageBar />)
    // Thanh tiến trình: chỉ hiện ở bản đầy đủ → điều kiện phải là container.
    const progress = host.querySelector('[data-testid="context-usage-progress"]') as HTMLElement
    expect(progress.className).toContain('hidden')
    expect(progress.className).toContain(`${CONTAINER_VARIANT}:flex`)

    // Nhãn ước lượng + chữ trên nút Compact cũng chỉ hiện ở bản đầy đủ.
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    const estimated = label.querySelector('span.hidden')
    expect(estimated?.className).toContain(`${CONTAINER_VARIANT}:inline`)
    const compactWord = Array.from(
      (host.querySelector('[data-testid="context-usage-compact"]') as HTMLElement).querySelectorAll('span'),
    ).find((span) => (span.textContent ?? '').trim().length > 0)
    expect(compactWord?.className).toContain('hidden')
    expect(compactWord?.className).toContain(`${CONTAINER_VARIANT}:inline`)
  })

  it('nút Compact không bao giờ bị cắt: nhãn/nhóm co được, nút thì không', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    seedRun()

    const host = render(<ContextUsageBar />)
    const actions = host.querySelector('[data-testid="context-usage-actions"]') as HTMLElement
    const label = host.querySelector('[data-testid="context-usage-label"]') as HTMLElement
    const compact = host.querySelector('[data-testid="context-usage-compact"]') as HTMLElement

    // Hai node co giãn được (nhóm hành động + nhãn token) mang lớp co.
    expect(actions.className).toContain('min-w-0')
    expect(label.className).toContain('min-w-0')
    expect(label.className).toContain('overflow-hidden')
    // Nút: giữ nguyên kích thước và không mang lớp ẩn/cắt cụt nào.
    expect(compact.className).toContain('shrink-0')
    expect(compact.className).not.toMatch(/\bhidden\b/)
    expect(compact.className).not.toMatch(/\btruncate\b|\boverflow-hidden\b/)
    expect(compact.querySelectorAll('[data-testid="context-usage-label"]')).toHaveLength(0)
  })
})

describe('ContextUsageBar — F7 sau khi nén ngữ cảnh', () => {
  it('hiện ước lượng SAU khi nén, không giữ số trước khi nén', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    useHarnessChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          id: 'sess-1',
          status: 'completed',
          events: [
            { seq: 1, type: 'step', data: { contextEstimate: 187_628 }, created: 1 },
            { seq: 2, type: 'compression', data: { kind: 'summary', beforeEstimate: 187_628, afterEstimate: 36_323 }, created: 2 },
          ],
          error: null,
          lastModelLabel: 'Gemini 3.8 Flash (High)',
        },
      },
    } as never)

    const host = render(<ContextUsageBar />)
    const text = (host.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toContain('36.3k')
    expect(text).not.toContain('187.6k')
  })

  it('lượt mới sau khi nén lại lấy step mới hơn', () => {
    useProviderStore.setState({ snapshot: snapshotWith(1_000_000) })
    useRouterChatStore.setState({ selection: { kind: 'model', connectionId: 'conn-1', modelId: 'gemini-3.8-flash-high' } })
    useHarnessChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          id: 'sess-1',
          status: 'running',
          events: [
            { seq: 1, type: 'step', data: { contextEstimate: 187_628 }, created: 1 },
            { seq: 2, type: 'compression', data: { afterEstimate: 36_323 }, created: 2 },
            { seq: 3, type: 'step', data: { contextEstimate: 39_865 }, created: 3 },
          ],
          error: null,
          lastModelLabel: 'Gemini 3.8 Flash (High)',
        },
      },
    } as never)

    const host = render(<ContextUsageBar />)
    expect((host.textContent ?? '').replace(/\s+/g, ' ')).toContain('39.9k')
  })
})
