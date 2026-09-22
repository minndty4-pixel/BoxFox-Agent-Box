/**
 * Đưa tệp người dùng chọn lên box TRƯỚC khi gửi lượt (đợt 22, kế hoạch Phần A / A5).
 *
 * Vì sao phải chờ upload xong mới gửi: harness chỉ nhận được đường dẫn
 * (`attachments: [{path, name, sizeBytes}]`), nên nếu gửi trước thì mô hình có thể
 * `file_read` đúng lúc tệp chưa nằm trên đĩa. Vì vậy hàm này chạy **tuần tự** (thứ tự số
 * RULE-5 do box cấp phải khớp thứ tự người dùng thấy) và **dừng cả lượt** khi một tệp lỗi —
 * không bao giờ trả về một mảng nửa vời khiến lượt gửi thiếu tệp mà người dùng không biết.
 */
import { IDE_WORKSPACE_ROOT } from '../ide/config'
import type { WorkspaceRepository } from '../workspace/types'

/** Thư mục box nhận tệp từ ô soạn tin (RULE-5: `<số>.<ext>`, xem `docs/naming.md`). */
export const DEFAULT_ATTACHMENT_DIR = '.uploaded_artifacts'

/**
 * Đầu vào tối thiểu của một tệp cần đưa lên box.
 *
 * Cố ý khai báo theo cấu trúc (không import `AttachedFile` từ component) để tầng `lib`
 * không phụ thuộc ngược lên `components`; `AttachedFile` của `AttachmentPicker` thoả kiểu này.
 */
export interface AttachmentCandidate {
  name: string
  file: File
  /** Chỉ có với tệp trong thư mục vừa chọn, ví dụ `proj/src/a.ts`. */
  relativePath?: string
}

/** Một tệp đã nằm trên đĩa box — đây là thứ đi kèm lượt gửi. */
export interface OutgoingAttachment {
  name: string
  /** Đường dẫn tương đối trong workspace, ví dụ `.uploaded_artifacts/proj/src/3.ts`. */
  path: string
  /** Dạng tuyệt đối để mô hình `file_read` thẳng, không phải đoán gốc workspace. */
  absolutePath: string
  sizeBytes: number
  kind: 'file' | 'folder-item'
}

export interface AttachmentUploadDeps {
  repo: Pick<WorkspaceRepository, 'upload'>
  targetDir?: string
  onProgress?: (done: number, total: number) => void
}

/** `proj/src/a.ts` → `proj/src`; tệp ngay trong gốc thư mục vừa chọn → ``. */
function parentDir(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+|\/+$/g, '')
  const cut = trimmed.lastIndexOf('/')
  return cut < 0 ? '' : trimmed.slice(0, cut)
}

function joinPath(base: string, leaf: string): string {
  const left = base.replace(/\/+$/, '')
  const right = leaf.replace(/^\/+/, '')
  if (!right) return left
  return left ? `${left}/${right}` : right
}

/** Đường dẫn tuyệt đối trong box — lấy gốc từ hằng số IDE, không rải chuỗi trong component. */
export function absoluteWorkspacePath(path: string): string {
  return `${IDE_WORKSPACE_ROOT}/${path.replace(/^\/+/, '')}`
}

/**
 * Tải tuần tự từng tệp lên box, trả mảng theo đúng thứ tự đầu vào.
 *
 * Tệp trong thư mục (có `relativePath`) giữ nguyên cây: đích là `<targetDir>/<thư mục cha>`
 * và box tự tạo thư mục còn thiếu (`mkdirs`). Lỗi ở bất kỳ tệp nào ⇒ ném lỗi có tên tệp.
 */
export async function uploadAttachments(
  files: readonly AttachmentCandidate[],
  {
    repo,
    targetDir = DEFAULT_ATTACHMENT_DIR,
    onProgress,
  }: AttachmentUploadDeps,
): Promise<OutgoingAttachment[]> {
  const total = files.length
  const uploaded: OutgoingAttachment[] = []
  for (let index = 0; index < files.length; index += 1) {
    const candidate = files[index]
    const fromFolder = Boolean(candidate.relativePath)
    const directory = fromFolder ? joinPath(targetDir, parentDir(candidate.relativePath as string)) : targetDir
    let result: Awaited<ReturnType<WorkspaceRepository['upload']>>
    try {
      result = await repo.upload(directory, candidate.file.name, candidate.file, {
        // Số do BOX cấp (RULE-5) — client không được tự đặt tên để tránh đè tệp người khác.
        assignNumber: true,
        // Cây thư mục của thư mục vừa chọn: thư mục cha có thể chưa tồn tại trên box.
        mkdirs: fromFolder,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Không tải lên được «${candidate.name}»: ${reason}`, { cause: error })
    }
    uploaded.push({
      name: result.name ?? candidate.file.name,
      path: result.path,
      absolutePath: absoluteWorkspacePath(result.path),
      sizeBytes: result.sizeBytes,
      kind: fromFolder ? 'folder-item' : 'file',
    })
    onProgress?.(index + 1, total)
  }
  return uploaded
}
