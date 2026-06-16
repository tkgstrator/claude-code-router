import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { ClaudeUsage, CodexUsage } from '../../src/schemas/usage.dto'
import {
  __clearUsageCachesForTest,
  __seedClaudeCacheForTest,
  __seedCodexCacheForTest,
  drainTarget,
  getAccountWindow,
  getKindWindowHeadroom,
  headroomFrom,
  PROACTIVE_THRESHOLD_PCT
} from '../../src/services/usage-service'

test('an empty cache reads as available (proactive only acts on real data)', () => {
  expect(headroomFrom([])).toEqual({ overLimit: false, resetAt: null })
})

test('one account with headroom keeps the whole kind available', () => {
  const result = headroomFrom([
    { pct: PROACTIVE_THRESHOLD_PCT, resetAt: 1000 },
    { pct: 40, resetAt: 2000 }
  ])
  expect(result).toEqual({ overLimit: false, resetAt: null })
})

test('every account at/over threshold is over-limit, with the earliest reset', () => {
  const result = headroomFrom([
    { pct: 99, resetAt: 5000 },
    { pct: PROACTIVE_THRESHOLD_PCT, resetAt: 3000 }
  ])
  expect(result).toEqual({ overLimit: true, resetAt: 3000 })
})

test('over-limit with no known reset time returns a null reset', () => {
  expect(headroomFrom([{ pct: 100, resetAt: null }])).toEqual({ overLimit: true, resetAt: null })
})

test('just under the threshold still counts as available', () => {
  expect(headroomFrom([{ pct: PROACTIVE_THRESHOLD_PCT - 1, resetAt: 1000 }])).toEqual({
    overLimit: false,
    resetAt: null
  })
})

// ---- drainTarget (pure) --------------------------------------------

// A 7-day window in ms, and a fixed `now` sitting exactly halfway through
// a window whose reset is a further half-window away. At the half mark the
// linear target is 50%.
const SEVEN_DAY_MS = 7 * 86_400_000
const NOW = 1_000_000_000_000
// resetAt is half a window in the future => now is at the 50% mark.
const HALFWAY_RESET = NOW + SEVEN_DAY_MS / 2

test('drainTarget: pct just below target is not over and keeps positive headroom', () => {
  const t = drainTarget({ pct: 49, resetAt: HALFWAY_RESET }, SEVEN_DAY_MS, NOW)
  expect(t.targetPct).toBe(50)
  expect(t.overTarget).toBe(false)
  expect(t.headroom).toBe(1)
})

test('drainTarget: pct just above target is over with negative headroom', () => {
  const t = drainTarget({ pct: 51, resetAt: HALFWAY_RESET }, SEVEN_DAY_MS, NOW)
  expect(t.targetPct).toBe(50)
  expect(t.overTarget).toBe(true)
  expect(t.headroom).toBe(-1)
})

test('drainTarget: null resetAt yields null target and is never over', () => {
  const t = drainTarget({ pct: 80, resetAt: null }, SEVEN_DAY_MS, NOW)
  expect(t.targetPct).toBeNull()
  expect(t.headroom).toBeNull()
  expect(t.overTarget).toBe(false)
})

test('drainTarget: null/non-positive windowLength yields null target and is never over', () => {
  expect(drainTarget({ pct: 80, resetAt: HALFWAY_RESET }, null, NOW).overTarget).toBe(false)
  expect(drainTarget({ pct: 80, resetAt: HALFWAY_RESET }, 0, NOW).targetPct).toBeNull()
})

test('drainTarget: marginPct widens the over-target threshold', () => {
  // 2 points over the 50% target. With a 3-point margin it is no longer over.
  const usage = { pct: 52, resetAt: HALFWAY_RESET }
  expect(drainTarget(usage, SEVEN_DAY_MS, NOW, 0).overTarget).toBe(true)
  expect(drainTarget(usage, SEVEN_DAY_MS, NOW, 3).overTarget).toBe(false)
})

test('drainTarget: elapsedFraction clamps to [0,1] past the reset', () => {
  // resetAt already in the past => elapsedFraction clamps to 1 => target 100.
  const t = drainTarget({ pct: 90, resetAt: NOW - SEVEN_DAY_MS }, SEVEN_DAY_MS, NOW)
  expect(t.targetPct).toBe(100)
  expect(t.overTarget).toBe(false)
})

// ---- cache-backed helpers ------------------------------------------

beforeEach(() => {
  __clearUsageCachesForTest()
})

afterEach(() => {
  __clearUsageCachesForTest()
})

const makeClaudeUsage = (resetAt: string): ClaudeUsage => ({
  accountLabel: 'acct',
  fiveHour: { utilization: 10, resetsAt: resetAt },
  sevenDay: { utilization: 40, resetsAt: resetAt },
  sevenDaySonnet: { utilization: 30, resetsAt: resetAt },
  sevenDayOpus: { utilization: 88, resetsAt: resetAt },
  extraUsageEnabled: false,
  capturedAt: resetAt
})

const makeCodexUsage = (resetAt: string): CodexUsage => ({
  accountLabel: 'acct',
  planType: 'pro',
  primary: { usedPercent: 12, resetAt, windowSeconds: 5 * 3600 },
  secondary: { usedPercent: 77, resetAt, windowSeconds: 7 * 86_400 },
  capturedAt: resetAt
})

test('getAccountWindow: returns null when there is no cached data', () => {
  expect(getAccountWindow('missing', 'claude', 'five_hour')).toBeNull()
  expect(getAccountWindow('missing', 'codex', 'primary')).toBeNull()
})

test('getAccountWindow: reads the requested claude window (opus vs five_hour)', () => {
  const iso = new Date(NOW).toISOString()
  __seedClaudeCacheForTest('a1', makeClaudeUsage(iso), NOW)
  expect(getAccountWindow('a1', 'claude', 'five_hour')).toEqual({ pct: 10, resetAt: NOW })
  expect(getAccountWindow('a1', 'claude', 'seven_day_opus')).toEqual({ pct: 88, resetAt: NOW })
})

test('getAccountWindow: reads the requested codex window (secondary vs primary)', () => {
  const iso = new Date(NOW).toISOString()
  __seedCodexCacheForTest('c1', makeCodexUsage(iso), NOW)
  expect(getAccountWindow('c1', 'codex', 'primary')).toEqual({ pct: 12, resetAt: NOW })
  expect(getAccountWindow('c1', 'codex', 'secondary')).toEqual({ pct: 77, resetAt: NOW })
})

test('getKindWindowHeadroom: over only when every account is over target for that window', () => {
  // Window opened SEVEN_DAY_MS before reset; both reset half a window out
  // so the linear target is 50%. Opus pcts 60 and 70 are both over target.
  const reset = new Date(HALFWAY_RESET).toISOString()
  const hot = makeClaudeUsage(reset)
  __seedClaudeCacheForTest('a1', { ...hot, sevenDayOpus: { utilization: 60, resetsAt: reset } }, NOW)
  __seedClaudeCacheForTest('a2', { ...hot, sevenDayOpus: { utilization: 70, resetsAt: reset } }, NOW)
  expect(getKindWindowHeadroom('claude', 'seven_day_opus', NOW)).toEqual({
    overTarget: true,
    resetAt: HALFWAY_RESET
  })
})

test('getKindWindowHeadroom: one account under target keeps the kind not over, earliest reset', () => {
  const resetEarly = new Date(HALFWAY_RESET).toISOString()
  const resetLate = new Date(HALFWAY_RESET + 1000).toISOString()
  const base = makeClaudeUsage(resetEarly)
  // a1 over target (60 > 50), a2 under target (40 < 50).
  __seedClaudeCacheForTest('a1', { ...base, sevenDayOpus: { utilization: 60, resetsAt: resetEarly } }, NOW)
  __seedClaudeCacheForTest('a2', { ...base, sevenDayOpus: { utilization: 40, resetsAt: resetLate } }, NOW)
  const result = getKindWindowHeadroom('claude', 'seven_day_opus', NOW)
  expect(result.overTarget).toBe(false)
  expect(result.resetAt).toBe(HALFWAY_RESET)
})

test('getKindWindowHeadroom: empty cache reads as not over', () => {
  expect(getKindWindowHeadroom('claude', 'seven_day_opus', NOW)).toEqual({ overTarget: false, resetAt: null })
  expect(getKindWindowHeadroom('codex', 'secondary', NOW)).toEqual({ overTarget: false, resetAt: null })
})
