/**
 * Process-wide de-duplication for OAuth token refreshes.
 *
 * Every vendor we hold a subscription grant for issues a ROTATING
 * refresh_token: the moment one refresh succeeds, the token it consumed
 * is dead. Two callers refreshing the same account concurrently
 * therefore don't just waste a round trip — the loser persists a
 * refresh_token the issuer has already invalidated, and the account
 * needs a manual re-auth.
 *
 * Codex has three independent readers of the same credentials (the proxy
 * hot path, the profile-sync job, and the usage poller), so the lock has
 * to live outside any one of them. Keyed by subAccountId: concurrent
 * calls for one account collapse onto the first in-flight promise, while
 * different accounts still refresh in parallel.
 *
 * Scope is this process only. A second CCR instance pointed at the same
 * database would still race; that needs a DB-level lock, and is out of
 * scope while CCR runs single-instance.
 */

const refreshInFlight = new Map<string, Promise<string>>()

/**
 * Run `refresh` under the lock for `key`, returning the resolved access
 * token. If a refresh for the same key is already running, its promise
 * is returned instead and `refresh` is never invoked.
 */
export const withRefreshLock = (key: string, refresh: () => Promise<string>): Promise<string> => {
  const existing = refreshInFlight.get(key)
  if (existing) return existing
  const started = refresh().finally(() => {
    refreshInFlight.delete(key)
  })
  refreshInFlight.set(key, started)
  return started
}

/** True while a refresh for `key` is in flight. Exposed for tests. */
export const isRefreshInFlight = (key: string): boolean => refreshInFlight.has(key)
