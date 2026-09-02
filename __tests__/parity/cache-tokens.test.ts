/**
 * Parity matrix — the "cache token accounting" row.
 *
 * There are two directions, and losing either has its own symptom:
 *
 *   (A) **Recording** — RequestLog's cacheReadTokens / cacheWriteTokens /
 *       cacheHitPct. Missing, Activity overstates the bill by the cached
 *       portion.
 *   (B) **Returning** — the usage envelope handed to the client. Missing,
 *       the cost is still right but the client's own display silently
 *       reads zero.
 *
 * (A) reads only the fields `UsageBlockSchema`
 * (src/schemas/domain/usage-record.ts) declares: Anthropic's
 * `cache_read_input_tokens` / `cache_creation_input_tokens`, OpenAI
 * Responses' `input_tokens_details.cached_tokens`, and OpenAI Chat
 * Completions' `prompt_tokens_details.cached_tokens`.
 *
 * The two vendors count by **opposite conventions**. Anthropic's
 * `input_tokens` is the uncached portion only, with the cached counts
 * beside it. OpenAI's `cached_tokens` is a **breakdown of**
 * `prompt_tokens` / `input_tokens` and is already included — as its SDK
 * types put it, "Cached tokens present in the prompt". The row is written
 * in Anthropic's convention (`inputTokens` = uncached, `totalInputTokens`
 * = everything), so the OpenAI side subtracts the cached portion before
 * summing. The fixtures here must hold **realistic values for that
 * convention**: OpenAI never issues a payload whose `input_tokens` is
 * smaller than its cached count.
 */

import { describe, expect, test } from 'bun:test'
import pino from 'pino'
import type { PipelineDeps } from '../../src/llms/pipeline/types'
import { captureUsage } from '../../src/llms/pipeline/usage-extraction'
import type { ResolvedProvider } from '../../src/llms/registry/provider'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAIResponsesTransformer, OpenAITransformer } from '../../src/llms/transformers/openai'
import type { TransformerContext, UsageRecord } from '../../src/schemas/domain'

const log = pino({ level: 'silent' })
const provider = { name: 'p' } as ResolvedProvider
const ctx = { req: { headers: { 'x-claude-code-session-id': 'sess-1' } } } as unknown as TransformerContext

const json = (payload: Record<string, unknown>): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })

const rowFor = async (upstream: Response): Promise<UsageRecord | null> => {
  const captured: { value: UsageRecord | null } = { value: null }
  const deps: PipelineDeps = {
    log,
    recordUsage: async (entry) => {
      captured.value = entry
    }
  }
  await captureUsage(upstream, ctx, provider, { model: 'm' }, 200, 12, deps)
  return captured.value
}

// A chat.completion with a cache hit. All four surfaces of the return
// direction start from this.
const CACHED_COMPLETION = {
  id: 'chatcmpl-cache',
  object: 'chat.completion',
  created: 1_700_000_000,
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 80 } }
}

describe('(A) recording — RequestLog', () => {
  test('anthropic — supported: both read and write are recorded, and a hit rate falls out', async () => {
    const row = await rowFor(
      json({
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 10
        }
      })
    )
    expect(row).toMatchObject({
      inputTokens: 10,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      // Uncached + write + read. Anthropic's input_tokens covers only
      // the uncached portion, so without summing this will not match the
      // bill.
      totalInputTokens: 100,
      cacheHitPct: 80
    })
  })

  test('openai-responses — supported for reads: input_tokens_details.cached_tokens', async () => {
    // input_tokens is the total and cached_tokens a part of it: 80 hits
    // out of 100 leaves 20 uncached.
    const row = await rowFor(
      json({ usage: { input_tokens: 100, output_tokens: 5, input_tokens_details: { cached_tokens: 80 } } })
    )
    expect(row).toMatchObject({
      inputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      totalInputTokens: 100,
      cacheHitPct: 80
    })
  })

  test('openai-chat — supported: prompt_tokens_details.cached_tokens', async () => {
    // The same number spelled two ways: `prompt_tokens_details` on Chat
    // Completions, `input_tokens_details` on Responses. Declaring only
    // one recorded zero hits on the Chat path, so Activity showed the
    // full price for traffic that was in fact discounted.
    const row = await rowFor(json({ usage: CACHED_COMPLETION.usage }))
    expect(row).toMatchObject({
      inputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      totalInputTokens: 100,
      cacheHitPct: 80
    })
  })

  test('the OpenAI breakdown is not double counted — subtract, then add back', async () => {
    // The degenerate case: with no hits, prompt_tokens is the uncached
    // portion. Break this and the input on every request is wrong.
    const row = await rowFor(json({ usage: { prompt_tokens: 100, completion_tokens: 5 } }))
    expect(row).toMatchObject({ inputTokens: 100, cacheReadTokens: 0, totalInputTokens: 100, cacheHitPct: 0 })
  })

  test('gemini — supported: cachedContentTokenCount is a breakdown too', async () => {
    // As the SDK puts it, "When `cached_content` is set, this also
    // includes the number of tokens in the cached content" —
    // promptTokenCount is the total including the cached portion. Same
    // convention as OpenAI, so subtract and add back.
    const row = await rowFor(json({ usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 80 } }))
    expect(row).toMatchObject({
      inputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      totalInputTokens: 100,
      cacheHitPct: 80
    })
  })
})

describe('(B) returning — the usage envelope the client sees', () => {
  const chatCtx = { req: { id: 'parity' } } as unknown as TransformerContext

  test('anthropic — supported: folded back into cache_read_input_tokens', async () => {
    const converted = await new AnthropicTransformer().transformResponseIn(json(CACHED_COMPLETION), chatCtx)
    const body: unknown = await converted.json()
    expect(Reflect.get(Object(body), 'usage')).toEqual({
      // Following Anthropic's convention, input_tokens is the uncached
      // portion only.
      input_tokens: 20,
      output_tokens: 5,
      cache_read_input_tokens: 80
    })
  })

  test('openai-chat — supported by passing through: the upstream details arrive intact', async () => {
    const upstream = json(CACHED_COMPLETION)
    const relayed = await new OpenAITransformer().transformResponseIn(upstream, chatCtx)
    const body: unknown = await relayed.json()
    const usage = Reflect.get(Object(body), 'usage')
    expect(Reflect.get(Object(usage), 'prompt_tokens_details')).toEqual({ cached_tokens: 80 })
  })

  test('gemini — supported: comes back as cachedContentTokenCount', async () => {
    const converted = await new GeminiTransformer().transformResponseIn(json(CACHED_COMPLETION), chatCtx)
    const body: unknown = await converted.json()
    expect(Reflect.get(Object(body), 'usageMetadata')).toMatchObject({
      promptTokenCount: 100,
      cachedContentTokenCount: 80
    })
  })

  test('unsupported: the openai-responses envelope drops the cache breakdown', async () => {
    // `convertChatCompletionToResponses` builds only input, output and
    // total. The real Responses API returns
    // `input_tokens_details.cached_tokens`, so the Codex CLI's cache
    // display always reads zero.
    const converted = await new OpenAIResponsesTransformer().transformResponseIn(json(CACHED_COMPLETION), chatCtx)
    const body: unknown = await converted.json()
    const usage = Reflect.get(Object(body), 'usage')
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 5, total_tokens: 105 })
    expect(Reflect.get(Object(usage), 'input_tokens_details')).toBeUndefined()
  })
})
