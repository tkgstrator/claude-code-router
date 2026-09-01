/**
 * パリティ・マトリクス — 行「cache トークン計上」。
 *
 * 二方向ある。どちらが欠けても症状が違う:
 *
 *   (A) **計上**   — RequestLog の cacheReadTokens / cacheWriteTokens /
 *       cacheHitPct。欠けると Activity の課金がキャッシュ分だけ過大に出る。
 *   (B) **返却**   — クライアントに返す usage 封筒。欠けてもコストは
 *       正しいが、クライアント側の可視化が黙って 0 になる。
 *
 * (A) は `UsageBlockSchema`（src/schemas/domain/usage-record.ts）が
 * 宣言したフィールドしか読まない。Anthropic の `cache_read_input_tokens` /
 * `cache_creation_input_tokens`、OpenAI Responses の
 * `input_tokens_details.cached_tokens`、OpenAI Chat Completions の
 * `prompt_tokens_details.cached_tokens` の3系統。
 *
 * 二つのベンダは**逆の慣習**で数える。Anthropic の `input_tokens` は
 * 非キャッシュ分だけで、キャッシュ分は隣に並ぶ。OpenAI の `cached_tokens`
 * は SDK の型定義が "Cached tokens present in the prompt" と書くとおり
 * `prompt_tokens` / `input_tokens` の**内訳**で、既に含まれている。
 * 行は Anthropic の慣習（`inputTokens` = 非キャッシュ分、
 * `totalInputTokens` = 全部）で書かれるので、OpenAI 側は合算する前に
 * キャッシュ分を差し引く。ここのフィクスチャは**その慣習どおりの
 * 現実的な値**にしてあること —— `input_tokens` がキャッシュ分より
 * 小さい払い出しは OpenAI からは来ない。
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

// キャッシュ命中つきの chat.completion。返却方向の 4 面はこれを起点にする。
const CACHED_COMPLETION = {
  id: 'chatcmpl-cache',
  object: 'chat.completion',
  created: 1_700_000_000,
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 80 } }
}

describe('(A) 計上 — RequestLog', () => {
  test('anthropic — 対応済み: read と write の両方が載り、命中率が出る', async () => {
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
      // 非キャッシュ分 + write + read。Anthropic の input_tokens は
      // 非キャッシュ分だけなので、合算しないと請求額と合わない。
      totalInputTokens: 100,
      cacheHitPct: 80
    })
  })

  test('openai-responses — 対応済み（read のみ）: input_tokens_details.cached_tokens', async () => {
    // input_tokens は総量で、cached_tokens はその内訳。100 のうち 80 が
    // 命中なら非キャッシュ分は 20 になる。
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

  test('openai-chat — 対応済み: prompt_tokens_details.cached_tokens', async () => {
    // Chat Completions は `prompt_tokens_details.cached_tokens`、Responses は
    // `input_tokens_details.cached_tokens` と綴りが違うだけの同じ数。片方しか
    // 宣言しないと Chat 経路の命中が 0 で記録され、実際には安くなっている
    // 課金が Activity では満額で出ていた。
    const row = await rowFor(json({ usage: CACHED_COMPLETION.usage }))
    expect(row).toMatchObject({
      inputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      totalInputTokens: 100,
      cacheHitPct: 80
    })
  })

  test('OpenAI の内訳は二重計上されない —— 差し引いてから足し直す', async () => {
    // 命中ゼロなら prompt_tokens がそのまま非キャッシュ分になる、という
    // 退化ケース。ここが崩れると全リクエストの input がずれる。
    const row = await rowFor(json({ usage: { prompt_tokens: 100, completion_tokens: 5 } }))
    expect(row).toMatchObject({ inputTokens: 100, cacheReadTokens: 0, totalInputTokens: 100, cacheHitPct: 0 })
  })

  test('gemini — 対応済み: cachedContentTokenCount も内訳として扱う', async () => {
    // SDK が "When `cached_content` is set, this also includes the number
    // of tokens in the cached content" と書くとおり、promptTokenCount は
    // キャッシュ分を含む総量。OpenAI と同じ慣習なので差し引いて足し直す。
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

describe('(B) 返却 — クライアントが見る usage 封筒', () => {
  const chatCtx = { req: { id: 'parity' } } as unknown as TransformerContext

  test('anthropic — 対応済み: cache_read_input_tokens に畳み直される', async () => {
    const converted = await new AnthropicTransformer().transformResponseIn(json(CACHED_COMPLETION), chatCtx)
    const body: unknown = await converted.json()
    expect(Reflect.get(Object(body), 'usage')).toEqual({
      // Anthropic の慣習に合わせ、input_tokens は非キャッシュ分のみ。
      input_tokens: 20,
      output_tokens: 5,
      cache_read_input_tokens: 80
    })
  })

  test('openai-chat — 対応済み（素通し）: 上流の details がそのまま届く', async () => {
    const upstream = json(CACHED_COMPLETION)
    const relayed = await new OpenAITransformer().transformResponseIn(upstream, chatCtx)
    const body: unknown = await relayed.json()
    const usage = Reflect.get(Object(body), 'usage')
    expect(Reflect.get(Object(usage), 'prompt_tokens_details')).toEqual({ cached_tokens: 80 })
  })

  test('gemini — 対応済み: cachedContentTokenCount として戻る', async () => {
    const converted = await new GeminiTransformer().transformResponseIn(json(CACHED_COMPLETION), chatCtx)
    const body: unknown = await converted.json()
    expect(Reflect.get(Object(body), 'usageMetadata')).toMatchObject({
      promptTokenCount: 100,
      cachedContentTokenCount: 80
    })
  })

  test('未対応: openai-responses の封筒はキャッシュ内訳を落とす', async () => {
    // `convertChatCompletionToResponses` が組むのは input/output/total の
    // 三つだけ。Responses API 本家は `input_tokens_details.cached_tokens` を
    // 返すので、Codex CLI 側のキャッシュ表示は常に 0 になる。
    const converted = await new OpenAIResponsesTransformer().transformResponseIn(json(CACHED_COMPLETION), chatCtx)
    const body: unknown = await converted.json()
    const usage = Reflect.get(Object(body), 'usage')
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 5, total_tokens: 105 })
    expect(Reflect.get(Object(usage), 'input_tokens_details')).toBeUndefined()
  })
})
