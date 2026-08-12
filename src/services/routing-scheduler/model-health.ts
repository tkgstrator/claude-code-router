/**
 * Event-driven per-target error-rate tracker (Phase 2e).
 *
 * The tracker is a small in-process ring of the last 5 min of
 * outcomes per `"providerName,modelName"` target. Callers push events
 * from the request pipeline (`recordUsage` for successes,
 * `attemptChainEntry` catch for failures) and read the smoothed
 * error rate via `errorRateOf(target)`.
 *
 * Event-driven (NOT polled) — the plan doc emphasises this: polling
 * RequestLog every tick would double the DB query rate and lag the
 * signal by up to a tick interval. In-process ring gives the selector
 * a sub-minute picture without extra I/O.
 *
 * Ring bounded per target so a runaway model can't blow memory:
 * cap at 200 events per target, oldest evicted.
 */

import dayjs from '../../lib/dayjs'

const WINDOW_MS = 5 * 60 * 1000
const EVENTS_PER_TARGET_CAP = 200

interface Event {
  at: number // epoch ms
  ok: boolean
}

const buckets = new Map<string, Event[]>()

const evictOld = (list: Event[], now: number): void => {
  const cutoff = now - WINDOW_MS
  // list is time-ordered append-only; drop from the head while old.
  let dropped = 0
  for (const ev of list) {
    if (ev.at >= cutoff) break
    dropped += 1
  }
  if (dropped > 0) list.splice(0, dropped)
  while (list.length > EVENTS_PER_TARGET_CAP) list.shift()
}

const push = (target: string, ok: boolean, now: number): void => {
  const list = buckets.get(target) ?? []
  list.push({ at: now, ok })
  evictOld(list, now)
  buckets.set(target, list)
}

export function recordModelSuccess(target: string): void {
  push(target, true, dayjs().valueOf())
}

export function recordModelFailure(target: string): void {
  push(target, false, dayjs().valueOf())
}

// Optional injected clock for testing. When omitted, uses dayjs().valueOf().
export function errorRateOf(target: string, nowOverride?: number): number {
  const list = buckets.get(target)
  if (list === undefined || list.length === 0) return 0
  const now = nowOverride ?? dayjs().valueOf()
  evictOld(list, now)
  if (list.length === 0) return 0
  const failures = list.reduce((n, ev) => (ev.ok ? n : n + 1), 0)
  return failures / list.length
}

export function sampleCountOf(target: string, nowOverride?: number): number {
  const list = buckets.get(target)
  if (list === undefined) return 0
  evictOld(list, nowOverride ?? dayjs().valueOf())
  return list.length
}

export function __resetModelHealthForTest(): void {
  buckets.clear()
}
