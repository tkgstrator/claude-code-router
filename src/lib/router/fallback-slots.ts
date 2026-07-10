// Slots that carry an ordered fallback chain, in the order they're
// rendered in the Router page's fallback section.
export const FALLBACK_SLOTS = ['default', 'background', 'think', 'webSearch', 'longContext', 'image'] as const

export type FallbackSlot = (typeof FALLBACK_SLOTS)[number]

// Pull the "provider" segment off a "provider,model" wire string. Empty
// when the value is null/undefined/'' (no primary picked yet, in which
// case there is no same-provider rule to enforce).
export function providerOf(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  const idx = value.indexOf(',')
  return idx === -1 ? value : value.slice(0, idx)
}
