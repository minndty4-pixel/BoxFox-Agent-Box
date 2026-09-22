import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Engine không trả lời thì sơ đồ phải nói `unavailable`, tuyệt đối không bày lại
 * tên công cụ của lần chạy trước (năm cái tên cũ còn không tồn tại trong registry).
 *
 * Mock riêng `lib/ownerDirectives.loadRuntimeInfo` (giữ nguyên các helper khác) để
 * test không phụ thuộc module cache dùng chung — hàm này chỉ ghi cache khi nạp được.
 */
vi.mock('../../lib/ownerDirectives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ownerDirectives')>()
  return { ...actual, loadRuntimeInfo: async () => null, cachedRuntimeInfo: () => null }
})

import { HarnessFlowVisualizer } from './HarnessFlowVisualizer'
import { useRuntimeInfoStore } from '../../store/runtimeInfoStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useRuntimeInfoStore.setState({ info: null, status: 'idle', error: null })
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('engine down')
  }))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('HarnessFlowVisualizer không có runtime-info', () => {
  it('ghi unavailable và không đoán tên công cụ nào', async () => {
    await act(async () => {
      root.render(<HarnessFlowVisualizer />)
    })

    const node = [...host.querySelectorAll<HTMLElement>('div')].find(
      (candidate) => candidate.textContent?.includes('1. Explore') && candidate.className.includes('flow-node')
    )
    expect(node).toBeTruthy()
    await act(async () => {
      node!.click()
    })

    expect(host.textContent).toContain('unavailable')
    for (const fake of ['file_multi_replace', 'diagram_generate', 'dir_list', 'git_diff', 'read_url_content']) {
      expect(host.textContent).not.toContain(fake)
    }
  })
})
