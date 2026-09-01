/**
 * Locale parity.
 *
 * The three bundles are loaded as one `resources` object by `src/i18n.ts`,
 * so a key that exists only in `en` does not fail anywhere — it silently
 * falls back and the other two languages ship an English string. The
 * reverse is worse: a key present only in `ja` is dead weight nobody
 * notices. Both are cheap to catch here and expensive to catch by eye.
 *
 * The interpolation check exists for the same reason. `t('a.b', { n })`
 * against a translation that spells the placeholder differently renders
 * the raw `{{...}}` to the user, and only in that language.
 */
import { describe, expect, test } from 'bun:test'
import en from '../../src/locales/en.json'
import ja from '../../src/locales/ja.json'
import zh from '../../src/locales/zh.json'

type Tree = { [key: string]: string | Tree }

const BUNDLES: readonly (readonly [string, Tree])[] = [
  ['en', en],
  ['ja', ja],
  ['zh', zh]
]

/** Flatten to `a.b.c` paths so a set difference reads as a key list. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of flatten(value, path)) out.set(k, v)
  }
  return out
}

/** `{{name}}` occurrences, sorted and de-duplicated. */
const placeholders = (value: string): string[] =>
  [...new Set([...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]))].sort()

/** `<tag>` / `<tag/>` names, for the `Trans` components a string declares. */
const tags = (value: string): string[] =>
  [...new Set([...value.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\s*\/?>/g)].map((m) => m[1]))].sort()

const FLAT = new Map(BUNDLES.map(([lang, tree]) => [lang, flatten(tree)]))
const EN = FLAT.get('en') ?? new Map()

describe('locale parity', () => {
  test('en is non-empty', () => {
    expect(EN.size).toBeGreaterThan(0)
  })

  for (const lang of ['ja', 'zh']) {
    const other = FLAT.get(lang) ?? new Map()

    test(`${lang} has no keys missing from en`, () => {
      expect([...EN.keys()].filter((k) => !other.has(k)).sort()).toEqual([])
    })

    test(`${lang} has no keys en does not declare`, () => {
      expect([...other.keys()].filter((k) => !EN.has(k)).sort()).toEqual([])
    })

    test(`${lang} keeps every interpolation placeholder`, () => {
      const mismatched = [...EN.entries()]
        .filter(([key, value]) => {
          const translated = other.get(key)
          return translated !== undefined && placeholders(value).join(',') !== placeholders(translated).join(',')
        })
        .map(([key]) => key)
      expect(mismatched).toEqual([])
    })

    test(`${lang} keeps every Trans component tag`, () => {
      const mismatched = [...EN.entries()]
        .filter(([key, value]) => {
          const translated = other.get(key)
          return translated !== undefined && tags(value).join(',') !== tags(translated).join(',')
        })
        .map(([key]) => key)
      expect(mismatched).toEqual([])
    })

    test(`${lang} has no empty strings`, () => {
      expect([...other.entries()].filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([])
    })
  }
})
