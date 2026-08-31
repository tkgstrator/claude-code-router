/**
 * Weight-vector shaping: normalisation plus the three guards.
 *
 * Split from scoring because nothing here reads a quota window or a
 * request — it is arithmetic over a `RawScore` list and the previous
 * tick's vector. That is exactly what makes each guard testable on its
 * own: a hand-written score list is enough to exercise the probe floor,
 * the damper and the hold guard without constructing an account.
 *
 * Order matters and is enforced by `computeWeights`, not here: floor
 * before damper (the floor can push a candidate past the per-tick delta,
 * and the damper is what walks it back), hold guard last (it judges the
 * vector that would actually ship).
 */

import type { RawScore } from './score'

export const normalize = (raws: readonly RawScore[]): Map<string, number> => {
  const enabled = raws.filter((r) => r.enabled)
  const sum = enabled.reduce((acc, r) => acc + r.healthiness, 0)
  const out = new Map<string, number>()
  if (sum <= 0) {
    for (const r of raws) out.set(r.target, 0)
    return out
  }
  for (const r of raws) out.set(r.target, r.enabled ? r.healthiness / sum : 0)
  return out
}

// Probe floor: any enabled candidate with healthiness > 0 gets
// max(current, minWeightPct/100). Sum can exceed 1 after the floor,
// so we re-normalize.
export const applyProbeFloor = (
  raws: readonly RawScore[],
  initial: Map<string, number>,
  minWeightPct: number
): Map<string, number> => {
  const floor = minWeightPct / 100
  if (floor <= 0) return initial
  const boosted = new Map<string, number>()
  let sum = 0
  for (const r of raws) {
    if (!r.enabled || r.healthiness <= 0) {
      boosted.set(r.target, 0)
      continue
    }
    const w = Math.max(initial.get(r.target) ?? 0, floor)
    boosted.set(r.target, w)
    sum += w
  }
  if (sum === 0) return initial
  if (sum <= 1) return boosted
  const scale = 1 / sum
  const scaled = new Map<string, number>()
  for (const [target, w] of boosted) scaled.set(target, w * scale)
  return scaled
}

// Oscillation damper: constrain each candidate's move vs `previous`.
export const applyDamper = (
  next: Map<string, number>,
  previous: ReadonlyMap<string, number> | null,
  maxDelta: number
): Map<string, number> => {
  if (previous === null) return next
  if (maxDelta >= 1) return next
  const clamped = new Map<string, number>()
  let sum = 0
  for (const [target, w] of next) {
    const prev = previous.get(target) ?? w
    const upper = prev + maxDelta
    const lower = Math.max(0, prev - maxDelta)
    const c = Math.min(upper, Math.max(lower, w))
    clamped.set(target, c)
    sum += c
  }
  if (sum <= 0) return next
  const scaled = new Map<string, number>()
  for (const [target, w] of clamped) scaled.set(target, w / sum)
  return scaled
}

// Hold guard: if the top-preference candidate has healthy budget (>=
// 0.1) and its NEW weight would fall below minWeightPct/100, keep the
// previous vector unchanged. Prevents a compute bug from zeroing out
// a live primary.
export const holdGuardFires = (
  raws: readonly RawScore[],
  next: Map<string, number>,
  previous: ReadonlyMap<string, number> | null,
  minWeightPct: number
): boolean => {
  if (previous === null) return false
  const top = raws.find((r) => r.enabled)
  if (top === undefined) return false
  const budget = top.budgetPct
  if (budget === null || budget < 10) return false
  const w = next.get(top.target) ?? 0
  return w < minWeightPct / 100
}
