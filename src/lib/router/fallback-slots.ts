// Pull the "provider" segment off a "provider,model" wire string. Empty
// when the value is null/undefined/'' (no primary picked yet, in which
// case there is no same-provider rule to enforce).
export function providerOf(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  const idx = value.indexOf(',')
  return idx === -1 ? value : value.slice(0, idx)
}

// Pull the "model" segment off a "provider,model" wire string. Empty
// when the value is null/undefined/''. Used when a summary label wants
// to save width by dropping the provider prefix (the map's model
// column already implies the provider).
export function modelNameOf(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  const idx = value.indexOf(',')
  return idx === -1 ? value : value.slice(idx + 1)
}
