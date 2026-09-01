/**
 * 列ソートの比較規則。
 *
 * フック本体（`useTableSort`）はコンポーネントテストの基盤が無いので
 * 直接は叩けない。代わりに、そこが依存している**並べ替えの規則**を
 * 同じ形で組み立てて固定する。守りたいのは実装の内部ではなく、
 * 操作者から見える3つの性質である。
 *
 * 1. 欠損値は**方向によらず末尾**。価格未公開のモデルを昇順で最安として
 *    先頭に出すと、答えていない問いに答えたことになる
 * 2. 同値は**入力順を保つ**。粗い列（tier / status）で並べたとき、
 *    グループ内が勝手に混ざらない
 * 3. 真偽値は false < true。有効・無効の列で off がまとまる
 */

import { describe, expect, test } from 'bun:test'
import type { SortValue } from '../../src/components/rialto/table-sort'

// useTableSort の sorted と同じ比較。フックから切り出せないので写している
// が、writeup ではなく振る舞いを固定するのが目的なので、ここが本体と
// 食い違ったらこのテストが落ちるべきである。
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

describe('欠損値', () => {
  test('昇順で末尾に来る', () => {
    expect(ids(sortBy(ROWS, (r) => r.price, 'asc'))).toEqual(['c', 'e', 'a', 'b', 'd'])
  })

  test('降順でも末尾に来る —— 方向を反転しても先頭に回らない', () => {
    // ここが症状の本体。単純に符号を掛けるだけの実装だと、降順で
    // 「価格未公開」が最上位に並ぶ。
    expect(ids(sortBy(ROWS, (r) => r.price, 'desc'))).toEqual(['a', 'e', 'c', 'b', 'd'])
  })

  test('欠損同士は入力順のまま', () => {
    const onlyMissing = ROWS.filter((r) => r.price === null)
    expect(ids(sortBy(onlyMissing, (r) => r.price, 'asc'))).toEqual(['b', 'd'])
    expect(ids(sortBy(onlyMissing, (r) => r.price, 'desc'))).toEqual(['b', 'd'])
  })
})

describe('同値', () => {
  test('粗い列で並べてもグループ内の順序が保たれる', () => {
    // haiku < opus < sonnet。opus は a, c の順で入力されており、tier で
    // 並べてもそのまま。haiku 側の b, e も同じ。
    const sorted = sortBy(ROWS, (r) => r.tier, 'asc')
    expect(ids(sorted)).toEqual(['b', 'e', 'a', 'c', 'd'])
  })
})

describe('真偽値', () => {
  test('false が先、true が後（昇順）', () => {
    expect(ids(sortBy(ROWS, (r) => r.on, 'asc'))).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  test('降順で反転する', () => {
    expect(ids(sortBy(ROWS, (r) => r.on, 'desc'))).toEqual(['a', 'c', 'e', 'b', 'd'])
  })
})

describe('文字列', () => {
  test('ロケール比較で並ぶ', () => {
    const rows = [{ v: 'b' }, { v: 'A' }, { v: 'a' }]
    // localeCompare なので大文字小文字をまたいで自然に並ぶ。コードポイント
    // 順だと 'A' < 'a' < 'b' になり、表の見た目と合わない。
    expect(sortBy(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual(['a', 'A', 'b'])
  })
})
