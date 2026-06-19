/**
 * Tests for session-account-router — the per-session account picker.
 *
 * Phase 6 S4: account selection now balances on the scarce WEEKLY window
 * (claude: 7d Opus) instead of the 5h window. The picked account is the
 * one furthest behind its linear 7d-Opus drain target (largest headroom),
 * with never-polled accounts treated as maximum headroom.
 *
 * getSubAccountTokensForKind comes from subscription-account-sync-service
 * and would otherwise need the DB + token decryption, so it is mocked.
 * The usage cache is driven through the S1 test seams
 * (__seedClaudeCacheForTest / __clearUsageCachesForTest) so headroom is
 * deterministic without hitting the network.
 */

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type { ClaudeUsage } from '../../src/schemas/usage.dto'
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
const { resolveAccountForSession } = await import('../../src/services/session-account-router')

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
})

afterEach(() => {
  __clearUsageCachesForTest()
})

test('returns null when no accounts exist', async () => {
  claudeAccounts = []
  expect(await resolveAccountForSession('s-none', 'claude')).toBeNull()
})

test('returns the only account without consulting usage', async () => {
  claudeAccounts = [account('solo')]
  const picked = await resolveAccountForSession('s-solo', 'claude')
  expect(picked?.subAccountId).toBe('solo')
})

test('picks the account furthest behind its 7d-Opus drain target', async () => {
  // Target at NOW is 50%. a1 opus 20% => headroom +30; a2 opus 45% =>
  // headroom +5. a1 is further behind target, so it is picked — even
  // though a1 has the HOTTER 5h window (the old metric would pick a2).
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 90), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 5), NOW)
  const picked = await resolveAccountForSession('s-opus', 'claude')
  expect(picked?.subAccountId).toBe('a1')
})

test('a never-polled account reads as maximum headroom and is preferred', async () => {
  // a2 has no cached usage at all => MAX_HEADROOM, beating a1 which is
  // exactly on target (headroom 0).
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(50, 10), NOW)
  const picked = await resolveAccountForSession('s-fresh', 'claude')
  expect(picked?.subAccountId).toBe('a2')
})

test('an account with no computable target reads as maximum headroom', async () => {
  // a1 over target (60 > 50) with a real reset; a2 has a null resetsAt so
  // its drain target is null => MAX_HEADROOM => a2 wins.
  const noReset: ClaudeUsage = {
    ...claudeUsage(99, 99),
    sevenDayOpus: { utilization: 99, resetsAt: null }
  }
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(60, 10), NOW)
  __seedClaudeCacheForTest('a2', noReset, NOW)
  const picked = await resolveAccountForSession('s-noreset', 'claude')
  expect(picked?.subAccountId).toBe('a2')
})

test('a known session sticks to its previously-chosen account', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 90), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 5), NOW)
  const first = await resolveAccountForSession('s-sticky', 'claude')
  expect(first?.subAccountId).toBe('a1')
  // Flip the usage so a2 now has more headroom; the sticky map must keep
  // returning a1 for the same session id.
  __seedClaudeCacheForTest('a1', claudeUsage(48, 5), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(10, 90), NOW)
  const second = await resolveAccountForSession('s-sticky', 'claude')
  expect(second?.subAccountId).toBe('a1')
})

test('a sticky account that is gone triggers a repick', async () => {
  claudeAccounts = [account('a1'), account('a2')]
  __seedClaudeCacheForTest('a1', claudeUsage(20, 0), NOW)
  __seedClaudeCacheForTest('a2', claudeUsage(45, 0), NOW)
  const first = await resolveAccountForSession('s-gone', 'claude')
  expect(first?.subAccountId).toBe('a1')
  // a1 disappears (e.g. disabled). The session must repick among what's
  // left, landing on a2.
  claudeAccounts = [account('a2')]
  const second = await resolveAccountForSession('s-gone', 'claude')
  expect(second?.subAccountId).toBe('a2')
})
