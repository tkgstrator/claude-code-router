import { expect, test } from 'bun:test'
import { fnv1a32, isSessionInRollout } from '../../../src/services/routing-scheduler/rollout'

test('fnv1a32 is deterministic', () => {
  expect(fnv1a32('hello')).toBe(fnv1a32('hello'))
  expect(fnv1a32('a')).not.toBe(fnv1a32('b'))
})

test('rollout 100 accepts every session', () => {
  for (let i = 0; i < 20; i += 1) {
    expect(isSessionInRollout(`session-${i}`, 100)).toBe(true)
  }
})

test('rollout 0 rejects every session', () => {
  for (let i = 0; i < 20; i += 1) {
    expect(isSessionInRollout(`session-${i}`, 0)).toBe(false)
  }
})

test('same session always lands in the same bucket', () => {
  const first = isSessionInRollout('sess-abc', 25)
  for (let i = 0; i < 10; i += 1) {
    expect(isSessionInRollout('sess-abc', 25)).toBe(first)
  }
})

test('rollout is roughly proportional across many sessions', () => {
  const n = 1_000
  let inRollout = 0
  for (let i = 0; i < n; i += 1) {
    if (isSessionInRollout(`session-${i}`, 25)) inRollout += 1
  }
  // Expect roughly 25% ± 5% at n=1_000; FNV-1a is a stable hash so
  // this holds deterministically per test run.
  expect(inRollout).toBeGreaterThan(200)
  expect(inRollout).toBeLessThan(300)
})

test('missing session id buckets deterministically on empty string', () => {
  const a = isSessionInRollout(null, 50)
  const b = isSessionInRollout(undefined, 50)
  const c = isSessionInRollout('', 50)
  expect(a).toBe(b)
  expect(b).toBe(c)
})
