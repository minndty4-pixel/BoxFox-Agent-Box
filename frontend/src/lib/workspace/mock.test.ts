/**
 * Thao tác ghi trên `MockWorkspaceRepository`: chúng phải SỬA THẬT cây trong bộ
 * nhớ (để hook/test thấy kết quả sau khi nạp lại) và trả đúng khoá của hợp đồng.
 */
import { describe, expect, it } from 'vitest'
import { MockWorkspaceRepository } from './mock'

async function names(repo: MockWorkspaceRepository, path = ''): Promise<string[]> {
  const listing = await repo.list(path)
  return listing.entries.map((e) => e.name)
}

describe('MockWorkspaceRepository — thao tác ghi', () => {
  it('mkdir tạo thư mục thật và trả {path, type}', async () => {
    const repo = new MockWorkspaceRepository()
    const out = await repo.mkdir('notes')
    expect(out).toEqual({ path: 'notes', type: 'directory' })
    expect(await names(repo)).toContain('notes')
  })

  it('mkdir trong thư mục con rồi list thấy mục mới', async () => {
    const repo = new MockWorkspaceRepository()
    await repo.mkdir('src/nested')
    expect(await names(repo, 'src')).toEqual(['nested', 'auth.py', 'parser.py'])
  })

  it('touch tạo file rỗng với size đúng và trả type "file"', async () => {
    const repo = new MockWorkspaceRepository()
    const out = await repo.touch('src/notes.md')
    expect(out).toEqual({ path: 'src/notes.md', type: 'file', size: 0 })
    expect(await names(repo, 'src')).toContain('notes.md')
  })

  it('mkdir/touch trùng tên thì ném lỗi (409 của container)', async () => {
    const repo = new MockWorkspaceRepository()
    await expect(repo.mkdir('docs')).rejects.toThrow(/đã tồn tại/)
    await expect(repo.touch('plan.md')).rejects.toThrow(/đã tồn tại/)
  })

  it('rename đổi tên tại chỗ và cập nhật cả đường dẫn của hậu duệ', async () => {
    const repo = new MockWorkspaceRepository()
    const out = await repo.rename('src', 'source')
    expect(out).toEqual({ path: 'src', newPath: 'source' })
    expect(await names(repo)).toContain('source')
    expect(await names(repo)).not.toContain('src')
    expect(await names(repo, 'source')).toEqual(['auth.py', 'parser.py'])
  })

  it('rename từ chối tên chứa "/" hoặc rỗng', async () => {
    const repo = new MockWorkspaceRepository()
    await expect(repo.rename('plan.md', 'a/b.md')).rejects.toThrow(/tên không hợp lệ/)
    await expect(repo.rename('plan.md', '   ')).rejects.toThrow(/tên không hợp lệ/)
  })

  it('move chuyển entry sang thư mục khác và trả newPath', async () => {
    const repo = new MockWorkspaceRepository()
    const out = await repo.move('plan.md', 'docs')
    expect(out).toEqual({ path: 'plan.md', newPath: 'docs/plan.md' })
    expect(await names(repo)).not.toContain('plan.md')
    expect(await names(repo, 'docs')).toContain('plan.md')
  })

  it('move về gốc workspace (destination rỗng)', async () => {
    const repo = new MockWorkspaceRepository()
    const out = await repo.move('docs', '')
    expect(out.newPath).toBe('docs')
  })

  it('move từ chối đích không phải thư mục và không cho chuyển vào chính nó', async () => {
    const repo = new MockWorkspaceRepository()
    await expect(repo.move('plan.md', '.env')).rejects.toThrow(/đích không tồn tại/)
    await expect(repo.move('plan.md', 'plan.md')).rejects.toThrow(/chính nó/)
    await expect(repo.move('src', 'src/nested')).rejects.toThrow(/chính nó/)
  })

  it('deleteEntry bỏ khỏi cây và trả trashPath trong .trash', async () => {
    const repo = new MockWorkspaceRepository()
    const out = await repo.deleteEntry('plan.md')
    expect(out.path).toBe('plan.md')
    expect(out.trashPath).toMatch(/^\.trash\/\d+-plan\.md$/)
    expect(await names(repo)).not.toContain('plan.md')
  })

  it('deleteEntry từ chối mục được bảo vệ và đường dẫn không hợp lệ', async () => {
    const repo = new MockWorkspaceRepository()
    await expect(repo.deleteEntry('.plans')).rejects.toThrow(/bảo vệ/)
    await expect(repo.deleteEntry('../etc/passwd')).rejects.toThrow(/không hợp lệ/)
    await expect(repo.deleteEntry('')).rejects.toThrow(/thiếu đường dẫn/)
  })
})
