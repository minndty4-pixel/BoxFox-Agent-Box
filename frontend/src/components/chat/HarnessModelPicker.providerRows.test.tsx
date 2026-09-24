/**
 * Vòng 29 — bảng chọn model của composer: MỘT hàng cho mỗi (provider, model), và nhánh ghim
 * một connection cho ai thật sự muốn ghim.
 *
 * Lỗi gốc (chủ sở hữu báo): "opencode key1 model A, opencode key2 model A" — bảng cũ dựng một
 * hàng cho mỗi CONNECTION, nên bốn khoá opencode cùng model hiện thành bốn hàng giống nhau, và
 * chọn hàng nào là ghim phiên vào đúng connection đó: khoá ấy hết hạn mức là lượt chết.
 *
 * Render qua raw `createRoot` + `act` (dự án không dùng @testing-library). Popover của picker
 * nằm trong một portal ở `document.body`, nên truy vấn phải hỏi `document`, không phải `host`.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useHarnessStore } from '../../store/harnessStore'
import { useProviderStore } from '../../store/providerStore'
import type { ProviderSnapshot } from '../../types/provider'
import { HarnessModelPicker, type RouterSingleModel } from './HarnessModelPicker'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MUSE = 'muse-spark-1.3-contributor-free'
const PROVIDER_ROW = `provider:opencode:${MUSE}`

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

function click(el: Element | null | undefined) {
  if (!el) throw new Error('Không tìm thấy phần tử để bấm')
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function byId(id: string): HTMLElement | null {
  return document.querySelector(`[data-component-id="${id}"]`)
}

/** Hàng cha của model — bỏ qua nút mở nhánh ghim (id bắt đầu bằng `model-row-`). */
function modelRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-component-id^="model-row-"]'))
    .filter((el) => !(el.getAttribute('data-component-id') ?? '').startsWith('model-row-pin-toggle-'))
}

/** Hàng con trong nhánh ghim — bỏ qua nút Unpin. */
function pinRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-component-id^="pin-row-"]'))
    .filter((el) => !(el.getAttribute('data-component-id') ?? '').endsWith('-unpin'))
}

/** Mở popover rồi sang tab Single Models. */
function openModels(host: HTMLElement) {
  const trigger = Array.from(host.querySelectorAll('button'))
    .find((b) => (b.getAttribute('title') ?? '').startsWith('Model:'))
  click(trigger)
  const modelsTab = Array.from(document.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').trim().endsWith('Single Models'))
  click(modelsTab)
}

const model = (id: string, thinkingLevels?: string[]) => ({
  id, name: id, source: 'live', stale: false, contextWindow: 1_000_000,
  contextWindowSource: 'reported', thinkingType: 'effort', defaultThinking: null, thinkingLevels,
  capabilities: {}, enabled: true, health: 'healthy',
})

const connection = (
  id: string,
  name: string,
  models: ReturnType<typeof model>[],
  overrides: Record<string, unknown> = {},
  keyCount = 1,
) => ({
  id, providerId: 'opencode', name, endpoint: 'https://example.test',
  enabled: true, authState: 'ready', projectState: 'not_applicable',
  discoveryState: 'ready', inferenceState: 'ready', credentialPresent: true,
  email: null, accountLabel: null, projectId: null, revision: 1, autoSync: true,
  lastModelTestedAt: null, lastModelSyncAt: null, nextModelSyncAt: null, quota: null,
  error: null, models,
  keys: keyCount > 0
    ? Array.from({ length: keyCount }, (_, i) => ({ id: `${id}-key${i + 1}`, label: `key ${i + 1}`, prefix: 'sk-', state: 'ready' }))
    : undefined,
  ...overrides,
})

const snapshotWith = (connections: Array<ReturnType<typeof connection>>): ProviderSnapshot => ({
  providers: [{ id: 'opencode', name: 'OpenCode Free' }],
  connections,
  providerConfigs: [],
  aliases: [],
  defaultRoute: null,
  keys: [],
  usage: [],
  health: { status: 'ok', version: '0.1.0' },
}) as unknown as ProviderSnapshot

const twoKeys = () => snapshotWith([
  connection('c1', 'OpenCode Free (key 1)', [model(MUSE, ['low', 'medium', 'high'])]),
  connection('c2', 'OpenCode Free (key 2)', [model(MUSE, ['low', 'medium', 'high'])]),
])

beforeEach(() => {
  useHarnessStore.getState().setActiveModel(PROVIDER_ROW)
  useProviderStore.setState({ snapshot: twoKeys() })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  useProviderStore.setState({ snapshot: null })
  vi.restoreAllMocks()
})

describe('HarnessModelPicker — một hàng cho mỗi (provider, model)', () => {
  it('gộp hai connection cùng model thành MỘT hàng, số connection nằm ở dòng phụ', () => {
    const host = render(<HarnessModelPicker />)
    openModels(host)

    const rows = modelRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('data-component-id')).toBe(`model-row-${PROVIDER_ROW}`)
    // Nhãn là tên provider + tên model; tên connection KHÔNG lên hàng cha (nhãn còn bị composer
    // cắt theo dấu `·`, nhét tên connection vào đó là mất chính tên model).
    expect(rows[0].textContent).toContain('OpenCode Free')
    expect(rows[0].textContent).toContain(MUSE)
    expect(rows[0].textContent).not.toContain('key 1')
    expect(rows[0].textContent).toContain('2 connections')
    expect(rows[0].textContent).toContain('2 keys')
    expect(rows[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('dòng phụ đếm khoá của cả nhóm (một connection có thể giữ nhiều khoá)', () => {
    useProviderStore.setState({ snapshot: snapshotWith([
      connection('c1', 'OpenCode Free (key 1)', [model(MUSE, ['high'])], {}, 3),
      connection('c2', 'OpenCode Free (key 2)', [model(MUSE, ['high'])], {}, 1),
    ]) })
    const host = render(<HarnessModelPicker />)
    openModels(host)

    expect(modelRows()[0].textContent).toContain('2 connections')
    expect(modelRows()[0].textContent).toContain('4 keys')
  })

  it('router chưa trang trí vòng khoá: mỗi connection vẫn tính là một khoá', () => {
    useProviderStore.setState({ snapshot: snapshotWith([
      connection('c1', 'OpenCode Free (key 1)', [model(MUSE, ['high'])], {}, 0),
      connection('c2', 'OpenCode Free (key 2)', [model(MUSE, ['high'])], {}, 0),
    ]) })
    const host = render(<HarnessModelPicker />)
    openModels(host)

    expect(modelRows()[0].textContent).toContain('2 keys')
  })

  it('tab Single Models nhắc việc tự chuyển khoá khi hết hạn mức', () => {
    const host = render(<HarnessModelPicker />)
    openModels(host)
    expect(document.body.textContent).toContain('Auto-switch on quota — shared across the group.')
    expect(document.body.textContent).not.toContain('Auto-switch on quota — shared across the group. Auto')

    // Tab Harnesses không có dòng nhắc này (đây là chuyện của nhóm connection).
    click(Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim().endsWith('Harnesses')))
    expect(document.body.textContent).not.toContain('Auto-switch on quota')
  })

  it('nhóm chỉ một connection thì không có nút ghim', () => {
    useProviderStore.setState({ snapshot: snapshotWith([connection('c1', 'OpenCode Free', [model(MUSE, ['high'])])]) })
    const host = render(<HarnessModelPicker />)
    openModels(host)

    expect(modelRows()).toHaveLength(1)
    expect(byId(`model-row-pin-toggle-${PROVIDER_ROW}`)).toBeNull()
  })

  it('model chỉ công bố một mức thì không bày dải chọn mức (không có gì để chọn)', () => {
    useProviderStore.setState({ snapshot: snapshotWith([connection('c1', 'OpenCode Free', [model(MUSE, ['high'])])]) })
    const host = render(<HarnessModelPicker />)
    openModels(host)

    expect(modelRows()[0].textContent).not.toContain('Thinking:')
  })

  it('nhóm có giao mức rỗng thì cũng không bày dải chọn mức', () => {
    // Hai connection công bố hai mức khác nhau: không mức nào hợp lệ cho MỌI đích, nên lượt đi
    // không mang mức nào và bảng cũng không được mời chọn — chọn xong là lượt chết.
    useProviderStore.setState({ snapshot: snapshotWith([
      connection('c1', 'OpenCode Free (key 1)', [model(MUSE, ['high'])]),
      connection('c2', 'OpenCode Free (key 2)', [model(MUSE, ['low'])]),
    ]) })
    const host = render(<HarnessModelPicker />)
    openModels(host)

    expect(modelRows()[0].textContent).not.toContain('Thinking:')
  })

  it('nhóm có giao mức ≥ 2 thì bày dải chọn mức trên hàng đang chọn', () => {
    const host = render(<HarnessModelPicker />)
    openModels(host)

    expect(modelRows()[0].textContent).toContain('Thinking:')
  })
})

describe('HarnessModelPicker — nhánh ghim một connection', () => {
  it('mở nhánh ghim: một hàng con cho mỗi connection, kèm trạng thái thật', () => {
    const host = render(<HarnessModelPicker />)
    openModels(host)

    const toggle = byId(`model-row-pin-toggle-${PROVIDER_ROW}`)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.getAttribute('title')).toBe('Pin one connection')

    click(toggle)

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(byId(`pin-menu-${PROVIDER_ROW}`)?.textContent).toContain('Pin this connection')
    expect(byId(`pin-menu-${PROVIDER_ROW}`)?.textContent).toContain('this connection only')
    expect(pinRows().map((row) => row.getAttribute('data-component-id')))
      .toEqual([`pin-row-model:c1:${MUSE}`, `pin-row-model:c2:${MUSE}`])
    expect(pinRows()[0].textContent).toContain('OpenCode Free (key 1)')
    expect(pinRows()[0].textContent).toContain('ready')
    expect(pinRows()[1].textContent).toContain('OpenCode Free (key 2)')
  })

  it('connection đang hỏng nói thẳng trạng thái của nó, không giả vờ sẵn sàng', () => {
    useProviderStore.setState({ snapshot: snapshotWith([
      connection('c1', 'OpenCode Free (key 1)', [model(MUSE, ['high'])]),
      connection('c2', 'OpenCode Free (key 2)', [model(MUSE, ['high'])], { inferenceState: 'failed' }),
      connection('c3', 'OpenCode Free (key 3)', [model(MUSE, ['high'])], { inferenceState: 'unknown' }),
    ]) })
    const host = render(<HarnessModelPicker />)
    openModels(host)
    click(byId(`model-row-pin-toggle-${PROVIDER_ROW}`))

    expect(pinRows()[1].textContent).toContain('failed')
    expect(pinRows()[2].textContent).toContain('untested')
  })

  it('bấm một hàng con: chọn tuyến connection cũ rồi đóng bảng', () => {
    const onRouterModelChange = vi.fn()
    const host = render(<HarnessModelPicker onRouterModelChange={onRouterModelChange} />)
    openModels(host)
    click(byId(`model-row-pin-toggle-${PROVIDER_ROW}`))

    click(pinRows()[1])

    expect(onRouterModelChange).toHaveBeenCalledWith(`model:c2:${MUSE}`)
    expect(useHarnessStore.getState().activeModelId).toBe(`model:c2:${MUSE}`)
    expect(useHarnessStore.getState().activeType).toBe('model')
    // Model này công bố ba mức thinking ⇒ bảng ở lại để chọn mức ngay tại chỗ.
    expect(byId(`pin-menu-${PROVIDER_ROW}`)).not.toBeNull()
  })

  it('phiên đang ghim: hàng cha vẫn được đánh dấu chọn, hàng con mang `in use`, Unpin đưa về cả nhóm', () => {
    useHarnessStore.getState().setActiveModel(`model:c2:${MUSE}`)
    const onRouterModelChange = vi.fn()
    const host = render(<HarnessModelPicker onRouterModelChange={onRouterModelChange} />)
    openModels(host)

    const parent = modelRows()[0]
    // Hàng cha là thứ duy nhất mang nhãn provider · model, nên nó phải được đánh dấu chọn.
    expect(parent.getAttribute('aria-pressed')).toBe('true')
    expect(parent.textContent).toContain('pinned · OpenCode Free (key 2)')

    // Nhánh ghim tự mở sẵn, hàng con đang dùng nói rõ nó đang dùng.
    const pinnedChild = byId(`pin-row-model:c2:${MUSE}`)
    expect(pinnedChild?.getAttribute('aria-pressed')).toBe('true')
    expect(pinnedChild?.textContent).toContain('in use')

    click(byId(`pin-row-model:c2:${MUSE}-unpin`))

    expect(onRouterModelChange).toHaveBeenCalledWith(PROVIDER_ROW)
    expect(useHarnessStore.getState().activeModelId).toBe(PROVIDER_ROW)
  })

  it('chip trên composer nói rõ đang ghim connection nào', () => {
    useHarnessStore.getState().setActiveModel(`model:c2:${MUSE}`)
    const host = render(<HarnessModelPicker />)

    const trigger = Array.from(host.querySelectorAll('button'))
      .find((b) => (b.getAttribute('title') ?? '').startsWith('Model:'))
    expect(trigger?.textContent).toContain('pinned: OpenCode Free (key 2)')
    expect(trigger?.textContent).toContain(MUSE.slice(0, 14))
  })
})

describe('HarnessModelPicker — danh sách do chỗ gọi truyền vào', () => {
  it('nhận `pins` từ prop routerModels (đường ChatPanel đi) và ghim được y như đường live', () => {
    const models: RouterSingleModel[] = [{
      id: PROVIDER_ROW,
      name: `OpenCode Free · ${MUSE}`,
      provider: 'opencode',
      thinkingLevels: ['low', 'medium', 'high'],
      connections: 2,
      pins: [
        { id: `model:c1:${MUSE}`, name: 'OpenCode Free (key 1)', provider: 'opencode', thinkingLevels: ['low', 'medium', 'high'] },
        { id: `model:c2:${MUSE}`, name: 'OpenCode Free (key 2)', provider: 'opencode', thinkingLevels: ['low', 'medium', 'high'] },
      ],
    }]
    // Snapshot đang có một hàng KHÁC (một connection, tên provider khác): danh sách của chỗ gọi
    // phải thắng, nếu không thì bảng đang bày thứ khác với thứ composer sẽ gửi đi.
    useProviderStore.setState({
      snapshot: snapshotWith([connection('live-1', 'Live Only', [model(MUSE, ['high'])])]),
    })
    const onRouterModelChange = vi.fn()
    const host = render(<HarnessModelPicker routerModels={models} onRouterModelChange={onRouterModelChange} />)
    openModels(host)

    expect(modelRows()).toHaveLength(1)
    expect(modelRows()[0].textContent).toContain('OpenCode Free')
    expect(modelRows()[0].textContent).not.toContain('Live Only')
    expect(modelRows()[0].textContent).toContain('2 connections')
    click(byId(`model-row-pin-toggle-${PROVIDER_ROW}`))
    expect(pinRows()).toHaveLength(2)
    click(pinRows()[0])
    expect(onRouterModelChange).toHaveBeenCalledWith(`model:c1:${MUSE}`)
  })
})
