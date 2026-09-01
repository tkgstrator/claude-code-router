/**
 * パリティ・マトリクス — 行「thinking / reasoning」。
 *
 * 要求側（クライアント → 上流）と応答側（上流 → クライアント）の
 * 両方を見る。片方だけ通る面が実際にあり、「思考を要求できるが返って
 * こない」「返るが要求できない」はどちらも別の壊れ方をする。
 *
 * 内部表現は要求側が `reasoning: { effort }`、応答側が
 * `choices[].message.thinking.content`（Rialto 内部の拡張フィールド）。
 */

import { describe, expect, test } from 'bun:test'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAIResponsesTransformer, OpenAITransformer } from '../../src/llms/transformers/openai'
import { aggregateOpenAiChatSseToJson } from '../../src/llms/utils/sse-aggregate'
import type { TransformerContext } from '../../src/schemas/domain'

const ctx = { req: { id: 'parity' } } as unknown as TransformerContext

const chatJson = (payload: Record<string, unknown>): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

// 思考つきの chat.completion 応答。4面の応答側はすべてこれを起点にする。
const THINKING_COMPLETION = {
  id: 'chatcmpl-think',
  object: 'chat.completion',
  created: 1_700_000_000,
  model: 'm',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'pong', thinking: { content: 'weighing options', signature: 'sig' } },
      finish_reason: 'stop'
    }
  ]
}

describe('anthropic-messages — 対応済み（双方向）', () => {
  test('要求: thinking.budget_tokens が reasoning.effort になる', async () => {
    const unified = await new AnthropicTransformer().transformRequestOut(
      {
        model: 'm',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'enabled', budget_tokens: 10_000 }
      },
      ctx
    )
    expect(unified.reasoning).toMatchObject({ enabled: true })
    expect(typeof unified.reasoning?.effort).toBe('string')
  })

  test('要求: type=adaptive は unified の reasoning を立てない（think レーンの選択のみ）', async () => {
    // `adaptive` はモデル側に判断を委ねる指定で、Rialto は予算を訳せない。
    // シナリオ分類（think レーン）には効くが unified には出ない、という
    // 非対称は意図的なもの。
    const unified = await new AnthropicTransformer().transformRequestOut(
      {
        model: 'm',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'adaptive' }
      },
      ctx
    )
    expect(unified.reasoning).toBeUndefined()
  })

  test('応答: thinking が Anthropic の thinking ブロックとして戻る', async () => {
    const converted = await new AnthropicTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const content = Reflect.get(Object(body), 'content')
    const thinkingBlock = Array.isArray(content)
      ? content.find((b) => Reflect.get(Object(b), 'type') === 'thinking')
      : undefined
    expect(thinkingBlock).toMatchObject({ type: 'thinking', thinking: 'weighing options', signature: 'sig' })
  })

  test('要注意: thinking ブロックが text の後ろに置かれる（Anthropic 実機は先頭）', async () => {
    // `convertOpenAIResponseToAnthropic` は annotation → text → tool_use →
    // thinking の順に積む。Anthropic 本家は思考を先頭に置き、アシスタント
    // ターンを送り返すときも thinking が先頭であることを要求する。同じ
    // 変換を書いている gemini 側（gemini-inbound-response.ts の buildParts）は
    // 「思考 → 本文 → ツール」と明示的に並べているので、面の間で順序が
    // 割れている。順序を直したらこの期待値も反転させること。
    const converted = await new AnthropicTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const content = Reflect.get(Object(body), 'content')
    const types = Array.isArray(content) ? content.map((b) => Reflect.get(Object(b), 'type')) : []
    expect(types).toEqual(['text', 'thinking'])
  })
})

describe('openai-chat — 部分対応', () => {
  test('要求: 対応済み — reasoning_effort が nested reasoning.effort になる', async () => {
    // 変換規則そのものは __tests__/llms/openai-transformer-request-out.test.ts
    // 「reasoning_effort translation」が担保。ここでは面の担保として1点だけ。
    const unified = await new OpenAITransformer().transformRequestOut(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' },
      ctx
    )
    expect(unified.reasoning).toEqual({ effort: 'high' })
  })

  test('応答: 対応済み（非ストリーム素通し）— message.thinking がそのまま届く', async () => {
    const upstream = chatJson(THINKING_COMPLETION)
    const relayed = await new OpenAITransformer().transformResponseIn(upstream, ctx)
    const body: unknown = await relayed.json()
    const choices = Reflect.get(Object(body), 'choices')
    const message = Array.isArray(choices) ? Reflect.get(Object(choices[0]), 'message') : undefined
    expect(Reflect.get(Object(message), 'thinking')).toEqual({ content: 'weighing options', signature: 'sig' })
  })

  test('応答: 未対応 — 非ストリーム集約の経路では thinking の差分が捨てられる', async () => {
    // `stream:false` のクライアントを SSE 上流が服務する経路
    // （codex-oauth）だけ、集約が delta.thinking を読まないので思考が消える。
    // 素通し経路では残るぶん、面の中で経路によって挙動が割れている。
    const stream =
      `data: ${JSON.stringify({ id: 'c', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', thinking: { content: 'weighing' } } }] })}\n\n` +
      `data: ${JSON.stringify({ id: 'c', choices: [{ index: 0, delta: { content: 'pong' }, finish_reason: 'stop' }] })}\n\n`
    const folded = await aggregateOpenAiChatSseToJson(
      new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    )
    const choices = folded.choices as Array<Record<string, unknown>>
    expect(Reflect.get(Object(choices[0].message), 'thinking')).toBeUndefined()
    expect(Reflect.get(Object(choices[0].message), 'content')).toBe('pong')
  })
})

describe('openai-responses — 部分対応', () => {
  test('要求: 対応済み — reasoning ブロックが unified に残る', async () => {
    const unified = await new OpenAIResponsesTransformer().transformRequestOut(
      { model: 'm', input: 'hi', reasoning: { effort: 'high' } },
      ctx
    )
    expect(unified.reasoning).toEqual({ effort: 'high' })
  })

  test('応答: 未対応 — Responses 封筒に reasoning の出力アイテムが作られない', async () => {
    // `convertChatCompletionToResponses` が組み立てるのは message と
    // function_call だけ。Responses API の `reasoning` アイテムに相当する
    // ものが無いので、思考は封筒に載らず Codex CLI からは見えない。
    const converted = await new OpenAIResponsesTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const output = Reflect.get(Object(body), 'output')
    const types = Array.isArray(output) ? output.map((i) => Reflect.get(Object(i), 'type')) : []
    expect(types).toEqual(['message'])
    expect(types).not.toContain('reasoning')
  })
})

describe('gemini-generate — 対応済み（双方向）', () => {
  test('要求: thinkingBudget が reasoning.effort になる', async () => {
    // 予算 → 段階の丸めは `/v1/messages` が Anthropic の budget_tokens に
    // 使うのと同じ `getThinkLevel`。面によって「8192 トークンの思考」の
    // 意味が変わってはいけない。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [],
        generationConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 8_192 } }
      },
      ctx
    )
    expect(unified.reasoning).toEqual({ enabled: true, effort: 'medium', max_tokens: 8_192 })
  })

  test('要求: Gemini 3 の thinkingLevel はそのまま effort になる', async () => {
    const unified = await new GeminiTransformer().transformRequestOut(
      { model: 'gemini-3-pro', contents: [], generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } },
      ctx
    )
    expect(unified.reasoning).toEqual({ enabled: true, effort: 'high' })
  })

  test('要求: 未知の thinkingLevel でリクエスト全体を落とさない', async () => {
    // Google は think レベルを増やす。厳格な enum にすると、知らない値
    // ひとつで 500 になり会話が死ぬ。読めないフィールドは無視して通す。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [],
        generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'ultra' } }
      },
      ctx
    )
    expect(unified.reasoning).toEqual({ enabled: true })
  })

  test('要求: thinkingConfig が無ければ reasoning を立てない', async () => {
    const unified = await new GeminiTransformer().transformRequestOut(
      { model: 'gemini-3-pro', contents: [], generationConfig: { maxOutputTokens: 64 } },
      ctx
    )
    expect(unified.reasoning).toBeUndefined()
  })

  test('要求: 思考パートは content ではなく thinking に載る', async () => {
    // Gemini は過去ターンのモデル思考を `thought: true` のパートとして
    // 送り返す。これを本文に混ぜると、モデルの内心が次のプロバイダに
    // 発話として渡る。
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [
          {
            role: 'model',
            parts: [
              { text: 'weighing options', thought: true, thoughtSignature: 'sig' },
              { text: 'pong' }
            ]
          }
        ]
      },
      ctx
    )
    expect(Object(unified.messages[0])).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'pong' }],
      thinking: { content: 'weighing options', signature: 'sig' }
    })
  })

  test('応答: 対応済み — thought: true のパートとして戻る', async () => {
    const converted = await new GeminiTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const candidates = Reflect.get(Object(body), 'candidates')
    const content = Array.isArray(candidates) ? Reflect.get(Object(candidates[0]), 'content') : undefined
    expect(Reflect.get(Object(content), 'parts')).toEqual([
      { text: 'weighing options', thought: true },
      { text: 'pong' }
    ])
  })

  // ストリーミング応答側の thought パートは
  // __tests__/llms/gemini-inbound-response.test.ts が担保している。
})
