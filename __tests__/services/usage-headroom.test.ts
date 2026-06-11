import { expect, test } from 'bun:test'
import { headroomFrom, PROACTIVE_THRESHOLD_PCT } from '../../src/services/usage-service'

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
