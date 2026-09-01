/**
 * Why the Routing screen's State column reads `unknown`, and which of the
 * two reasons to name.
 *
 * The column is drawn from the scheduler's published weights, and there
 * are two independent ways there can be none:
 *
 *   1. The scheduler never ticks. It only runs for quota-aware
 *      selection, so under `scenario` there is no snapshot at all.
 *   2. It ticks and scores nothing. The weights are built entirely from
 *      `RouterPreferenceEntry` rows, so an install with the mode on and
 *      no chain configured publishes an empty snapshot.
 *
 * The first version of the on-screen note named only (1), which sent an
 * operator with no chain to flip a switch that changed nothing on their
 * screen. These pin the two apart.
 */

import { describe, expect, test } from 'bun:test'
import { schedulerRuns, schedulerScoredNothing } from '../../src/components/rialto/routing/derive'
import type { RoutingSchedulerStateResponse, RoutingSchedulerWeightEntry } from '../../src/lib/api-types'

const snapshot = (over: Partial<RoutingSchedulerStateResponse>): RoutingSchedulerStateResponse => ({
  tickAt: null,
  tickCount: 0,
  consecutiveFailures: 0,
  degraded: false,
  weights: [],
  accounts: [],
  soonestResetAt: null,
  recentChanges: [],
  ...over
})

describe('schedulerRuns', () => {
  test('quota-aware as the primary mode runs it', () => {
    expect(schedulerRuns('quota-aware', 'off')).toBe(true)
  })

  test('quota-aware in shadow runs it too — observing is enough to need weights', () => {
    expect(schedulerRuns('scenario', 'quota-aware')).toBe(true)
  })

  test('scenario with no shadow never ticks', () => {
    expect(schedulerRuns('scenario', 'off')).toBe(false)
    expect(schedulerRuns('preference', 'preference')).toBe(false)
  })

  test('an unread config is treated as not running rather than assumed', () => {
    expect(schedulerRuns(undefined, undefined)).toBe(false)
  })
})

describe('schedulerScoredNothing', () => {
  test('a tick that published no weights has nothing to score', () => {
    // The install this was found on: mode could be turned on and the
    // column would still say unknown, because no preference entry exists.
    expect(schedulerScoredNothing(snapshot({ tickAt: '2026-09-01T22:00:00Z', weights: [] }))).toBe(true)
  })

  test('a cold boot is not the same claim — it resolves within a tick', () => {
    expect(schedulerScoredNothing(snapshot({ tickAt: null, weights: [] }))).toBe(false)
  })

  test('no snapshot at all says nothing either way', () => {
    expect(schedulerScoredNothing(null)).toBe(false)
  })

  test('a tick that scored something is not it', () => {
    const entry: RoutingSchedulerWeightEntry = {
      target: 'anthropic,claude-opus-5',
      weight: 1,
      healthiness: 1,
      remainingBudgetPct: null,
      earliestResetAt: null,
      reasons: ['ok']
    }
    const scored = snapshot({ tickAt: '2026-09-01T22:00:00Z', weights: [entry] })
    expect(schedulerScoredNothing(scored)).toBe(false)
  })
})
