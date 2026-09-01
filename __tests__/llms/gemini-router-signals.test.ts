/**
 * gemini 面のルーティング・シグナル抽出。
 *
 * `/v1beta/models/*` は 4 面の中で唯一、本文もシステムプロンプトも
 * 思考設定もツールも Anthropic と別のキーに置く面で、リーダーが無い
 * 間はそのすべてが「無い」と読まれていた（`contents` を数えないので
 * longContext が常に 0 トークン、`thinkingConfig` は不可視、
 * `functionDeclarations` は hasTool に出てこない）。
 *
 * 検証は `readSignals` 越しに行う。面 id → リーダーの登録まで含めて
 * 見ておかないと、リーダーだけ正しくて配線されていない状態を通して
 * しまう。
 */

import { describe, expect, test } from 'bun:test'
import { TokenizerRegistry } from '../../src/llms/registry/tokenizer'
import { readSignals } from '../../src/llms/scenario-router/surface-signals'
import type { RouterRequestBody } from '../../src/llms/scenario-router/types'

const GEMINI_PATH = '/v1beta/models/gemini-3-pro:generateContent'

const signals = (body: Record<string, unknown>) => {
  const withModel: RouterRequestBody = { model: 'google,gemini-3-pro', ...body }
  return readSignals(withModel, GEMINI_PATH)
}

/** 実トークナイザ（cl100k_base）で数える。0 かどうかが本題なので。 */
async function countTokens(body: Record<string, unknown>): Promise<number> {
  const tokenizers = new TokenizerRegistry()
  await tokenizers.initialize()
  const result = await tokenizers.countTokens(signals(body).tokenize)
  return result.tokenCount
}

describe('tokenize — contents[] を数える', () => {
  test('parts[].text が messages に落ちる', () => {
    const { tokenize } = signals({
      contents: [
        { role: 'user', parts: [{ text: 'hello' }, { text: 'world' }] },
        { role: 'model', parts: [{ text: 'hi' }] }
      ]
    })
    expect(tokenize.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
    ])
  })

  test('長い会話が 0 トークンにならない（これが未対応だった本体）', async () => {
    const long = 'lorem ipsum dolor sit amet '.repeat(200)
    expect(await countTokens({ contents: [{ role: 'user', parts: [{ text: long }] }] })).toBeGreaterThan(500)
  })

  test('role 省略の contents も数える（Gemini は省略を user 扱いする）', async () => {
    expect(await countTokens({ contents: [{ parts: [{ text: 'no role here' }] }] })).toBeGreaterThan(0)
  })

  test('systemInstruction が数に含まれる', async () => {
    const instruction = 'you are a terse assistant '.repeat(50)
    const withSystem = await countTokens({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      systemInstruction: { parts: [{ text: instruction }] }
    })
    const withoutSystem = await countTokens({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    expect(withSystem).toBeGreaterThan(withoutSystem)
    expect(signals({ systemInstruction: { parts: [{ text: 'be terse' }] } }).tokenize.system).toBe('be terse')
  })

  test('snake_case の system_instruction も読む', () => {
    expect(signals({ system_instruction: { parts: [{ text: 'be terse' }] } }).tokenize.system).toBe('be terse')
  })

  test('functionCall の引数と functionResponse の中身が数に入る', async () => {
    const args = { query: 'x'.repeat(400) }
    const called = await countTokens({
      contents: [{ role: 'model', parts: [{ functionCall: { name: 'search', args } }] }]
    })
    const answered = await countTokens({
      contents: [
        { role: 'user', parts: [{ functionResponse: { name: 'search', response: { result: 'y'.repeat(400) } } }] }
      ]
    })
    expect(called).toBeGreaterThan(50)
    expect(answered).toBeGreaterThan(50)
  })

  test('tools の JSON スキーマも数に入る', async () => {
    const withTools = await countTokens({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'search',
              description: 'search the web',
              parameters: { type: 'object', properties: { q: { type: 'string', description: 'z'.repeat(400) } } }
            }
          ]
        }
      ]
    })
    const withoutTools = await countTokens({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    expect(withTools).toBeGreaterThan(withoutTools + 50)
  })

  test('Gemini 本文として読めない body は Anthropic の答えを借りない', () => {
    // `messages` を持つ body を gemini 面で受けても、それは Gemini の
    // 語彙ではない。フォールバックすると「面の語彙を読んでいない」状態に
    // 静かに戻る。
    const { tokenize } = signals({ contents: 'not an array' })
    expect(tokenize.messages).toEqual([])
    expect(tokenize.tools).toEqual([])
  })
})

describe('thinking / effort — generationConfig.thinkingConfig', () => {
  const thinkingConfig = (config: Record<string, unknown>, key = 'generationConfig') =>
    signals({ [key]: { thinkingConfig: config } })

  test('thinkingLevel が effort にそのまま写る', () => {
    expect(thinkingConfig({ thinkingLevel: 'high' })).toMatchObject({ thinking: true, effort: 'high' })
    expect(thinkingConfig({ thinkingLevel: 'low' })).toMatchObject({ thinking: true, effort: 'low' })
  })

  test('thinkingLevel: none は明示的なオプトアウト', () => {
    expect(thinkingConfig({ thinkingLevel: 'none' })).toMatchObject({ thinking: false, effort: undefined })
  })

  test('thinkingBudget は /v1/messages と同じバケットで effort になる', () => {
    expect(thinkingConfig({ thinkingBudget: 512 })).toMatchObject({ thinking: true, effort: 'low' })
    expect(thinkingConfig({ thinkingBudget: 8192 })).toMatchObject({ thinking: true, effort: 'medium' })
    expect(thinkingConfig({ thinkingBudget: 32_000 })).toMatchObject({ thinking: true, effort: 'high' })
    expect(thinkingConfig({ thinkingBudget: 0 })).toMatchObject({ thinking: false, effort: undefined })
  })

  test('includeThoughts だけなら「思考するが強度は言っていない」', () => {
    expect(thinkingConfig({ includeThoughts: true })).toMatchObject({ thinking: true, effort: undefined })
  })

  test('知らない thinkingLevel でも thinking は立つ', () => {
    // Google が値を増やしたときに黙って default レーンへ落ちないこと。
    expect(thinkingConfig({ thinkingLevel: 'ultra' })).toMatchObject({ thinking: true, effort: undefined })
  })

  test('router の effort 語彙にある値なら ThinkLevel に無くても拾う', () => {
    expect(thinkingConfig({ thinkingLevel: 'max' })).toMatchObject({ thinking: true, effort: 'max' })
    expect(thinkingConfig({ thinkingLevel: 'XHIGH' })).toMatchObject({ thinking: true, effort: 'xhigh' })
  })

  test('snake_case の generation_config も読む', () => {
    expect(thinkingConfig({ thinkingLevel: 'high' }, 'generation_config')).toMatchObject({
      thinking: true,
      effort: 'high'
    })
  })

  test('thinkingConfig が無ければ思考要求ではない', () => {
    expect(signals({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })).toMatchObject({
      thinking: false,
      effort: undefined
    })
  })
})

describe('toolNames / webSearch', () => {
  test('functionDeclarations[].name をベンダの語彙のまま返す', () => {
    expect(
      signals({
        tools: [{ functionDeclarations: [{ name: 'search_web' }, { name: 'read_file' }] }]
      }).toolNames
    ).toEqual(['search_web', 'read_file'])
  })

  test('組み込みツールはキー名で出る（hasTool が当てられる唯一の名前）', () => {
    expect(signals({ tools: [{ googleSearch: {} }, { urlContext: {} }] }).toolNames).toEqual([
      'googleSearch',
      'urlContext'
    ])
  })

  test('googleSearch で webSearch が立つ', () => {
    expect(signals({ tools: [{ googleSearch: {} }] }).webSearch).toBe(true)
  })

  test('1.5 系の googleSearchRetrieval / snake_case でも立つ', () => {
    expect(signals({ tools: [{ googleSearchRetrieval: { dynamicRetrievalConfig: {} } }] }).webSearch).toBe(true)
    expect(signals({ tools: [{ google_search_retrieval: {} }] }).webSearch).toBe(true)
    expect(signals({ tools: [{ google_search: {} }] }).webSearch).toBe(true)
  })

  test('ふつうの関数ツールだけなら webSearch は立たない', () => {
    expect(signals({ tools: [{ functionDeclarations: [{ name: 'search_web' }] }] }).webSearch).toBe(false)
    expect(signals({ tools: [{ codeExecution: {} }] }).webSearch).toBe(false)
  })

  test('tools が無ければ空', () => {
    expect(signals({ contents: [] })).toMatchObject({ toolNames: [], webSearch: false })
  })
})
