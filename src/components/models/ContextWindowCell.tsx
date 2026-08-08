import { useState } from 'react'
import { api } from '@/lib/api'
import { formatContext } from '@/lib/models/format-context'

interface ContextWindowCellProps {
  provider: string
  model: string
  // Current value from the composed config (undefined = not set / unknown).
  value: number | undefined
  // After a successful save, ask ConfigProvider to re-fetch so the row
  // reflects the new persisted value. The parent handles both success
  // toast (silent by default) and error toast.
  onSaved: () => void | Promise<void>
  onError: (message: string) => void
}

// Accepts a raw number ("200000"), a friendly abbreviation ("200k" / "1M"),
// or an empty string ("" = clear). Returns null for clear, a positive
// integer for a value, or 'invalid' for anything else.
function parseContextInput(raw: string): number | null | 'invalid' {
  const s = raw.trim()
  if (s === '') return null
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([kmKM]?)$/)
  if (!m) return 'invalid'
  const base = Number.parseFloat(m[1])
  const suffix = m[2].toLowerCase()
  const mult = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1
  const val = Math.round(base * mult)
  if (!Number.isFinite(val) || val <= 0) return 'invalid'
  return val
}

// Inline-editable cell for a Model's `contextWindow`. Displays the
// formatted value ("128K", "1M") when idle; on focus turns into a
// controlled input. Blur or Enter commits the change via
// PATCH /api/providers/{name}/models/{model} with {contextWindow}.
export function ContextWindowCell({ provider, model, value, onSaved, onError }: ContextWindowCellProps) {
  const initial = value === undefined ? '' : (formatContext(value) ?? '')
  const [draft, setDraft] = useState<string>(initial)
  const [isSaving, setIsSaving] = useState(false)

  const commit = async () => {
    // The user typed the same formatted display back — no-op, keep the
    // input as-is so we don't churn ConfigProvider on every blur.
    if (draft === initial) return
    const parsed = parseContextInput(draft)
    if (parsed === 'invalid') {
      onError(`"${draft}" is not a valid context window (use e.g. 128000, 128k, 1M)`)
      setDraft(initial)
      return
    }
    setIsSaving(true)
    try {
      await api.patch(`/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(model)}`, {
        contextWindow: parsed
      })
      await onSaved()
    } catch (err) {
      onError(`Failed to save context window: ${(err as Error).message}`)
      setDraft(initial)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <input
      type='text'
      inputMode='numeric'
      spellCheck={false}
      autoComplete='off'
      value={draft}
      placeholder='—'
      disabled={isSaving}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(initial)
          e.currentTarget.blur()
        }
      }}
      className='w-20 rounded-none border-b border-transparent bg-transparent px-1 text-right text-xs text-muted-foreground transition-colors hover:border-border focus:border-primary focus:outline-none disabled:opacity-50'
    />
  )
}
