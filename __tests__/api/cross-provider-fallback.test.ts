/**
 * Integration test for the cross-provider peer failover path.
 *
 * Walks the same `attemptChainEntry` loop the /v1 route uses, wired up
 * with a stub `attempt` callback that throws HTTPException(429) on the
 * primary and returns a 200 Response on the peer. Verifies that the
 * chain the walker sees after peer expansion + auth_mode bypass
 * actually rotates from `codex,gpt-5.6-luna` to `openai,gpt-5.6-luna`
 * on a rate-limit — the real-world scenario the toggle exists for.
 *
 * Keeps the pipeline out of scope: `runPipeline` requires real
 * transformers, network I/O, and a live provider registry. The failure
 * mode the toggle needs to cover is "429 lands us on the peer", which
 * lives in the walker layer. sendToProvider raising the canonical
 * "Error from provider(..)" HTTPException is what the walker keys on;
 * that error shape is asserted here explicitly.
 */

import { expect, test } from 'bun:test'
import { HTTPException } from 'hono/http-exception'
import type { Logger } from 'pino'
import { attemptChainEntry, type ChainCtx } from '../../src/api/v1/chain-failover'
import { buildFailoverChain } from '../../src/api/v1/candidate-chain'
import type { RoutePlan } from '../../src/api/v1/route-plan'
import { ConfigStore } from '../../src/llms/registry/config'
import { expandChainWithPeers } from '../../src/llms/scenario-router/peer-fallback'
import type { ConfigProvider } from '../../src/llms/scenario-router/types'
import { clearModelExhaustion, clearProviderExhaustion } from '../../src/services/failover-state'

const providers: ConfigProvider[] = [
  {
    name: 'codex',
    api_base_url: 'https://chatgpt.com/backend-api',
    api_key: 'oauth',
    auth_mode: 'subscription',
    api_style: 'openai_responses',
    models: ['gpt-5.6-luna']
  },
  {
    name: 'openai',
    api_base_url: 'https://api.openai.com/v1',
    api_key: 'sk-openai',
    auth_mode: 'api_key',
    api_style: 'openai_chat',
    models: ['gpt-5.6-luna']
  }
]

// Minimal ProviderRegistry stub: only the two calls attemptChainEntry
// reaches into (`get(name)`) matter for this test. The returned shape
// mirrors ResolvedProvider closely enough for resolveInvocationForModel
// to construct a PipelineRequest without touching real transformers.
const stubRegistry = {
  get: (name: string) => {
    const p = providers.find((x) => x.name === name)
    if (!p) return undefined
    return {
      name: p.name,
      api_base_url: p.api_base_url,
      api_key: p.api_key,
      models: p.models,
      transformer: undefined
    }
  }
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {}, child() { return noopLog } } as unknown as Logger

const makeCtx = () =>
  ({
    log: noopLog,
    config: new ConfigStore({ Router: {}, providers }),
    providers: stubRegistry,
    tokenizers: {} as unknown
  }) as unknown as Parameters<typeof attemptChainEntry>[0]['ctx']

// Build a walker-consumed chain that mirrors what routeScenario would
// have produced with CROSS_PROVIDER_FALLBACK on: expand peers, then
// filter through buildFailoverChain (which honors the peer bypass).
const buildEnrichedChain = (primary: string): { chain: string[]; peerTargets: Set<string> } => {
  const expanded = expandChainWithPeers(primary, [], providers, () => 0.5, true)
  const peerTargets = new Set(expanded.peerTargets)
  const plan: RoutePlan = {
    routedBody: { model: primary.split(',').slice(1).join(',') },
    headers: {},
    transformersByName: new Map(),
    defaultTransformer: {},
    scenarioType: 'default',
    primaryModel: primary,
    isSubagent: false,
    fallbacks: expanded.chain.slice(1),
    peerTargets,
    path: '/v1/messages',
    search: ''
  } as unknown as RoutePlan
  const chain = buildFailoverChain(plan, {
    config: new ConfigStore({ Router: {}, providers })
  } as unknown as Parameters<typeof buildFailoverChain>[1])
  return { chain, peerTargets }
}

test('cross-provider fallback: chain composes primary + peer with auth_mode bypass', () => {
  const { chain, peerTargets } = buildEnrichedChain('codex,gpt-5.6-luna')
  // codex (subscription) primary + openai (api_key) peer. Without the
  // bypass, buildFailoverChain would strip openai for the auth_mode
  // mismatch and leave just [codex,...].
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'openai,gpt-5.6-luna'])
  expect(peerTargets.has('openai,gpt-5.6-luna')).toBe(true)
})

test('cross-provider fallback: 429 on primary rescues to openai peer', async () => {
  clearProviderExhaustion('codex')
  clearProviderExhaustion('openai')
  clearModelExhaustion('codex', 'gpt-5.6-luna')
  clearModelExhaustion('openai', 'gpt-5.6-luna')

  const { chain, peerTargets } = buildEnrichedChain('codex,gpt-5.6-luna')
  const primary = chain[0] ?? ''
  const peer = chain[1] ?? ''

  const attempted: string[] = []
  const attempt = async (inv: { provider: { name: string }; request: { model?: string } }) => {
    const target = `${inv.provider.name},${inv.request.model}`
    attempted.push(target)
    if (target === primary) {
      throw new HTTPException(429 as never, {
        message: `Error from provider(codex,gpt-5.6-luna: 429): {"type":"error","error":{"type":"rate_limit_error","message":"weekly limit exceeded"}}`
      })
    }
    // Peer 200 — the outcome the toggle exists to produce.
    return new Response(JSON.stringify({ ok: true, model: inv.request.model }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  const ctx = makeCtx()
  const plan: RoutePlan = {
    routedBody: { model: 'gpt-5.6-luna' },
    headers: {},
    transformersByName: new Map(),
    defaultTransformer: {},
    scenarioType: 'default',
    primaryModel: primary,
    isSubagent: false,
    fallbacks: chain.slice(1),
    peerTargets,
    path: '/v1/messages',
    search: ''
  } as unknown as RoutePlan

  const chainCtx: ChainCtx = {
    c: {} as never,
    ctx,
    plan,
    providers,
    sessionId: null,
    attempt: attempt as unknown as ChainCtx['attempt'],
    errorResponse: (_c, _err) => new Response('err', { status: 500 })
  }

  // Walk the chain the same way route.ts does.
  let final: Response | null = null
  for (const model of chain) {
    const outcome = await attemptChainEntry(chainCtx, model)
    if (outcome.kind === 'done') {
      final = outcome.response
      break
    }
  }

  expect(attempted).toEqual([primary, peer])
  expect(final).not.toBeNull()
  expect(final?.status).toBe(200)

  clearProviderExhaustion('codex')
  clearProviderExhaustion('openai')
  clearModelExhaustion('codex', 'gpt-5.6-luna')
  clearModelExhaustion('openai', 'gpt-5.6-luna')
})

test('cross-provider fallback: peer 429 too returns the last forwarded rate-limit body', async () => {
  clearModelExhaustion('codex', 'gpt-5.6-luna')
  clearModelExhaustion('openai', 'gpt-5.6-luna')

  const { chain, peerTargets } = buildEnrichedChain('codex,gpt-5.6-luna')
  const primary = chain[0] ?? ''
  const peer = chain[1] ?? ''

  const attempt = async (inv: { provider: { name: string }; request: { model?: string } }) => {
    const target = `${inv.provider.name},${inv.request.model}`
    throw new HTTPException(429 as never, {
      message: `Error from provider(${target}: 429): {"error":{"type":"rate_limit_error","message":"${target} exhausted"}}`
    })
  }

  const ctx = makeCtx()
  const plan: RoutePlan = {
    routedBody: { model: 'gpt-5.6-luna' },
    headers: {},
    transformersByName: new Map(),
    defaultTransformer: {},
    scenarioType: 'default',
    primaryModel: primary,
    isSubagent: false,
    fallbacks: chain.slice(1),
    peerTargets,
    path: '/v1/messages',
    search: ''
  } as unknown as RoutePlan

  const chainCtx: ChainCtx = {
    c: {} as never,
    ctx,
    plan,
    providers,
    sessionId: null,
    attempt: attempt as unknown as ChainCtx['attempt'],
    errorResponse: (_c, _err) => new Response('err', { status: 500 })
  }

  let lastForwarded: Response | null = null
  for (const model of chain) {
    const outcome = await attemptChainEntry(chainCtx, model)
    if (outcome.kind === 'done') {
      lastForwarded = outcome.response
      break
    }
    if (outcome.forwarded !== null) lastForwarded = outcome.forwarded
  }

  // Both entries 429'd. The walker exits with the last forwarded body so
  // the client sees a genuine rate_limit_error instead of a synthesised
  // 400 "no usable model". The last one is from the peer.
  expect(lastForwarded).not.toBeNull()
  expect(lastForwarded?.status).toBe(429)
  const bodyText = await lastForwarded?.text()
  expect(bodyText).toContain(peer)

  clearModelExhaustion('codex', 'gpt-5.6-luna')
  clearModelExhaustion('openai', 'gpt-5.6-luna')
})
