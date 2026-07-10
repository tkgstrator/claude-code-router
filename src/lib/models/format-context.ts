// 1_000_000 → "1M", 1_050_000 → "1.05M", 200_000 → "200K", else the
// raw count. Null when the vendor doesn't publish a context window.
export function formatContext(n: number | undefined): string | null {
  if (!n || n <= 0) return null
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : parseFloat(m.toFixed(2))}M`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
