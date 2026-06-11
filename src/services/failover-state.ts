/**
 * In-process record of which providers are currently rate-limited.
 *
 * Populated reactively when an upstream returns a rate-limit status
 * (429), and consulted by the router so it can skip an exhausted
 * provider's slot until its limit window resets. The map is
 * process-local — it resets on restart, which is fine: a fresh process
 * re-probes every provider on its next request and re-learns the
 * exhausted set from the first 429. Mirrors the in-memory approach used
 * by session-account-router.
 */

// Default cooldown applied when the caller has no precise reset time
// from the usage API. Subscription limits reset on much longer windows,
// but a short default keeps the router re-probing the primary instead of
// pinning the fallback forever. The proactive path (which knows the real
// resetAt from the usage poll) supplies a precise `until` instead.
const DEFAULT_COOLDOWN_MS = 5 * 60_000

// providerName -> epoch millis the limit is expected to clear at.
const exhaustedUntil = new Map<string, number>()

// Mark a provider as rate-limited until `until` (epoch millis). When
// `until` is absent or already in the past, fall back to a short
// cooldown. Never shortens an existing, later expiry — a precise resetAt
// shouldn't be clobbered by a subsequent default-cooldown mark.
export function markProviderExhausted(providerName: string, until?: number): void {
  const now = Date.now()
  const resolved = typeof until === 'number' && until > now ? until : now + DEFAULT_COOLDOWN_MS
  const current = exhaustedUntil.get(providerName)
  if (current === undefined || resolved > current) exhaustedUntil.set(providerName, resolved)
}

// True when the provider is currently within an exhaustion window.
// Expired entries are evicted on read so the next probe goes back to the
// primary automatically.
export function isProviderExhausted(providerName: string): boolean {
  const until = exhaustedUntil.get(providerName)
  if (until === undefined) return false
  if (until <= Date.now()) {
    exhaustedUntil.delete(providerName)
    return false
  }
  return true
}

// Drop a provider's exhaustion mark (e.g. after a successful response
// proves the window has reset).
export function clearProviderExhaustion(providerName: string): void {
  exhaustedUntil.delete(providerName)
}
