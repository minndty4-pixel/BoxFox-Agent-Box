/**
 * Danh sách option của composer — Vòng 29 gộp về MỘT dòng cho mỗi (provider, model).
 *
 * Trước đây mỗi connection là một dòng, nên bốn connection opencode cùng model hiện thành bốn
 * dòng giống nhau; chọn dòng nào là ghim phiên vào đúng connection đó, hết hạn mức là lượt chết.
 * Bản này gộp các connection DÙNG ĐƯỢC thành một dòng `provider:<providerId>:<modelId>` (router
 * tự chạy luân phiên + tự failover), và giữ đường ghim một connection trong `pins`.
 *
 * Kèm phần cũ: mức thinking của tuyến alias chỉ được gửi khi **mọi** đích của alias đều công bố.
 */
import { describe, expect, it } from 'vitest'
import { composerModels, findRouteOption, routerChatOptions, selectionKey } from '../../lib/routeOptions'
import type { ProviderSnapshot } from '../../types/provider'

type Snapshot = ProviderSnapshot

const model = (id: string, thinkingLevels?: string[]) => ({
  id, name: id, source: 'live', stale: false, contextWindow: 1000,
  thinkingType: 'effort', defaultThinking: null, thinkingLevels,
  capabilities: {}, enabled: true, health: 'healthy',
})

const connection = (
  id: string,
  models: ReturnType<typeof model>[],
  providerId = 'openrouter',
  overrides: Partial<Snapshot['connections'][number]> = {},
) => ({
  id, providerId, name: `Provider ${id}`, endpoint: 'https://example.test',
  enabled: true, authState: 'ready', projectState: 'not_applicable',
  discoveryState: 'ready', inferenceState: 'ready', credentialPresent: true,
  email: null, accountLabel: null, projectId: null, revision: 1, autoSync: true,
  lastModelTestedAt: null, lastModelSyncAt: null, nextModelSyncAt: null, quota: null,
  error: null, models, ...overrides,
}) as unknown as Snapshot['connections'][number]

const alias = (id: string, targets: Array<{ connectionId: string; modelId: string }>) => ({
  id, name: id, enabled: true, targets,
}) as unknown as Snapshot['aliases'][number]

const snapshot = (
  connections: Snapshot['connections'],
  aliases: Snapshot['aliases'] = [],
  providers: Array<{ id: string; name: string }> = [],
) => ({ connections, aliases, providers }) as Snapshot

const MUSE = 'muse-spark-1.3-contributor-free'

describe('routerChatOptions — một dòng cho mỗi (provider, model)', () => {
  it('gộp bốn connection cùng provider + model thành MỘT dòng, kèm bốn đường ghim', () => {
    const options = routerChatOptions(snapshot(
      [1, 2, 3, 4].map((n) => connection(`c${n}`, [model(MUSE)], 'opencode', { name: `OpenCode Free (key ${n})` })),
      [],
      [{ id: 'opencode', name: 'OpenCode Free' }],
    ))

    expect(options.map((option) => option.value)).toEqual([`provider:opencode:${MUSE}`])
    expect(options[0].label).toBe(`OpenCode Free · ${MUSE}`)
    expect(options[0].connections).toBe(4)
    expect(options[0].pins?.map((pin) => pin.value)).toEqual([
      `model:c1:${MUSE}`, `model:c2:${MUSE}`, `model:c3:${MUSE}`, `model:c4:${MUSE}`,
    ])
    // Nhãn hàng con là tên connection — chỗ duy nhất còn nói đang chạy trên connection nào.
    expect(options[0].pins?.map((pin) => pin.label)).toEqual([
      'OpenCode Free (key 1)', 'OpenCode Free (key 2)', 'OpenCode Free (key 3)', 'OpenCode Free (key 4)',
    ])
    expect(options[0].selection).toEqual({ kind: 'provider', providerId: 'opencode', modelId: MUSE })
  })

  it('đếm khoá của cả nhóm: vòng khoá chưa công bố thì mỗi connection là một khoá', () => {
    const withRings = routerChatOptions(snapshot([
      connection('c1', [model('m1')], 'opencode', { keys: [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }] } as never),
      connection('c2', [model('m1')], 'opencode', { keys: [] } as never),
    ]))
    const bare = routerChatOptions(snapshot([
      connection('c1', [model('m1')], 'opencode'),
      connection('c2', [model('m1')], 'opencode'),
    ]))

    // c1 giữ ba khoá, c2 công bố vòng rỗng (vẫn có credential) ⇒ 4 khoá.
    expect(withRings[0].keys).toBe(4)
    expect(bare[0].keys).toBe(2)
    // Một connection một khoá thì không cần nói ra ở dòng phụ.
    expect(routerChatOptions(snapshot([connection('c1', [model('m1')])]))[0].keys).toBe(1)
  })

  it('một connection thì không có nhánh ghim (ghim một đích là vô nghĩa)', () => {
    const options = routerChatOptions(snapshot([connection('c1', [model('m1')])]))

    expect(options).toHaveLength(1)
    expect(options[0].connections).toBe(1)
    expect(options[0].pins).toBeUndefined()
  })

  it('hai provider cùng model id là hai dòng khác nhau', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1')], 'opencode'),
      connection('c2', [model('m1')], 'openrouter'),
    ]))

    expect(options.map((option) => option.value)).toEqual(['provider:opencode:m1', 'provider:openrouter:m1'])
  })

  it('bỏ connection không định tuyến được và model bị tắt/hỏng khỏi nhóm', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1')], 'opencode'),
      connection('c2', [model('m1')], 'opencode', { enabled: false }),
      connection('c3', [model('m1')], 'opencode', { inferenceState: 'failed' }),
      connection('c4', [model('m1')], 'opencode', { discoveryState: 'failed' }),
      connection('c5', [{ ...model('m1'), health: 'unavailable' }], 'opencode'),
      connection('c6', [{ ...model('m1'), enabled: false }], 'opencode'),
    ]))

    // `inferenceState` không nằm trong điều kiện của router — chỉ `enabled`/`authState`/
    // `discoveryState`(+ antigravity) mới quyết định, nên c3 vẫn là một đích dùng được.
    expect(options[0].connections).toBe(2)
    expect(options[0].pins?.map((pin) => pin.value)).toEqual(['model:c1:m1', 'model:c3:m1'])
  })

  it('giữ connection dò hỏng khi model là thứ người dùng gõ tay', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1')], 'opencode'),
      connection('c2', [{ ...model('m1'), source: 'custom' }], 'opencode', { discoveryState: 'degraded' }),
    ]))

    // Nhánh `custom` của `validTarget`: dò hỏng mà model gõ tay thì router vẫn định tuyến, nên
    // bảng chọn không được bỏ đích đó đi (ẩn nó là hứa hẹp thiếu, không phải hứa hẹp thừa).
    expect(options[0].connections).toBe(2)
    expect(options[0].pins?.map((pin) => pin.value)).toEqual(['model:c1:m1', 'model:c2:m1'])
    // Hàng nói ra connection nào đang chạy bằng danh sách gõ tay; nhóm toàn connection dò xong thì im.
    expect(options[0].handTyped).toBe(1)
    expect(routerChatOptions(snapshot([connection('c1', [model('m1')])]))[0].handTyped).toBeUndefined()
  })

  it('mức thinking tính trên cả connection dò hỏng nên không hứa mức harness sẽ từ chối', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1', ['low', 'medium', 'high'])], 'opencode'),
      connection('c2', [{ ...model('m1', ['low', 'high']), source: 'custom' }], 'opencode', { discoveryState: 'degraded' }),
    ]))

    // Harness giao mức trên MỌI connection định tuyến được, kể cả connection dò hỏng có model gõ
    // tay; `medium` chỉ có ở c1, nên gửi nó là chắc chắn ăn THINKING_LEVEL_UNSUPPORTED.
    expect(options[0].connections).toBe(2)
    expect(options[0].thinkingLevels).toEqual(['low', 'high'])
  })

  it('mức thinking của dòng là giao mức của mọi connection trong nhóm', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1', ['max', 'high', 'low'])], 'opencode'),
      connection('c2', [model('m1', ['high', 'low'])], 'opencode'),
    ]))

    expect(options[0].thinkingLevels).toEqual(['high', 'low'])
    // Từng connection vẫn giữ mức riêng: ghim c1 thì được chọn `max`.
    expect(options[0].pins?.map((pin) => pin.thinkingLevels)).toEqual([['max', 'high', 'low'], ['high', 'low']])
  })

  it('một connection không công bố mức nào thì cả dòng không gửi mức nào', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1', ['high', 'low'])], 'opencode'),
      connection('c2', [model('m1', [])], 'opencode'),
    ]))

    expect(options[0].thinkingLevels).toBeUndefined()
  })

  it('hai connection không có mức chung thì dòng cũng không gửi mức nào', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1', ['high'])], 'opencode'),
      connection('c2', [model('m1', ['low'])], 'opencode'),
    ]))

    expect(options[0].thinkingLevels).toBeUndefined()
  })

  it('tên provider lấy từ danh sách providers, thiếu thì rơi về tên connection', () => {
    const withProvider = routerChatOptions(snapshot([connection('c1', [model('m1')], 'opencode')], [], [{ id: 'opencode', name: 'OpenCode Free' }]))
    const withoutProvider = routerChatOptions(snapshot([connection('c1', [model('m1')], 'opencode')]))

    expect(withProvider[0].label).toBe('OpenCode Free · m1')
    expect(withoutProvider[0].label).toBe('Provider c1 · m1')
  })

  it('tra được option theo cả đường ghim (defaultRoute vẫn là connectionId/modelId)', () => {
    const options = routerChatOptions(snapshot([
      connection('c1', [model('m1')], 'opencode'),
      connection('c2', [model('m1')], 'opencode'),
    ]))

    expect(findRouteOption(options, 'provider:opencode:m1')?.value).toBe('provider:opencode:m1')
    expect(findRouteOption(options, 'model:c2:m1')?.label).toBe('Provider c2')
    expect(findRouteOption(options, 'model:c9:m1')).toBeUndefined()
  })

  it('adapter composer đổi value/label thành id/name và mang theo pins + số connection', () => {
    const models = composerModels(routerChatOptions(snapshot([
      connection('c1', [model('m1')], 'opencode'),
      connection('c2', [model('m1')], 'opencode'),
    ])))

    expect(models[0]).toMatchObject({ id: 'provider:opencode:m1', name: 'Provider c1 · m1', provider: 'opencode', connections: 2, keys: 2 })
    expect(models[0].pins?.[1]).toMatchObject({ id: 'model:c2:m1', name: 'Provider c2' })
  })

  it('khoá chọn của ba hình dạng tuyến', () => {
    expect(selectionKey({ kind: 'provider', providerId: 'opencode', modelId: MUSE })).toBe(`provider:opencode:${MUSE}`)
    expect(selectionKey({ kind: 'model', connectionId: 'c1', modelId: MUSE })).toBe(`model:c1:${MUSE}`)
    expect(selectionKey({ kind: 'alias', aliasId: 'a1' })).toBe('alias:a1')
    expect(selectionKey(null)).toBe('')
  })
})

describe('routerChatOptions — mức thinking của alias', () => {
  it('lấy giao mức của mọi đích khi mọi đích đều công bố', () => {
    const options = routerChatOptions(snapshot(
      [connection('c1', [model('m1', ['max', 'high', 'low'])]), connection('c2', [model('m2', ['high', 'low'])])],
      [alias('a1', [{ connectionId: 'c1', modelId: 'm1' }, { connectionId: 'c2', modelId: 'm2' }])],
    ))

    expect(options.find(o => o.value === 'alias:a1')?.thinkingLevels).toEqual(['high', 'low'])
  })

  it('bỏ trống khi có đích chưa công bố mức nào', () => {
    const options = routerChatOptions(snapshot(
      [connection('c1', [model('m1', ['high', 'low'])]), connection('c2', [model('m2', [])])],
      [alias('a1', [{ connectionId: 'c1', modelId: 'm1' }, { connectionId: 'c2', modelId: 'm2' }])],
    ))

    expect(options.find(o => o.value === 'alias:a1')?.thinkingLevels).toBeUndefined()
  })

  it('bỏ trống khi hai đích không có mức chung', () => {
    const options = routerChatOptions(snapshot(
      [connection('c1', [model('m1', ['high'])]), connection('c2', [model('m2', ['low'])])],
      [alias('a1', [{ connectionId: 'c1', modelId: 'm1' }, { connectionId: 'c2', modelId: 'm2' }])],
    ))

    expect(options.find(o => o.value === 'alias:a1')?.thinkingLevels).toBeUndefined()
  })

  it('alias đứng trước các dòng model và giữ nguyên hình dạng cũ', () => {
    const options = routerChatOptions(snapshot(
      [connection('c1', [model('m1', ['high'])])],
      [alias('a1', [{ connectionId: 'c1', modelId: 'm1' }])],
    ))

    expect(options.map(o => o.value)).toEqual(['alias:a1', 'provider:openrouter:m1'])
    expect(options[0].selection).toEqual({ kind: 'alias', aliasId: 'a1' })
  })
})
