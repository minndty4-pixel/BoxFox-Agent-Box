/**
 * Giao diện công khai của gói workspace: kiểu, adapter, factory chọn nguồn.
 *
 * Sandbox là đường chạy thật DUY NHẤT. Mock chỉ được dựng khi vừa ở chế độ phát
 * triển (`import.meta.env.DEV`) vừa được bật tường minh bằng
 * `VITE_WORKSPACE_SOURCE=mock` — bản dựng sản phẩm không bao giờ chạm tới nhánh
 * này, nên không có dữ liệu giả trên đường chạy thật.
 */
import { resolveBoxApiKey, resolveBoxApiUrl } from '../boxApi'
import { SandboxWorkspaceRepository } from './http'
import { MockWorkspaceRepository } from './mock'
import type { WorkspaceRepository } from './types'

export * from './types'
export { WorkspaceRepositoryHttpError } from './http'

export type { PreviewKind } from './languages'
export { extOf, languageForExt, previewKindFor } from './languages'

export type { LineTokens, Token, TokenKind } from './tokenizer'
export { byLine, tokenize } from './tokenizer'

export * from './tree'

export type WorkspaceSource = 'sandbox' | 'mock'

/**
 * Sandbox mặc định. Mock CHỈ khi `import.meta.env.DEV` và
 * `VITE_WORKSPACE_SOURCE=mock` — bản sản phẩm luôn dùng sandbox thật.
 */
export function createWorkspaceRepository(env: ImportMetaEnv = import.meta.env): WorkspaceRepository {
  const source = env.VITE_WORKSPACE_SOURCE?.trim().toLowerCase()
  if (env.DEV && source === 'mock') return new MockWorkspaceRepository()
  return new SandboxWorkspaceRepository(resolveBoxApiUrl(env), resolveBoxApiKey(env))
}
