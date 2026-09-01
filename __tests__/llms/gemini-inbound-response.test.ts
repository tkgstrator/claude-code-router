/**
 * OpenAI-shaped → Gemini response conversion.
 *
 * This runs whenever a Gemini client is served by a provider that is not
 * Gemini — which is what routing the surface invites. The failure mode it
 * prevents is silent: an OpenAI `chat.completion` body has no
 * `candidates`, so a Google SDK reading one reports an empty answer
 * rather than an error, and the operator sees a model that has stopped
 * talking rather than a gateway that has stopped translating.
 */

import { describe, expect, test } from 'bun:test'
import {
  convertChatCompletionToGemini,
  convertChatStreamToGeminiSse
} from '../../src/llms/utils/gemini-inbound-response'

type GeminiPart = { text?: string; thought?: boolean; functionCall?: { name: string; args: unknown; id?: string } }
type GeminiCandidate = { index?: number; finishReason?: string; content?: { role?: string; parts?: GeminiPart[] } }

const candidates = (envelope: Record<string, unknown>): GeminiCandidate[] => envelope.candidates as GeminiCandidate[]
const partsOf = (envelope: Record<string, unknown>, index = 0): GeminiPart[] =>
  candidates(envelope)[index].content?.parts ?? []

describe('convertChatCompletionToGemini', () => {
  test('a plain answer becomes one candidate with one text part', () => {
    const envelope = convertChatCompletionToGemini({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'claude-sonnet-5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
    })
    expect(candidates(envelope)).toHaveLength(1)
    expect(partsOf(envelope)).toEqual([{ text: 'Hello' }])
    expect(candidates(envelope)[0].content?.role).toBe('model')
    expect(candidates(envelope)[0].finishReason).toBe('STOP')
    expect(envelope.modelVersion).toBe('claude-sonnet-5')
    expect(envelope.responseId).toBe('chatcmpl-1')
  })

  test('usage maps onto usageMetadata under Gemini names', () => {
    const envelope = convertChatCompletionToGemini({
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 40 },
        output_tokens_details: { reasoning_tokens: 5 }
      }
    })
    expect(envelope.usageMetadata).toEqual({
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 120,
      cachedContentTokenCount: 40,
      thoughtsTokenCount: 5
    })
  })

  test('zero cache / reasoning counts are omitted, not reported as zero', () => {
    const envelope = convertChatCompletionToGemini({
      choices: [],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        prompt_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 }
      }
    })
    expect(envelope.usageMetadata).toEqual({
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2
    })
  })

  test('reasoning becomes a thought part, ahead of the answer', () => {
    const envelope = convertChatCompletionToGemini({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'four', thinking: { content: 'two plus two' } },
          finish_reason: 'stop'
        }
      ]
    })
    expect(partsOf(envelope)).toEqual([{ text: 'two plus two', thought: true }, { text: 'four' }])
  })

  test('a tool call becomes a functionCall part with parsed args', () => {
    const envelope = convertChatCompletionToGemini({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"tokyo"}' } }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ]
    })
    // Empty content must NOT become `{ text: '' }` — clients render that
    // as a blank model turn next to the tool call.
    expect(partsOf(envelope)).toEqual([
      { functionCall: { name: 'get_weather', args: { city: 'tokyo' }, id: 'call_1' } }
    ])
    // Gemini has no tool-call finish reason; it says STOP and puts the
    // call in the content.
    expect(candidates(envelope)[0].finishReason).toBe('STOP')
  })

  test('unparseable tool arguments still yield the call, with empty args', () => {
    // Dropping the call would make the model look like it said nothing.
    const envelope = convertChatCompletionToGemini({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_1', function: { name: 'f', arguments: '{"city":' } }]
          },
          finish_reason: 'tool_calls'
        }
      ]
    })
    expect(partsOf(envelope)).toEqual([{ functionCall: { name: 'f', args: {}, id: 'call_1' } }])
  })

  test('finish reasons map onto the names a Gemini client branches on', () => {
    const reasonFor = (finish: string): string | undefined =>
      candidates(
        convertChatCompletionToGemini({ choices: [{ index: 0, message: { content: 'x' }, finish_reason: finish }] })
      )[0].finishReason
    expect(reasonFor('stop')).toBe('STOP')
    expect(reasonFor('length')).toBe('MAX_TOKENS')
    expect(reasonFor('content_filter')).toBe('SAFETY')
  })

  test('multiple choices stay multiple candidates', () => {
    const envelope = convertChatCompletionToGemini({
      choices: [
        { index: 0, message: { content: 'a' }, finish_reason: 'stop' },
        { index: 1, message: { content: 'b' }, finish_reason: 'stop' }
      ]
    })
    expect(candidates(envelope).map((c) => c.index)).toEqual([0, 1])
    expect(partsOf(envelope, 1)).toEqual([{ text: 'b' }])
  })

  test('a body in an unexpected shape yields an empty candidate list, not a throw', () => {
    // The pipeline hands this whatever the last transformer produced;
    // throwing here would turn a degraded answer into a 500.
    expect(convertChatCompletionToGemini(null)).toEqual({ candidates: [] })
    expect(convertChatCompletionToGemini({ choices: 'nope' })).toEqual({ candidates: [] })
  })
})

// ─── streaming ─────────────────────────────────────────────────────────

const streamOf = (body: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    }
  })

async function readSse(stream: ReadableStream<Uint8Array>): Promise<Record<string, unknown>[]> {
  const text = await new Response(stream).text()
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data:'))
    .map((chunk) => JSON.parse(chunk.slice(5).trim()))
}

const chunk = (payload: Record<string, unknown>): string => `data: ${JSON.stringify(payload)}\n\n`

describe('convertChatStreamToGeminiSse', () => {
  test('text deltas pass through one for one, keeping the upstream cadence', async () => {
    const body =
      chunk({ id: 'c1', model: 'gpt-5', choices: [{ index: 0, delta: { role: 'assistant' } }] }) +
      chunk({ id: 'c1', choices: [{ index: 0, delta: { content: 'Hel' } }] }) +
      chunk({ id: 'c1', choices: [{ index: 0, delta: { content: 'lo' } }] }) +
      chunk({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
      'data: [DONE]\n\n'
    const events = await readSse(convertChatStreamToGeminiSse(streamOf(body)))
    // The role-only opener carries nothing a Gemini client can render,
    // so it is dropped rather than sent as an empty model turn.
    expect(events).toHaveLength(3)
    expect(events.map((e) => (e.candidates as GeminiCandidate[])[0].content?.parts)).toEqual([
      [{ text: 'Hel' }],
      [{ text: 'lo' }],
      []
    ])
    const last = (events[2].candidates as GeminiCandidate[])[0]
    expect(last.finishReason).toBe('STOP')
    // model / id are stated once by the upstream and carried onto every
    // emitted chunk, which is what Gemini itself does.
    expect(events[0].modelVersion).toBe('gpt-5')
    expect(events[0].responseId).toBe('c1')
  })

  test('reasoning deltas arrive as thought parts', async () => {
    const body = chunk({ id: 'c1', choices: [{ index: 0, delta: { thinking: { content: 'hmm' } } }] })
    const events = await readSse(convertChatStreamToGeminiSse(streamOf(body)))
    expect((events[0].candidates as GeminiCandidate[])[0].content?.parts).toEqual([{ text: 'hmm', thought: true }])
  })

  test('tool-call fragments are held back and emitted whole at the end', async () => {
    // Gemini has no partial functionCall: emitting a fragment would send
    // the client arguments that are not valid JSON.
    const body =
      chunk({
        id: 'c1',
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'f', arguments: '{"a"' } }] } }
        ]
      }) +
      chunk({
        id: 'c1',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }]
      }) +
      chunk({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    const events = await readSse(convertChatStreamToGeminiSse(streamOf(body)))
    expect(events).toHaveLength(1)
    expect((events[0].candidates as GeminiCandidate[])[0].content?.parts).toEqual([
      { functionCall: { name: 'f', args: { a: 1 }, id: 'call_1' } }
    ])
  })

  test('two parallel tool calls stay separate', async () => {
    const body =
      chunk({
        id: 'c1',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'a', function: { name: 'f', arguments: '{}' } },
                { index: 1, id: 'b', function: { name: 'g', arguments: '{}' } }
              ]
            }
          }
        ]
      }) + chunk({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    const events = await readSse(convertChatStreamToGeminiSse(streamOf(body)))
    const parts = (events[0].candidates as GeminiCandidate[])[0].content?.parts ?? []
    expect(parts.map((p) => p.functionCall?.name)).toEqual(['f', 'g'])
  })

  test('a usage-only trailing chunk still reaches the client', async () => {
    const body = chunk({ id: 'c1', choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })
    const events = await readSse(convertChatStreamToGeminiSse(streamOf(body)))
    expect(events[0].usageMetadata).toEqual({
      promptTokenCount: 2,
      candidatesTokenCount: 1,
      totalTokenCount: 3
    })
  })

  test('malformed chunks are dropped rather than killing the stream', async () => {
    const body =
      'data: {broken\n\n' +
      ': keep-alive comment\n\n' +
      chunk({ id: 'c1', choices: [{ index: 0, delta: { content: 'ok' } }] })
    const events = await readSse(convertChatStreamToGeminiSse(streamOf(body)))
    expect(events).toHaveLength(1)
    expect((events[0].candidates as GeminiCandidate[])[0].content?.parts).toEqual([{ text: 'ok' }])
  })

  test('an empty upstream stream closes cleanly with no events', async () => {
    expect(await readSse(convertChatStreamToGeminiSse(streamOf('')))).toEqual([])
  })
})
