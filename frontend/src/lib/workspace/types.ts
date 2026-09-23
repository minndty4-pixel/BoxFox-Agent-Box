/**
 * Hợp đồng dữ liệu thuần cho trình duyệt file workspace.
 *
 * `path` luôn là đường dẫn TƯƠNG ĐỐI từ gốc workspace (`/home/agent/workspace`);
 * chuỗi rỗng nghĩa là thư mục gốc. Backend quyết định nhãn provenance — giao diện
 * chỉ hiển thị, không tự gán.
 */
import type { Confidentiality, Integrity } from '../../types/labels'
import type { FileNodeKind } from '../../types/ui'

/** Một mục trong danh sách thư mục (file hoặc thư mục con). */
export interface WorkspaceEntry {
  name: string
  kind: FileNodeKind
  sizeBytes: number
  /** ISO 8601 — thời gian sửa cuối. */
  mtime: string
  /** Nhãn provenance do backend cấp; `null` khi chưa biết (thư mục thường không mang nhãn). */
  integrity: Integrity | null
  confidentiality: Confidentiality | null
  /** Phần mở rộng (đã viết thường, không dấu chấm) hoặc `null` với file không có đuôi. */
  ext: string | null
  /** Ngôn ngữ nhận diện cho tô màu, hoặc `null`. */
  language: string | null
}

/** Một đoạn trong breadcrumb điều hướng. */
export interface WorkspaceCrumb {
  name: string
  path: string
}

/** Kết quả liệt kê MỘT thư mục. */
export interface WorkspaceListing {
  breadcrumb: WorkspaceCrumb[]
  entries: WorkspaceEntry[]
  /** `true` khi backend đã cắt bớt vì vượt giới hạn số mục. */
  truncated?: boolean
}

/** Nội dung văn bản của một file (chỉ cho file có thể giải mã text). */
export interface WorkspaceContent {
  content: string
  sizeBytes: number
  mime: string
  language: string | null
  /** `true` khi file là nhị phân — không giải mã text được. */
  binary: boolean
}

/** Kết quả `mkdir` — đúng khoá của hợp đồng (`POST /__box/files/mkdir`). */
/**
 * Tuỳ chọn cho `upload` (đợt 22 / A4).
 *
 * `assignNumber` để **box** cấp số RULE-5 (`<số>.<ext>`, không zero-pad, tăng một chiều —
 * `docs/naming.md` RULE-5) thay vì dùng nguyên `filename`; số thật nằm ở `name` trong kết quả.
 * `mkdirs` để box tạo các thư mục cha còn thiếu, nhờ đó tệp trong thư mục vừa chọn giữ nguyên
 * cây thư mục (`proj/src/a.ts`).
 */
export interface WorkspaceUploadOptions {
  assignNumber?: boolean
  mkdirs?: boolean
  signal?: AbortSignal
}

/** Kết quả `upload` — đúng khoá của hợp đồng (`POST /__box/file/upload`). */
export interface WorkspaceUploadResult {
  path: string
  /** Tên thật trên đĩa; chỉ có khi box cấp số (`assignNumber`) — thường khác `filename`. */
  name?: string
  sizeBytes: number
}

export interface WorkspaceMkdirResult {
  path: string
  type: 'directory'
}

/** Kết quả `touch` — đúng khoá của hợp đồng (`POST /__box/files/touch`). */
export interface WorkspaceTouchResult {
  path: string
  type: 'file'
  /** Số byte của nội dung vừa ghi (`0` khi tạo file rỗng). */
  size: number
}

/** Kết quả `rename`/`move` — đúng khoá của hợp đồng. */
export interface WorkspaceMoveResult {
  path: string
  newPath: string
}

/** Kết quả `deleteEntry` — KHÔNG xoá thẳng: entry được chuyển vào `.trash`. */
export interface WorkspaceDeleteResult {
  path: string
  trashPath: string
}

/**
 * Adapter đọc/ghi file workspace. Phương thức `*Url` trả URL cho subresource
 * (`<img>`, `<video>`, `<a download>`) — KHÔNG thêm header Origin/auth vì trình
 * duyệt không gửi Origin cho subresource; biên thật là bind loopback của proxy.
 *
 * Năm phương thức ghi (`mkdir`, `touch`, `rename`, `move`, `deleteEntry`) bắt
 * buộc gửi `X-BoxFox-Api-Key` (hợp đồng §0.4) và trả về đúng khoá của bảng §2.
 */
export interface WorkspaceRepository {
  baseUrl: string
  list(path: string, signal?: AbortSignal): Promise<WorkspaceListing>
  readText(path: string, signal?: AbortSignal): Promise<WorkspaceContent>
  mediaUrl(path: string): string
  thumbnailUrl(path: string): string
  downloadUrl(path: string): string
  zip(paths: string[], signal?: AbortSignal): Promise<Blob>
  upload(
    targetDir: string,
    filename: string,
    body: Blob,
    options?: WorkspaceUploadOptions,
  ): Promise<WorkspaceUploadResult>
  unzip(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ extracted: number; skipped: number; warnings: string[] }>
  /** Tạo thư mục tại `path` (đường dẫn tương đối). */
  mkdir(path: string, signal?: AbortSignal): Promise<WorkspaceMkdirResult>
  /** Tạo file tại `path`; `content` mặc định là rỗng. */
  touch(path: string, content?: string, signal?: AbortSignal): Promise<WorkspaceTouchResult>
  /** Đổi tên trong CÙNG thư mục — `name` không được chứa `/`. */
  rename(path: string, name: string, signal?: AbortSignal): Promise<WorkspaceMoveResult>
  /** Di chuyển entry vào thư mục `destination` (chuỗi rỗng = gốc workspace). */
  move(path: string, destination: string, signal?: AbortSignal): Promise<WorkspaceMoveResult>
  /** Chuyển entry vào `.trash` (không xoá thẳng) và trả đường dẫn trong thùng rác. */
  deleteEntry(path: string, signal?: AbortSignal): Promise<WorkspaceDeleteResult>
}
