/**
 * SystemLogPanel — bảng Nhật ký hệ thống (việc 5, bản v2 — kế hoạch §3.3–§3.5).
 *
 * Bảng chỉ ĐỌC: mọi dữ liệu đến từ `GET /api/agent/system-log` qua `agentApi`.
 * Test khoá lại: dòng được vẽ đúng; bộ lọc đổi query path; nhóm lỗi theo `code`
 * kèm số lần; nút "Sao chép chẩn đoán" ghi đúng văn bản (có commit + phiên bản);
 * "chưa có tệp log" khác "không dòng nào khớp bộ lọc"; lỗi của API hiện inline;
 * và bảng tự đọc lại theo nhịp khi đang mở.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { SYSTEM_LOG_REFRESH_MS, systemLogQueryPath } from '../../hooks/useSystemLog'
import {
  SystemLogPanel,
  diagnosticsText,
  formatLogLine,
  groupErrorCodes,
} from './SystemLogPanel'
import type { SystemLogEntry, SystemLogSnapshot } from '../../hooks/useSystemLog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { agentApiMock } = vi.hoisted(() => ({ agentApiMock: vi.fn() }))
vi.mock('../../lib/agentApi', () => ({ agentApi: agentApiMock }))

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

/** Chờ các promise của lần đọc đã resolve vào state. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

/** Gõ vào ô nhập có điều khiển của React (setter gốc rồi mới phát sự kiện). */
function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = input instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function entry(overrides: Partial<SystemLogEntry> = {}): SystemLogEntry {
  return {
    ts: '2026-09-20T04:05:06.123Z',
    level: 'info',
    source: 'harness',
    event: 'turn.start',
    runId: '20260920T040506-123-0a1b',
    sessionId: 'deadbeef-1111',
    ...overrides,
  }
}

function snapshot(overrides: Partial<SystemLogSnapshot> = {}): SystemLogSnapshot {
  return {
    entries: [],
    count: 0,
    exists: true,
    file: 'harness.jsonl',
    lines: 200,
    cap: 500,
    runId: '20260920T040506-123-0a1b',
    version: '0.1.0',
    commit: '58598c1deadbeef',
    ...overrides,
  }
}

function pathsCalled(): string[] {
  return agentApiMock.mock.calls.map(([path]) => String(path))
}

beforeEach(() => {
  agentApiMock.mockReset()
  agentApiMock.mockImplementation(async () => snapshot())
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('SystemLogPanel — dòng, bộ lọc, nhóm lỗi', () => {
  it('vẽ các dòng đọc được và phần meta của lượt chạy', async () => {
    agentApiMock.mockImplementation(async () =>
      snapshot({
        entries: [
          entry(),
          entry({ level: 'error', event: 'turn.failed', code: 'UPSTREAM_UNREACHABLE', message: 'mất kết nối' }),
        ],
        count: 2,
      }),
    )
    const host = render(<SystemLogPanel />)
    await settle()

    const lines = host.querySelectorAll('[data-testid="system-log-line"]')
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).toContain('turn.start')
    expect(lines[0].textContent).toContain('deadbeef') // 8 ký tự đầu của phiên
    expect(lines[1].textContent).toContain('UPSTREAM_UNREACHABLE')
    expect(lines[1].textContent).toContain('mất kết nối')

    const meta = host.querySelector('[data-testid="system-log-meta"]')?.textContent ?? ''
    expect(meta).toContain('harness.jsonl')
    expect(meta).toContain('0.1.0')
    expect(meta).toContain('58598c1') // commit rút gọn 7 ký tự
    expect(meta).not.toContain('58598c1deadbeef')
    expect(meta).toContain('20260920T040506-123-0a1b')
    expect(pathsCalled()).toEqual(['/system-log?lines=200'])
  })

  it('bộ lọc đổi query path gửi lên harness', async () => {
    const host = render(<SystemLogPanel />)
    await settle()

    const level = host.querySelector('select[aria-label="Filter by level"]') as HTMLSelectElement
    act(() => {
      setInputValue(level, 'error')
    })
    await settle()
    expect(pathsCalled().at(-1)).toBe('/system-log?level=error&lines=200')

    const source = host.querySelector('select[aria-label="Filter by source"]') as HTMLSelectElement
    act(() => {
      setInputValue(source, 'router')
    })
    await settle()
    expect(pathsCalled().at(-1)).toBe('/system-log?level=error&source=router&lines=200')

    const session = host.querySelector('input[aria-label="Filter by session"]') as HTMLInputElement
    act(() => {
      setInputValue(session, ' deadbeef ')
    })
    await settle()
    expect(pathsCalled().at(-1)).toBe('/system-log?level=error&source=router&sessionId=deadbeef&lines=200')
  })

  it('gom lỗi theo `code` kèm số lần, xếp nhiều nhất trước', async () => {
    agentApiMock.mockImplementation(async () =>
      snapshot({
        entries: [
          entry({ level: 'error', code: 'DEADLINE' }),
          entry({ level: 'error', code: 'UPSTREAM_UNREACHABLE' }),
          entry({ level: 'error', code: 'UPSTREAM_UNREACHABLE' }),
          entry({ level: 'error', data: { errorCode: 'RATE_LIMIT' } }),
          entry({ level: 'error' }), // không mã nào → UNCLASSIFIED
          entry({ level: 'info', code: 'KHÔNG-PHẢI-LỖI' }),
          entry({ level: 'warn' }),
        ],
        count: 7,
      }),
    )
    const host = render(<SystemLogPanel />)
    await settle()

    const groups = host.querySelector('[data-testid="system-log-error-groups"]')
    expect(groups).toBeTruthy()
    expect(groups?.querySelector('[data-testid="system-log-error-code-UPSTREAM_UNREACHABLE"]')?.textContent)
      .toContain('×2')
    expect(groups?.querySelector('[data-testid="system-log-error-code-DEADLINE"]')?.textContent).toContain('×1')
    expect(groups?.querySelector('[data-testid="system-log-error-code-RATE_LIMIT"]')).toBeTruthy()
    expect(groups?.querySelector('[data-testid="system-log-error-code-UNCLASSIFIED"]')).toBeTruthy()
    expect(groups?.querySelector('[data-testid="system-log-error-code-KHÔNG-PHẢI-LỖI"]')).toBeNull()

    const chips = Array.from(groups?.querySelectorAll('[data-testid^="system-log-error-code-"]') ?? [])
    expect(chips[0].getAttribute('data-testid')).toBe('system-log-error-code-UPSTREAM_UNREACHABLE')
  })

  it('chưa có tệp log khác với không dòng nào khớp bộ lọc', async () => {
    agentApiMock.mockImplementation(async () => snapshot({ entries: [], count: 0, exists: false }))
    const missing = render(<SystemLogPanel />)
    await settle()
    expect(missing.textContent).toContain('No log file yet')
    expect(missing.textContent).toContain('NO LOG FILE YET')

    agentApiMock.mockImplementation(async () => snapshot({ entries: [], count: 0, exists: true }))
    const empty = render(<SystemLogPanel />)
    await settle()
    expect(empty.textContent).toContain('No line matches the current filter')
  })

  it('lỗi của API hiện inline và bảng vẫn đứng vững', async () => {
    agentApiMock.mockImplementation(async () => {
      throw new Error('Harness engine unavailable. Start the BoxFox launcher.')
    })
    const host = render(<SystemLogPanel />)
    await settle()

    expect(host.querySelector('[data-testid="system-log-error"]')?.textContent).toContain(
      'Harness engine unavailable',
    )
    expect(host.querySelectorAll('[data-testid="system-log-line"]')).toHaveLength(0)
  })

  it('nút Đọc lại và nhịp 2 giây đều gọi lại API', async () => {
    vi.useFakeTimers()
    const host = render(<SystemLogPanel />)
    await settle()
    expect(agentApiMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(SYSTEM_LOG_REFRESH_MS)
    })
    expect(agentApiMock).toHaveBeenCalledTimes(2)

    const reload = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Reload'),
    )
    await act(async () => {
      reload?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(agentApiMock).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })
})

describe('SystemLogPanel — sao chép chẩn đoán', () => {
  it('ghi các dòng đang xem kèm commit, phiên bản, lượt chạy và bộ lọc', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    agentApiMock.mockImplementation(async () =>
      snapshot({
        entries: [
          entry(),
          entry({ level: 'error', event: 'turn.failed', code: 'UPSTREAM_UNREACHABLE', durationMs: 1523.4 }),
        ],
        count: 2,
      }),
    )
    const host = render(<SystemLogPanel />)
    await settle()

    const copy = host.querySelector('[data-testid="system-log-copy"]') as HTMLButtonElement
    await act(async () => {
      copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    const text = String(writeText.mock.calls[0][0])
    expect(text.split('\n')[0]).toBe('# BoxFox - dev system log (harness, host-only)')
    expect(text).toContain('# version=0.1.0 commit=58598c1deadbeef run=20260920T040506-123-0a1b')
    expect(text).toContain('# filter level=all source=all session=all lines=2')
    expect(text).toContain('turn.start')
    expect(text).toContain('UPSTREAM_UNREACHABLE')
    expect(text).toContain('1523.4ms')
    expect(copy.textContent).toContain('Copied')
  })

  it('không có quyền clipboard thì báo lỗi, không làm hỏng bảng', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('denied') }) },
      configurable: true,
    })
    const host = render(<SystemLogPanel />)
    await settle()

    const copy = host.querySelector('[data-testid="system-log-copy"]') as HTMLButtonElement
    await act(async () => {
      copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(copy.textContent).toContain('Copy failed')
  })
})

describe('hàm thuần của bảng nhật ký', () => {
  it('systemLogQueryPath bỏ bộ lọc `all` và luôn gửi `lines`', () => {
    expect(systemLogQueryPath({ level: 'all', source: 'all', sessionId: '', lines: 200 })).toBe(
      '/system-log?lines=200',
    )
    expect(
      systemLogQueryPath({ level: 'warn', source: 'router', sessionId: ' dead ', lines: 50 }),
    ).toBe('/system-log?level=warn&source=router&sessionId=dead&lines=50')
  })

  it('formatLogLine có cùng dạng với `scripts/system-log.py tail`', () => {
    const line = formatLogLine(
      entry({ level: 'error', event: 'turn.failed', code: 'DEADLINE', durationMs: 12, message: 'hết hạn' }),
    )
    expect(line).toBe('04:05:06.123 ERROR turn.failed      deadbeef DEADLINE 12ms hết hạn')
  })

  it('groupErrorCodes chỉ đếm dòng lỗi và luôn có nhãn cho dòng thiếu mã', () => {
    expect(
      groupErrorCodes([
        entry({ level: 'error', code: 'B' }),
        entry({ level: 'error', code: 'A' }),
        entry({ level: 'error', code: 'B' }),
        entry({ level: 'warn', code: 'C' }),
      ]),
    ).toEqual([
      { code: 'B', count: 2 },
      { code: 'A', count: 1 },
    ])
    expect(groupErrorCodes([])).toEqual([])
  })

  it('diagnosticsText nói `unknown` khi thiếu phiên bản/commit', () => {
    const text = diagnosticsText({
      entries: [entry()],
      level: 'all',
      source: 'all',
      sessionId: '  ',
      version: null,
      commit: null,
      runId: null,
    })
    expect(text).toContain('# version=unknown commit=unknown run=unknown')
    expect(text).toContain('session=all')
  })
})
