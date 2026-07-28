// Numeric formatters for the Sessions view. Kept dependency-free so they
// can be unit-tested without pulling React or i18n into the harness.

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function fmtCost(usd: number | null): string {
  if (usd == null) return '–'
  if (usd < 0.00001) return '<$0.00001'
  return `$${usd.toFixed(5)}`
}

export function fmtMs(ms: number): string {
  if (ms >= 1_000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}
