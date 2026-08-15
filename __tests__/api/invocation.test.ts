import { expect, test } from 'bun:test'
import { buildFailoverChain, type RoutePlan } from '../../src/api/v1/invocation'
import { ConfigStore } from '../../src/llms/registry/config'

const providers = [
  { name: 'codex', auth_mode: 'subscription', models: ['gpt-5.6-luna', 'gpt-5.6-sol'] },
  { name: 'claude-code', auth_mode: 'subscription', models: ['claude-haiku'] },
  { name: 'gemini', auth_mode: 'subscription', models: ['g'] }
]

type Ctx = Parameters<typeof buildFailoverChain>[1]
const ctx: Ctx = { config: new ConfigStore({ Router: {}, providers }) } as unknown as Ctx

// The fallback chain is now pre-resolved inside selectModel (from a rule
// or the scenario's catch-all) and threaded through the RoutePlan, so
// tests set it directly instead of stubbing an agent/subagent map on
// the config.
const plan = (over: Partial<RoutePlan>): RoutePlan =>
  ({
    routedBody: {},
    headers: {},
    transformersByName: new Map(),
    defaultTransformer: {},
    scenarioType: 'default',
    primaryModel: 'codex,gpt-5.6-luna',
    isSubagent: false,
    fallbacks: [],
    peerTargets: new Set<string>(),
    path: '/v1/messages',
    search: '',
    ...over
  }) as unknown as RoutePlan

test('buildFailoverChain: appends the pre-resolved fallback chain after the primary', () => {
  const chain = buildFailoverChain(plan({ fallbacks: ['gemini,g'] }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'gemini,g'])
})

test('buildFailoverChain: a subagent request walks whatever chain selectModel resolved', () => {
  // A subagent request gets its subagent-lane chain from selectModel;
  // the reactive path just uses whatever plan.fallbacks carries — it
  // does not re-look-up by scenario/kind.
  const chain = buildFailoverChain(
    plan({ isSubagent: true, fallbacks: ['claude-code,claude-haiku'] }),
    ctx
  )
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'claude-code,claude-haiku'])
})

test('buildFailoverChain: same-provider fallbacks pass through (intra-account rescue)', () => {
  // Different models on the same provider used to be dropped
  // unconditionally. Now that exhaustion is tracked per (provider,
  // model), a Fable→Opus-style fallback on the same provider is a
  // legitimate configuration and stays in the chain.
  const chain = buildFailoverChain(plan({ fallbacks: ['codex,gpt-5.6-sol'] }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'codex,gpt-5.6-sol'])
})

test('buildFailoverChain: an empty fallback chain leaves just the primary', () => {
  const chain = buildFailoverChain(plan({ fallbacks: [] }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna'])
})

test('buildFailoverChain: peer-injected entries bypass the same-auth_mode gate', () => {
  // codex (subscription) is the primary and openai (api_key) is the
  // peer-injected fallback for the same model. The auth_mode gate would
  // normally strip the api_key peer, but plan.peerTargets tells the
  // walker this entry was cross-provider auto-injected (user opted in
  // via CROSS_PROVIDER_FALLBACK) and it must pass through.
  const providersWithOpenai = [
    { name: 'codex', auth_mode: 'subscription', models: ['gpt-5.6-luna'] },
    { name: 'openai', auth_mode: 'api_key', models: ['gpt-5.6-luna'] }
  ]
  const ctxWithOpenai: Ctx = {
    config: new ConfigStore({ Router: {}, providers: providersWithOpenai })
  } as unknown as Ctx
  const chain = buildFailoverChain(
    plan({
      fallbacks: ['openai,gpt-5.6-luna'],
      peerTargets: new Set(['openai,gpt-5.6-luna'])
    }),
    ctxWithOpenai
  )
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'openai,gpt-5.6-luna'])
})

test('buildFailoverChain: explicit (non-peer) mixed-auth_mode entry is still stripped', () => {
  // Same providers, same primary — but this time the openai entry is
  // NOT in peerTargets (user hand-configured it as an explicit fallback
  // without enabling cross-provider fallback). The auth_mode gate must
  // still apply so subscription-first users don't silently roll onto a
  // paid api_key provider.
  const providersWithOpenai = [
    { name: 'codex', auth_mode: 'subscription', models: ['gpt-5.6-luna'] },
    { name: 'openai', auth_mode: 'api_key', models: ['gpt-5.6-luna'] }
  ]
  const ctxWithOpenai: Ctx = {
    config: new ConfigStore({ Router: {}, providers: providersWithOpenai })
  } as unknown as Ctx
  const chain = buildFailoverChain(
    plan({
      fallbacks: ['openai,gpt-5.6-luna'],
      peerTargets: new Set<string>()
    }),
    ctxWithOpenai
  )
  expect(chain).toEqual(['codex,gpt-5.6-luna'])
})
