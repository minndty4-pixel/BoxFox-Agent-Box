import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { useOwnerSettingsStore } from '../../store/ownerSettingsStore'
import { useSessionRecordStore } from '../../store/sessionRecordStore'
import { InstructionsTab } from './InstructionsTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUNTIME_INFO = {
  tools: ['file_read', 'terminal_exec'],
  toolGroups: [],
  limits: { instructionsChars: 12000, maxStepsDefault: 16, maxStepsMax: 60, deadlineDefaultSeconds: 180, deadlineMaxSeconds: 600, childMaxSteps: 10, childDeadlineSeconds: 120 },
}

let root: Root
let host: HTMLDivElement
const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
let stored = { instructions: 'Be brief.', revision: 4 }
let putResponse: () => Response

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

const pristineOwner = useOwnerSettingsStore.getState()

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  calls.length = 0
  stored = { instructions: 'Be brief.', revision: 4 }
  putResponse = () => json({ instructions: stored.instructions, revision: stored.revision + 1 })
  useOwnerSettingsStore.setState(pristineOwner, true)
  useSessionRecordStore.getState().reset()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url: String(url), method, body: typeof init.body === 'string' ? JSON.parse(init.body) : null })
    if (String(url).endsWith('/runtime-info')) return json(RUNTIME_INFO)
    if (method === 'PUT') {
      const response = putResponse()
      if (response.ok) {
        const body = JSON.parse(String(init.body)) as { instructions: string }
        stored = { instructions: body.instructions, revision: stored.revision + 1 }
      }
      return response
    }
    return json(stored)
  }))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
const render = async () => {
  await act(async () => {
    root.render(
      <I18nProvider>
        <InstructionsTab />
      </I18nProvider>,
    )
  })
  await flush()
}
const box = () => host.querySelector<HTMLTextAreaElement>('textarea')!
const counter = () => host.querySelector<HTMLElement>('[data-testid="settings-instructions-counter"]')
const testid = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = async (element: HTMLElement | null) => {
  expect(element, 'element to click').toBeTruthy()
  await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  await flush()
}
function type(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
const putCall = () => calls.find((call) => call.method === 'PUT')

describe('InstructionsTab', () => {
  it('keeps the box controlled: typing reaches the draft that Save will send', async () => {
    await render()
    expect(box().value).toBe('Be brief.')

    type(box(), 'Be brief. Always prove it.')

    expect(useOwnerSettingsStore.getState().draft).toBe('Be brief. Always prove it.')
    expect(box().value).toBe('Be brief. Always prove it.')
    expect(testid('settings-instructions-dirty')).toBeTruthy()
    expect(counter()?.textContent).toContain(`${'Be brief. Always prove it.'.length} / 12,000 characters`)
  })

  it('sends the draft with the revision it read, then shows the new revision', async () => {
    await render()
    type(box(), 'Be brief. Always prove it.')
    await click(testid('settings-instructions-save'))

    expect(putCall()?.url).toBe('/api/agent/owner-settings')
    expect(putCall()?.body).toEqual({ instructions: 'Be brief. Always prove it.', revision: 4 })
    expect(useOwnerSettingsStore.getState().revision).toBe(5)
    expect(testid('settings-instructions-receipt')?.textContent).toContain('revision 5')
    expect(testid('settings-instructions-dirty')).toBeFalsy()
  })

  it('keeps the draft and says NOT SAVED when the harness refuses the revision', async () => {
    putResponse = () => json({ code: 'REVISION_CONFLICT', error: 'REVISION_CONFLICT: reload owner settings' }, 409)
    await render()
    type(box(), 'Be brief. Always prove it.')
    await click(testid('settings-instructions-save'))

    expect(useOwnerSettingsStore.getState().draft).toBe('Be brief. Always prove it.')
    expect(useOwnerSettingsStore.getState().revision).toBe(4)
    expect(box().value).toBe('Be brief. Always prove it.')
    expect(testid('settings-instructions-failed')?.textContent).toBe('NOT SAVED')
    expect(testid('settings-instructions-save-failed')?.textContent).toContain('The change was not saved')
    expect(testid('settings-instructions-save-failed')?.textContent).toContain('REVISION_CONFLICT: reload owner settings')
    expect(testid('settings-instructions-retry')).toBeTruthy()
  })

  it('Reset to empty clears the box and Save then sends an empty string', async () => {
    await render()
    await click(testid('settings-instructions-reset'))
    expect(box().value).toBe('')
    expect(useOwnerSettingsStore.getState().draft).toBe('')

    await click(testid('settings-instructions-save'))
    expect(putCall()?.body).toEqual({ instructions: '', revision: 4 })
  })

  it('turns the counter amber at 11,000 and red at the cut', async () => {
    await render()
    type(box(), 'x'.repeat(10999))
    expect(counter()?.dataset.tone).toBe('ok')
    type(box(), 'x'.repeat(11000))
    expect(counter()?.dataset.tone).toBe('warn')
    expect(testid('settings-instructions-overcut')).toBeFalsy()

    type(box(), 'x'.repeat(12000))
    expect(counter()?.dataset.tone).toBe('over')
    expect(counter()?.textContent).toContain('12,000 / 12,000 characters')
    expect(testid('settings-instructions-overcut')?.textContent).toContain('Only the first 12,000 characters reach the agent')
  })

  it('inserts an example at the cursor instead of appending a fake document', async () => {
    stored = { instructions: '', revision: 0 }
    await render()
    type(box(), 'Rule one\nRule two')
    box().setSelectionRange(8, 8)
    const chip = [...host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === 'Prove it before you claim it')!
    await click(chip)

    const value = box().value
    expect(value.startsWith('Rule one\nRun the repository')).toBe(true)
    expect(value.endsWith('\nRule two')).toBe(true)
    expect(useOwnerSettingsStore.getState().draft).toBe(value)
  })

  it('stays honest when the harness never answers: load failure, no invented text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Harness engine unavailable') }))
    await render()
    expect(testid('settings-instructions-load-failed')?.textContent).toContain('Could not read the stored directives')
    expect(box().value).toBe('')
    expect(box().disabled).toBe(true)
  })

  it('reads the chat receipt from the session book and never guesses when there is none', async () => {
    await render()
    expect(testid('settings-instructions-not-recorded')?.textContent).toContain('No directive count was recorded')

    await act(async () => {
      useSessionRecordStore.getState().record('83c504cc-1111-2222-3333-444455556666', { harnessId: 'open-model-harness', instructionsChars: 521 })
    })
    expect(testid('settings-instructions-this-chat')?.textContent).toContain('83c504cc')
    expect(testid('settings-instructions-this-chat')?.textContent).toContain('521 characters')
    expect(testid('settings-instructions-in-use')).toBeTruthy()

    act(() => { useSessionRecordStore.getState().record('aaaabbbb-1111-2222-3333-444455556666', { harnessId: 'open-model-harness', instructionsChars: 0 }) })
    // Bản ghi mới nhất là bản vừa mở, và nó mang 0 ký tự chỉ dẫn thì không được gắn chip IN USE.
    expect(testid('settings-instructions-this-chat')?.textContent).toContain('aaaabbbb')
    expect(testid('settings-instructions-in-use')).toBeFalsy()
  })
})
