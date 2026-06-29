/**
 * Tests for session-account-router — the per-session account picker.
 *
 * Phase 6 S4: account selection balances on the scarce WEEKLY window
 * (claude: 7d Opus) instead of the 5h window. As of the time-aware
 * refresh, the picked account is the one with the highest required
 * burn rate on that window — pctRemaining / timeRemainingMs — so
 * near-reset accounts that still have headroom are drained first, and
 * already-burnt-out accounts (pctRemaining ≤ 0) are deprioritised. The
 * old "furthest behind linear drain" tests still pass because they hold
 * timeRemaining constant; the new tests below exercise the time term.
 *
 * getSubAccountTokensForKind comes from subscription-account-sync-service
 * and would otherwise need the DB + token decryption, so it is mocked.
 * The usage cache is driven through the S1 test seams
 * (__seedClaudeCacheForTest / __clearUsageCachesForTest) so the score is
 * deterministic without hitting the network.
 */

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type { ClaudeUsage } from '../../src/schemas/usage.dto'
import { clearAccountExhaustion, markAccountExhausted } from '../../src/services/failover-state'
import type { SubAccountTokenInfo } from '../../src/services/subscription-account-sync-service'
import { __clearUsageCachesForTest, __seedClaudeCacheForTest } from '../../src/services/usage-service'

// Mutable list the mocked getSubAccountTokensForKind returns. Tests set
// this before invoking the router.
let claudeAccounts: SubAccountTokenInfo[] = []

mock.module('../../src/services/subscription-account-sync-service', () => ({
  getSubAccountTokensForKind: async (kind: 'claude' | 'codex'): Promise<SubAccountTokenInfo[]> =>
    kind === 'claude' ? claudeAccounts : []
}))

// Imported after the mock is registered so the router binds to the stub.
const { resolveAccountForSession, getActiveAccountForSession, releaseAccountForSession } = await import(
  '../../src/services/session-account-router'
)

// A 7-day window in ms and a fixed `now` sitting exactly halfway through a
// window whose reset is a further half-window away => linear target 50%.
const SEVEN_DAY_MS = 7 * 86_400_000
const NOW = 1_000_000_000_000
const HALFWAY_RESET_ISO = new Date(NOW + SEVEN_DAY_MS / 2).toISOString()

const account = (subAccountId: string): SubAccountTokenInfo => ({
  subAccountId,
  displayName: subAccountId,
  accessToken: `token-${subAccountId}`,
  refreshToken: null,
  accountId: null,
  expiresAt: null
})

// Claude snapshot whose 7d-Opus utilization is `opusPct` at the halfway
// reset. Other windows are filled with arbitrary values to prove the
// picker ignores them (notably fiveHour, the old 5h metric).
const claudeUsage = (opusPct: number, fiveHourPct: number): ClaudeUsage => ({
  accountLabel: 'acct',
  fiveHour: { utilization: fiveHourPct, resetsAt: HALFWAY_RESET_ISO },
  sevenDay: { utilization: 40, resetsAt: HALFWAY_RESET_ISO },
  sevenDaySonnet: { utilization: 30, resetsAt: HALFWAY_RESET_ISO },
  sevenDayOpus: { utilization: opusPct, resetsAt: HALFWAY_RESET_ISO },
  extraUsageEnabled: false,
  capturedAt: HALFWAY_RESET_ISO
})

beforeEach(() => {
  __clearUsageCachesForTest()
  claudeAccounts = []
  // Account-level exhaustion is module-global; reset for the accounts
  // any test in this file touches so cases stay independent.
  clearAccountExhaustion('a1')
  clearAccountExhaustion('a2')
  clearAccountExhaustion('a3')
  clearAccountExhaustion('solo')
})

afterEach(() => {
  __clearUsageCachesForTest()
  clearAccountExhaustion('a1')
  clearAccountExhaustion('a2')
  clearAccountExhaustion('a3')
  clearAccountExhaustion('solo')
})

test('returns null when no accounts exist', async () => {
  claudeAccounts = []
  expect(await resolveAccountForSession('s-none', 'claude', NOW)).toBeNull()
})

test('returns the only account without consulting usage', async () => {
  claudeAccounts = [account('solo')]
  const picked = await resolveAccountForSession('s-solo', 'claude', NOW)
  expect(picked?.subAccountId).toBe('solo')
})

test('picks the account with the highest required burn rate (same resetAt)', async () => {
  // Same resetAt: timeRemaining cancels, so the larger pctRemaining
  // wins. a1 opus 20% (pctRemaining 80) beats a2 opus 45%
  // (pctRemaining 55) — same direction as the old "furthest behind
  // drain" pick, even though a1 has the HOTTER 5h window.
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 90), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 5), NOW)
  const picked = await resolveAccountForSession('s-opus', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a1')
})

test('picks the nearer-reset account when both have the same usage', async () => {
  // Same pctRemaining (50): smaller timeRemainingMs wins. a1 resets in
  // 1 day, a2 in 6 days — a1 must burn faster to fully consume its
  // remaining quota by reset, so a1 is picked.
  const nearReset = new Date(NOW + 1 * 86_400_000).toISOString()
  const farReset = new Date(NOW + 6 * 86_400_000).toISOString()
  const usageWithReset = (opusPct: number, resetIso: string): ClaudeUsage => ({
    ...claudeUsage(opusPct, 0),
    sevenDayOpus: { utilization: opusPct, resetsAt: resetIso }
  })
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', usageWithReset(50, nearReset), NOW)
  __seedClaudeCacheForTest('a2', usageWithReset(50, farReset), NOW)
  const picked = await resolveAccountForSession('s-near', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a1')
})

test('a near-reset but fully-drained account loses to a far-reset account with headroom', async () => {
  // a1: resets in 1 day, 100% used → pctRemaining 0 → score -Infinity.
  // a2: resets in 6 days, 20% used → finite positive score.
  // a2 should win — there is no quota to dump on a1.
  const nearReset = new Date(NOW + 1 * 86_400_000).toISOString()
  const farReset = new Date(NOW + 6 * 86_400_000).toISOString()
  const drained: ClaudeUsage = {
    ...claudeUsage(100, 0),
    sevenDayOpus: { utilization: 100, resetsAt: nearReset }
  }
  const fresh: ClaudeUsage = {
    ...claudeUsage(20, 0),
    sevenDayOpus: { utilization: 20, resetsAt: farReset }
  }
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', drained, NOW)
  __seedClaudeCacheForTest('a2', fresh, NOW)
  const picked = await resolveAccountForSession('s-drained', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('a never-polled account reads as MAX_PRIORITY and is preferred', async () => {
  // a2 has no cached usage at all => MAX_PRIORITY, beating a1 which
  // has a finite required burn rate.
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(50, 10), NOW)
  const picked = await resolveAccountForSession('s-fresh', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('an account with no resetAt on the balancing window reads as MAX_PRIORITY', async () => {
  // a1 has a real reset and a finite score; a2 has a null resetsAt on
  // the 7d-Opus window so its score is MAX_PRIORITY => a2 wins. Keep
  // both burst (5h) windows below the saturation threshold so the new
  // proactive demote doesn't fire and the test isolates the resetAt
  // branch under exercise.
  const noReset: ClaudeUsage = {
    ...claudeUsage(99, 10),
    sevenDayOpus: { utilization: 99, resetsAt: null }
  }
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(60, 10), NOW)
  __seedClaudeCacheForTest('a2', noReset, NOW)
  const picked = await resolveAccountForSession('s-noreset', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('a known session sticks to its previously-chosen account', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 90), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 5), NOW)
  const first = await resolveAccountForSession('s-sticky', 'claude', NOW)
  expect(first?.subAccountId).toBe('a1')
  // Flip the usage so a2 now has more headroom; the sticky map must keep
  // returning a1 for the same session id.
  __seedClaudeCacheForTest('a1', claudeUsage(48, 5), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(10, 90), NOW)
  const second = await resolveAccountForSession('s-sticky', 'claude', NOW)
  expect(second?.subAccountId).toBe('a1')
})

test('a sticky account that is gone triggers a repick', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 0), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 0), NOW)
  const first = await resolveAccountForSession('s-gone', 'claude', NOW)
  expect(first?.subAccountId).toBe('a1')
  // a1 disappears (e.g. disabled). The session must repick among what's
  // left, landing on a2.
  claudeAccounts = [account('a2')]
  const second = await resolveAccountForSession('s-gone', 'claude', NOW)
  expect(second?.subAccountId).toBe('a2')
})

// ─── 5h burst-window proactive demote ──────────────────────────────────

test('an account with a saturated 5h window is demoted below a fresh peer', async () => {
  // a1 looks "better" on the 7d-Opus burn-rate metric (more pctRemaining
  // there), but its 5h window is saturated (>= PROACTIVE_THRESHOLD_PCT
  // = 95). The proactive demote drops a1 to -Infinity so a2 — which has
  // 5h headroom even though its 7d-Opus is hotter — is picked instead.
  // This is the regression the user hit: routing to a 5h-exhausted
  // account while a peer still had capacity.
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 99), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 10), NOW)
  const picked = await resolveAccountForSession('s-burst', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('when EVERY account is 5h-saturated, the router still returns one (fall-through)', async () => {
  // No peer has headroom — both 5h windows are pinned. The router must
  // not return null (that would 401 the client); -Infinity ties are
  // broken in iteration order so a1 (the first scored) wins. The
  // reactive 429 path takes over from there.
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 99), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 99), NOW)
  const picked = await resolveAccountForSession('s-all-burst', 'claude', NOW)
  expect(picked).not.toBeNull()
})

// ─── Reactive account exhaustion filtering ─────────────────────────────

test('an exhausted account is filtered out and the router picks a peer', async () => {
  // a1 has the strictly better burn-rate score and would normally win,
  // but a 429 marked it exhausted. The router filters a1 out of the
  // candidate set and picks a2 instead.
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 10), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 10), NOW)
  markAccountExhausted('a1', NOW + 5 * 60_000)
  const picked = await resolveAccountForSession('s-acct-exh', 'claude', NOW)
  expect(picked?.subAccountId).toBe('a2')
})

test('when every account is exhausted, the router falls back to the full list', async () => {
  // Both accounts are 429-marked. Returning null here would 401 the
  // client, which is strictly worse than letting the request go out and
  // 429 again (the marks auto-expire on read once cooldown elapses).
  // The exhaustion check still happens reactively on the next 429.
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 10), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 10), NOW)
  markAccountExhausted('a1', NOW + 5 * 60_000)
  markAccountExhausted('a2', NOW + 5 * 60_000)
  const picked = await resolveAccountForSession('s-all-exh', 'claude', NOW)
  expect(picked).not.toBeNull()
})

test('exhausting the sticky account causes a repick on the next call', async () => {
  // First call binds the session to a1. Then a1 hits 429 and the
  // reactive path marks it exhausted; the second call must drop the
  // sticky and pick a2.
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 10), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 10), NOW)
  const first = await resolveAccountForSession('s-sticky-exh', 'claude', NOW)
  expect(first?.subAccountId).toBe('a1')

  markAccountExhausted('a1', NOW + 5 * 60_000)
  const second = await resolveAccountForSession('s-sticky-exh', 'claude', NOW)
  expect(second?.subAccountId).toBe('a2')
})

// ─── Helper exports used by the reactive 429 path ──────────────────────

test('getActiveAccountForSession returns the picked subAccountId', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 10), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 10), NOW)
  await resolveAccountForSession('s-active', 'claude', NOW)
  expect(getActiveAccountForSession('s-active')).toBe('a1')
})

test('getActiveAccountForSession returns null when the session has no sticky', () => {
  expect(getActiveAccountForSession('s-never-seen')).toBeNull()
})

test('releaseAccountForSession drops the sticky only when the subAccountId matches', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 10), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 10), NOW)
  await resolveAccountForSession('s-release', 'claude', NOW)
  expect(getActiveAccountForSession('s-release')).toBe('a1')

  // Mismatched id is a no-op — protects against a stale release racing a
  // concurrent re-pick that already moved the sticky elsewhere.
  releaseAccountForSession('s-release', 'a2')
  expect(getActiveAccountForSession('s-release')).toBe('a1')

  releaseAccountForSession('s-release', 'a1')
  expect(getActiveAccountForSession('s-release')).toBeNull()
})
