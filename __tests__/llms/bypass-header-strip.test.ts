/**
 * Regression: bypass-mode header passthrough used to forward the
 * client's own `Authorization` (which for CCR is the caller's CCR
 * APIKEY, not any upstream credential). buildRequestHeaders set
 * `Authorization: Bearer <provider.api_key>` first, then spread the
 * inbound header set on top — the lowercase `authorization` in the
 * spread overwrote the correct default, so OpenAI upstream received
 * the CCR APIKEY as its Bearer and 400'd with "Incorrect API key".
 *
 * The strip now also targets x-api-key (Anthropic idiom) for the
 * same reason. content-length + accept-encoding stripping (hop-by-hop
 * / decompression) stays.
 */

import { describe, expect, test } from 'bun:test'
import type { ResolvedProvider } from '../../src/llms/registry/provider'
import type { Transformer } from '../../src/llms/transformers/base'
import type { TransformerContext, UnifiedChatRequest } from '../../src/schemas'
import { processRequestTransformers } from '../../src/llms/pipeline/request-chain'

// Bare-minimum transformer stub — bypass mode doesn't call any hooks
// other than auth() (which is invoked separately in provider-send).
class NoopTransformer {
  readonly name = 'noop'
  async transformRequestOut(request: unknown): Promise<UnifiedChatRequest> {
    return request as UnifiedChatRequest
  }
  async transformRequestIn(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    return request
  }
  async transformResponseOut(response: Response): Promise<Response> {
    return response
  }
  async transformResponseIn(response: Response): Promise<Response> {
    return response
  }
  async auth(request: unknown): Promise<unknown> {
    return request
  }
}

function inputWithHeaders(headers: Record<string, string>): {
  body: unknown
  headers: Record<string, string>
  provider: ResolvedProvider
  transformer: Transformer
  context: TransformerContext
} {
  return {
    body: { model: 'x', messages: [] },
    headers,
    // biome-ignore plugin: ResolvedProvider is heavy — only .transformer is read in the bypass branch we're exercising, and the request-chain passes provider through without touching it.
    provider: {} as unknown as ResolvedProvider,
    // biome-ignore plugin: NoopTransformer covers the abstract surface Transformer requires. Full cast is safer than a partial stub.
    transformer: new NoopTransformer() as unknown as Transformer,
    context: {} as TransformerContext
  }
}

describe('processRequestTransformers — bypass mode header strip', () => {
  test('strips lowercase authorization so provider.api_key wins', async () => {
    const { config } = await processRequestTransformers(
      inputWithHeaders({
        authorization: 'Bearer ccr-caller-key',
        'content-type': 'application/json',
        'x-something': 'keep'
      }),
      true
    )
    expect(config.headers?.authorization).toBeUndefined()
    expect(config.headers?.['x-something']).toBe('keep')
    expect(config.headers?.['content-type']).toBe('application/json')
  })

  test('strips Authorization regardless of case', async () => {
    const { config } = await processRequestTransformers(
      inputWithHeaders({
        Authorization: 'Bearer ccr-caller-key',
        'X-Api-Key': 'ccr-caller-key'
      }),
      true
    )
    expect(config.headers?.Authorization).toBeUndefined()
    expect(config.headers?.['X-Api-Key']).toBeUndefined()
  })

  test('strips content-length and accept-encoding (hop-by-hop, preserved behaviour)', async () => {
    const { config } = await processRequestTransformers(
      inputWithHeaders({
        'content-length': '42',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json'
      }),
      true
    )
    expect(config.headers?.['content-length']).toBeUndefined()
    expect(config.headers?.['accept-encoding']).toBeUndefined()
    expect(config.headers?.['content-type']).toBe('application/json')
  })

  test('non-bypass mode still starts config with an empty header set (not touched by this fix)', async () => {
    const { config } = await processRequestTransformers(
      inputWithHeaders({ authorization: 'Bearer ccr-caller-key' }),
      false
    )
    // Non-bypass never copies inbound headers into config; the provider
    // Bearer stamped by buildRequestHeaders is the only Authorization
    // that reaches the upstream in that path.
    expect(config.headers).toBeUndefined()
  })
})
