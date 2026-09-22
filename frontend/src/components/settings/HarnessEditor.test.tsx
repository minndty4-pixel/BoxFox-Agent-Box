import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { HarnessEditor } from './HarnessEditor'
import { useHarnessStore } from '../../store/harnessStore'
import { useProviderStore } from '../../store/providerStore'
import { useRuntimeInfoStore } from '../../store/runtimeInfoStore'
import { useUiStore } from '../../store/uiStore'
import { isRoutableModel } from '../../lib/harnessRoles'
import type { ProviderConnection, ProviderSnapshot } from '../../types/provider'

/**
 * HarnessEditor — những con số và danh sách phải là dữ liệu thật:
 *  • `Steps per turn` / `Turn deadline` in đúng khoảng và mặc định của engine, kèm câu
 *    về trần của specialist con; lưu thì bị kẹp theo trần thật (không lưu 900 bước).
 *  • `Tool access` đếm theo registry, nhóm `Questions & approvals` luôn bật, và chỉ
 *    được lấy công cụ đi chứ không thêm được.
 *  • `Retries` đọc số của engine và không sửa được ở đây.
 *  • `Model` chỉ đưa ra giá trị định tuyến `model:<connectionId>:<modelId>` lấy từ
 *    catalogue sống; tên hiển thị trần (dạng select cũ lưu) bị router trả
 *    `404 MODEL_NOT_FOUND` — đo sống với `deepseek-v4-pro` và `Claude 3.7 Sonnet`.
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUNTIME_INFO = {
  toolGroups: [
    { key: 'repositoryReading', tools: ['file_read', 'codebase_glob', 'codebase_grep'], alwaysOn: false },
    { key: 'skills', tools: ['skills_list', 'skill_view'], alwaysOn: false },
    { key: 'filesTerminal', tools: ['file_write', 'file_edit_block', 'terminal_exec'], alwaysOn: false },
    { key: 'screenBrowser', tools: ['computer_screen_capture', 'computer_screen_record', 'computer_use', 'browser_use', 'inspect_element'], alwaysOn: false },
    { key: 'webResearch', tools: ['web_search', 'web_fetch'], alwaysOn: false },
    { key: 'delegationPlans', tools: ['delegate_task', 'session_search', 'write_plan'], alwaysOn: false },
    { key: 'questionsApprovals', tools: ['ask_user', 'request_approval'], alwaysOn: true },
  ],
  tools: ['ask_user', 'browser_use', 'codebase_glob', 'codebase_grep', 'computer_screen_capture', 'computer_screen_record', 'computer_use', 'delegate_task', 'file_edit_block', 'file_read', 'file_write', 'inspect_element', 'request_approval', 'session_search', 'skill_view', 'skills_list', 'terminal_exec', 'web_fetch', 'web_search', 'write_plan'],
  roles: [{ id: 'explore', name: 'Explore', tools: ['file_read'], skills: [] }],
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

const CONNECTION: ProviderConnection = {
  id: 'c1', providerId: 'anthropic', name: 'TokenHarbor', endpoint: 'https://tokenharbor.ai/v1',
  email: null, accountLabel: null, projectId: null, revision: 1, enabled: true, credentialPresent: true,
  authState: 'ready', projectState: 'not_applicable', discoveryState: 'ready', inferenceState: 'ready',
  lastTestedAt: null, lastDiscoveryAttemptAt: null, error: null, quota: null,
  models: [{
    id: 'm1', name: 'Model One', enabled: true, source: 'live', stale: false,
    health: 'ready', probeStatus: 'passed',
    capabilities: { streaming: 'reported', tools: 'reported', vision: 'unknown' },
  }],
}

const SNAPSHOT: ProviderSnapshot = {
  providers: [], connections: [CONNECTION],
  // Alias cũng là một dạng định tuyến thật của router, nên nó phải có mặt trong danh sách.
  aliases: [{ id: 'a1', name: 'Cheap first', strategy: 'fallback', targets: [{ connectionId: 'c1', modelId: 'm1' }], enabled: true }],
  keys: [], usage: [],
  defaultRoute: { connectionId: null, modelId: null, aliasId: null },
  health: { status: 'ok', version: 'test' },
}

const OPEN_MODEL_HARNESS = 'open-model-harness'
const COPY_HARNESS = 'open-model-harness-copy-1'

const pristine = useHarnessStore.getState()

let root: Root
let host: HTMLDivElement
let routerState: () => Promise<Response>

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useHarnessStore.setState(pristine)
  useProviderStore.setState({ snapshot: SNAPSHOT, loading: false, busy: false, error: null })
  useRuntimeInfoStore.setState({ info: null, status: 'idle', error: null })
  useUiStore.setState({ editingHarnessId: null, isSettingsOpen: true, autoOpenTabs: false, autoOpenOnlyWhenIdle: false })
  routerState = async () => json(SNAPSHOT)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/runtime-info')) return json(RUNTIME_INFO)
    if (String(url).includes('/api/router/state')) return routerState()
    return json({})
  }))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render(harnessId: string) {
  await act(async () => {
    root.render(
      <I18nProvider>
        <HarnessEditor harnessId={harnessId} />
      </I18nProvider>
    )
  })
}

const stored = (id: string) => useHarnessStore.getState().harnesses.find((h) => h.id === id)!

function field<T extends HTMLElement>(id: string): T {
  const element = host.querySelector<T>(`#${id}`)
  expect(element, `#${id} phải có trên màn hình`).toBeTruthy()
  return element!
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setChecked(checkbox: HTMLInputElement, checked: boolean) {
  // `click()` của jsdom tự lật `checked` rồi phát sự kiện — React đọc giá trị mới đó.
  if (checkbox.checked !== checked) {
    act(() => {
      checkbox.click()
    })
  }
}

function clickButton(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  expect(button, `nút "${label}" phải có trên màn hình`).toBeTruthy()
  act(() => {
    button!.click()
  })
}

/** Card theo tiêu đề, để khẳng định đúng khối nào có gì. */
function card(title: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>('section')].find(
    (section) => section.querySelector('h2')?.textContent === title
  )
  expect(found, `card "${title}" phải có trên màn hình`).toBeTruthy()
  return found!
}

describe('HarnessEditor — model chọn từ catalogue sống', () => {
  it('chỉ đưa ra giá trị định tuyến, và tên hiển thị trần thì bị store kẹp về default', async () => {
    await render(COPY_HARNESS)

    const select = field<HTMLSelectElement>('harness-main-model')
    const values = [...select.options].map((option) => option.value)
    expect(values).toContain('model:c1:m1')
    expect(values).toContain('alias:a1')
    for (const value of values) expect(isRoutableModel(value), `${value} phải định tuyến được`).toBe(true)

    choose(select, 'model:c1:m1')
    clickButton('Save changes')
    expect(stored(COPY_HARNESS).mainModel).toBe('model:c1:m1')
    expect(field<HTMLSelectElement>('harness-main-model').value).toBe('model:c1:m1')

    // Đỏ đã đo sống: gửi `model: "Claude 3.7 Sonnet"` (đúng dạng select cũ lưu) cho router
    // → HTTP 404 {"error":{"code":"MODEL_NOT_FOUND", ...}}. Store vì thế kẹp mọi giá trị
    // không định tuyến được về 'default' thay vì lưu một lời hứa router không chạy được.
    const copy = stored(COPY_HARNESS)
    act(() => {
      useHarnessStore.getState().saveHarness({ ...copy, mainModel: 'Claude 3.7 Sonnet' })
    })
    expect(stored(COPY_HARNESS).mainModel).toBe('default')
  })

  it('catalogue chưa nạp thì khoá select và nói rõ lý do, không rơi về danh sách tĩnh', async () => {
    routerState = () => new Promise<Response>(() => {})
    useProviderStore.setState({ snapshot: null, loading: true, error: null })

    await render(COPY_HARNESS)

    const select = field<HTMLSelectElement>('harness-main-model')
    expect(select.disabled).toBe(true)
    expect(host.textContent).toContain('has not loaded yet, so the picker is disabled instead of falling back to a static list')
    // Danh sách tĩnh cũ có tên hiển thị không định tuyến được — chúng không được xuất hiện.
    expect(host.textContent).not.toContain('DeepSeek V4 Pro (Global) 1M High')
  })
})

describe('HarnessEditor — turn limits', () => {
  it('in khoảng thật, mặc định của engine và câu về trần của specialist con', async () => {
    await render(COPY_HARNESS)

    expect(host.textContent).toContain('allowed 1 – 60 · engine default 16')
    expect(host.textContent).toContain('allowed 5 – 600 · engine default 180')
    expect(host.textContent).toContain('the smaller of 10 steps and this number, and the smaller of 120 s and this deadline')
    expect(host.textContent).toContain('Raising the deadline above 180 s also raises how long a decision request can hold a turn')
  })

  it('kẹp giá trị theo trần thật khi lưu và đọc lại đúng số đã lưu', async () => {
    await render(COPY_HARNESS)

    type(field<HTMLInputElement>('harness-max-steps'), '900')
    type(field<HTMLInputElement>('harness-deadline'), '900')
    clickButton('Save changes')

    expect(stored(COPY_HARNESS).maxSteps).toBe(60)
    expect(stored(COPY_HARNESS).deadlineSeconds).toBe(600)
    expect(field<HTMLInputElement>('harness-max-steps').value).toBe('60')
    expect(field<HTMLInputElement>('harness-deadline').value).toBe('600')

    // Xoá ô trống ⇒ không lưu trường nào, engine tự quyết.
    type(field<HTMLInputElement>('harness-max-steps'), '')
    clickButton('Save changes')
    expect(stored(COPY_HARNESS).maxSteps).toBeUndefined()
  })
})

describe('HarnessEditor — tool access', () => {
  it('đếm theo registry, lấy công cụ đi được, nhóm luôn bật không tắt được', async () => {
    await render(COPY_HARNESS)

    expect(host.textContent).toContain('20 of 20 tools on · nothing narrowed')
    expect(host.textContent).toContain('Repository reading')
    expect(host.textContent).toContain('file_read · codebase_glob · codebase_grep')
    expect(host.textContent).toContain('You can only take tools away')

    const alwaysOn = field<HTMLInputElement>('tool-group-questionsApprovals')
    expect(alwaysOn.disabled).toBe(true)
    expect(alwaysOn.checked).toBe(true)

    setChecked(field<HTMLInputElement>('tool-group-webResearch'), false)
    expect(host.textContent).toContain('18 of 20 tools on')
    clickButton('Save changes')
    expect(stored(COPY_HARNESS).tools).toEqual(
      RUNTIME_INFO.tools.filter((tool) => tool !== 'web_search' && tool !== 'web_fetch')
    )
  })

})

describe('HarnessEditor — retries', () => {
  it('in số của engine và không có ô nào sửa được', async () => {
    await render(COPY_HARNESS)

    const retries = card('Retries')
    expect(retries.textContent).toContain('Engine-wide')
    expect(retries.textContent).toContain('Retries after the first call')
    expect(retries.textContent).toContain('3')
    expect(retries.textContent).toContain('Ceiling for a rate limit')
    expect(retries.textContent).toContain('30 s')
    expect(retries.textContent).toContain('Budget per turn')
    expect(retries.textContent).toContain('60 s')
    expect(retries.textContent).toContain('1 s → 4 s → 12 s')
    expect(retries.textContent).toContain('±20% jitter')
    expect(retries.querySelectorAll('input, select, textarea')).toHaveLength(0)
  })
})

describe('HarnessEditor — built-in là read-only', () => {
  it('khoá đúng ô, mang theo câu giải thích, không có nút lưu và công tắc toàn cục vẫn sống', async () => {
    await render(OPEN_MODEL_HARNESS)

    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Save changes')).toBe(false)
    expect(host.textContent).toContain('This harness is part of the product, so it cannot be edited here')
    expect(host.textContent).toContain('Built-in harnesses are read-only. Duplicate and edit.')
    expect(host.textContent).toContain('Engine defaults')
    expect(host.textContent).toContain('16 of 60 allowed')
    expect(host.textContent).toContain('180 of 600 allowed')
    expect(host.textContent).toContain('READ-ONLY')

    for (const id of ['harness-name', 'harness-description', 'harness-main-model']) {
      const control = field<HTMLInputElement>(id)
      expect(control.disabled, `#${id} phải bị khoá`).toBe(true)
      expect(control.title).toBe('Built-in harnesses are read-only. Duplicate and edit.')
      expect(control.getAttribute('aria-describedby')).toBe('builtin-locked-reason')
    }
    // Bậc thinking và hai con số là dòng chữ khoá, cũng mang theo câu giải thích.
    const lockedRows = [...host.querySelectorAll<HTMLElement>('[title="Built-in harnesses are read-only. Duplicate and edit."]')]
    expect(lockedRows.length).toBeGreaterThanOrEqual(5)
    for (const row of lockedRows) expect(row.getAttribute('aria-describedby')).toBe('builtin-locked-reason')
    expect(card('Thinking level').textContent).toContain('Auto — let the provider decide')

    // Câu trong `aria-describedby` phải là chữ thật trên màn hình, không phải một id rỗng.
    expect(host.querySelector('#builtin-locked-reason')?.textContent).toBe(
      'Built-in harnesses are read-only. Duplicate and edit.'
    )

    // Không có ô tick công cụ nào trong màn read-only.
    expect(card('Tool access').querySelectorAll('input')).toHaveLength(0)

    // Công tắc auto-open là của app, không thuộc record: vẫn bấm được.
    const autoOpen = [...host.querySelectorAll<HTMLElement>('section')].at(-1)!
    const toggleLabels = autoOpen.querySelectorAll<HTMLElement>('label')
    expect(toggleLabels.length).toBeGreaterThan(0)
    act(() => {
      toggleLabels[0].click()
    })
    expect(useUiStore.getState().autoOpenTabs).toBe(true)
  })
})

describe('HarnessEditor — nhân bản ngay từ màn chỉ-đọc', () => {
  it('ở lại màn chỉ-đọc thì biên nhận nằm trên banner và nói rõ bản sao chưa nắm quyền', async () => {
    await render(OPEN_MODEL_HARNESS)

    clickButton('Duplicate and edit')
    setChecked(field<HTMLInputElement>('open-copy-in-editor'), false)
    clickButton('Duplicate')

    const copy = useHarnessStore.getState().harnesses.at(-1)!
    expect(copy.duplicatedFrom).toEqual({ id: OPEN_MODEL_HARNESS, name: 'Open Model Harness' })
    expect(stored(OPEN_MODEL_HARNESS).mainModel).toBe('default')

    const receipt = field<HTMLElement>('harness-receipt')
    expect(receipt.getAttribute('role')).toBe('status')
    expect(receipt.textContent).toContain(`${copy.name} created · built-in untouched`)
    expect(receipt.textContent).toContain('marked NEW')
    expect(receipt.textContent).toContain('not in charge of any chat until you pick it there')
    // Vị trí thật của bản sao trong danh sách (store thêm vào cuối) — biên nhận không được hứa khác.
    expect(receipt.textContent).toContain('at the end of the Harness list')
    // Biên nhận phải đứng trước khối đầu tiên: ở cuối một trang dài thì người vừa bấm không thấy nó.
    expect(
      receipt.compareDocumentPosition(card('Identity')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    // Bản sao mới không tự thành harness đang dùng, và editor không đi đâu cả: test này render
    // thẳng component nên chỗ đứng của nó là `editingHarnessId` đang không được đặt (null).
    expect(useHarnessStore.getState().activeHarnessId).not.toBe(copy.id)
    expect(useUiStore.getState().editingHarnessId).toBeNull()
  })

  it('tick `Open the copy in the editor` thì chuyển thẳng sang editor của bản sao', async () => {
    await render(OPEN_MODEL_HARNESS)

    clickButton('Duplicate and edit')
    expect(field<HTMLInputElement>('open-copy-in-editor').checked).toBe(true)
    clickButton('Duplicate')

    const copy = useHarnessStore.getState().harnesses.at(-1)!
    expect(useUiStore.getState().editingHarnessId).toBe(copy.id)
  })
})
