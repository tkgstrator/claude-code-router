/**
 * パリティ・マトリクス — 行「system プロンプト」。
 *
 * 面ごとに system プロンプトの置き場所が違う:
 *   - anthropic-messages : トップレベル `system`（文字列 or ブロック配列）
 *   - openai-chat        : `messages[0].role === 'system'`
 *   - openai-responses   : トップレベル `instructions`
 *   - gemini-generate    : トップレベル `systemInstruction`
 *
 * 変換経路では、これが unified の `role: 'system'` メッセージに落ちて
 * 初めて下流のプロバイダに届く。落ちなければ system は**黙って消える**
 * ——エラーにならないぶん質が悪い。
 */

import { describe, expect, test } from 'bun:test'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAIResponsesTransformer, OpenAITransformer } from '../../src/llms/transformers/openai'
import type { TransformerContext } from '../../src/schemas/domain'

const ctx = {} as TransformerContext

const systemContentOf = (messages: unknown): unknown => {
  if (!Array.isArray(messages)) return undefined
  const first = messages.find((m) => Reflect.get(Object(m), 'role') === 'system')
  return first === undefined ? undefined : Reflect.get(Object(first), 'content')
}

describe('anthropic-messages — 対応済み', () => {
  test('文字列 system が先頭の system メッセージになる', async () => {
    const unified = await new AnthropicTransformer().transformRequestOut(
      { model: 'm', max_tokens: 16, system: 'You are terse.', messages: [{ role: 'user', content: 'hi' }] },
      ctx
    )
    expect(systemContentOf(unified.messages)).toBe('You are terse.')
  })

  test('ブロック配列 system は cache_control ごと保持される', async () => {
    // cache_control を落とすと、Claude Code が prefix キャッシュのために
    // 付けているマーカーが消えて課金が跳ねる。ここは text だけ拾えば済む
    // 話ではない。
    const unified = await new AnthropicTransformer().transformRequestOut(
      {
        model: 'm',
        max_tokens: 16,
        system: [
          { type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Be terse.' }
        ],
        messages: [{ role: 'user', content: 'hi' }]
      },
      ctx
    )
    expect(systemContentOf(unified.messages)).toEqual([
      { type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Be terse.', cache_control: undefined }
    ])
  })
})

describe('openai-chat — 対応済み', () => {
  test('ネイティブの system メッセージはそのまま通る', async () => {
    const unified = await new OpenAITransformer().transformRequestOut(
      {
        model: 'm',
        messages: [
          { role: 'system', content: 'You are terse.' },
          { role: 'user', content: 'hi' }
        ]
      },
      ctx
    )
    expect(systemContentOf(unified.messages)).toBe('You are terse.')
  })

  // Anthropic 由来のトップレベル `system` の吸収（persona 注入が漏れた
  // ときの防御）は __tests__/llms/openai-transformer-request-out.test.ts
  // 「system absorption」が担保している。
})

describe('openai-responses — 対応済み', () => {
  test('instructions が先頭の system メッセージになる', async () => {
    const unified = await new OpenAIResponsesTransformer().transformRequestOut(
      { model: 'm', instructions: 'You are terse.', input: 'hi' },
      ctx
    )
    expect(systemContentOf(unified.messages)).toBe('You are terse.')
    // Responses 固有のキーは下流に漏らさない。
    expect(Reflect.get(unified, 'instructions')).toBeUndefined()
  })
})

describe('gemini-generate — 対応済み', () => {
  test('systemInstruction が先頭の system メッセージになる', async () => {
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        systemInstruction: { parts: [{ text: 'You are terse.' }] },
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
      },
      ctx
    )
    expect(systemContentOf(unified.messages)).toBe('You are terse.')
    // Gemini 固有のキーは下流に漏らさない（他の面と同じ約束）。
    expect(Reflect.get(unified, 'systemInstruction')).toBeUndefined()
    // system は contents[] より前に積む。ここが逆だと、system を
    // 先頭でしか受けないプロバイダで無視される。
    expect(Reflect.get(Object(unified.messages[0]), 'role')).toBe('system')
  })

  test('複数パートの systemInstruction は改行で連結される', async () => {
    // 他の 3 面の system は素の文字列。ブロック配列のまま渡すと面ごとに
    // 形が割れるので、gemini だけ配列にはしない。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        systemInstruction: { role: 'system', parts: [{ text: 'You are terse.' }, { text: 'Answer in English.' }] },
        contents: []
      },
      ctx
    )
    expect(systemContentOf(unified.messages)).toBe('You are terse.\nAnswer in English.')
  })

  test('snake_case の system_instruction / 素の文字列も読む', async () => {
    const unified = await new GeminiTransformer().transformRequestOut(
      { model: 'gemini-3-pro', system_instruction: 'You are terse.', contents: [] },
      ctx
    )
    expect(systemContentOf(unified.messages)).toBe('You are terse.')
  })
})
