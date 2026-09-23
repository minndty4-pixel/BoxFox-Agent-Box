/**
 * Adapter mock cho test/demo — dựng từ cây `FileNode` của kịch bản.
 *
 * Chuyển `FileNode` → `WorkspaceEntry`, phục vụ `readText` từ `node.content`
 * (hoặc văn bản mẫu tổng hợp khi thiếu). `zip` trả Blob chứa JSON tên file —
 * đủ cho unit test, không nén thật.
 *
 * Năm thao tác ghi (`mkdir`, `touch`, `rename`, `move`, `deleteEntry`) SỬA THẬT
 * cây trong bộ nhớ để hook/test thấy được kết quả sau khi nạp lại, và giữ đúng
 * khoá trả về của hợp đồng §2. `deleteEntry` "chuyển vào .trash" bằng cách bỏ
 * khỏi cây và trả `trashPath` — mock không dựng thư mục `.trash` thật.
 */
import type { FileNode } from '../../types/ui'
import { buildWorkspace } from '../mock/workspace'
import { extOf, languageForExt } from './languages'
import { basename, childPath, sortEntries } from './tree'
import type {
  WorkspaceContent,
  WorkspaceCrumb,
  WorkspaceDeleteResult,
  WorkspaceEntry,
  WorkspaceListing,
  WorkspaceMkdirResult,
  WorkspaceMoveResult,
  WorkspaceRepository,
  WorkspaceTouchResult,
  WorkspaceUploadOptions,
  WorkspaceUploadResult,
} from './types'

function toEntry(node: FileNode): WorkspaceEntry {
  const ext = node.kind === 'file' ? extOf(node.name) : null
  return {
    name: node.name,
    kind: node.kind,
    sizeBytes: node.content ? node.content.length : 0,
    mtime: '2026-08-27T00:00:00Z',
    integrity: node.integrity ?? null,
    confidentiality: node.confidentiality ?? null,
    ext,
    language: node.kind === 'file' ? languageForExt(ext) : null,
  }
}

function buildBreadcrumb(path: string): WorkspaceCrumb[] {
  const crumbs: WorkspaceCrumb[] = [{ name: 'workspace', path: '' }]
  if (path === '') return crumbs
  let walked = ''
  for (const seg of path.split('/')) {
    walked = walked ? `${walked}/${seg}` : seg
    crumbs.push({ name: seg, path: walked })
  }
  return crumbs
}

function synthesizedSample(path: string): string {
  return `# ${basename(path)}\n\n(Không có nội dung xem trước trong mock.)\n`
}

export class MockWorkspaceRepository implements WorkspaceRepository {
  readonly baseUrl = 'mock://workspace'
  private readonly roots: FileNode[]
  /** Bộ đếm RULE-5 theo thư mục đích — mock không có tệp thật để đếm `max(số) + 1`. */
  private readonly uploadCounters = new Map<string, number>()

  constructor() {
    // Trạng thái "đã sửa parser + đã có plan" — đủ phong phú để demo hai chế độ xem.
    this.roots = buildWorkspace({ parserFixed: true, withPlan: true, authInjected: false })
  }

  async list(path: string): Promise<WorkspaceListing> {
    const entries = this.entriesAt(path)
    return { breadcrumb: buildBreadcrumb(path), entries: sortEntries(entries) }
  }

  async readText(path: string): Promise<WorkspaceContent> {
    const node = this.findFile(path)
    const content = node?.content ?? synthesizedSample(path)
    return {
      content,
      sizeBytes: content.length,
      mime: 'text/plain',
      language: languageForExt(extOf(basename(path))),
      binary: false,
    }
  }

  mediaUrl(path: string): string {
    return `mock://workspace/file/media?path=${encodeURIComponent(path)}`
  }
  thumbnailUrl(path: string): string {
    return `mock://workspace/file/thumbnail?path=${encodeURIComponent(path)}`
  }
  downloadUrl(path: string): string {
    return `mock://workspace/file/download?path=${encodeURIComponent(path)}`
  }

  async zip(paths: string[]): Promise<Blob> {
    return new Blob([JSON.stringify({ paths }, null, 2)], { type: 'application/json' })
  }

  async upload(
    targetDir: string,
    filename: string,
    body?: Blob,
    options: WorkspaceUploadOptions = {},
  ): Promise<WorkspaceUploadResult> {
    // Mock không dựng cây cho tệp tải lên (giữ nguyên hành vi cũ), nên bộ đếm RULE-5 nằm trong
    // bộ nhớ — nhưng vẫn tăng một chiều và không dùng lại số, đúng luật của box.
    if (options.assignNumber) {
      const next = (this.uploadCounters.get(targetDir) ?? 0) + 1
      this.uploadCounters.set(targetDir, next)
      const ext = extOf(filename)
      const name = ext ? `${next}.${ext}` : `${next}`
      return { path: childPath(targetDir, name), name, sizeBytes: body?.size ?? 0 }
    }
    // `mkdirs` là việc của box (tạo thư mục cha còn thiếu); mock không có thư mục thật để tạo.
    return { path: childPath(targetDir, filename), name: filename, sizeBytes: body?.size ?? 0 }
  }

  async unzip(path: string): Promise<{ extracted: number; skipped: number; warnings: string[] }> {
    return { extracted: 0, skipped: 0, warnings: [`Mock: không giải nén thật ${path}`] }
  }

  async mkdir(path: string): Promise<WorkspaceMkdirResult> {
    const target = requireWritablePath(path)
    const { siblings } = this.locateParent(target)
    const name = basename(target)
    assertAbsent(siblings, name)
    siblings.push({ path: target, name, kind: 'dir', children: [] })
    return { path: target, type: 'directory' }
  }

  async touch(path: string, content = ''): Promise<WorkspaceTouchResult> {
    const target = requireWritablePath(path)
    const { siblings } = this.locateParent(target)
    const name = basename(target)
    assertAbsent(siblings, name)
    siblings.push({ path: target, name, kind: 'file', content })
    return { path: target, type: 'file', size: content.length }
  }

  async rename(path: string, name: string): Promise<WorkspaceMoveResult> {
    const target = requireWritablePath(path)
    const clean = requireSimpleName(name)
    const node = this.navigate(target)
    if (!node) throw new Error(`Mock: không tìm thấy ${target}`)
    const { parentPath, siblings } = this.locateParent(target)
    assertAbsent(siblings, clean, node)
    node.name = clean
    repath(node, parentPath)
    return { path: target, newPath: childPath(parentPath, clean) }
  }

  async move(path: string, destination: string): Promise<WorkspaceMoveResult> {
    const target = requireWritablePath(path)
    const node = this.navigate(target)
    if (!node) throw new Error(`Mock: không tìm thấy ${target}`)
    const dest = destination.trim()
    if (dest === target || dest.startsWith(`${target}/`)) {
      throw new Error(`Mock: không thể chuyển ${target} vào chính nó`)
    }
    const into = this.navigate(dest)
    if (dest !== '' && (!into || into.kind !== 'dir')) {
      throw new Error(`Mock: thư mục đích không tồn tại: ${dest}`)
    }
    const from = this.locateParent(target)
    const to = this.locateParent(childPath(dest, node.name))
    if (to.siblings === from.siblings) return { path: target, newPath: target }
    assertAbsent(to.siblings, node.name, node)
    const index = from.siblings.indexOf(node)
    if (index >= 0) from.siblings.splice(index, 1)
    repath(node, dest)
    to.siblings.push(node)
    return { path: target, newPath: childPath(dest, node.name) }
  }

  async deleteEntry(path: string): Promise<WorkspaceDeleteResult> {
    const target = requireWritablePath(path)
    if (PROTECTED_NAMES.has(basename(target))) {
      throw new Error(`Mock: không thể xoá mục được bảo vệ: ${target}`)
    }
    const node = this.navigate(target)
    if (!node) throw new Error(`Mock: không tìm thấy ${target}`)
    const { siblings } = this.locateParent(target)
    const index = siblings.indexOf(node)
    if (index >= 0) siblings.splice(index, 1)
    return { path: target, trashPath: `.trash/${Math.floor(Date.now() / 1000)}-${node.name}` }
  }

  private navigate(path: string): FileNode | null {
    if (path === '') return null
    let level: FileNode[] = this.roots
    let current: FileNode | null = null
    for (const seg of path.split('/')) {
      const found = level.find((node) => node.name === seg)
      if (!found) return null
      current = found
      level = found.children ?? []
    }
    return current
  }

  private entriesAt(path: string): WorkspaceEntry[] {
    if (path === '') return this.roots.map(toEntry)
    const dir = this.navigate(path)
    if (!dir || dir.kind !== 'dir' || !dir.children) return []
    return dir.children.map(toEntry)
  }

  private findFile(path: string): FileNode | null {
    const node = this.navigate(path)
    return node && node.kind === 'file' ? node : null
  }

  /**
   * Danh sách anh em chứa `path` (mảng con của thư mục cha, hoặc `roots` ở gốc)
   * — nơi cần thêm/bớt/đổi tên để cây thấy được thay đổi ngay sau đó.
   */
  private locateParent(path: string): { parentPath: string; siblings: FileNode[] } {
    const i = path.lastIndexOf('/')
    const parentPath = i < 0 ? '' : path.slice(0, i)
    if (parentPath === '') return { parentPath, siblings: this.roots }
    const dir = this.navigate(parentPath)
    if (!dir || dir.kind !== 'dir' || !dir.children) {
      throw new Error(`Mock: thư mục cha không tồn tại: ${parentPath}`)
    }
    return { parentPath, siblings: dir.children }
  }
}

/** Mục bảo vệ như container: không cho xoá (`.plans`, `.trash`, …). */
const PROTECTED_NAMES = new Set(['.plans', '.trash', '.generated_artifacts'])

/** Đường dẫn ghi phải tương đối, không rỗng và không chứa `..`/NUL — như guard của container. */
function requireWritablePath(path: string): string {
  const clean = path.trim().replace(/^\/+/, '')
  if (!clean) throw new Error('Mock: thiếu đường dẫn')
  if (clean.includes('\0') || clean.split('/').some((seg) => seg === '' || seg === '..' || seg === '.')) {
    throw new Error(`Mock: đường dẫn không hợp lệ: ${path}`)
  }
  return clean
}

/** `rename` chỉ đổi tên trong cùng thư mục — `name` phải là một đoạn tên đơn. */
function requireSimpleName(name: string): string {
  const clean = name.trim()
  if (!clean || clean === '.' || clean === '..' || clean.includes('/') || clean.includes('\0')) {
    throw new Error(`Mock: tên không hợp lệ: ${name}`)
  }
  return clean
}

function assertAbsent(siblings: FileNode[], name: string, allowed?: FileNode): void {
  if (siblings.some((node) => node.name === name && node !== allowed)) {
    throw new Error(`Mock: đã tồn tại: ${name}`)
  }
}

/** Ghi lại `path` cho node và toàn bộ hậu duệ sau khi đổi tên/di chuyển. */
function repath(node: FileNode, parentPath: string): void {
  node.path = childPath(parentPath, node.name)
  for (const child of node.children ?? []) repath(child, node.path)
}
