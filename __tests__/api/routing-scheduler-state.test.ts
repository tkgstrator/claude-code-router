import { afterEach, beforeEach, expect, test } from 'bun:test'
import { routingSchedulerStateRoute } from '../../src/api/routing-scheduler-state/route'
import {
  __resetSchedulerStateForTest,
  publishSnapshot,
  recordWeightChanges
} from '../../src/services/routing-scheduler/state'
import type { RoutingSnapshot } from '../../src/services/routing-scheduler/types'

beforeEach(() => {
  __resetSchedulerStateForTest()
})
afterEach(() => {
  __resetSchedulerStateForTest()
})

const call = async (): Promise<Response> =>
  routingSchedulerStateRoute.fetch(new Request('http://local/api/routing-scheduler-state'))

test('cold-boot returns an empty snapshot rather than 404', async () => {
  const res = await call()
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    tickAt: string | null
    tickCount: number
    weights: unknown[]
    accounts: unknown[]
    recentChanges: unknown[]
  }
  expect(body.tickAt).toBeNull()
  expect(body.tickCount).toBe(0)
  expect(body.weights).toEqual([])
  expect(body.accounts).toEqual([])
  expect(body.recentChanges).toEqual([])
})

test('published snapshot serialises with ISO timestamps', async () => {
  const tickAt = 1_700_000_000_000
  const reset = 1_700_000_060_000
  const snap: RoutingSnapshot = {
    tickAt,
    tickCount: 3,
    consecutiveFailures: 0,
    degraded: false,
    weights: new Map([
      [
        'claude-code,fable-5',
        {
          target: 'claude-code,fable-5',
          weight: 0.6,
          healthiness: 0.9,
          remainingBudgetPct: 45,
          earliestResetAt: reset,
          reasons: ['ok']
        }
      ]
    ]),
    accounts: [
      {
        subAccountId: 'sa1',
        providerName: 'claude-code',
        kind: 'claude',
        fiveHour: { used: 45, limit: 100, resetAt: reset, windowLengthMs: 5 * 60 * 60 * 1000 },
        weekly: null,
        refreshedAt: tickAt,
        stale: false
      }
    ],
    soonestResetAt: reset
  }
  publishSnapshot(snap)
  const res = await call()
  const body = (await res.json()) as {
    tickAt: string
    tickCount: number
    soonestResetAt: string
    weights: { target: string; weight: number; earliestResetAt: string }[]
    accounts: { subAccountId: string; fiveHour: { resetAt: string } | null }[]
  }
  expect(body.tickCount).toBe(3)
  expect(body.tickAt).toBe(new Date(tickAt).toISOString())
  expect(body.soonestResetAt).toBe(new Date(reset).toISOString())
  expect(body.weights[0].target).toBe('claude-code,fable-5')
  expect(body.weights[0].earliestResetAt).toBe(new Date(reset).toISOString())
  expect(body.accounts[0].fiveHour?.resetAt).toBe(new Date(reset).toISOString())
})

test('recentChanges bounded ring is returned in order', async () => {
  const tickAt = 1_700_000_000_000
  publishSnapshot({
    tickAt,
    tickCount: 1,
    consecutiveFailures: 0,
    degraded: false,
    weights: new Map(),
    accounts: [],
    soonestResetAt: null
  })
  recordWeightChanges(
    [
      { target: 'a,x', from: 0.5, to: 0.3, reason: 'quota_drop' },
      { target: 'b,y', from: 0.5, to: 0.7, reason: 'quota_recovered' }
    ],
    tickAt
  )
  const res = await call()
  const body = (await res.json()) as { recentChanges: { target: string; reason: string }[] }
  expect(body.recentChanges).toHaveLength(2)
  expect(body.recentChanges[0].reason).toBe('quota_drop')
  expect(body.recentChanges[1].target).toBe('b,y')
})
