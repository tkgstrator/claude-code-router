/**
 * パリティ・マトリクス — 行「failover / 429」。
 *
 * この行は 4 面で**同一の実装**が動く。チェーンの構築
 * （`buildFailoverChain`）も 429 の判定（`isRateLimited` /
 * `isInsufficientQuota`）もアカウント回転も、面を一切見ていない。
 * 面によって変わるのは、失敗を返すときの封筒だけ。
 *
 * したがってこの行の担保は「面ごとに別々に動くこと」ではなく
 * **「面によって差が出ないこと」**の証明になる。差が出うる唯一の点
 * ——ルーティングが有効な面でしかフォールバック先が解決されない——は
 * `__tests__/parity/routing-mode.test.ts` が担保する。
 */

import { describe, expect, test } from 'bun:test'
import { HTTPException } from 'hono/http-exception'
import pino from 'pino'
import { buildFailoverChain } from '../../src/api/v1/candidate-chain'
import { errorShapeForPath } from '../../src/api/v1/error-shape'
import type { RoutePlan } from '../../src/api/v1/route-plan'
import { forwardUpstreamError, isInsufficientQuota, isRateLimited } from '../../src/api/v1/upstream-error'
import type { LlmsContext } from '../../src/llms'
import { ConfigStore } from '../../src/llms/registry/config'
import { ProviderRegistry } from '../../src/llms/registry/provider'
import { TokenizerRegistry } from '../../src/llms/registry/tokenizer'
import { TransformerRegistry } from '../../src/llms/registry/transformer'
import { OpenAITransformer } from '../../src/llms/transformers/openai'

const log = pino({ level: 'silent' })

const SURFACE_PATHS: readonly string[] = [
  '/v1/messages',
  '/v1/chat/completions',
  '/v1/responses',
  '/v1beta/models/gemini-3-pro:generateContent'
]

const PROVIDERS = [
  {
    name: 'sub',
    auth_mode: 'subscription' as const,
    api_style: 'anthropic' as const,
    api_key: 'sk-a',
    api_base_url: 'https://api.anthropic.com/v1/messages',
    models: ['fable', 'opus']
  },
  {
    name: 'paid',
    auth_mode: 'api_key' as const,
    api_style: 'anthropic' as const,
    api_key: 'sk-b',
    api_base_url: 'https://api.anthropic.com/v1/messages',
    models: ['opus']
  }
]

function buildLlmsContext(): LlmsContext {
  const transformers = new TransformerRegistry(log)
  transformers.registerMany([new OpenAITransformer()])
  const providers = new ProviderRegistry(transformers, log)
  providers.registerFromConfig(PROVIDERS)
  const config = new ConfigStore({ Providers: PROVIDERS, providers: PROVIDERS, Router: {} })
  return { config, transformers, providers, tokenizers: new TokenizerRegistry(log), log }
}

const planFor = (path: string, fallbacks: readonly string[]): RoutePlan => ({
  routedBody: { model: 'sub,fable' },
  headers: {},
  transformersByName: new Map(),
  defaultTransformer: new OpenAITransformer(),
  scenarioType: 'default',
  primaryModel: 'sub,fable',
  isSubagent: false,
  fallbacks,
  peerTargets: new Set<string>(),
  path,
  search: ''
})

const upstream429 = (rawBody: string): HTTPException =>
  new HTTPException(429 as never, { message: `Error from provider(sub,fable: 429): ${rawBody}` })

describe('チェーン構築は面に依存しない', () => {
  test('同じ計画なら 4 面すべてで同じ候補列になる', () => {
    const ctx = buildLlmsContext()
    const chains = SURFACE_PATHS.map((path) => buildFailoverChain(planFor(path, ['sub,opus']), ctx))
    for (const chain of chains) expect(chain).toEqual(['sub,fable', 'sub,opus'])
  })

  test('auth_mode ゲートも面に依存しない（無料枠 → 従量課金への滑落を止める）', () => {
    // subscription を primary にした要求は、429 のたびに api_key
    // プロバイダへ落ちてはいけない。この判断はどの面から来た要求でも同じ。
    const ctx = buildLlmsContext()
    for (const path of SURFACE_PATHS) {
      expect(buildFailoverChain(planFor(path, ['paid,opus']), ctx)).toEqual(['sub,fable'])
    }
  })

  test('同一プロバイダの別モデルへの退避は残る（fable → opus）', () => {
    const ctx = buildLlmsContext()
    expect(buildFailoverChain(planFor('/v1/messages', ['sub,opus', 'sub,fable']), ctx)).toEqual([
      'sub,fable',
      'sub,opus'
    ])
  })
})

describe('429 の判定は面に依存しない', () => {
  test('429 はフェイルオーバー対象', () => {
    expect(isRateLimited(upstream429('{"type":"error"}'))).toBe(true)
  })

  test('400 / 401 はフェイルオーバーしない（本当の問題を隠さない）', () => {
    expect(isRateLimited(new HTTPException(400 as never, { message: 'Error from provider(p,m: 400): x' }))).toBe(false)
    expect(isRateLimited(new HTTPException(401 as never, { message: 'Error from provider(p,m: 401): x' }))).toBe(false)
  })

  test('insufficient_quota は恒久的な上限としてプロバイダごと切り離される', () => {
    const err = upstream429(JSON.stringify({ error: { type: 'insufficient_quota', message: 'quota' } }))
    expect(isRateLimited(err)).toBe(true)
    expect(isInsufficientQuota(err)).toBe(true)
  })
})

describe('チェーンを使い切ったときの 429 は面の封筒で返る', () => {
  const RATE_LIMIT_BODY = JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })

  test('各面が自分の SDK の読める形で 429 を受け取る', async () => {
    const bodies = await Promise.all(
      SURFACE_PATHS.map(async (path) => {
        const forwarded = forwardUpstreamError(upstream429(RATE_LIMIT_BODY), errorShapeForPath(path), 'sub')
        expect(forwarded?.status).toBe(429)
        return await forwarded!.json()
      })
    )
    expect(bodies[0]).toEqual({
      type: 'error',
      error: { type: 'rate_limit_error', message: '[via sub] slow down' }
    })
    expect(bodies[1]).toEqual({
      error: { message: '[via sub] slow down', type: 'rate_limit_error', param: null, code: null }
    })
    expect(bodies[2]).toEqual(bodies[1])
    expect(bodies[3]).toEqual({
      error: { code: 429, message: '[via sub] slow down', status: 'RESOURCE_EXHAUSTED' }
    })
  })
})
