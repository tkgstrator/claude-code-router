/**
 * 表示名 → API モデル ID の写像。
 *
 * ここは2つの壊れ方をしていた。どちらも「価格ページには載っているのに
 * カタログに出てこない」という同じ症状で現れる。
 *
 * 1. **系統が Opus / Sonnet / Haiku 固定**だった。`Claude Fable 5.1` は
 *    どの分岐にも当たらず、スクレイパの "Skipped (no API id mapping)"
 *    に落ちて捨てられていた。
 * 2. **`.0` を無条件に付けていた**。命名は 5 世代で変わっていて、
 *    `claude-opus-5` は存在するが `claude-opus-5-0` は存在しない。
 *    付けると実在しない ID を捏造することになる（実際に
 *    `claude-opus-5-0` と `claude-sonnet-5-0` が出力されていた）。
 *
 * 期待値は Anthropic の models overview / pricing ページの
 * "Claude API ID" 行から取った実物である。
 */

import { describe, expect, test } from 'bun:test'
import { __testables } from '../../src/vendors/anthropic'

const { claude4PlusSlug, headerModelName } = __testables

describe('claude4PlusSlug', () => {
  test('5 世代は minor 無しなら接尾辞も付かない', () => {
    expect(claude4PlusSlug('Claude Opus 5')).toBe('claude-opus-5')
    expect(claude4PlusSlug('Claude Sonnet 5')).toBe('claude-sonnet-5')
    expect(claude4PlusSlug('Claude Fable 5')).toBe('claude-fable-5')
  })

  test('4 世代は minor 無しなら -0 を補う', () => {
    // ここだけ規則が違う。揃えようとして 5 世代にも付けたのが元のバグ。
    expect(claude4PlusSlug('Claude Opus 4')).toBe('claude-opus-4-0')
    expect(claude4PlusSlug('Claude Sonnet 4')).toBe('claude-sonnet-4-0')
  })

  test('minor 付きはそのまま繋ぐ', () => {
    expect(claude4PlusSlug('Claude Opus 4.7')).toBe('claude-opus-4-7')
    expect(claude4PlusSlug('Claude Haiku 4.5')).toBe('claude-haiku-4-5')
    expect(claude4PlusSlug('Claude Fable 5.1')).toBe('claude-fable-5-1')
    expect(claude4PlusSlug('Claude Mythos 5.1')).toBe('claude-mythos-5-1')
  })

  test('Fable / Mythos も系統として認識する', () => {
    // 認識しないと "no API id mapping" で丸ごと捨てられる。
    expect(claude4PlusSlug('Claude Fable 5.1')).not.toBeNull()
    expect(claude4PlusSlug('Claude Mythos 5')).not.toBeNull()
  })

  test('4 より前の系統は別経路に任せる', () => {
    expect(claude4PlusSlug('Claude Haiku 3.5')).toBeNull()
    expect(claude4PlusSlug('Claude 3 Opus')).toBeNull()
  })

  test('形が違うものは null', () => {
    expect(claude4PlusSlug('GPT-5')).toBeNull()
    expect(claude4PlusSlug('Claude Opus')).toBeNull()
    expect(claude4PlusSlug('')).toBeNull()
  })

  test('捏造 ID を作らない', () => {
    // 回帰の本体。この2つは Anthropic に存在しない。
    const produced = ['Claude Opus 5', 'Claude Sonnet 5', 'Claude Fable 5'].map(claude4PlusSlug)
    expect(produced).not.toContain('claude-opus-5-0')
    expect(produced).not.toContain('claude-sonnet-5-0')
    expect(produced).not.toContain('claude-fable-5-0')
  })
})

describe('headerModelName', () => {
  test('説明文が地続きに繋がったヘッダーからモデル名だけを取る', () => {
    // 比較表のヘッダーはマークアップを剥がすと名前と説明が区切り無しで
    // 連結される。これを丸ごとキーにしていたため、価格ページ側の
    // "Claude Fable 5.1" と永久に一致せず、contextWindow が全モデルで
    // null になっていた。
    expect(headerModelName('Claude Fable 5.1For demanding reasoning and long-horizon agentic work')).toBe(
      'Claude Fable 5.1'
    )
    expect(headerModelName('Claude Haiku 4.5The fastest model with near-frontier intelligence')).toBe(
      'Claude Haiku 4.5'
    )
  })

  test('マイナー番号を落とさない', () => {
    // 既存の modelPrefix は末尾に \b を要求するので "1" と "F" の間で
    // 失敗し、"Claude Fable 5" までバックトラックする。別モデルになる。
    expect(headerModelName('Claude Fable 5.1For demanding')).not.toBe('Claude Fable 5')
  })

  test('説明の無いヘッダーもそのまま取れる', () => {
    expect(headerModelName('Claude Opus 5')).toBe('Claude Opus 5')
    expect(headerModelName('Claude Sonnet 5')).toBe('Claude Sonnet 5')
  })

  test('モデル名でないヘッダーは null', () => {
    expect(headerModelName('Feature')).toBeNull()
    expect(headerModelName('')).toBeNull()
  })
})
