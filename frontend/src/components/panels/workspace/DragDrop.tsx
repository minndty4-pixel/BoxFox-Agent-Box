/**
 * Xử lý kéo-thả file để tải lên: preventDefault trên dragover/drop, đọc
 * DataTransfer.files rồi gọi `onFiles`. Trả cả cờ `isDragging` để bật lớp nền.
 *
 * Kèm phần kéo-thả NỘI BỘ (di chuyển entry giữa các thư mục): dùng một MIME
 * riêng để phân biệt với tệp từ hệ điều hành, nên thả tệp để tải lên vẫn nguyên
 * hành vi cũ.
 */
import { useCallback, useState, type DragEvent } from 'react'

/** MIME nội bộ đánh dấu "đang kéo một entry workspace" (khác tệp từ hệ điều hành). */
export const WORKSPACE_PATH_MIME = 'application/x-boxfox-workspace-path'

/** Bắt đầu kéo một entry — đường dẫn tương đối nằm trong DataTransfer. */
export function startPathDrag(e: DragEvent, path: string): void {
  e.dataTransfer.setData(WORKSPACE_PATH_MIME, path)
  e.dataTransfer.effectAllowed = 'move'
}

/** `true` khi lượt kéo hiện tại là kéo entry nội bộ (không phải tệp để tải lên). */
export function isPathDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(WORKSPACE_PATH_MIME)
}

/** Đường dẫn đang được kéo, hoặc chuỗi rỗng nếu không phải kéo nội bộ. */
export function draggedPath(e: DragEvent): string {
  return e.dataTransfer.getData(WORKSPACE_PATH_MIME)
}

/**
 * Đích thả cho một entry: chỉ nhận khi `destination` là thư mục hợp lệ và không
 * nằm trong chính entry đang kéo (chặn thả thư mục vào con của nó).
 */
export function acceptsPathDrop(e: DragEvent, destination: string): boolean {
  if (!isPathDrag(e)) return false
  const source = draggedPath(e)
  if (!source) return false
  return source !== destination && !destination.startsWith(`${source}/`)
}

export function useDropZone(onFiles: (files: File[]) => void) {
  const [isDragging, setDragging] = useState(false)

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) setDragging(true)
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (e.currentTarget === e.target) setDragging(false)
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length) onFiles(files)
    },
    [onFiles],
  )

  return { isDragging, onDragOver, onDragLeave, onDrop }
}
