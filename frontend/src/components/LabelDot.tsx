/**
 * Chấm màu nhãn + badge chữ.
 *
 * LUẬT: KHÔNG BAO GIỜ chỉ dùng màu. Mỗi chấm phải có `title` bằng chữ để
 * người mù màu, ảnh chụp đen trắng, hay người đọc bằng trình đọc màn hình
 * vẫn biết nhãn là gì.
 */
import { CONFIDENTIALITY_META, INTEGRITY_META, confidentialityLabelKey, integrityLabelKey } from '../lib/labels'
import { useT, type TKey } from '../i18n/context'
import type { Confidentiality, Integrity } from '../types/labels'

interface LabelProps {
  integrity?: Integrity
  confidentiality?: Confidentiality
  className?: string
}

/**
 * Nhãn chữ của chấm — MỘT nguồn cho mọi bề mặt (chấm trong `LabelDot`, chấm trên
 * thẻ lưới Explorer): `Integrity: <nhãn>` / `Confidentiality: <nhãn>`, lấy từ
 * i18n nên theo đúng ngôn ngữ giao diện (B2c).
 */
export function integrityDotTitle(value: Integrity, t: (key: TKey) => string): string {
  return `${t('fileTree.integrityLabel')}: ${t(integrityLabelKey(value))}`
}

export function confidentialityDotTitle(value: Confidentiality, t: (key: TKey) => string): string {
  return `${t('fileTree.confidentialityLabel')}: ${t(confidentialityLabelKey(value))}`
}

export function LabelDot({ integrity, confidentiality, className = '' }: LabelProps) {
  const t = useT()
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {integrity && (
        <span
          className={`size-2 shrink-0 rounded-full ${INTEGRITY_META[integrity].dotClass}`}
          title={integrityDotTitle(integrity, t)}
          aria-label={integrityDotTitle(integrity, t)}
          role="img"
        />
      )}
      {confidentiality && (
        <span
          className={`size-2 shrink-0 rounded-full ${CONFIDENTIALITY_META[confidentiality].dotClass}`}
          title={confidentialityDotTitle(confidentiality, t)}
          aria-label={confidentialityDotTitle(confidentiality, t)}
          role="img"
        />
      )}
    </span>
  )
}

export function IntegrityBadge({ value }: { value: Integrity }) {
  const meta = INTEGRITY_META[value]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  )
}

export function ConfidentialityBadge({ value }: { value: Confidentiality }) {
  const meta = CONFIDENTIALITY_META[value]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  )
}
