import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessList } from './HarnessList'
import { useHarnessStore } from '../../store/harnessStore'
import { useRuntimeInfoStore } from '../../store/runtimeInfoStore'
import { useUiStore } from '../../store/uiStore'

/**
 * HarnessList — danh sách phải nói thật:
 *  • hai ô chọn `Team Default` / `My Default` ghi vào `boxfox_harness_v0` mà không ai
 *    đọc lại, và sản phẩm không có "team" nào ⇒ thay bằng MỘT ô chọn ghi thẳng
 *    `activeHarnessId` (đúng thứ composer dùng);
 *  • mỗi dòng có một câu tóm tắt dựng từ trường thật của record, và vì store reset
 *    mọi built-in về cùng một trạng thái nên các câu đó buộc phải giống nhau;
 *  • built-in mở màn read-only với đúng MỘT hành động `Duplicate and edit` (cặp
 *    eye/pencil cũ mở thẳng editor và sửa được cả harness của sản phẩm);
 *  • xoá built-in thì bị từ chối kèm lý do; xoá bản sao thì hỏi lại một lần.
 *
 * Render qua raw `createRoot` + `act` — dự án không dùng @testing-library.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUNTIME_INFO = {
  toolGroups: [{ key: 'questionsApprovals', tools: ['ask_user', 'request_approval'], alwaysOn: true }],
  tools: ['ask_user', 'browser_use', 'codebase_glob', 'codebase_grep', 'computer_screen_capture', 'computer_screen_record', 'computer_use', 'delegate_task', 'file_edit_block', 'file_read', 'file_write', 'inspect_element', 'request_approval', 'session_search', 'skill_view', 'skills_list', 'terminal_exec', 'web_fetch', 'web_search', 'write_plan'],
  roles: ['explore', 'plan', 'design', 'build', 'debug', 'review', 'simplify', 'testing', 'research'].map((id) => ({ id, name: id, tools: ['file_read'], skills: [] })),
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

const BUILT_IN = 'open-model-harness'
const pristine = useHarnessStore.getState()

let root: Root
let host: HTMLDivElement

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useHarnessStore.setState(pristine)
  useRuntimeInfoStore.setState({ info: null, status: 'idle', error: null })
  useUiStore.setState({ editingHarnessId: null, isSettingsOpen: true })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/runtime-info')) return json(RUNTIME_INFO)
    return json({})
  }))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

/** Danh sách nằm sau nút `List View`; mặc định màn mở ở chế độ sơ đồ. */
async function render() {
  await act(async () => {
    root.render(<HarnessList />)
  })
  clickText('List View')
}

function button(match: (button: HTMLButtonElement) => boolean): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(match)
  expect(found, 'nút phải có trên màn hình').toBeTruthy()
  return found!
}

function clickText(label: string) {
  const found = button((candidate) => candidate.textContent?.trim() === label)
  act(() => {
    found.click()
  })
}

function click(element: HTMLElement) {
  act(() => {
    element.click()
  })
}

const byLabel = (label: string) => button((candidate) => candidate.getAttribute('aria-label') === label)

/** Dòng của đúng harness đó — tên là nút mở màn hình, cha gần nhất có `px-4` là cả dòng. */
function rowFor(name: string): HTMLElement {
  const nameButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === name && candidate.title !== ''
  )
  expect(nameButton, `dòng "${name}" phải có trên màn hình`).toBeTruthy()
  return nameButton!.closest<HTMLElement>('div.px-4')!
}

function buttonIn(scope: HTMLElement, match: (button: HTMLButtonElement) => boolean): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(match)
  expect(found, 'nút phải có trong dòng').toBeTruthy()
  return found!
}

const harness = (id: string) => useHarnessStore.getState().harnesses.find((h) => h.id === id)

function setSearch(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Search harnesses..."]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function typeInto(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('HarnessList — một ô chọn mặc định thật', () => {
  it('ghi thẳng activeHarnessId và không còn Team/My Default', async () => {
    await render()

    expect(host.textContent).not.toContain('Team Default')
    expect(host.textContent).not.toContain('My Default')
    expect(host.textContent).toContain('Default harness for new sessions')
    expect(host.textContent).toContain('A chat that is already open keeps the harness it started with')

    const select = host.querySelector<HTMLSelectElement>('#default-harness')!
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => {
      setter.call(select, BUILT_IN)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(useHarnessStore.getState().activeHarnessId).toBe(BUILT_IN)
    expect(useHarnessStore.getState().activeType).toBe('harness')
    // Giá trị mặc định cũ (teamDefaultId/myDefaultId) không bị luồng này ghi vào nữa.
    expect(useHarnessStore.getState().teamDefaultId).toBe(pristine.teamDefaultId)
  })
})

describe('HarnessList — câu tóm tắt theo dữ liệu thật', () => {
  it('in ra đúng thứ đang lưu, kể cả khi mọi built-in trùng nhau', async () => {
    await render()

    const summary =
      'Changes nothing yet: router default model · 9 of 9 specialists on · 0 carry an appended prompt · ' +
      '20 of 20 tools · 16 steps (engine default) · 180 s (engine default)'
    const matches = host.textContent!.split(summary).length - 1
    expect(matches).toBeGreaterThanOrEqual(4)

    // Bản sao có prompt riêng thì câu tóm tắt khác đi — và đó cũng là sự thật của record.
    expect(host.textContent).toContain('2 carry an appended prompt')

    // Dòng built-in nào cũng giống nhau: giao diện phải nói rõ đó là dữ liệu, không phải lỗi hiển thị.
    expect(host.textContent).toContain(
      'Every built-in harness is stored with the same settings right now, so their summary lines read the same'
    )
    expect(host.textContent).toContain('not a copy-paste bug')
    expect(host.textContent).toContain('20 tools · 9 roles')
  })
})

describe('HarnessList — built-in mở read-only', () => {
  it('một hành động duy nhất và tên mở màn read-only', async () => {
    await render()

    const row = rowFor('Open Model Harness')
    click(buttonIn(row, (candidate) => candidate.getAttribute('title') === 'Open the read-only screen'))
    expect(useUiStore.getState().editingHarnessId).toBe(BUILT_IN)

    click(buttonIn(row, (candidate) => candidate.textContent?.trim() === 'Duplicate and edit'))
    expect(host.textContent).toContain('Duplicate harness')
    clickText('Cancel')

    // Icon "con mắt" đã bỏ hẳn: nó mở thẳng editor sửa được cả harness của sản phẩm.
    expect(host.querySelectorAll('button[title="View details"]')).toHaveLength(0)
    expect([...row.querySelectorAll('button')].map((candidate) => candidate.textContent?.trim() || candidate.title)).toEqual([
      'Open Model Harness',
      'Duplicate and edit',
      'Delete harness',
    ])
  })
})

describe('HarnessList — xoá', () => {
  it('built-in bị từ chối kèm lý do và vẫn còn nguyên', async () => {
    await render()

    click(byLabel('Delete Open Model Harness'))

    expect(host.textContent).toContain('Built-in harnesses cannot be deleted')
    expect(host.textContent).toContain('Duplicate this one to get a copy you can change or remove')
    expect(harness(BUILT_IN)).toBeTruthy()
  })

  it('bản sao hỏi lại một lần, nói rõ không hoàn tác được và không đụng bản gốc', async () => {
    await render()
    // Bản sao trong seed không có `duplicatedFrom`; tạo một bản sao thật từ built-in.
    let clonedId = ''
    act(() => {
      clonedId = useHarnessStore.getState().cloneHarness(BUILT_IN)
    })

    click(byLabel(`Delete ${harness(clonedId)!.name}`))

    expect(host.textContent).toContain('Delete harness?')
    expect(host.textContent).toContain('There is no undo.')
    expect(host.textContent).toContain('The built-in it came from is not affected.')

    clickText('Delete')
    expect(harness(clonedId)).toBeUndefined()
    expect(harness(BUILT_IN)).toBeTruthy()
  })
})

describe('HarnessList — nhân bản', () => {
  it('gợi ý tên chưa bị chiếm, cảnh báo trùng tên, và bản sao nhớ bản gốc', async () => {
    await render()

    const row = rowFor('Open Model Harness')
    click(buttonIn(row, (candidate) => candidate.textContent?.trim() === 'Duplicate and edit'))
    const nameField = host.querySelector<HTMLInputElement>('#copy-name')!
    // Seed đã có "(Copy)" và "(Copy)1" ⇒ số kế tiếp phải là 2.
    expect(nameField.value).toBe('Open Model Harness (Copy) 2')
    expect(host.textContent).toContain('Open Model Harness · built-in')
    expect(host.querySelector<HTMLInputElement>('#open-copy-in-editor')!.checked).toBe(true)

    typeInto(nameField, 'Open Model Harness (Copy)')
    expect(host.textContent).toContain('A copy with that name already exists')
    expect(host.textContent).toContain('It will be saved as Open Model Harness (Copy) 2.')

    clickText('Duplicate')

    const copy = useHarnessStore.getState().harnesses.at(-1)!
    expect(copy.name).toBe('Open Model Harness (Copy) 2')
    expect(copy.duplicatedFrom).toEqual({ id: BUILT_IN, name: 'Open Model Harness' })
    expect(copy.isBuiltIn).toBe(false)
    expect(host.textContent).toContain('Open Model Harness (Copy) 2 created · built-in untouched')
    expect(host.textContent).toContain('NEW')
    expect(host.textContent).toContain('Duplicate of Open Model Harness (built-in)')
    expect(useUiStore.getState().editingHarnessId).toBe(copy.id)
    // Bản gốc không bị đụng tới.
    expect(harness(BUILT_IN)!.mainModel).toBe('default')
    expect(harness(BUILT_IN)!.duplicatedFrom).toBeUndefined()
  })
})

describe('HarnessList — trạng thái rỗng duy nhất', () => {
  it('chỉ khi bộ lọc không khớp gì, và nút Clear search trả lại danh sách', async () => {
    await render()

    setSearch('không có harness nào tên thế này')
    expect(host.textContent).toContain('No harnesses found matching your search.')
    clickText('Clear search')
    expect(host.textContent).toContain('Open Model Harness')
  })

  it('tìm kiếm chỉ khớp tên và mô tả, không khớp câu tóm tắt', async () => {
    await render()

    setSearch('20 of 20 tools')
    expect(host.textContent).toContain('No harnesses found matching your search.')
    expect(host.textContent).not.toContain('Changes nothing yet')
  })
})
