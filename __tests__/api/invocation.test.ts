import { expect, test } from 'bun:test'
import { buildFailoverChain, type RoutePlan } from '../../src/api/v1/invocation'
import { ConfigStore } from '../../src/llms/registry/config'

const providers = [
  { name: 'codex', auth_mode: 'subscription', models: ['gpt-5.6-luna', 'gpt-5.6-sol'] },
  { name: 'claude-code', auth_mode: 'subscription', models: ['claude-haiku'] },
  { name: 'gemini', auth_mode: 'subscription', models: ['g'] }
]

type Ctx = Parameters<typeof buildFailoverChain>[1]
const ctxWith = (router: {
  agentFallbacks?: Record<string, string[]>
  subagentFallbacks?: Record<string, string[]>
}): Ctx => ({ config: new ConfigStore({ Router: router, providers }) }) as unknown as Ctx

const plan = (over: Partial<RoutePlan>): RoutePlan =>
  ({
    routedBody: {},
    headers: {},
    transformersByName: new Map(),
    defaultTransformer: {},
    scenarioType: 'background',
    primaryModel: 'codex,gpt-5.6-luna',
    isSubagent: false,
    path: '/v1/messages',
    search: '',
    ...over
  }) as unknown as RoutePlan

test('buildFailoverChain: an agent request walks the agent fallback chain after the primary', () => {
  const ctx = ctxWith({ agentFallbacks: { background: ['gemini,g'] } })
  const chain = buildFailoverChain(plan({}), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'gemini,g'])
})

test('buildFailoverChain: a subagent request walks the subagent fallback chain', () => {
  const ctx = ctxWith({
    agentFallbacks: { background: ['gemini,g'] },
    subagentFallbacks: { background: ['claude-code,claude-haiku'] }
  })
  const chain = buildFailoverChain(plan({ isSubagent: true }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'claude-code,claude-haiku'])
})

test('buildFailoverChain: a fallback on the same provider as the primary is dropped', () => {
  const ctx = ctxWith({ agentFallbacks: { background: ['codex,gpt-5.6-sol'] } })
  const chain = buildFailoverChain(plan({}), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna'])
})

test('buildFailoverChain: no configured fallbacks leaves just the primary', () => {
  const ctx = ctxWith({ agentFallbacks: { background: [] } })
  const chain = buildFailoverChain(plan({}), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna'])
})
