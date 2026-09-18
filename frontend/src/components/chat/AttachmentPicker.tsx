/**
 * Menu đính kèm tài liệu (AttachmentPicker) tại nút [+] của Chat Input Bar.
 * - Upload Image: Tải ảnh (.png, .jpg, .webp, ...) đọc trực tiếp thành Base64 DataURL cho VLM.
 * - Upload File: Tải tệp văn bản / mã nguồn / tài liệu.
 * - Upload Folder: Tải toàn bộ thư mục dự án (webkitdirectory).
 * - Google Drive: Tích hợp chọn tài liệu đám mây.
 */
import { useState, useRef, useEffect } from 'react'
import { Plus, Image as ImageIcon, FileText, FolderUp } from 'lucide-react'

export interface AttachedFile {
  id: string
  name: string
  source: 'computer' | 'drive'
  size?: string
  dataUrl?: string
  isFolderItem?: boolean
}

export function AttachmentPicker({
  onAttach,
}: {
  onAttach: (file: AttachedFile) => void
}) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
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

  const handleFiles = (files: FileList | null, isFolder = false) => {
    if (!files || files.length === 0) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          onAttach({
            id: `img-${Date.now()}-${i}`,
            name: file.name,
            source: 'computer',
            size: `${(file.size / 1024).toFixed(0)} KB`,
            dataUrl: reader.result as string,
            isFolderItem: isFolder,
          })
        }
        reader.readAsDataURL(file)
      } else {
        onAttach({
          id: `file-${Date.now()}-${i}`,
          name: file.name,
          source: 'computer',
          size: `${(file.size / 1024).toFixed(0)} KB`,
          isFolderItem: isFolder,
        })
      }
    }
  }

  const handleUploadImage = () => {
    setOpen(false)
    imageInputRef.current?.click()
  }

  const handleUploadFile = () => {
    setOpen(false)
    fileInputRef.current?.click()
  }

  const handleUploadFolder = () => {
    setOpen(false)
    folderInputRef.current?.click()
  }

  const handleGoogleDrive = () => {
    setOpen(false)
    onAttach({
      id: `drive-${Date.now()}`,
      name: 'Architecture_Blueprint_2026.gdoc',
      source: 'drive',
      size: 'Google Doc',
    })
  }

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Hidden inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
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
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files, true)
          if (folderInputRef.current) folderInputRef.current.value = ''
        }}
      />

      {/* Trigger [+] Button */}
      <button
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

      {/* Popover Dropdown Menu (Opens upward) */}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-60 rounded-2xl border border-line bg-panel p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 select-none">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
            Đính kèm ngữ cảnh
          </div>

          {/* 1. Upload Image */}
          <button
            type="button"
            onClick={handleUploadImage}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-fg hover:bg-panel2 transition cursor-pointer"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <ImageIcon className="size-4" />
            </div>
            <div>
              <div className="font-medium text-fg">Tải lên hình ảnh</div>
              <div className="text-[10px] text-muted">PNG, JPG, WebP cho phân tích VLM</div>
            </div>
          </button>

          {/* 2. Upload File */}
          <button
            type="button"
            onClick={handleUploadFile}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-fg hover:bg-panel2 transition cursor-pointer"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <FileText className="size-4" />
            </div>
            <div>
              <div className="font-medium text-fg">Tải lên tệp tin</div>
              <div className="text-[10px] text-muted">Mã nguồn, văn bản, cấu hình</div>
            </div>
          </button>

          {/* 3. Upload Folder */}
          <button
            type="button"
            onClick={handleUploadFolder}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-fg hover:bg-panel2 transition cursor-pointer"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <FolderUp className="size-4" />
            </div>
            <div>
              <div className="font-medium text-fg">Tải lên thư mục</div>
              <div className="text-[10px] text-muted">Toàn bộ folder dự án</div>
            </div>
          </button>

          <div className="my-1 border-t border-line/60" />

          {/* 4. Google Drive */}
          <button
            type="button"
            onClick={handleGoogleDrive}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-fg hover:bg-panel2 transition cursor-pointer"
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
              <div className="font-medium text-fg">Google Drive</div>
              <div className="text-[10px] text-muted">Tài liệu từ Google Workspace</div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
