/**
 * パリティ・マトリクス — 行「ストリーミング (SSE)」。
 *
 * 各面が「自分の語彙の SSE」をクライアントに返せるかを見る。判定対象は
 * **変換経路**（面の wire format ≠ プロバイダの wire format）で、これは
 * 面の endpoint transformer の `transformResponseIn` が担当する。同一
 * wire format のプロバイダに当たる経路はパイプラインがバイパスに落ちて
 * 変換自体が走らないため、ここでは評価しない（docs/architecture/
 * inbound-parity.md の「判定基準」を参照）。
 *
 * 内部表現は OpenAI chat.completion なので、4面すべてで入力は
 * chat.completion.chunk の SSE になる。違うのは出力の語彙と、
 * **刻み方**（逐次かバッファリングか）だけ。
 */

import { describe, expect, test } from 'bun:test'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAIResponsesTransformer, OpenAITransformer } from '../../src/llms/transformers/openai'
import type { TransformerContext } from '../../src/schemas/domain'

const ctx = { req: { id: 'parity' } } as unknown as TransformerContext

const chunk = (payload: Record<string, unknown>): string => `data: ${JSON.stringify(payload)}\n\n`

const chatStream = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

// Two separate content deltas, so a converter that buffers is
// distinguishable from one that relays the upstream cadence.
const TWO_DELTA_STREAM =
  chunk({
    id: 'chatcmpl-parity',
    model: 'm',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }]
  }) +
  chunk({ id: 'chatcmpl-parity', model: 'm', choices: [{ index: 0, delta: { content: 'lo' } }] }) +
  chunk({ id: 'chatcmpl-parity', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
  'data: [DONE]\n\n'

const eventNames = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .filter((l) => l.startsWith('event:'))
    .map((l) => l.slice(6).trim())

const dataPayloads = (raw: string): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const body = line.slice(5).trim()
    if (body.length === 0 || body === '[DONE]') continue
    const parsed: unknown = JSON.parse(body)
    if (parsed !== null && typeof parsed === 'object') out.push(parsed as Record<string, unknown>)
  }
  return out
}

describe('anthropic-messages — 対応済み（逐次）', () => {
  test('chat.completion.chunk の SSE が Anthropic のイベント語彙になる', async () => {
    const converted = await new AnthropicTransformer().transformResponseIn(chatStream(TWO_DELTA_STREAM), ctx)
    expect(converted.headers.get('Content-Type')).toBe('text/event-stream')
    const raw = await converted.text()
    const names = eventNames(raw)
    expect(names).toContain('message_start')
    expect(names).toContain('content_block_delta')
    expect(names).toContain('message_stop')
  })

  test('上流の刻みがそのまま伝わる（2 つの delta が 2 つのイベントになる）', async () => {
    const converted = await new AnthropicTransformer().transformResponseIn(chatStream(TWO_DELTA_STREAM), ctx)
    const texts = dataPayloads(await converted.text())
      .filter((e) => e.type === 'content_block_delta')
      .map((e) => {
        const delta = e.delta
        return delta !== null && typeof delta === 'object' ? Reflect.get(delta, 'text') : undefined
      })
    expect(texts).toEqual(['Hel', 'lo'])
  })
})

describe('openai-chat — 対応済み（素通し）', () => {
  // 内部表現が chat.completion そのものなので、この面には変換が要らない。
  // base の恒等 `transformResponseIn` を継承しているのが「対応済み」の
  // 実体であり、上流のバイト列がそのままクライアントに届く。
  test('endpoint transformer は応答に触らない', async () => {
    const upstream = chatStream(TWO_DELTA_STREAM)
    const relayed = await new OpenAITransformer().transformResponseIn(upstream, ctx)
    expect(relayed).toBe(upstream)
    expect(await relayed.text()).toBe(TWO_DELTA_STREAM)
  })
})

describe('openai-responses — 部分対応（契約は満たすが逐次性を失う）', () => {
  test('Responses のイベント語彙に変換される', async () => {
    const converted = await new OpenAIResponsesTransformer().transformResponseIn(chatStream(TWO_DELTA_STREAM), ctx)
    expect(converted.headers.get('content-type')).toBe('text/event-stream')
    const names = eventNames(await converted.text())
    expect(names[0]).toBe('response.created')
    expect(names).toContain('response.output_text.delta')
    expect(names[names.length - 1]).toBe('response.completed')
  })

  test('未対応: 上流の刻みは失われ、全文が 1 つの delta にまとまる', async () => {
    // `transformResponseIn` は上流 SSE を一度 `aggregateOpenAiChatSseToJson`
    // で JSON に畳んでから Responses SSE を composeし直す。よって TTFT は
    // 上流の完了時刻まで遅れる。実装側を逐次化したらこの期待値を反転させ、
    // inbound-parity.md の該当セルも同時に更新すること。
    const converted = await new OpenAIResponsesTransformer().transformResponseIn(chatStream(TWO_DELTA_STREAM), ctx)
    const deltas = dataPayloads(await converted.text())
      .filter((e) => e.type === 'response.output_text.delta')
      .map((e) => e.delta)
    expect(deltas).toEqual(['Hello'])
  })
})

describe('gemini-generate — 対応済み（逐次）', () => {
  test('chat.completion.chunk の SSE が candidates[] の語彙になる', async () => {
    const converted = await new GeminiTransformer().transformResponseIn(chatStream(TWO_DELTA_STREAM), ctx)
    expect(converted.headers.get('Content-Type')).toBe('text/event-stream')
    const events = dataPayloads(await converted.text())
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].candidates).toBeDefined()
  })

  test('上流の刻みがそのまま伝わる（2 つの delta が 2 つのチャンクになる）', async () => {
    const converted = await new GeminiTransformer().transformResponseIn(chatStream(TWO_DELTA_STREAM), ctx)
    const texts = dataPayloads(await converted.text()).flatMap((e) => {
      const candidates = Array.isArray(e.candidates) ? e.candidates : []
      return candidates.flatMap((c: unknown) => {
        const content = c !== null && typeof c === 'object' ? Reflect.get(c, 'content') : undefined
        const parts = content !== null && typeof content === 'object' ? Reflect.get(content, 'parts') : undefined
        return Array.isArray(parts) ? parts.map((p: unknown) => Reflect.get(Object(p), 'text')) : []
      })
    })
    expect(texts).toEqual(['Hel', 'lo'])
  })
})
