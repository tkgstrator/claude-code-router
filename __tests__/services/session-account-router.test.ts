/**
 * Tests for session-account-router — the per-session account picker.
 *
 * Both data sources the picker depends on are mocked so the suite never
 * touches the DB or the network:
 *   - `getSubAccountTokensForKind` lists the enabled accounts of a kind
 *     (would otherwise need the DB + token decryption).
 *   - `getPerAccountUsage` returns the per-account hard-limit window
 *     state the picker consults (would otherwise need the
 *     SubAccountUsage table).
 *
 * Tests pin the clock against deterministic resetAt values via the
 * `NOW` constant so the time terms don't drift.
 */

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { clearAccountExhaustion, markAccountExhausted } from '../../src/services/failover-state'
import { CLAUDE_METRICS, type AccountUsageMap, type Metric } from '../../src/services/subaccount-usage-store'
import type { SubAccountTokenInfo } from '../../src/services/subscription-account-sync-service'

// Mutable lists / maps the mocks return. Tests reset and reseed these
// before each invocation of the router.
let claudeAccounts: SubAccountTokenInfo[] = []
let perAccountUsage: Map<string, AccountUsageMap> = new Map()

mock.module('../../src/services/subscription-account-sync-service', () => ({
  getSubAccountTokensForKind: async (kind: 'claude' | 'codex'): Promise<SubAccountTokenInfo[]> =>
    kind === 'claude' ? claudeAccounts : []
}))

mock.module('../../src/services/subaccount-usage-store', async () => {
  // Re-export everything from the real module so the type values
  // (CLAUDE_METRICS, etc.) the router still imports remain available;
  // only swap `getPerAccountUsage` for the test-controlled stub.
  const real = await import('../../src/services/subaccount-usage-store')
  return {
    ...real,
    getPerAccountUsage: async (subAccountIds: string[]): Promise<Map<string, AccountUsageMap>> => {
      const out = new Map<string, AccountUsageMap>(subAccountIds.map((id) => [id, perAccountUsage.get(id) ?? new Map()]))
      return out
    }
  }
})

// Imported after the mocks are registered so the router binds to the stubs.
const { resolveAccountForSession, getActiveAccountForSession, releaseAccountForSession } = await import(
  '../../src/services/session-account-router'
)

// A 7-day window in ms and a fixed `now` sitting exactly halfway through a
// window whose reset is a further half-window away => linear target 50%.
const SEVEN_DAY_MS = 7 * 86_400_000
const NOW = 1_000_000_000_000
const HALFWAY_RESET = new Date(NOW + SEVEN_DAY_MS / 2)

const account = (subAccountId: string): SubAccountTokenInfo => ({
  subAccountId,
  displayName: subAccountId,
  accessToken: `token-${subAccountId}`,
  refreshToken: null,
  accountId: null,
  expiresAt: null
})

// Build a synthetic per-account usage map. By default every window
// resets at HALFWAY_RESET and lives below the hard-limit threshold so
// the picker passes the gate — individual tests override specific
// windows to exercise the branches.
const usage = (overrides: Partial<Record<Metric, { percent: number; resetAt: Date | null }>>): AccountUsageMap => {
  const m: AccountUsageMap = new Map()
  m.set(CLAUDE_METRICS.five_hour, { percent: 10, resetAt: HALFWAY_RESET })
  m.set(CLAUDE_METRICS.seven_day, { percent: 40, resetAt: HALFWAY_RESET })
  m.set(CLAUDE_METRICS.seven_day_sonnet, { percent: 30, resetAt: HALFWAY_RESET })
  m.set(CLAUDE_METRICS.seven_day_opus, { percent: 50, resetAt: HALFWAY_RESET })
  for (const [k, v] of Object.entries(overrides)) m.set(k as Metric, v as { percent: number; resetAt: Date | null })
  return m
}

beforeEach(() => {
  claudeAccounts = []
  perAccountUsage = new Map()
  clearAccountExhaustion('a1')
  clearAccountExhaustion('a2')
  clearAccountExhaustion('a3')
  clearAccountExhaustion('solo')
})

afterEach(() => {
  clearAccountExhaustion('a1')
  clearAccountExhaustion('a2')
  clearAccountExhaustion('a3')
  clearAccountExhaustion('solo')
})

test('returns null when no accounts exist', async () => {
  expect(await resolveAccountForSession('s-none', 'claude', NOW)).toBeNull()
})

test('returns the only account without consulting usage', async () => {
  claudeAccounts = [account('solo')]
  const picked = await resolveAccountForSession('s-solo', 'claude', NOW)
  expect(picked?.subAccountId).toBe('solo')
})

test('picks the account with the highest required burn rate (same resetAt)', async () => {
  // Same resetAt: timeRemaining cancels, so larger pctRemaining wins.
  // a1 opus 20% (pctRemaining 80) beats a2 opus 45% (pctRemaining 55).
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 20, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 45, resetAt: HALFWAY_RESET } }))
  const picked = await resolveAccountForSession('s-opus', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a1')
})

test('picks the nearer-reset account when both have the same usage', async () => {
  // Same pctRemaining: smaller timeRemainingMs wins. a1 resets in 1
  // day, a2 in 6 days — a1 must burn faster, so a1 is picked.
  const nearReset = new Date(NOW + 1 * 86_400_000)
  const farReset = new Date(NOW + 6 * 86_400_000)
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 50, resetAt: nearReset } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 50, resetAt: farReset } }))
  const picked = await resolveAccountForSession('s-near', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a1')
})

test('a never-polled account reads as MAX_PRIORITY and is preferred', async () => {
  // a1 has DB usage with a finite burn rate; a2 has no row at all.
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 50, resetAt: HALFWAY_RESET } }))
  const picked = await resolveAccountForSession('s-fresh', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

// ─── Hard-limit filter (7d + 5h) ───────────────────────────────────────

test('a 7d-opus 100% account is filtered out even when its burn-rate score would win', async () => {
  // a1 would normally win on burn rate, but its 7d-opus is at 100%
  // with a future resetAt — guaranteed 429 if we picked it.
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 100, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 60, resetAt: HALFWAY_RESET } }))
  const picked = await resolveAccountForSession('s-7d-hit', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('a 5h 100% account is filtered out even when its 7d windows have headroom', async () => {
  // a1's 5h is pinned at 100% — even though 7d Opus is fresh, the
  // request would 429 immediately, so prefer a2.
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set(
    'a1',
    usage({
      [CLAUDE_METRICS.five_hour]: { percent: 100, resetAt: HALFWAY_RESET },
      [CLAUDE_METRICS.seven_day_opus]: { percent: 10, resetAt: HALFWAY_RESET }
    })
  )
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 60, resetAt: HALFWAY_RESET } }))
  const picked = await resolveAccountForSession('s-5h-hit', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('a 5h 100% account with resetAt already passed is NOT filtered (stale cache)', async () => {
  // a1's cached 5h shows 100% but resetsAt is in the past — the cache
  // is stale across the reset. The picker should treat this as cleared
  // and let the account back into the candidate set so the next
  // request triggers a refresh (and probably succeeds).
  const pastReset = new Date(NOW - 10 * 60_000)
  claudeAccounts = [account('a1')]
  perAccountUsage.set(
    'a1',
    usage({
      [CLAUDE_METRICS.five_hour]: { percent: 100, resetAt: pastReset },
      [CLAUDE_METRICS.seven_day_opus]: { percent: 60, resetAt: HALFWAY_RESET }
    })
  )
  const picked = await resolveAccountForSession('s-stale', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a1')
})

test('when EVERY account has a hard limit hit, the router still returns one (fall-through)', async () => {
  // No peer has headroom — both 7d-opus pinned. The router must not
  // return null (that would 401 the client); it falls through to the
  // not-exhausted set and picks by score (highest burn rate wins).
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 100, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 100, resetAt: HALFWAY_RESET } }))
  const picked = await resolveAccountForSession('s-all-hit', 'claude', NOW)
  expect(picked).not.toBeNull()
})

// ─── Reactive account exhaustion filtering ─────────────────────────────

test('an exhausted account is filtered out and the router picks a peer', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 20, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 45, resetAt: HALFWAY_RESET } }))
  markAccountExhausted('a1', NOW + 5 * 60_000)
  const picked = await resolveAccountForSession('s-acct-exh', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('exhausting the sticky account causes a repick on the next call', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 20, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 45, resetAt: HALFWAY_RESET } }))
  const first = await resolveAccountForSession('s-sticky-exh', 'claude', NOW)
  expect(first?.subAccountId).toBe('a1')

  markAccountExhausted('a1', NOW + 5 * 60_000)
  const second = await resolveAccountForSession('s-sticky-exh', 'claude', NOW)
  expect(second?.subAccountId).toBe('a2')
})

// ─── Sticky session ────────────────────────────────────────────────────

test('a known session sticks to its previously-chosen account', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 20, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 45, resetAt: HALFWAY_RESET } }))
  const first = await resolveAccountForSession('s-sticky', 'claude', NOW)
  expect(first?.subAccountId).toBe('a1')
  // Flip the usage so a2 now has more headroom; the sticky map must keep
  // returning a1 for the same session id.
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 48, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 10, resetAt: HALFWAY_RESET } }))
  const second = await resolveAccountForSession('s-sticky', 'claude', NOW)
  expect(second?.subAccountId).toBe('a1')
})

test('a sticky account that is gone triggers a repick', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 20, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 45, resetAt: HALFWAY_RESET } }))
  const first = await resolveAccountForSession('s-gone', 'claude', NOW)
  expect(first?.subAccountId).toBe('a1')
  claudeAccounts = [account('a2')]
  const second = await resolveAccountForSession('s-gone', 'claude', NOW)
  expect(second?.subAccountId).toBe('a2')
})

// ─── Helper exports used by the reactive 429 path ──────────────────────

test('getActiveAccountForSession returns the picked subAccountId', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 20, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 45, resetAt: HALFWAY_RESET } }))
  await resolveAccountForSession('s-active', 'claude', NOW)
  expect(getActiveAccountForSession('s-active')).toBe('a1')
})

test('getActiveAccountForSession returns null when the session has no sticky', () => {
  expect(getActiveAccountForSession('s-never-seen')).toBeNull()
})

test('releaseAccountForSession drops the sticky only when the subAccountId matches', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  perAccountUsage.set('a1', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 20, resetAt: HALFWAY_RESET } }))
  perAccountUsage.set('a2', usage({ [CLAUDE_METRICS.seven_day_opus]: { percent: 45, resetAt: HALFWAY_RESET } }))
  await resolveAccountForSession('s-release', 'claude', NOW)
  expect(getActiveAccountForSession('s-release')).toBe('a1')

  releaseAccountForSession('s-release', 'a2')
  expect(getActiveAccountForSession('s-release')).toBe('a1')

  releaseAccountForSession('s-release', 'a1')
  expect(getActiveAccountForSession('s-release')).toBeNull()
})
