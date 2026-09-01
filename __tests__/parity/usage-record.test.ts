/**
 * パリティ・マトリクス — 行「usage 記録 (RequestLog)」。
 *
 * RequestLog の1行は 2 つの独立した出所から組み立てられる:
 *
 *   (1) **面の帰属**  `inboundType` / `surface` 列。記述子から
 *       `resolveInvocationForModel` が押す。面ごとに違い、面ごとに壊れうる。
 *   (2) **トークン数** 上流応答の usage ブロック。`captureUsage` が
 *       **変換前の生の上流応答**のクローンから読む（provider-send.ts が
 *       `processResponseTransformers` の手前でクローンする）ので、
 *       読める語彙は**プロバイダ**の wire format で決まる。
 *
 * (2) が面の表に載るのは、面ごとに「素通しで当たる既定のプロバイダ」が
 * 決まっているから。gemini 面 → Google プロバイダの組み合わせでは上流が
 * `usageMetadata` を返し、これは `UsageBlockSchema` に無いので usage が
 * null になり、**行そのものが作られない**。
 */

import { describe, expect, test } from 'bun:test'
import pino from 'pino'
import { resolveInvocationForModel } from '../../src/api/v1/invocation'
import type { RoutePlan } from '../../src/api/v1/route-plan'
import type { LlmsContext } from '../../src/llms'
import type { PipelineDeps } from '../../src/llms/pipeline/types'
import { captureUsage } from '../../src/llms/pipeline/usage-extraction'
import { ConfigStore } from '../../src/llms/registry/config'
import { ProviderRegistry, type ResolvedProvider } from '../../src/llms/registry/provider'
import { TokenizerRegistry } from '../../src/llms/registry/tokenizer'
import { TransformerRegistry } from '../../src/llms/registry/transformer'
import { AnthropicTransformer } from '../../src/llms/transformers/anthropic'
import { GeminiTransformer } from '../../src/llms/transformers/gemini'
import { OpenAIResponsesTransformer, OpenAITransformer } from '../../src/llms/transformers/openai'
import type { TransformerContext, UsageRecord } from '../../src/schemas/domain'

const log = pino({ level: 'silent' })
const provider = { name: 'p' } as ResolvedProvider

// captureUsage を1回まわして、書かれた行（書かれなければ null）を返す。
const rowFor = async (upstream: Response, context: TransformerContext): Promise<UsageRecord | null> => {
  const captured: { value: UsageRecord | null } = { value: null }
  const deps: PipelineDeps = {
    log,
    recordUsage: async (entry) => {
      captured.value = entry
    }
  }
  await captureUsage(upstream, context, provider, { model: 'm' }, 200, 12, deps)
  return captured.value
}

const json = (payload: Record<string, unknown>): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })

const sse = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })

const ctxWithSession = (extra: Record<string, unknown> = {}): TransformerContext =>
  ({ req: { headers: { 'x-claude-code-session-id': 'sess-1' }, model: 'm', ...extra } }) as unknown as TransformerContext

// ─── (1) 面の帰属 ────────────────────────────────────────────────────

const PROVIDERS = [
  {
    name: 'p',
    auth_mode: 'api_key' as const,
    api_style: 'openai_chat' as const,
    api_key: 'sk',
    api_base_url: 'https://example.test/v1/chat/completions',
    models: ['m']
  }
]

async function buildContext(): Promise<LlmsContext> {
  const transformers = new TransformerRegistry(log)
  transformers.registerMany([
    new AnthropicTransformer(),
    new OpenAITransformer(),
    new OpenAIResponsesTransformer(),
    new GeminiTransformer()
  ])
  const providers = new ProviderRegistry(transformers, log)
  providers.registerFromConfig(PROVIDERS)
  const tokenizers = new TokenizerRegistry(log)
  const config = new ConfigStore({ Providers: PROVIDERS, providers: PROVIDERS, Router: {} })
  return { config, transformers, providers, tokenizers, log }
}

const planFor = (path: string): RoutePlan => ({
  routedBody: { model: 'p,m' },
  headers: {},
  transformersByName: new Map(),
  defaultTransformer: new OpenAITransformer(),
  scenarioType: 'default',
  primaryModel: 'p,m',
  isSubagent: false,
  fallbacks: [],
  peerTargets: new Set<string>(),
  path,
  search: ''
})

describe('面の帰属 — 4面すべてが自分の inboundType / surface を刻む', () => {
  const CASES: ReadonlyArray<[string, string, string]> = [
    ['/v1/messages', 'anthropic', 'anthropic-messages'],
    ['/v1/chat/completions', 'openai', 'openai-chat'],
    ['/v1/responses', 'openai', 'openai-responses'],
    ['/v1beta/models/gemini-3-pro:generateContent', 'gemini', 'gemini-generate']
  ]

  for (const [path, inboundType, surface] of CASES) {
    test(`${path} → inboundType=${inboundType} / surface=${surface}`, async () => {
      const ctx = await buildContext()
      const inv = resolveInvocationForModel(planFor(path), 'p,m', ctx)
      expect(inv?.request.inboundType).toBe(inboundType)
      expect(inv?.request.surface).toBe(surface)
    })
  }

  test('面でないパス（/v1/models 等）は null のまま — 誤ったバケットに入れない', async () => {
    const ctx = await buildContext()
    const inv = resolveInvocationForModel(planFor('/v1/models'), 'p,m', ctx)
    expect(inv?.request.inboundType).toBeUndefined()
    expect(inv?.request.surface).toBeUndefined()
  })

  test('刻んだ帰属が RequestLog の行にそのまま載る', async () => {
    const row = await rowFor(
      json({ usage: { input_tokens: 10, output_tokens: 4 } }),
      ctxWithSession({ inboundType: 'gemini', surface: 'gemini-generate', requestedModel: 'gemini-3-pro' })
    )
    expect(row).toMatchObject({
      sessionId: 'sess-1',
      inboundType: 'gemini',
      surface: 'gemini-generate',
      requestedModel: 'gemini-3-pro'
    })
  })
})

// ─── (2) トークン数 ──────────────────────────────────────────────────

describe('トークン数 — 上流 wire format 別', () => {
  test('anthropic（JSON）— 対応済み', async () => {
    const row = await rowFor(json({ usage: { input_tokens: 10, output_tokens: 4 } }), ctxWithSession())
    expect(row).toMatchObject({ inputTokens: 10, outputTokens: 4, totalInputTokens: 10 })
  })

  test('anthropic（SSE）— 対応済み: message_start と message_delta が合流する', async () => {
    const row = await rowFor(
      sse(
        `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 10 } } })}\n\n` +
          `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 4 } })}\n\n`
      ),
      ctxWithSession()
    )
    expect(row).toMatchObject({ inputTokens: 10, outputTokens: 4 })
  })

  test('openai-chat（JSON）— 対応済み: prompt_tokens / completion_tokens', async () => {
    const row = await rowFor(json({ usage: { prompt_tokens: 20, completion_tokens: 7 } }), ctxWithSession())
    expect(row).toMatchObject({ inputTokens: 20, outputTokens: 7 })
  })

  test('openai-responses（SSE）— 対応済み: response.completed の usage を読む', async () => {
    const row = await rowFor(
      sse(
        `data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 30, output_tokens: 9 } } })}\n\n`
      ),
      ctxWithSession()
    )
    expect(row).toMatchObject({ inputTokens: 30, outputTokens: 9 })
  })

  test('gemini（JSON）— 対応済み: usageMetadata を読む', async () => {
    // Gemini は counters を `usage` ではなく応答ルートの `usageMetadata` に
    // 置く。これが読めないと `extractUsage` が null を返し、`captureUsage` は
    // 即 return するので RequestLog に行が 1 行も残らない —— Activity にも
    // 料金にも Gemini のトラフィックが一切出てこない状態になっていた。
    const row = await rowFor(
      json({
        candidates: [],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 9, totalTokenCount: 39 }
      }),
      ctxWithSession()
    )
    expect(row).toMatchObject({ inputTokens: 30, outputTokens: 9, totalInputTokens: 30 })
  })

  test('gemini（SSE）— 対応済み: チャンクの usageMetadata を拾う', async () => {
    // 累積値なので最後に見たものが勝つ。
    const row = await rowFor(
      sse(
        `data: ${JSON.stringify({ candidates: [], usageMetadata: { promptTokenCount: 30 } })}\n\n` +
          `data: ${JSON.stringify({ candidates: [], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 9 } })}\n\n`
      ),
      ctxWithSession()
    )
    expect(row).toMatchObject({ inputTokens: 30, outputTokens: 9 })
  })
})
