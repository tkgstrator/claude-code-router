import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { HAS_DB, resetDbTables, teardownPrisma } from '../../db/helpers'
import { getPrismaClient } from '../../../src/db/client'
import { resolveQuotaAwareSelection } from '../../../src/llms/quota-router/runtime'
import { applyRouterPreferences } from '../../../src/services/router-preference-service'
import { __resetSchedulerStateForTest } from '../../../src/services/routing-scheduler/state'

const describeOrSkip = HAS_DB ? describe : describe.skip

describeOrSkip('resolveQuotaAwareSelection (DB + snapshot)', () => {
  beforeEach(async () => {
    await resetDbTables()
    __resetSchedulerStateForTest()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('empty preference chain returns no primary and no Retry-After', async () => {
    const out = await resolveQuotaAwareSelection({ requestedModel: 'claude-opus-5', isSubagent: false })
    expect(out.selection.primary).toBeNull()
    // Default constraints exhaustedBehavior='429' but no snapshot yet;
    // resolveQuotaAwareSelection returns the L4 default 30s hint.
    expect(out.retryAfterSec).toBe(30)
  })

  test('passthrough constraint suppresses Retry-After even when the chain is empty', async () => {
    await applyRouterPreferences({ entries: [], constraints: { exhaustedBehavior: 'passthrough' } })
    const out = await resolveQuotaAwareSelection({ requestedModel: 'claude-opus-5', isSubagent: false })
    expect(out.selection.primary).toBeNull()
    expect(out.retryAfterSec).toBeNull()
  })

  test('healthy primary yields a target and no Retry-After', async () => {
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
      entries: [{ priority: 1, target: 'claude-code,claude-opus-5', enabled: true, subagentTiers: [] }],
      constraints: null
    })
    const out = await resolveQuotaAwareSelection({ requestedModel: 'claude-opus-5', isSubagent: false })
    expect(out.selection.primary).toBe('claude-code,claude-opus-5')
    expect(out.retryAfterSec).toBeNull()
  })
})
