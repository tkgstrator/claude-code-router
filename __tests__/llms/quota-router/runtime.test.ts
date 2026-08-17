import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { HAS_DB, resetDbTables, teardownPrisma } from '../../db/helpers'
import { getPrismaClient } from '../../../src/db/client'
import { resolveQuotaAwareSelection } from '../../../src/llms/quota-router/runtime'
import { applyRouterPreferences } from '../../../src/services/router-preference-service'
import { __resetSchedulerStateForTest } from '../../../src/services/routing-scheduler/state'

const describeOrSkip = HAS_DB ? describe : describe.skip

const emptyPair = () => ({ agent: [], subagent: [] })
const emptyChains = {
  default: emptyPair(),
  think: emptyPair(),
  longContext: emptyPair(),
  webSearch: emptyPair(),
  image: emptyPair()
}

describeOrSkip('resolveQuotaAwareSelection (DB + snapshot)', () => {
  beforeEach(async () => {
    await resetDbTables()
    __resetSchedulerStateForTest()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('empty per-scenario chain passes through regardless of exhaustedBehavior (not-configured shortcut)', async () => {
    // An empty preference chain means the operator hasn't set up
    // quota-aware routing for this scenario. Treat that as "no
    // opinion" and pass through to the scenario router's answer,
    // ignoring `exhaustedBehavior: '429'` — the 429 branch is meant
    // for real chains whose candidates are all currently gated, not
    // for the "nothing to route" case. Without this, a fresh install
    // with ROUTER_MODE=quota-aware but no chain entries 429s every
    // request instead of falling through to the scenario router.
    const out = await resolveQuotaAwareSelection({
      requestedModel: 'claude-opus-5',
      isSubagent: false,
      scenario: 'default'
    })
    expect(out.selection.primary).toBeNull()
    expect(out.retryAfterSec).toBeNull()
  })

  test('passthrough constraint on an empty chain also passes through', async () => {
    // Same outcome via the constraints route — kept as a distinct
    // case so the empty-chain shortcut and the explicit
    // exhaustedBehavior:passthrough branch both stay covered.
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
        think: {
          agent: [{ priority: 1, target: 'claude-code,claude-opus-5', enabled: true, subagentTiers: [] }],
          subagent: []
        }
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

  test('a scenario without its own chain still passes through (empty-chain shortcut wins)', async () => {
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
        think: {
          agent: [{ priority: 1, target: 'claude-code,claude-opus-5', enabled: true, subagentTiers: [] }],
          subagent: []
        }
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
    // Empty chain in this scenario → passthrough (no Retry-After).
    expect(out.retryAfterSec).toBeNull()
  })

  test('agent-only chain does not leak into subagent traffic (kind gates selector)', async () => {
    // The (scenario, kind) split means an entry configured only in the
    // agent lane is invisible to subagent calls. Without the kind gate
    // in loadPreferenceChain, subagent traffic would inherit whatever
    // the operator set up for agent.
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
        default: {
          agent: [{ priority: 1, target: 'claude-code,claude-opus-5', enabled: true, subagentTiers: [] }],
          subagent: []
        }
      },
      constraints: null
    })
    const agentOut = await resolveQuotaAwareSelection({
      requestedModel: 'claude-opus-5',
      isSubagent: false,
      scenario: 'default'
    })
    expect(agentOut.selection.primary).toBe('claude-code,claude-opus-5')
    const subagentOut = await resolveQuotaAwareSelection({
      requestedModel: 'claude-opus-5',
      isSubagent: true,
      scenario: 'default'
    })
    // Subagent lane is empty for this scenario → passthrough
    expect(subagentOut.selection.primary).toBeNull()
    expect(subagentOut.retryAfterSec).toBeNull()
  })

  test('subagent-only chain does not leak into agent traffic', async () => {
    // Symmetric guard: a subagent-lane entry must not resolve on an
    // agent call. Both kinds are truly independent.
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
      data: { providerId: provider.id, name: 'claude-haiku-4-5', enabled: true }
    })
    await applyRouterPreferences({
      entriesByScenario: {
        ...emptyChains,
        default: {
          agent: [],
          subagent: [{ priority: 1, target: 'claude-code,claude-haiku-4-5', enabled: true, subagentTiers: [] }]
        }
      },
      constraints: null
    })
    const agentOut = await resolveQuotaAwareSelection({
      requestedModel: 'claude-haiku-4-5',
      isSubagent: false,
      scenario: 'default'
    })
    expect(agentOut.selection.primary).toBeNull()
    expect(agentOut.retryAfterSec).toBeNull()
    const subagentOut = await resolveQuotaAwareSelection({
      requestedModel: 'claude-haiku-4-5',
      isSubagent: true,
      scenario: 'default'
    })
    expect(subagentOut.selection.primary).toBe('claude-code,claude-haiku-4-5')
  })
})
