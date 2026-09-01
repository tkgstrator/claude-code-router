/**
 * パリティ・マトリクスそのものの検査。
 *
 * master-plan §2-5 の完了条件は「全セルに対応済み / 未対応（理由付き）の
 * ラベルとテストがある」こと。**空白セルの洗い出しが成果物**である以上、
 * 表の側にも「空欄を作れない」保証が要る —— でなければ面を1つ足したとき、
 * 列が1つ足りない表が静かに残る。
 *
 * ここでは docs/architecture/inbound-parity.md を実際に読み、
 *   - 面の列が記述子レジストリと一致しているか
 *   - 機能の行が 10 行そろっているか
 *   - すべてのセルが 3 種類のラベルのどれかで埋まっているか
 *   - 未対応 / 部分対応のセルが実在する注記を指しているか
 *   - 各行が実在するテストファイルを担保として挙げているか
 * を検査する。
 */

import { existsSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { INBOUND_SURFACES } from '../../src/llms/inbound/surfaces'

const DOC_PATH = new URL('../../docs/architecture/inbound-parity.md', import.meta.url).pathname
const REPO_ROOT = new URL('../../', import.meta.url).pathname

// master-plan §2-5 が定義している機能軸。表がこの 10 行から欠けても
// 増えても落ちる。
const FEATURES: readonly string[] = [
  'ストリーミング (SSE)',
  '非ストリーム集約',
  'tool use',
  'system プロンプト',
  '画像入力',
  'thinking / reasoning',
  'usage 記録 (RequestLog)',
  'エラー形式',
  'cacheトークン計上',
  'failover / 429'
]

const LABELS: readonly string[] = ['対応', '部分', '未対応']

const doc = await Bun.file(DOC_PATH).text()

/** `## <heading>` から次の `## ` までの本文。 */
const sectionOf = (heading: string): string => {
  const start = doc.indexOf(`## ${heading}`)
  if (start === -1) throw new Error(`section not found: ${heading}`)
  const rest = doc.slice(start + heading.length + 3)
  const end = rest.indexOf('\n## ')
  return end === -1 ? rest : rest.slice(0, end)
}

/** markdown テーブルを行×セルに割る（区切り行は捨てる）。 */
const tableRows = (section: string): string[][] =>
  section
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
    )
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)))

const matrix = tableRows(sectionOf('マトリクス'))
const header = matrix[0]
const body = matrix.slice(1)

describe('マトリクスの形', () => {
  test('列が記述子レジストリの 4 面と対応している', () => {
    // 見出しは短縮名なので、記述子の path の末尾で照合する。面を足したのに
    // 列を足し忘れたらここで落ちる。
    expect(header.length).toBe(INBOUND_SURFACES.length + 1)
    expect(header.slice(1)).toEqual(['messages', 'chat/completions', 'responses', 'gemini'])
  })

  test('行が master-plan の機能軸 10 項目とちょうど一致している', () => {
    expect(body.map((row) => row[0])).toEqual(FEATURES)
  })

  test('40 セルすべてがラベルで埋まっている（空欄を残さない）', () => {
    const cells = body.flatMap((row) => row.slice(1))
    expect(cells.length).toBe(FEATURES.length * INBOUND_SURFACES.length)
    for (const cell of cells) {
      expect(cell.length).toBeGreaterThan(0)
      const label = cell.replace(/\s*\(\d+\)\s*$/, '')
      expect(LABELS).toContain(label)
    }
  })
})

describe('注記', () => {
  // `### (n) ...` と `### (2)(3)(4) の共通原因` の両方から番号を拾う。
  const defined = new Set(
    doc
      .split('\n')
      .filter((line) => line.startsWith('### '))
      .flatMap((line) => [...line.matchAll(/\((\d+)\)/g)].map((m) => m[1]))
  )

  test('未対応 / 部分対応のセルは必ず注記を指している', () => {
    for (const row of body) {
      for (const cell of row.slice(1)) {
        const label = cell.replace(/\s*\(\d+\)\s*$/, '')
        if (label === '対応') continue
        expect(cell).toMatch(/\(\d+\)$/)
      }
    }
  })

  test('セルが指す注記番号がすべて実在する', () => {
    const referenced = new Set(
      body.flatMap((row) => row.slice(1)).flatMap((cell) => [...cell.matchAll(/\((\d+)\)/g)].map((m) => m[1]))
    )
    for (const id of referenced) expect(defined).toContain(id)
  })
})

describe('担保テストの実在', () => {
  const rows = tableRows(sectionOf('セル別の担保テスト')).slice(1)

  test('担保テスト表が機能軸 10 項目をすべて挙げている', () => {
    expect(rows.map((row) => row[0])).toEqual(FEATURES)
  })

  test('挙げられているテストファイルがすべて実在する', () => {
    const paths = rows.flatMap((row) => [...row[1].matchAll(/`([^`]+\.test\.ts)`/g)].map((m) => m[1]))
    expect(paths.length).toBeGreaterThanOrEqual(FEATURES.length)
    for (const path of paths) expect(existsSync(`${REPO_ROOT}${path}`)).toBe(true)
  })
})
