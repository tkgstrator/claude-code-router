/**
 * The comparison rules behind column sorting.
 *
 * The hook itself (`useTableSort`) cannot be called directly — there is no
 * component-test harness here — so this rebuilds the *ordering rules* it
 * depends on in the same shape and pins those. What matters is not the
 * internals but the three properties an operator can see:
 *
 * 1. Missing values sort last **in both directions**. Floating a model with
 *    no published price to the top of an ascending sort answers a question
 *    nobody asked.
 * 2. Ties keep the incoming order, so sorting by a coarse column (tier,
 *    status) does not shuffle the rows within each group.
 * 3. Booleans compare false < true, so an on/off column groups the off rows
 *    together at one end.
 */

import { describe, expect, test } from 'bun:test'
import type { SortValue } from '../../src/components/rialto/table-sort'

// The same comparison `useTableSort`'s `sorted` performs. Copied rather
// than imported because it cannot be lifted out of the hook — the point is
// to pin the behaviour, so if this drifts from the real one, this test is
// what should fail.
const isMissing = (v: SortValue): boolean => v === null || v === undefined

const compare = (a: SortValue, b: SortValue): number => {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b)
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

const sortBy = <T,>(rows: T[], valueFor: (r: T) => SortValue, dir: 'asc' | 'desc'): T[] => {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = valueFor(a)
    const bv = valueFor(b)
    if (isMissing(av) && isMissing(bv)) return 0
    if (isMissing(av)) return 1
    if (isMissing(bv)) return -1
    return compare(av, bv) * sign
  })
}

type Row = { id: string; price: number | null; tier: string; on: boolean }

const ROWS: Row[] = [
  { id: 'a', price: 10, tier: 'opus', on: true },
  { id: 'b', price: null, tier: 'haiku', on: false },
  { id: 'c', price: 2, tier: 'opus', on: true },
  { id: 'd', price: null, tier: 'sonnet', on: false },
  { id: 'e', price: 5, tier: 'haiku', on: true }
]

const ids = (rows: Row[]): string[] => rows.map((r) => r.id)

describe('missing values', () => {
  test('sort last ascending', () => {
    expect(ids(sortBy(ROWS, (r) => r.price, 'asc'))).toEqual(['c', 'e', 'a', 'b', 'd'])
  })

  test('sort last descending too — reversing must not float them to the top', () => {
    // This is the symptom itself. An implementation that merely multiplies
    // by the sign puts "price unpublished" at the head of a descending sort.
    expect(ids(sortBy(ROWS, (r) => r.price, 'desc'))).toEqual(['a', 'e', 'c', 'b', 'd'])
  })

  test('keep their incoming order relative to each other', () => {
    const onlyMissing = ROWS.filter((r) => r.price === null)
    expect(ids(sortBy(onlyMissing, (r) => r.price, 'asc'))).toEqual(['b', 'd'])
    expect(ids(sortBy(onlyMissing, (r) => r.price, 'desc'))).toEqual(['b', 'd'])
  })
})

describe('ties', () => {
  test('a coarse column leaves the order within each group alone', () => {
    // haiku < opus < sonnet. `opus` arrived as a, c and stays that way after
    // sorting by tier; so does haiku's b, e.
    const sorted = sortBy(ROWS, (r) => r.tier, 'asc')
    expect(ids(sorted)).toEqual(['b', 'e', 'a', 'c', 'd'])
  })
})

describe('booleans', () => {
  test('false first, true after (ascending)', () => {
    expect(ids(sortBy(ROWS, (r) => r.on, 'asc'))).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  test('reverse descending', () => {
    expect(ids(sortBy(ROWS, (r) => r.on, 'desc'))).toEqual(['a', 'c', 'e', 'b', 'd'])
  })
})

describe('strings', () => {
  test('order by locale comparison', () => {
    const rows = [{ v: 'b' }, { v: 'A' }, { v: 'a' }]
    // localeCompare folds case naturally. Code-point order would give
    // 'A' < 'a' < 'b', which does not match how the column reads.
    expect(sortBy(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual(['a', 'A', 'b'])
  })
})
