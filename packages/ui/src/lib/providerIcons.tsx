import * as si from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'

// Vendor → simple-icons slug. Vendors not in simple-icons (openai,
// moonshot-ai at v16) fall back to a first-letter badge below.
const VENDOR_ICON_SLUG: Record<string, keyof typeof si> = {
  anthropic: 'siAnthropic',
  google: 'siGooglegemini',
  deepseek: 'siDeepseek',
  mistral: 'siMistralai',
  qwen: 'siQwen',
  xai: 'siX',
  minimax: 'siMinimax'
}

interface ProviderIconProps {
  name: string
  size?: number
  className?: string
}

export function ProviderIcon({ name, size = 20, className }: ProviderIconProps) {
  const slug = VENDOR_ICON_SLUG[name]
  const icon = slug ? (si[slug] as SimpleIcon | undefined) : undefined
  if (icon) {
    return (
      <svg
        role='img'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
        width={size}
        height={size}
        fill={`#${icon.hex}`}
        className={className}
        aria-label={icon.title}
      >
        <path d={icon.path} />
      </svg>
    )
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded bg-muted text-xs font-medium uppercase text-muted-foreground ${className ?? ''}`}
      style={{ width: size, height: size }}
      aria-label={name}
    >
      {name.charAt(0)}
    </span>
  )
}
