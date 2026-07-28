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

test('buildFailoverChain: a fallback on the same provider as the primary is dropped', () => {
  const chain = buildFailoverChain(plan({ fallbacks: ['codex,gpt-5.6-sol'] }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna'])
})

test('buildFailoverChain: an empty fallback chain leaves just the primary', () => {
  const chain = buildFailoverChain(plan({ fallbacks: [] }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna'])
})
