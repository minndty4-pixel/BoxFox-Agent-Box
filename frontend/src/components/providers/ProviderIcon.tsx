import { useState } from 'react'

const ICONS: Record<string, string> = {
  antigravity: '/providers/antigravity.png',
  openai: '/providers/openai.svg',
  anthropic: '/providers/anthropic.svg',
  gemini: '/providers/gemini.svg',
  custom: '/providers/custom.svg',
}

export function ProviderIcon({ providerId, name, className = 'size-6' }: { providerId: string; name?: string; className?: string }) {
  const [failedProvider, setFailedProvider] = useState<string | null>(null)
  const label = name ?? providerId
  const src = ICONS[providerId] ?? `/providers/${providerId}.png`

  if (!src || failedProvider === providerId) {
    return (
      <span
        aria-label={`${label} icon`}
        className={`inline-flex shrink-0 items-center justify-center rounded-md border border-line bg-panel2 text-[10px] font-bold uppercase text-muted ${className}`}
      >
        {label.slice(0, 2)}
      </span>
    )
  }

  return <img src={src} alt={`${label} icon`} className={`shrink-0 object-contain ${className}`} onError={() => setFailedProvider(providerId)} />
}
