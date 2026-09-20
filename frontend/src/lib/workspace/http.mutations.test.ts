/**
 * Thao tác GHI của `SandboxWorkspaceRepository` — năm route mới của hợp đồng §2:
 * đúng URL, đúng thân JSON, có `X-BoxFox-Api-Key`, và map đúng khoá trả về.
 */
import { describe, expect, it, vi } from 'vitest'
import { SandboxWorkspaceRepository, WorkspaceRepositoryHttpError } from './http'

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  const ok = init?.ok ?? true
  const status = init?.status ?? 200
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

const WRITE_HEADERS = { 'Content-Type': 'application/json', 'X-BoxFox-Api-Key': 'secret-key' }

describe('SandboxWorkspaceRepository — thao tác ghi', () => {
  it('mkdir POST JSON tới /__box/files/mkdir', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ path: 'src/new', type: 'directory' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await new SandboxWorkspaceRepository('http://box.test', 'secret-key').mkdir('src/new')
    expect(fetchMock).toHaveBeenCalledWith('http://box.test/__box/files/mkdir', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ path: 'src/new' }),
      signal: undefined,
    })
    expect(out).toEqual({ path: 'src/new', type: 'directory' })
  })

  it('touch POST JSON tới /__box/files/touch kèm content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ path: 'src/new.md', type: 'file', size: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await new SandboxWorkspaceRepository('http://box.test', 'secret-key').touch('src/new.md')
    expect(fetchMock).toHaveBeenCalledWith('http://box.test/__box/files/touch', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ path: 'src/new.md', content: '' }),
      signal: undefined,
    })
    expect(out).toEqual({ path: 'src/new.md', type: 'file', size: 0 })
  })

  it('rename POST JSON tới /__box/files/rename và map newPath', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ path: 'src/a.md', newPath: 'src/b.md' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await new SandboxWorkspaceRepository('http://box.test', 'secret-key').rename('src/a.md', 'b.md')
    expect(fetchMock).toHaveBeenCalledWith('http://box.test/__box/files/rename', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ path: 'src/a.md', name: 'b.md' }),
      signal: undefined,
    })
    expect(out.newPath).toBe('src/b.md')
  })

  it('move POST JSON tới /__box/files/move và map newPath', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ path: 'src/a.md', newPath: 'docs/a.md' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await new SandboxWorkspaceRepository('http://box.test', 'secret-key').move('src/a.md', 'docs')
    expect(fetchMock).toHaveBeenCalledWith('http://box.test/__box/files/move', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ path: 'src/a.md', destination: 'docs' }),
      signal: undefined,
    })
    expect(out).toEqual({ path: 'src/a.md', newPath: 'docs/a.md' })
  })

  it('deleteEntry POST JSON tới /__box/files/delete và trả trashPath', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ path: 'src/a.md', trashPath: '.trash/1758300012-a.md' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await new SandboxWorkspaceRepository('http://box.test', 'secret-key').deleteEntry('src/a.md')
    expect(fetchMock).toHaveBeenCalledWith('http://box.test/__box/files/delete', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ path: 'src/a.md' }),
      signal: undefined,
    })
    expect(out.trashPath).toBe('.trash/1758300012-a.md')
  })

  it('lỗi 409 của thao tác ghi vẫn ném WorkspaceRepositoryHttpError kèm thông báo server', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'ALREADY_EXISTS: src/new' }, { ok: false, status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new SandboxWorkspaceRepository('http://box.test', 'k').mkdir('src/new')).rejects.toMatchObject({
      status: 409,
      message: 'ALREADY_EXISTS: src/new',
    })
    await expect(new SandboxWorkspaceRepository('http://box.test', 'k').mkdir('src/new')).rejects.toBeInstanceOf(
      WorkspaceRepositoryHttpError,
    )
  })

  it('truyền AbortSignal xuống fetch của thao tác ghi', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ path: 'a', type: 'file', size: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new SandboxWorkspaceRepository('http://box.test', 'k').touch('a', 'hi', controller.signal)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: controller.signal })
  })
})
