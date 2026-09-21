/**
 * Mức thinking của tuyến alias: composer chỉ được gửi một mức khi **mọi** đích của alias
 * đều công bố mức đó. Trước đây đích alias không mang `thinkingLevels`, nên composer gửi
 * `medium` cho một alias có đích chỉ công bố `max/high/low` — đúng lỗi T-1 mà bản sửa
 * cho model trực tiếp đã chặn.
 */
import { describe, expect, it } from 'vitest'
import { routerChatOptions } from './RouterTestChat'
import type { ProviderSnapshot } from '../../types/provider'

type Snapshot = ProviderSnapshot

const model = (id: string, thinkingLevels?: string[]) => ({
  id, name: id, source: 'live', stale: false, contextWindow: 1000,
  thinkingType: 'effort', defaultThinking: null, thinkingLevels,
  capabilities: {}, enabled: true, health: 'healthy',
})

const connection = (id: string, models: ReturnType<typeof model>[]) => ({
  id, providerId: 'openrouter', name: `Provider ${id}`, endpoint: 'https://example.test',
  enabled: true, authState: 'ready', projectState: 'not_applicable',
  discoveryState: 'ready', inferenceState: 'ready', credentialPresent: true,
  email: null, accountLabel: null, projectId: null, revision: 1, autoSync: true,
  lastModelTestedAt: null, lastModelSyncAt: null, nextModelSyncAt: null, quota: null,
  error: null, models,
}) as unknown as Snapshot['connections'][number]

const alias = (id: string, targets: Array<{ connectionId: string; modelId: string }>) => ({
  id, name: id, enabled: true, targets,
}) as unknown as Snapshot['aliases'][number]

const snapshot = (connections: Snapshot['connections'], aliases: Snapshot['aliases']) => ({ connections, aliases }) as Snapshot

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
})
