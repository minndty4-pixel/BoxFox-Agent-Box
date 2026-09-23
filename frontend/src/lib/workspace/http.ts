/**
 * Adapter HTTP cho endpoint file workspace của ide-proxy (`/__box/files...`).
 *
 * Mọi endpoint ĐIỀU KHIỂN (`upload`, `unzip`, `mkdir`, `touch`, `rename`, `move`,
 * `delete`) gửi `X-BoxFox-Api-Key` vì trình duyệt không gửi Origin cho
 * cross-origin write một cách tin cậy được; endpoint đọc (`list`, `readText`,
 * `zip`) vẫn qua `fetch` thường. Các URL media/thumbnail/download KHÔNG kèm auth
 * — chúng là subresource.
 */
import type {
  WorkspaceContent,
  WorkspaceDeleteResult,
  WorkspaceListing,
  WorkspaceMkdirResult,
  WorkspaceMoveResult,
  WorkspaceRepository,
  WorkspaceTouchResult,
  WorkspaceUploadOptions,
  WorkspaceUploadResult,
} from './types'

export class WorkspaceRepositoryHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceRepositoryHttpError'
  }
}

export class SandboxWorkspaceRepository implements WorkspaceRepository {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async list(path: string, signal?: AbortSignal): Promise<WorkspaceListing> {
    return requestJson<WorkspaceListing>(`${this.baseUrl}/__box/files?path=${encodeURIComponent(path)}`, signal)
  }

  async readText(path: string, signal?: AbortSignal): Promise<WorkspaceContent> {
    return requestJson<WorkspaceContent>(
      `${this.baseUrl}/__box/file/content?path=${encodeURIComponent(path)}`,
      signal,
    )
  }

  mediaUrl(path: string): string {
    return `${this.baseUrl}/__box/file/media?path=${encodeURIComponent(path)}`
  }

  thumbnailUrl(path: string): string {
    return `${this.baseUrl}/__box/file/thumbnail?path=${encodeURIComponent(path)}`
  }

  downloadUrl(path: string): string {
    return `${this.baseUrl}/__box/file/download?path=${encodeURIComponent(path)}`
  }

  async zip(paths: string[], signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/__box/files/zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
      signal,
    })
    await ensureOk(response)
    return response.blob()
  }

  async upload(
    targetDir: string,
    filename: string,
    body: Blob,
    options: WorkspaceUploadOptions = {},
  ): Promise<WorkspaceUploadResult> {
    // `assign`/`mkdirs` là cờ bật/tắt của hợp đồng: chỉ gửi khi cần, để request của panel
    // Workspace Files giữ nguyên hình dạng cũ (xem `http.test.ts`).
    const query = [
      `path=${encodeURIComponent(targetDir)}`,
      `name=${encodeURIComponent(filename)}`,
      ...(options.assignNumber ? ['assign=1'] : []),
      ...(options.mkdirs ? ['mkdirs=1'] : []),
    ].join('&')
    const response = await fetch(`${this.baseUrl}/__box/file/upload?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-BoxFox-Api-Key': this.apiKey },
      body,
      signal: options.signal,
    })
    await ensureOk(response)
    return (await response.json()) as WorkspaceUploadResult
  }

  async unzip(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ extracted: number; skipped: number; warnings: string[] }> {
    const response = await fetch(`${this.baseUrl}/__box/file/unzip?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'X-BoxFox-Api-Key': this.apiKey },
      signal,
    })
    await ensureOk(response)
    return (await response.json()) as { extracted: number; skipped: number; warnings: string[] }
  }

  async mkdir(path: string, signal?: AbortSignal): Promise<WorkspaceMkdirResult> {
    return this.postJson<WorkspaceMkdirResult>('/__box/files/mkdir', { path }, signal)
  }

  async touch(path: string, content = '', signal?: AbortSignal): Promise<WorkspaceTouchResult> {
    return this.postJson<WorkspaceTouchResult>('/__box/files/touch', { path, content }, signal)
  }

  async rename(path: string, name: string, signal?: AbortSignal): Promise<WorkspaceMoveResult> {
    return this.postJson<WorkspaceMoveResult>('/__box/files/rename', { path, name }, signal)
  }

  async move(path: string, destination: string, signal?: AbortSignal): Promise<WorkspaceMoveResult> {
    return this.postJson<WorkspaceMoveResult>('/__box/files/move', { path, destination }, signal)
  }

  async deleteEntry(path: string, signal?: AbortSignal): Promise<WorkspaceDeleteResult> {
    return this.postJson<WorkspaceDeleteResult>('/__box/files/delete', { path }, signal)
  }

  /**
   * POST JSON tới một route ghi của container: luôn kèm `X-BoxFox-Api-Key`
   * (hợp đồng §0.4 — thiếu khoá là 401). Lỗi vẫn ném
   * `WorkspaceRepositoryHttpError` kèm thông báo `{"error": "..."}` của server.
   */
  private async postJson<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BoxFox-Api-Key': this.apiKey },
      body: JSON.stringify(body),
      signal,
    })
    await ensureOk(response)
    return (await response.json()) as T
  }
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  await ensureOk(response)
  return (await response.json()) as T
}

/** Lỗi có dạng `{"error":"..."}` — rút thông báo; không phải JSON thì giữ mặc định. */
async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  let message = `Workspace request failed (${response.status}).`
  try {
    const payload = (await response.json()) as { error?: string }
    if (payload && typeof payload.error === 'string') message = payload.error
  } catch {
    // nội dung không phải JSON — giữ thông báo mặc định
  }
  throw new WorkspaceRepositoryHttpError(response.status, message)
}
