/**
 * Regression tests for ResponsesStreamSession.
 *
 * Reporter hit `JSONDecodeError: Extra data` from the official OpenAI
 * Python SDK when streaming /v1/chat/completions through a codex
 * provider. The stream started with two raw Responses payloads:
 *
 *   data: {"type":"response.created","response":{...}}
 *   data: {"type":"response.in_progress","response":{...}}
 *   data: {"id":"msg_…","object":"chat.completion.chunk",…}
 *
 * Root cause: codex sends an explicit `"usage": null` on those two
 * events. `ResponsesStreamEventSchema` modelled usage as `.optional()`,
 * which rejects null, so the events failed to parse and fell through to
 * the raw-passthrough branch — emitting Responses payloads on a wire
 * that promises chat chunks. Any SDK reading `data:` lines as chat
 * chunks throws on the first one.
 */

import { describe, expect, test } from 'bun:test'
import { ResponsesStreamEventSchema } from '../../src/schemas'
import { ResponsesStreamSession } from '../../src/llms/transformers/openai/responses/response-stream'

function sse(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('')))
      controller.close()
    }
  }).getReader()
}

async function drive(lines: string[]): Promise<string[]> {
  const out: string[] = []
  const decoder = new TextDecoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const session = new ResponsesStreamSession(controller)
      await session.run(sse(lines))
    }
  })
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(decoder.decode(value))
  }
  return out
    .join('')
    .split('\n')
    .filter((line) => line.trim().length > 0)
}

describe('ResponsesStreamSession', () => {
  test('schema accepts the explicit null usage codex sends', () => {
    const created = {
      type: 'response.created',
      response: { id: 'resp_1', model: 'gpt-5.6-luna', output: [], usage: null }
    }
    expect(ResponsesStreamEventSchema.safeParse(created).success).toBe(true)
  })

  test('schema still accepts a populated usage', () => {
    const completed = {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        model: 'gpt-5.6-luna',
        output: [{ type: 'message' }],
        usage: { input_tokens: 18, output_tokens: 5, total_tokens: 23 }
      }
    }
    const parsed = ResponsesStreamEventSchema.safeParse(completed)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.response?.usage?.total_tokens).toBe(23)
  })

  test('no response.* payload reaches the chat stream', async () => {
    const emitted = await drive([
      `data: ${JSON.stringify({
        type: 'response.created',
        response: { id: 'resp_1', model: 'gpt-5.6-luna', output: [], usage: null }
      })}\n\n`,
      `data: ${JSON.stringify({
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: 'm1', type: 'message', content: [] }
      })}\n\n`,
      `data: ${JSON.stringify({
        type: 'response.output_text.delta',
        item_id: 'm1',
        output_index: 0,
        delta: 'hi'
      })}\n\n`,
      'data: [DONE]\n\n'
    ])
    for (const line of emitted) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
      const payload: unknown = JSON.parse(line.slice(6))
      const object = typeof payload === 'object' && payload !== null && 'object' in payload ? payload.object : undefined
      expect(object).toBe('chat.completion.chunk')
    }
    expect(emitted.some((l) => l.includes('"object":"chat.completion.chunk"'))).toBe(true)
  })

  test('an unrecognised non-Responses payload is still passed through', async () => {
    const emitted = await drive([`data: ${JSON.stringify({ hello: 'world' })}\n\n`, 'data: [DONE]\n\n'])
    expect(emitted.some((l) => l.includes('"hello":"world"'))).toBe(true)
  })
})
