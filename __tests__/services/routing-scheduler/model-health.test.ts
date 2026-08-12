import { afterEach, expect, test } from 'bun:test'
import {
  __resetModelHealthForTest,
  errorRateOf,
  recordModelFailure,
  recordModelSuccess,
  sampleCountOf
} from '../../../src/services/routing-scheduler/model-health'

afterEach(() => {
  __resetModelHealthForTest()
})

test('errorRateOf returns 0 for an untracked target', () => {
  expect(errorRateOf('a,b')).toBe(0)
  expect(sampleCountOf('a,b')).toBe(0)
})

test('all-success target reports error rate 0', () => {
  recordModelSuccess('a,b')
  recordModelSuccess('a,b')
  recordModelSuccess('a,b')
  expect(errorRateOf('a,b')).toBe(0)
  expect(sampleCountOf('a,b')).toBe(3)
})

test('mixed events return the failure ratio', () => {
  recordModelSuccess('a,b')
  recordModelSuccess('a,b')
  recordModelFailure('a,b')
  recordModelFailure('a,b')
  expect(errorRateOf('a,b')).toBeCloseTo(0.5)
})

test('events older than 5 min are evicted on read', () => {
  // Manual push via internal store isn't exposed; use recordModelSuccess
  // then read with a nowOverride that pushes the events out of the window.
  recordModelSuccess('a,b')
  recordModelFailure('a,b')
  const nowPlus6min = Date.now() + 6 * 60 * 1000
  expect(errorRateOf('a,b', nowPlus6min)).toBe(0)
  expect(sampleCountOf('a,b', nowPlus6min)).toBe(0)
})

test('targets are isolated from each other', () => {
  recordModelFailure('a,x')
  recordModelSuccess('a,y')
  expect(errorRateOf('a,x')).toBe(1)
  expect(errorRateOf('a,y')).toBe(0)
})
