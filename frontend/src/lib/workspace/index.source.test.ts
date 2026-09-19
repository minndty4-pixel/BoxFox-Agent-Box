/**
 * Nguồn dữ liệu của gói workspace: mock CHỈ tồn tại ở chế độ phát triển và phải
 * được bật tường minh. Bản sản phẩm (`DEV === false`) luôn dùng sandbox thật —
 * không có dữ liệu giả trên đường chạy thật.
 */
import { describe, expect, it } from 'vitest'
import { SandboxWorkspaceRepository } from './http'
import { MockWorkspaceRepository } from './mock'
import { createWorkspaceRepository } from './index'

/** Dựng env từ `import.meta.env` rồi ghi đè vài khoá — đủ kiểu cho factory. */
function env(overrides: Partial<ImportMetaEnv> = {}): ImportMetaEnv {
  return { ...import.meta.env, DEV: true, ...overrides }
}

describe('createWorkspaceRepository — nguồn dữ liệu', () => {
  it('DEV + VITE_WORKSPACE_SOURCE=mock → mock (test/demo)', () => {
    expect(createWorkspaceRepository(env({ VITE_WORKSPACE_SOURCE: 'mock' }))).toBeInstanceOf(MockWorkspaceRepository)
  })

  it('DEV nhưng không bật nguồn mock → sandbox', () => {
    expect(createWorkspaceRepository(env())).toBeInstanceOf(SandboxWorkspaceRepository)
  })

  it('bản sản phẩm (DEV=false) KHÔNG BAO GIỜ dùng mock dù env có xin mock', () => {
    const repo = createWorkspaceRepository(env({ DEV: false, VITE_WORKSPACE_SOURCE: 'mock' }))
    expect(repo).toBeInstanceOf(SandboxWorkspaceRepository)
    expect(repo).not.toBeInstanceOf(MockWorkspaceRepository)
  })
})
