/**
 * In-process record of which providers / sub-accounts are currently
 * rate-limited.
 *
 * Populated reactively when an upstream returns a rate-limit status
 * (429), and consulted by the router so it can skip an exhausted entry
 * until its limit window resets. Both maps are process-local — they
 * reset on restart, which is fine: a fresh process re-probes every
 * provider/account on its next request and re-learns the exhausted set
 * from the first 429. Mirrors the in-memory approach used by
 * session-account-router.
 *
 * Two scopes are tracked separately:
 *   - Provider-level: every account in this provider is over its
 *     ceiling, or the provider has no concept of accounts.
 *   - Account-level (subAccountId): one specific subscription account
 *     hit its 5-hour or weekly window, but peer accounts on the same
 *     provider may still be usable. The router checks the account map
 *     first so it can rotate accounts within the same provider before
 *     giving up on the provider as a whole.
 */

// Default cooldown applied when the caller has no precise reset time
// from the usage API. Subscription limits reset on much longer windows,
// but a short default keeps the router re-probing the primary instead of
// pinning the fallback forever. The proactive path (which knows the real
// resetAt from the usage poll) supplies a precise `until` instead.
const DEFAULT_COOLDOWN_MS = 5 * 60_000

// Build a TTL-keyed exhaustion map. Both the provider-level and the
// account-level marks share the exact same semantics — auto-evict on
// read once the deadline passes, never let a default cooldown shorten a
// more precise expiry — so the storage + behaviour lives in one place
// and the two public APIs are thin named wrappers around it.
const createExhaustionMap = (): {
  mark: (key: string, until?: number) => void
  is: (key: string) => boolean
  clear: (key: string) => void
} => {
  const map = new Map<string, number>()
  return {
    mark: (key, until) => {
      const now = Date.now()
      const resolved = typeof until === 'number' && until > now ? until : now + DEFAULT_COOLDOWN_MS
      const current = map.get(key)
      if (current === undefined || resolved > current) map.set(key, resolved)
    },
    is: (key) => {
      const until = map.get(key)
      if (until === undefined) return false
      if (until <= Date.now()) {
        map.delete(key)
        return false
      }
      return true
    },
    clear: (key) => {
      map.delete(key)
    }
  }
}

const providerMap = createExhaustionMap()
const accountMap = createExhaustionMap()

// Mark a provider as rate-limited until `until` (epoch millis). When
// `until` is absent or already in the past, fall back to a short
// cooldown. Never shortens an existing, later expiry — a precise resetAt
// shouldn't be clobbered by a subsequent default-cooldown mark.
export const markProviderExhausted = (providerName: string, until?: number): void =>
  providerMap.mark(providerName, until)

// True when the provider is currently within an exhaustion window.
// Expired entries are evicted on read so the next probe goes back to the
// primary automatically.
export const isProviderExhausted = (providerName: string): boolean => providerMap.is(providerName)

// Drop a provider's exhaustion mark (e.g. after a successful response
// proves the window has reset).
export const clearProviderExhaustion = (providerName: string): void => providerMap.clear(providerName)

// Mark a specific subscription account as rate-limited. Account-level
// is finer-grained than provider-level: a single 429 on account A
// redirects peer requests to accounts B/C in the same provider, not the
// entire provider's fallback chain.
export const markAccountExhausted = (subAccountId: string, until?: number): void => accountMap.mark(subAccountId, until)

// True when the account is currently within an exhaustion window.
// Expired entries are evicted on read.
export const isAccountExhausted = (subAccountId: string): boolean => accountMap.is(subAccountId)

// Drop an account's exhaustion mark (e.g. after a successful response
// proves the window has reset, or to clear test state).
export const clearAccountExhaustion = (subAccountId: string): void => accountMap.clear(subAccountId)
