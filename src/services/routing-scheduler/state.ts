/**
 * In-process snapshot store for the routing scheduler (Phase 2d).
 *
 * The publisher swaps a frozen `RoutingSnapshot` reference; readers
 * only ever see a complete snapshot. JS is single-threaded, so the
 * reference swap is atomic — no lock, no race.
 *
 * The durable audit log lives in `RoutingWeightChange` (DB). This
 * module only keeps a small in-process ring of recent changes for the
 * API's `recentChanges` field.
 */

import type { RoutingSnapshot, WeightChange } from './types'

let current: RoutingSnapshot | null = null
const HISTORY_LIMIT = 100
const recentChanges: WeightChange[] = []

export interface RecentWeightChange extends WeightChange {
  tickAt: number
}
const recentWithTick: RecentWeightChange[] = []

export function getRoutingSnapshot(): RoutingSnapshot | null {
  return current
}

export function publishSnapshot(next: RoutingSnapshot): void {
  Object.freeze(next.weights)
  Object.freeze(next.accounts)
  current = Object.freeze(next)
}

export function recordWeightChanges(changes: readonly WeightChange[], tickAt: number): void {
  for (const c of changes) {
    recentWithTick.push({ ...c, tickAt })
    recentChanges.push(c)
  }
  while (recentWithTick.length > HISTORY_LIMIT) recentWithTick.shift()
  while (recentChanges.length > HISTORY_LIMIT) recentChanges.shift()
}

export function getRecentWeightChanges(): readonly RecentWeightChange[] {
  return recentWithTick
}

// Test-only reset — the tick loop calls `stopRoutingScheduler` for the
// timer, and this clears the snapshot store so subsequent tests start
// clean.
export function __resetSchedulerStateForTest(): void {
  current = null
  recentChanges.length = 0
  recentWithTick.length = 0
}
