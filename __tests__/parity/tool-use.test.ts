/**
 * パリティ・マトリクス — 行「tool use」。
 *
 * tool use は 3 つの別々のものからできていて、面ごとに欠け方が違う:
 *   (a) 宣言   — リクエストの `tools[]`
 *   (b) 呼び出し — アシスタントターンに載る tool 呼び出し
 *   (c) 結果   — ユーザーターンに載る tool の返り値
 *
 * (a) だけ通って (b)(c) が落ちる面はマルチターンで壊れる——1 往復目は
 * 動いて 2 往復目で会話が消えるので、宣言だけ見ていると気づけない。
 * だから 3 つを分けて見る。
 */

import { describe, expect, test } from 'bun:test'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAIResponsesTransformer, OpenAITransformer } from '../../src/llms/transformers/openai'
import type { TransformerContext } from '../../src/schemas/domain'

const ctx = {} as TransformerContext

const roles = (messages: unknown): unknown[] =>
  Array.isArray(messages) ? messages.map((m) => Reflect.get(Object(m), 'role')) : []

const toolNames = (tools: unknown): unknown[] =>
  Array.isArray(tools) ? tools.map((t) => Reflect.get(Object(Reflect.get(Object(t), 'function')), 'name')) : []

describe('anthropic-messages — 対応済み', () => {
  test('(a) tools[] が unified の function ツールになる', async () => {
    const unified = await new AnthropicTransformer().transformRequestOut(
      {
        model: 'm',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: {} } }],
        tool_choice: { type: 'tool', name: 'Read' }
      },
      ctx
    )
    expect(toolNames(unified.tools)).toEqual(['Read'])
    expect(unified.tool_choice).toEqual({ type: 'function', function: { name: 'Read' } })
  })

  test('(b)(c) tool_use と tool_result が呼び出し/結果の対で残る', async () => {
    const unified = await new AnthropicTransformer().transformRequestOut(
      {
        model: 'm',
        max_tokens: 16,
        messages: [
          { role: 'user', content: 'read a' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: 'a' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file body' }] }
        ]
      },
      ctx
    )
    expect(roles(unified.messages)).toEqual(['user', 'assistant', 'tool'])
    const assistant = Object(unified.messages[1])
    expect(Reflect.get(Object(Reflect.get(assistant, 'tool_calls')), '0')).toMatchObject({
      id: 'tu_1',
      type: 'function',
      function: { name: 'Read', arguments: '{"path":"a"}' }
    })
    expect(Object(unified.messages[2])).toMatchObject({ tool_call_id: 'tu_1', content: 'file body' })
  })

  // サーバーツール（web_search_* 等）が name だけの宣言でも unified に
  // 落ちることは __tests__/llms/transformers/anthropic-request.test.ts が担保。
})

describe('openai-chat — 対応済み（素通し）', () => {
  test('(a)(b)(c) いずれも unified と同形なので素通る', async () => {
    const body = {
      model: 'm',
      messages: [
        { role: 'user', content: 'read a' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a"}' } }]
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'file body' }
      ],
      tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: {} } } }],
      tool_choice: 'auto'
    }
    const unified = await new OpenAITransformer().transformRequestOut(body, ctx)
    expect(roles(unified.messages)).toEqual(['user', 'assistant', 'tool'])
    expect(toolNames(unified.tools)).toEqual(['Read'])
    expect(unified.tool_choice).toBe('auto')
  })
})

describe('openai-responses — 対応済み', () => {
  test('(a) フラットな tools が Chat のネスト形に戻る', async () => {
    const unified = await new OpenAIResponsesTransformer().transformRequestOut(
      {
        model: 'm',
        input: 'read a',
        tools: [{ type: 'function', name: 'Read', parameters: { type: 'object', properties: {} } }],
        tool_choice: { type: 'function', name: 'Read' }
      },
      ctx
    )
    expect(toolNames(unified.tools)).toEqual(['Read'])
    expect(unified.tool_choice).toEqual({ type: 'function', function: { name: 'Read' } })
  })

  test('(b)(c) function_call と function_call_output が呼び出し/結果の対で残る', async () => {
    const unified = await new OpenAIResponsesTransformer().transformRequestOut(
      {
        model: 'm',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'read a' }] },
          { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"path":"a"}' },
          { type: 'function_call_output', call_id: 'call_1', output: 'file body' }
        ]
      },
      ctx
    )
    expect(roles(unified.messages)).toEqual(['user', 'assistant', 'tool'])
    expect(Object(unified.messages[2])).toMatchObject({ tool_call_id: 'call_1', content: 'file body' })
  })
})

describe('gemini-generate — 対応済み', () => {
  test('(a) functionDeclarations が unified の function ツールになる', async () => {
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [],
        tools: [
          {
            functionDeclarations: [
              { name: 'lookup', description: 'look something up', parameters: { type: 'object', properties: {} } }
            ]
          }
        ]
      },
      ctx
    )
    expect(toolNames(unified.tools)).toEqual(['lookup'])
  })

  test('(b)(c) functionCall / functionResponse が呼び出し/結果の対で残る', async () => {
    // Gemini は functionResponse をユーザーターンに詰めるが、unified は
    // OpenAI 流に結果 1 件 = 1 メッセージ。だから contents 2 件から
    // assistant + tool の 2 メッセージが出る。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [
          { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { q: 'x' } } }] },
          { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { result: 'ok' } } }] }
        ]
      },
      ctx
    )
    expect(roles(unified.messages)).toEqual(['assistant', 'tool'])
    const assistant = Object(unified.messages[0])
    const call = Object(Reflect.get(Object(Reflect.get(assistant, 'tool_calls')), '0'))
    expect(call).toMatchObject({ type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } })
    // Gemini の functionResponse は id を持たないのが普通なので、
    // 名前と到着順で呼び出しに突き合わせて id を合成する。ここが
    // ずれると OpenAI 系プロバイダが tool_call_id 不一致で 400 を返す。
    expect(Object(unified.messages[1])).toMatchObject({
      role: 'tool',
      tool_call_id: Reflect.get(call, 'id'),
      content: 'ok'
    })
  })

  test('(b)(c) 同名ツールの複数呼び出しが取り違えられない', async () => {
    // 合成 id が呼び出しごとに一意でないと、2 回目の結果が 1 回目の
    // 呼び出しに紐づく。名前だけで対にすると起きる壊れ方。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [
          {
            role: 'model',
            parts: [
              { functionCall: { name: 'lookup', args: { q: 'a' } } },
              { functionCall: { name: 'lookup', args: { q: 'b' } } }
            ]
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'lookup', response: { result: 'A' } } },
              { functionResponse: { name: 'lookup', response: { result: 'B' } } }
            ]
          }
        ]
      },
      ctx
    )
    const calls = Object(Reflect.get(Object(unified.messages[0]), 'tool_calls'))
    const ids = [Reflect.get(Object(calls[0]), 'id'), Reflect.get(Object(calls[1]), 'id')]
    expect(new Set(ids).size).toBe(2)
    expect(Object(unified.messages[1])).toMatchObject({ tool_call_id: ids[0], content: 'A' })
    expect(Object(unified.messages[2])).toMatchObject({ tool_call_id: ids[1], content: 'B' })
  })

  test('対応済み: Gemini の toolConfig（呼び出しモード）が tool_choice になる', async () => {
    // `buildToolConfig`（outbound）のちょうど逆。許可名が 1 つの ANY は
    // 「その関数を呼べ」なので、OpenAI 語彙の function 指定に落とす。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [],
        toolConfig: { functionCallingConfig: { mode: 'any', allowedFunctionNames: ['lookup'] } }
      },
      ctx
    )
    expect(unified.tool_choice).toEqual({ type: 'function', function: { name: 'lookup' } })
  })

  test('対応済み: 大文字の mode（ワイヤ上の綴り）も読む', async () => {
    // Gemini がワイヤに載せるのは AUTO / ANY / NONE。自前の outbound は
    // 小文字を出すので、どちらでも同じに読めないと往復で割れる。
    const auto = await new GeminiTransformer().transformRequestOut(
      { model: 'gemini-3-pro', contents: [], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } },
      ctx
    )
    expect(auto.tool_choice).toBe('auto')
    const any = await new GeminiTransformer().transformRequestOut(
      { model: 'gemini-3-pro', contents: [], toolConfig: { functionCallingConfig: { mode: 'ANY' } } },
      ctx
    )
    expect(any.tool_choice).toBe('required')
  })

  // 応答方向（OpenAI tool_calls → Gemini functionCall パート、引数の
  // 分割断片の組み立てを含む）は __tests__/llms/gemini-inbound-response.test.ts
  // が担保している。
})
