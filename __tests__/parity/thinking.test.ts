/**
 * Parity matrix — the "thinking / reasoning" row.
 *
 * Both directions are checked: the request (client → upstream) and the
 * response (upstream → client). Surfaces really do carry only one of
 * them, and "can ask for thinking but never receives it" and "receives it
 * but cannot ask" are different failures.
 *
 * The internal representation is `reasoning: { effort }` on the request
 * and `choices[].message.thinking.content` — a Rialto-internal extension
 * field — on the response.
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

// A chat.completion response carrying thinking. Every surface's
// response direction starts from this.
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

describe('anthropic-messages — supported in both directions', () => {
  test('request: thinking.budget_tokens becomes reasoning.effort', async () => {
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

  test('request: type=adaptive sets no unified reasoning and only selects the think lane', async () => {
    // `adaptive` hands the decision to the model, and Rialto has no
    // budget to translate. Counting for scenario classification (the
    // think lane) while staying out of unified is a deliberate
    // asymmetry.
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

  test('response: thinking comes back as an Anthropic thinking block', async () => {
    const converted = await new AnthropicTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const content = Reflect.get(Object(body), 'content')
    const thinkingBlock = Array.isArray(content)
      ? content.find((b) => Reflect.get(Object(b), 'type') === 'thinking')
      : undefined
    expect(thinkingBlock).toMatchObject({ type: 'thinking', thinking: 'weighing options', signature: 'sig' })
  })

  test('caveat: the thinking block is placed after the text, where Anthropic itself puts it first', async () => {
    // `convertOpenAIResponseToAnthropic` stacks annotation → text →
    // tool_use → thinking. Anthropic puts thinking first, and requires it
    // first when an assistant turn is sent back. The gemini side writing
    // the same conversion (buildParts in gemini-inbound-response.ts)
    // explicitly orders thinking → body → tools, so the order is forked
    // between surfaces. Fix the order and invert this expectation with
    // it.
    const converted = await new AnthropicTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const content = Reflect.get(Object(body), 'content')
    const types = Array.isArray(content) ? content.map((b) => Reflect.get(Object(b), 'type')) : []
    expect(types).toEqual(['text', 'thinking'])
  })
})

describe('openai-chat — partial', () => {
  test('request: supported — reasoning_effort becomes the nested reasoning.effort', async () => {
    // The translation rule itself is covered by "reasoning_effort
    // translation" in
    // __tests__/llms/openai-transformer-request-out.test.ts. This is the
    // single surface-level check.
    const unified = await new OpenAITransformer().transformRequestOut(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' },
      ctx
    )
    expect(unified.reasoning).toEqual({ effort: 'high' })
  })

  test('response: supported by passing a non-streaming body through — message.thinking arrives intact', async () => {
    const upstream = chatJson(THINKING_COMPLETION)
    const relayed = await new OpenAITransformer().transformResponseIn(upstream, ctx)
    const body: unknown = await relayed.json()
    const choices = Reflect.get(Object(body), 'choices')
    const message = Array.isArray(choices) ? Reflect.get(Object(choices[0]), 'message') : undefined
    expect(Reflect.get(Object(message), 'thinking')).toEqual({ content: 'weighing options', signature: 'sig' })
  })

  test('response: unsupported — the non-streaming aggregation path discards the thinking deltas', async () => {
    // Only on the path where an SSE upstream serves a `stream:false`
    // client (codex-oauth) does the aggregation fail to read
    // delta.thinking, and the thinking disappears. It survives on the
    // pass-through path, so behaviour forks by path within one
    // surface.
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

describe('openai-responses — partial', () => {
  test('request: supported — the reasoning block survives into unified', async () => {
    const unified = await new OpenAIResponsesTransformer().transformRequestOut(
      { model: 'm', input: 'hi', reasoning: { effort: 'high' } },
      ctx
    )
    expect(unified.reasoning).toEqual({ effort: 'high' })
  })

  test('response: unsupported — no reasoning output item is built in the Responses envelope', async () => {
    // `convertChatCompletionToResponses` assembles only message and
    // function_call. With no counterpart to the Responses API's
    // `reasoning` item, the thinking never reaches the envelope and is
    // invisible to the Codex CLI.
    const converted = await new OpenAIResponsesTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const output = Reflect.get(Object(body), 'output')
    const types = Array.isArray(output) ? output.map((i) => Reflect.get(Object(i), 'type')) : []
    expect(types).toEqual(['message'])
    expect(types).not.toContain('reasoning')
  })
})

describe('gemini-generate — supported in both directions', () => {
  test('request: thinkingBudget becomes reasoning.effort', async () => {
    // Rounding a budget to a level uses the same `getThinkLevel`
    // /v1/messages applies to Anthropic's budget_tokens. "8192 tokens of
    // thinking" must not mean different things on different surfaces.
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

  test("request: Gemini 3's thinkingLevel maps straight onto effort", async () => {
    const unified = await new GeminiTransformer().transformRequestOut(
      { model: 'gemini-3-pro', contents: [], generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } },
      ctx
    )
    expect(unified.reasoning).toEqual({ enabled: true, effort: 'high' })
  })

  test('request: an unknown thinkingLevel does not sink the whole request', async () => {
    // Google adds thinking levels. A strict enum would turn one
    // unrecognised value into a 500 and kill the conversation, so an
    // unreadable field is ignored and the request goes on.
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

  test('request: no thinkingConfig means no reasoning', async () => {
    const unified = await new GeminiTransformer().transformRequestOut(
      { model: 'gemini-3-pro', contents: [], generationConfig: { maxOutputTokens: 64 } },
      ctx
    )
    expect(unified.reasoning).toBeUndefined()
  })

  test('request: a thought part lands in thinking, not in content', async () => {
    // Gemini sends a previous turn's model thinking back as a part with
    // `thought: true`. Mixed into the body, the model's private
    // reasoning would reach the next provider as speech.
    const unified = await new GeminiTransformer().transformRequestOut(
      {
        model: 'gemini-3-pro',
        contents: [
          {
            role: 'model',
            parts: [{ text: 'weighing options', thought: true, thoughtSignature: 'sig' }, { text: 'pong' }]
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

  test('response: supported — comes back as a part with thought: true', async () => {
    const converted = await new GeminiTransformer().transformResponseIn(chatJson(THINKING_COMPLETION), ctx)
    const body: unknown = await converted.json()
    const candidates = Reflect.get(Object(body), 'candidates')
    const content = Array.isArray(candidates) ? Reflect.get(Object(candidates[0]), 'content') : undefined
    expect(Reflect.get(Object(content), 'parts')).toEqual([
      { text: 'weighing options', thought: true },
      { text: 'pong' }
    ])
  })

  // Thought parts on the streaming response side are covered by
  // __tests__/llms/gemini-inbound-response.test.ts.
})
