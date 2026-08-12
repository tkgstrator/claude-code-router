import { expect, test } from 'bun:test'
import type { ClaudeUsage, CodexUsage } from '../../../src/schemas/usage.dto'
import { mapClaudeToQuota, mapCodexToQuota } from '../../../src/services/routing-scheduler/collector'

const NOW = new Date('2026-08-11T21:00:00.000Z')
const CLAUDE_FIVE_HOUR_SECONDS = 5 * 60 * 60
const CLAUDE_WEEKLY_SECONDS = 7 * 24 * 60 * 60

const emptyClaude: ClaudeUsage = {
  subAccountId: 'sa_1',
  accountLabel: 'anna',
  fiveHour: null,
  sevenDay: null,
  sevenDaySonnet: null,
  sevenDayOpus: null,
  weeklyScoped: [],
  extraUsageEnabled: false,
  capturedAt: NOW.toISOString()
}

const fullClaude: ClaudeUsage = {
  subAccountId: 'sa_1',
  accountLabel: 'anna',
  fiveHour: { utilization: 42.5, resetsAt: '2026-08-11T22:00:00.000Z' },
  sevenDay: { utilization: 12.0, resetsAt: '2026-08-18T00:00:00.000Z' },
  sevenDaySonnet: null,
  sevenDayOpus: null,
  weeklyScoped: [
    { modelName: 'Fable', utilization: 7.3, resetsAt: '2026-08-18T00:00:00.000Z' },
    { modelName: 'Opus', utilization: 55.0, resetsAt: '2026-08-18T00:00:00.000Z' }
  ],
  extraUsageEnabled: false,
  capturedAt: NOW.toISOString()
}

const emptyCodex: CodexUsage = {
  subAccountId: 'sa_2',
  accountLabel: 'bob',
  planType: null,
  primary: null,
  secondary: null,
  capturedAt: NOW.toISOString()
}

const fullCodex: CodexUsage = {
  subAccountId: 'sa_2',
  accountLabel: 'bob',
  planType: 'plus',
  primary: {
    usedPercent: 30.0,
    resetAt: '2026-08-11T22:15:00.000Z',
    windowSeconds: 18_000
  },
  secondary: {
    usedPercent: 80.0,
    resetAt: '2026-08-18T00:00:00.000Z',
    windowSeconds: 604_800
  },
  capturedAt: NOW.toISOString()
}

test('mapClaudeToQuota with empty usage → all window fields null and empty scoped', () => {
  const out = mapClaudeToQuota(emptyClaude, NOW)
  expect(out.fiveHourUsed).toBeNull()
  expect(out.fiveHourLimit).toBeNull()
  expect(out.fiveHourResetAt).toBeNull()
  expect(out.fiveHourWindowSeconds).toBeNull()
  expect(out.weeklyUsed).toBeNull()
  expect(out.weeklyLimit).toBeNull()
  expect(out.weeklyResetAt).toBeNull()
  expect(out.weeklyWindowSeconds).toBeNull()
  // JsonNull sentinel (not an empty object) — round-trips as JSONB null.
  expect(out.scopedWindows).toBeDefined()
  expect(out.quotaRefreshedAt).toEqual(NOW)
})

test('mapClaudeToQuota with populated windows → pct + limit=100 + fixed window seconds', () => {
  const out = mapClaudeToQuota(fullClaude, NOW)
  expect(out.fiveHourUsed).toBe(42.5)
  expect(out.fiveHourLimit).toBe(100)
  expect(out.fiveHourResetAt).toEqual(new Date('2026-08-11T22:00:00.000Z'))
  expect(out.fiveHourWindowSeconds).toBe(CLAUDE_FIVE_HOUR_SECONDS)
  expect(out.weeklyUsed).toBe(12)
  expect(out.weeklyLimit).toBe(100)
  expect(out.weeklyResetAt).toEqual(new Date('2026-08-18T00:00:00.000Z'))
  expect(out.weeklyWindowSeconds).toBe(CLAUDE_WEEKLY_SECONDS)
})

test('mapClaudeToQuota emits scopedWindows keyed by slug with used/limit/resetAt', () => {
  const out = mapClaudeToQuota(fullClaude, NOW)
  // slug convention mirrors scopedMetricKey without the "claude.seven_day_scoped." prefix.
  const scoped = out.scopedWindows as Record<string, { used: number; limit: number; resetAt: string | null }>
  expect(scoped.fable).toEqual({ used: 7.3, limit: 100, resetAt: '2026-08-18T00:00:00.000Z' })
  expect(scoped.opus).toEqual({ used: 55.0, limit: 100, resetAt: '2026-08-18T00:00:00.000Z' })
})

test('mapCodexToQuota with empty usage → all window fields null', () => {
  const out = mapCodexToQuota(emptyCodex, NOW)
  expect(out.fiveHourUsed).toBeNull()
  expect(out.fiveHourLimit).toBeNull()
  expect(out.fiveHourResetAt).toBeNull()
  expect(out.fiveHourWindowSeconds).toBeNull()
  expect(out.weeklyUsed).toBeNull()
  expect(out.weeklyLimit).toBeNull()
  expect(out.weeklyResetAt).toBeNull()
  expect(out.weeklyWindowSeconds).toBeNull()
})

test('mapCodexToQuota preserves upstream window_seconds (not a Claude-style constant)', () => {
  const out = mapCodexToQuota(fullCodex, NOW)
  expect(out.fiveHourUsed).toBe(30)
  expect(out.fiveHourLimit).toBe(100)
  expect(out.fiveHourWindowSeconds).toBe(18_000)
  expect(out.weeklyUsed).toBe(80)
  expect(out.weeklyLimit).toBe(100)
  expect(out.weeklyWindowSeconds).toBe(604_800)
})

test('mapClaudeToQuota with only 5h window populated → weekly stays fully null', () => {
  const partial: ClaudeUsage = {
    ...emptyClaude,
    fiveHour: { utilization: 75.0, resetsAt: '2026-08-11T22:00:00.000Z' }
  }
  const out = mapClaudeToQuota(partial, NOW)
  expect(out.fiveHourUsed).toBe(75)
  expect(out.fiveHourLimit).toBe(100)
  expect(out.weeklyUsed).toBeNull()
  expect(out.weeklyLimit).toBeNull()
  expect(out.weeklyResetAt).toBeNull()
})

test('mapClaudeToQuota tolerates a malformed resetsAt string by mapping to null', () => {
  const bad: ClaudeUsage = {
    ...emptyClaude,
    fiveHour: { utilization: 10, resetsAt: 'not-an-iso' }
  }
  const out = mapClaudeToQuota(bad, NOW)
  expect(out.fiveHourUsed).toBe(10)
  expect(out.fiveHourResetAt).toBeNull()
})
