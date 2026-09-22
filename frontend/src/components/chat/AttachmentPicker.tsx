/**
 * Menu đính kèm tài liệu (AttachmentPicker) tại nút [+] của Chat Input Bar.
 * - Upload Image: Tải ảnh (.png, .jpg, .webp, ...) đọc trực tiếp thành Base64 DataURL cho VLM.
 * - Upload File: Tải tệp văn bản / mã nguồn / tài liệu.
 * - Upload Folder: Tải toàn bộ thư mục dự án (webkitdirectory).
 * - Google Drive: chưa nối — mục menu nói thẳng "chưa kết nối", không thêm chip giả.
 *
 * Hai bất biến của đợt 22 (BUG-39, BUG-40 — `docs/plan/…`, kế hoạch v1 Phần A):
 * 1. Popover render qua `createPortal` vào `document.body` — hàng công cụ của
 *    `ChatInputBar` có `overflow-hidden`, nên popover `absolute` bị CẮT và mục
 *    menu không bấm được (`document.elementFromPoint` trả về khung chat). Cách
 *    chữa là portal + vị trí tính từ `getBoundingClientRect()`, **không** phải
 *    tăng `z-index` (đó chỉ là triệu chứng). Mẫu: `HarnessModelPicker.tsx`.
 * 2. Đối tượng `File` thật được GIỮ trong `AttachedFile.file` (kèm
 *    `sizeBytes`/`relativePath`) — trước đây tệp thường chỉ còn cái tên, nên
 *    nội dung không bao giờ tới box. Ảnh vẫn giữ thêm `dataUrl` cho VLM.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Image as ImageIcon, FileText, FolderUp } from 'lucide-react'

export interface AttachedFile {
  id: string
  name: string
  source: 'computer' | 'drive'
  size?: string
  dataUrl?: string
  /** Đối tượng File thật — nguồn duy nhất để gửi nội dung lên box (BUG-40). */
  file?: File
  /** `webkitRelativePath` khi chọn cả thư mục; `undefined` khi chọn tệp lẻ. */
  relativePath?: string
  /** Kích thước thật theo byte (`file.size`); trần phía client đếm theo trường này. */
  sizeBytes?: number
}

/** Trần phía client (kế hoạch v1 Phần A, A2.3): chặn trước khi tốn một lượt gửi. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_TURN = 20
export const MAX_ATTACHMENT_BYTES_PER_TURN = 100 * 1024 * 1024

/** Kích thước hiển thị trên chip — không hiện chuỗi byte thô. */
export function formatAttachmentSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Tên đường dẫn rút gọn cho chip: giữ đuôi, cắt đầu khi quá dài. */
export function shortenAttachmentPath(path: string, max = 28): string {
  if (path.length <= max) return path
  return `…${path.slice(path.length - max + 1)}`
}

const PANEL_WIDTH = 240
/** Chiều cao ước lượng của panel (4 mục + tiêu đề) — dùng để kẹp mép trên. */
const PANEL_HEIGHT = 300

export function AttachmentPicker({
  onAttach,
  existingCount = 0,
  existingBytes = 0,
}: {
  onAttach: (file: AttachedFile) => void
  /** Số tệp đã nằm trong chip của lượt này (trần `MAX_ATTACHMENTS_PER_TURN`). */
  existingCount?: number
  /** Tổng byte đã nằm trong chip của lượt này (trần `MAX_ATTACHMENT_BYTES_PER_TURN`). */
  existingBytes?: number
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelPosition, setPanelPosition] = useState<{ left: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  // Bộ đếm id: nhiều tệp đọc bất đồng bộ trong cùng một mili-giây không được trùng id.
  const idSeqRef = useRef(0)

  // Ngoài-click phải kiểm CẢ nút [+] (trigger) lẫn panel: panel nằm ngoài cây DOM
  // của nút sau khi render qua portal, nên chỉ kiểm `panelRef` là đủ để bấm nút
  // lần thứ hai lại mở panel (mousedown đóng, click mở lại).
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // Vị trí panel bám theo nút [+] nhưng KHÔNG phụ thuộc cây DOM của nó: mở lên
  // trên, kẹp hai chiều vào viewport để cột chat hẹp không đẩy panel ra ngoài.
  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const maxBottom = Math.max(8, window.innerHeight - PANEL_HEIGHT - 8)
      setPanelPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8)),
        bottom: Math.min(Math.max(8, window.innerHeight - rect.top + 8), maxBottom),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  const handleFiles = (files: FileList | null, isFolder = false) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    const problems: string[] = []
    // Trần đếm theo đúng những gì ĐÃ nằm trong chip khi mở menu, cộng dồn theo
    // từng tệp được nhận trong lượt chọn này.
    let acceptedCount = existingCount
    let acceptedBytes = existingBytes
    const emit = (file: File, dataUrl?: string) => {
      idSeqRef.current += 1
      const relativePath = isFolder
        ? (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined
        : undefined
      const attached: AttachedFile = {
        id: `${dataUrl ? 'img' : 'file'}-${Date.now()}-${idSeqRef.current}`,
        name: file.name,
        source: 'computer',
        size: `${(file.size / 1024).toFixed(0)} KB`,
        sizeBytes: file.size,
        file,
      }
      if (dataUrl) attached.dataUrl = dataUrl
      if (relativePath) attached.relativePath = relativePath
      onAttach(attached)
    }

    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        problems.push(`«${file.name}» vượt trần 25 MB mỗi tệp.`)
        continue
      }
      if (acceptedCount >= MAX_ATTACHMENTS_PER_TURN) {
        problems.push(`Chỉ đính kèm được ${MAX_ATTACHMENTS_PER_TURN} tệp mỗi lượt.`)
        continue
      }
      if (acceptedBytes + file.size > MAX_ATTACHMENT_BYTES_PER_TURN) {
        problems.push(`Tổng dung lượng tệp đính kèm vượt trần 100 MB mỗi lượt.`)
        continue
      }
      acceptedCount += 1
      acceptedBytes += file.size
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => emit(file, reader.result as string)
        reader.readAsDataURL(file)
      } else {
        emit(file)
      }
    }

    if (problems.length > 0) {
      setError(problems.join(' '))
      // Lỗi phải ĐỌC ĐƯỢC: menu vừa đóng khi chọn mục, nên mở lại để dòng lỗi
      // hiện ra thay vì im lặng nuốt tệp của người dùng.
      setOpen(true)
    } else if (error) {
      setError(null)
    }
  }

  const handleUploadImage = () => {
    setError(null)
    setOpen(false)
    imageInputRef.current?.click()
  }

  const handleUploadFile = () => {
    setError(null)
    setOpen(false)
    fileInputRef.current?.click()
  }

  const handleUploadFolder = () => {
    setError(null)
    setOpen(false)
    folderInputRef.current?.click()
  }

  const menuButtonClass =
    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-fg hover:bg-panel2 transition cursor-pointer'

  return (
    <div className="relative inline-block">
      {/* Hidden inputs — cùng cây DOM với nút [+] vì người dùng không nhìn thấy chúng. */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        data-testid="attach-image-input"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          if (imageInputRef.current) imageInputRef.current.value = ''
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="attach-file-input"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is standard in browsers
        webkitdirectory=""
        data-testid="attach-folder-input"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files, true)
          if (folderInputRef.current) folderInputRef.current.value = ''
        }}
      />

      {/* Trigger [+] Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex size-6 items-center justify-center rounded transition cursor-pointer select-none ${
          open
            ? 'bg-brand/15 text-brand shadow-xs'
            : 'text-muted hover:bg-panel hover:text-fg'
        }`}
        title="Thêm đính kèm / Tệp tin / Hình ảnh"
      >
        <Plus className="size-3.5" />
      </button>

      {/* Popover Dropdown Menu (Opens upward) — portal ra `document.body` để hàng
          công cụ `overflow-hidden` của ChatInputBar không cắt mất (BUG-39). */}
      {open &&
        panelPosition &&
        createPortal(
          <div
            ref={panelRef}
            data-testid="attach-menu"
            className="fixed z-50 w-60 rounded-2xl border border-line bg-panel p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150 select-none"
            style={{ left: panelPosition.left, bottom: panelPosition.bottom }}
          >
            <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
              Đính kèm ngữ cảnh
            </div>

            {error && (
              <div
                data-testid="attach-error"
                className="mx-1.5 mb-1 rounded-xl border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-rose-400"
              >
                {error}
              </div>
            )}

            {/* 1. Upload Image */}
            <button type="button" onClick={handleUploadImage} className={menuButtonClass}>
              <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <ImageIcon className="size-4" />
              </div>
              <div>
                <div className="font-medium text-fg">Tải lên hình ảnh</div>
                <div className="text-[10px] text-muted">PNG, JPG, WebP cho phân tích VLM</div>
              </div>
            </button>

            {/* 2. Upload File */}
            <button type="button" onClick={handleUploadFile} className={menuButtonClass}>
              <div className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                <FileText className="size-4" />
              </div>
              <div>
                <div className="font-medium text-fg">Tải lên tệp tin</div>
                <div className="text-[10px] text-muted">Tối đa 25 MB/tệp · 20 tệp/lượt</div>
              </div>
            </button>

            {/* 3. Upload Folder */}
            <button type="button" onClick={handleUploadFolder} className={menuButtonClass}>
              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <FolderUp className="size-4" />
              </div>
              <div>
                <div className="font-medium text-fg">Tải lên thư mục</div>
                <div className="text-[10px] text-muted">Giữ nguyên cây thư mục dự án</div>
              </div>
            </button>

            <div className="my-1 border-t border-line/60" />

            {/* 4. Google Drive — CHƯA nối. Trước đây mục này gọi `onAttach` với một
                tệp giả `Architecture_Blueprint_2026.gdoc`: người dùng tưởng đã đính
                kèm tài liệu, nhưng chip chỉ có cái tên. Nói thẳng thay vì bịa. */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="attach-drive-item"
              className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-muted opacity-60"
            >
              <div className="flex size-7 items-center justify-center rounded-lg bg-panel2">
                <svg className="size-4 shrink-0" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A8.9 8.9 0 0 0 0 53h27.5z" fill="#00ac47"/>
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.15z" fill="#ea4335"/>
                  <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                  <path d="M59.8 53h27.5c0-1.55-.4-3.1-1.2-4.5L72.35 22.75c-.8-1.4-1.95-2.5-3.3-3.3L55.3 43.25z" fill="#2684fc"/>
                  <path d="m27.5 53 13.75 23.8c1.35-.8 2.5-1.9 3.3-3.3l20.75-35.95c.8-1.4 1.2-2.95 1.2-4.55H27.5z" fill="#ffba00"/>
                </svg>
              </div>
              <div>
                <div className="font-medium text-muted">Google Drive</div>
                <div className="text-[10px] text-muted">Chưa kết nối — không đính kèm được tài liệu Drive</div>
              </div>
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
