import { expect, test } from 'bun:test'
import { buildFailoverChain, type RoutePlan } from '../../src/api/v1/invocation'
import { ConfigStore } from '../../src/llms/registry/config'

const providers = [
  { name: 'codex', auth_mode: 'subscription', models: ['gpt-5.6-luna', 'gpt-5.6-sol'] },
  { name: 'claude-code', auth_mode: 'subscription', models: ['claude-haiku'] },
  { name: 'gemini', auth_mode: 'subscription', models: ['g'] }
]

type Ctx = Parameters<typeof buildFailoverChain>[1]
const ctxWith = (fallbacks: Record<string, string[]>): Ctx =>
  ({ config: new ConfigStore({ Router: { fallbacks }, providers }) }) as unknown as Ctx

const plan = (over: Partial<RoutePlan>): RoutePlan =>
  ({
    routedBody: {},
    headers: {},
    transformersByName: new Map(),
    defaultTransformer: {},
    scenarioType: 'background',
    primaryModel: 'codex,gpt-5.6-luna',
    path: '/v1/messages',
    search: '',
    ...over
  }) as unknown as RoutePlan

test('buildFailoverChain: force insert puts the original request between primary and fallbacks', () => {
  const ctx = ctxWith({ background: ['gemini,g'] })
  const chain = buildFailoverChain(plan({ forcedFrom: 'claude-code,claude-haiku' }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'claude-code,claude-haiku', 'gemini,g'])
})

test('buildFailoverChain: a forcedFrom on the same provider as the forced primary is dropped', () => {
  const ctx = ctxWith({ background: [] })
  const chain = buildFailoverChain(plan({ forcedFrom: 'codex,gpt-5.6-sol' }), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna'])
})

test('buildFailoverChain: no forcedFrom leaves the chain as primary + fallbacks', () => {
  const ctx = ctxWith({ background: ['gemini,g'] })
  const chain = buildFailoverChain(plan({}), ctx)
  expect(chain).toEqual(['codex,gpt-5.6-luna', 'gemini,g'])
})
