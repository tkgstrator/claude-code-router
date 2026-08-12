import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { HAS_DB, resetDbTables, teardownPrisma } from '../../db/helpers'
import { getPrismaClient } from '../../../src/db/client'
import { resolveQuotaAwareSelection } from '../../../src/llms/quota-router/runtime'
import { applyRouterPreferences } from '../../../src/services/router-preference-service'
import { __resetSchedulerStateForTest } from '../../../src/services/routing-scheduler/state'

const describeOrSkip = HAS_DB ? describe : describe.skip

const emptyChains = {
  default: [],
  think: [],
  longContext: [],
  webSearch: [],
  image: []
}

describeOrSkip('resolveQuotaAwareSelection (DB + snapshot)', () => {
  beforeEach(async () => {
    await resetDbTables()
    __resetSchedulerStateForTest()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('empty per-scenario chain returns no primary + default 30s Retry-After', async () => {
    const out = await resolveQuotaAwareSelection({
      requestedModel: 'claude-opus-5',
      isSubagent: false,
      scenario: 'default'
    })
    expect(out.selection.primary).toBeNull()
    expect(out.retryAfterSec).toBe(30)
  })

  test('passthrough constraint suppresses Retry-After even when the chain is empty', async () => {
    await applyRouterPreferences({
      entriesByScenario: emptyChains,
      constraints: { exhaustedBehavior: 'passthrough' }
    })
    const out = await resolveQuotaAwareSelection({
      requestedModel: 'claude-opus-5',
      isSubagent: false,
      scenario: 'default'
    })
    expect(out.selection.primary).toBeNull()
    expect(out.retryAfterSec).toBeNull()
  })

  test('healthy primary in the request-matched scenario yields a target', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: {
        name: 'claude-code',
        apiBaseUrl: 'https://api.anthropic.com',
        authMode: 'subscription',
        apiStyle: 'anthropic'
      }
    })
    await prisma.model.create({
      data: { providerId: provider.id, name: 'claude-opus-5', enabled: true }
    })
    await applyRouterPreferences({
      entriesByScenario: {
        ...emptyChains,
        think: [{ priority: 1, target: 'claude-code,claude-opus-5', enabled: true, subagentTiers: [] }]
      },
      constraints: null
    })
    const out = await resolveQuotaAwareSelection({
      requestedModel: 'claude-opus-5',
      isSubagent: false,
      scenario: 'think'
    })
    expect(out.selection.primary).toBe('claude-code,claude-opus-5')
    expect(out.retryAfterSec).toBeNull()
  })

  test('a scenario without a chain still returns null primary + default Retry-After', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: {
        name: 'claude-code',
        apiBaseUrl: 'https://api.anthropic.com',
        authMode: 'subscription',
        apiStyle: 'anthropic'
      }
    })
    await prisma.model.create({
      data: { providerId: provider.id, name: 'claude-opus-5', enabled: true }
    })
    await applyRouterPreferences({
      entriesByScenario: {
        ...emptyChains,
        think: [{ priority: 1, target: 'claude-code,claude-opus-5', enabled: true, subagentTiers: [] }]
      },
      constraints: null
    })
    // Same DB, but ask for default — the entry is only in `think`.
    const out = await resolveQuotaAwareSelection({
      requestedModel: 'claude-opus-5',
      isSubagent: false,
      scenario: 'default'
    })
    expect(out.selection.primary).toBeNull()
  })
})
