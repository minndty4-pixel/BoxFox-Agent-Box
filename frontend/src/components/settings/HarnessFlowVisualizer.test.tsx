import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessFlowVisualizer } from './HarnessFlowVisualizer'
import { useRuntimeInfoStore } from '../../store/runtimeInfoStore'

/**
 * HarnessFlowVisualizer — danh sách công cụ theo vai trò phải là dữ liệu thật của
 * engine (`GET /api/agent/runtime-info` → `roles[].tools`).
 *
 * Bản chép tay trước đây in ra năm cái tên KHÔNG hề tồn tại trong registry:
 * `file_multi_replace`, `diagram_generate`, `dir_list`, `git_diff`,
 * `read_url_content`. Test này khoá lại đúng điều đó. Trạng thái engine không trả
 * lời nằm ở `HarnessFlowVisualizer.runtimeUnavailable.test.tsx` (mock riêng module
 * cache để test không phụ thuộc thứ tự chạy).
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Payload thật đo sống từ `curl -s -H 'X-BoxFox-Admin: 1' http://127.0.0.1:3102/api/agent/runtime-info`.
const EXPLORE_TOOLS = ['ask_user', 'codebase_glob', 'codebase_grep', 'file_read', 'request_approval', 'skill_view', 'skills_list']
const REVIEW_TOOLS = ['ask_user', 'codebase_grep', 'file_read', 'request_approval', 'skill_view', 'skills_list']
const RUNTIME_INFO = {
  toolGroups: [
    { key: 'repositoryReading', tools: ['file_read', 'codebase_glob', 'codebase_grep'], alwaysOn: false },
    { key: 'questionsApprovals', tools: ['ask_user', 'request_approval'], alwaysOn: true },
  ],
  tools: [...EXPLORE_TOOLS, 'web_fetch', 'web_search'],
  roles: [
    { id: 'explore', name: 'Explore', tools: EXPLORE_TOOLS, skills: ['codebase-inspection'] },
    { id: 'review', name: 'Review', tools: REVIEW_TOOLS, skills: ['requesting-code-review'] },
  ],
  retry: { maxRetries: 3, backoffSeconds: [1, 4, 12], rateLimitMaxSeconds: 30, budgetSeconds: 60, jitter: 0.2 },
  limits: {
    instructionsChars: 12000,
    maxStepsDefault: 16,
    maxStepsMax: 60,
    deadlineDefaultSeconds: 180,
    deadlineMaxSeconds: 600,
    childMaxSteps: 10,
    childDeadlineSeconds: 120,
  },
}

const FAKE_TOOL_NAMES = ['file_multi_replace', 'diagram_generate', 'dir_list', 'git_diff', 'read_url_content']

let root: Root
let host: HTMLDivElement
let runtimeInfoResponse: () => Response

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  runtimeInfoResponse = () => json(RUNTIME_INFO)
  useRuntimeInfoStore.setState({ info: null, status: 'idle', error: null })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/runtime-info')) return runtimeInfoResponse()
    return json(RUNTIME_INFO)
  }))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => {
    root.render(<HarnessFlowVisualizer />)
  })
}

/** Node sơ đồ là `div` có onClick, nhãn nằm trong node. */
async function openNode(label: string) {
  const node = [...host.querySelectorAll<HTMLElement>('div')].find(
    (candidate) => candidate.textContent?.includes(label) && candidate.className.includes('flow-node')
  )
  expect(node, `node "${label}" phải có trên sơ đồ`).toBeTruthy()
  await act(async () => {
    node!.click()
  })
}

describe('HarnessFlowVisualizer tools per role', () => {
  it('in danh sách công cụ thật của registry, không còn tên bịa', async () => {
    await render()
    await openNode('1. Explore')

    for (const tool of EXPLORE_TOOLS) expect(host.textContent).toContain(tool)
    for (const fake of FAKE_TOOL_NAMES) expect(host.textContent).not.toContain(fake)
  })

  it('đổi vai trò thì đổi đúng danh sách của vai trò đó', async () => {
    await render()
    await openNode('5. Review & Verify')

    for (const tool of REVIEW_TOOLS) expect(host.textContent).toContain(tool)
    // `write_plan` là của vai trò plan, không phải review.
    expect(host.textContent).not.toContain('write_plan')
  })

})
