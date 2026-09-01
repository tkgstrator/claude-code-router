/**
 * パリティ・マトリクス — 行「非ストリーム集約」。
 *
 * `stream: false` で来たのに上流が SSE しか喋らない（codex-oauth が
 * 代表例）とき、面の記述子が持つ `aggregateSse` が自分の語彙の
 * ノンストリーム封筒に畳み直す。4面すべてに専用のアグリゲータがある。
 *
 * openai-chat / openai-responses / gemini の畳み込み仕様そのものは
 * `__tests__/llms/sse-aggregate.test.ts` が担保しているので、ここでは
 * **記述子経由で呼んだときに面ごとの封筒が返る**ことだけを面横断で
 * 押さえる。Anthropic のアグリゲータだけはどこにも単体テストが無かった
 * ため、ブロック単位の畳み込みをここで担保する。
 */

import { describe, expect, test } from 'bun:test'
import { INBOUND_SURFACES, surfaceForPath } from '../../src/llms/inbound/surfaces'

const sse = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })

const event = (payload: Record<string, unknown>): string => `data: ${JSON.stringify(payload)}\n\n`

// 面ごとの「その面の語彙で書かれた最小のストリーム」と、畳んだ結果が
// その面の封筒であることを示す指紋。
const CASES: ReadonlyArray<{
  path: string
  stream: string
  expect: (folded: Record<string, unknown>) => void
}> = [
  {
    path: '/v1/messages',
    stream:
      event({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', usage: { input_tokens: 3 } } }) +
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } }) +
      event({ type: 'content_block_stop', index: 0 }) +
      event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }) +
      event({ type: 'message_stop' }),
    expect: (folded) => {
      expect(folded.id).toBe('msg_1')
      expect(folded.content).toEqual([{ type: 'text', text: 'pong' }])
      expect(folded.stop_reason).toBe('end_turn')
      expect(folded.usage).toEqual({ input_tokens: 3, output_tokens: 2 })
    }
  },
  {
    path: '/v1/chat/completions',
    stream:
      event({ id: 'chatcmpl-1', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'po' } }] }) +
      event({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'ng' }, finish_reason: 'stop' }] }),
    expect: (folded) => {
      expect(folded.object).toBe('chat.completion')
      const choices = folded.choices as Array<Record<string, unknown>>
      expect(Reflect.get(Object(choices[0].message), 'content')).toBe('pong')
    }
  },
  {
    path: '/v1/responses',
    stream:
      event({ type: 'response.created', response: { id: 'resp_1', object: 'response', status: 'in_progress' } }) +
      event({ type: 'response.output_text.delta', output_index: 0, delta: 'pong' }) +
      event({
        type: 'response.completed',
        response: { id: 'resp_1', object: 'response', status: 'completed', output: [] }
      }),
    expect: (folded) => {
      expect(folded.object).toBe('response')
      expect(folded.status).toBe('completed')
      expect(folded.id).toBe('resp_1')
    }
  },
  {
    path: '/v1beta/models/gemini-3-pro:streamGenerateContent',
    stream:
      event({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'po' }] } }] }) +
      event({
        candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'ng' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 }
      }),
    expect: (folded) => {
      const candidates = folded.candidates as Array<Record<string, unknown>>
      expect(Reflect.get(Object(candidates[0].content), 'parts')).toEqual([{ text: 'pong' }])
      expect(folded.usageMetadata).toBeDefined()
    }
  }
]

describe('4面すべてが自分の封筒に畳める', () => {
  test('記述子は全面ぶん揃っている（ケース表に取りこぼしがない）', () => {
    expect(CASES.map((c) => surfaceForPath(c.path)?.id).sort()).toEqual(
      INBOUND_SURFACES.map((s) => s.id)
        .slice()
        .sort()
    )
  })

  for (const testCase of CASES) {
    test(`${testCase.path} — 記述子の aggregateSse がその面の封筒を返す`, async () => {
      const surface = surfaceForPath(testCase.path)
      expect(surface).toBeDefined()
      testCase.expect(await surface!.aggregateSse(sse(testCase.stream)))
    })
  }
})

describe('anthropic-messages — ブロック単位の畳み込み', () => {
  // Anthropic だけは「インデックス付きのブロックが開いて/差分が来て/閉じる」
  // という構造なので、走り書きの連結では復元できない。ここが他3面と
  // 決定的に違うところで、単体テストが無かった唯一のアグリゲータでもある。
  const fold = async (body: string): Promise<Record<string, unknown>> =>
    await surfaceForPath('/v1/messages')!.aggregateSse(sse(body))

  test('tool_use の partial_json 断片は閉じたときに 1 つの JSON に戻る', async () => {
    const folded = await fold(
      event({ type: 'message_start', message: { id: 'msg_t', role: 'assistant' } }) +
        event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' } }) +
        event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"pa' } }) +
        event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'th":"a"}' } }) +
        event({ type: 'content_block_stop', index: 0 })
    )
    expect(folded.content).toEqual([{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: 'a' } }])
  })

  test('thinking の差分と署名が同じブロックに集まる', async () => {
    const folded = await fold(
      event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) +
        event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'weigh' } }) +
        event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'ing' } }) +
        event({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }) +
        event({ type: 'content_block_stop', index: 0 })
    )
    expect(folded.content).toEqual([{ type: 'thinking', thinking: 'weighing', signature: 'sig' }])
  })

  test('複数ブロックはインデックス順に並ぶ（到着順ではなく）', async () => {
    const folded = await fold(
      event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'second' } }) +
        event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'first' } }) +
        event({ type: 'content_block_stop', index: 0 }) +
        event({ type: 'content_block_stop', index: 1 })
    )
    expect(folded.content).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' }
    ])
  })

  test('上流がブロックの途中で切れても閉じていない分を拾う', async () => {
    const folded = await fold(
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
        event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } })
    )
    expect(folded.content).toEqual([{ type: 'text', text: 'partial' }])
  })
})
