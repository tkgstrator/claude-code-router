import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { HAS_DB, resetDbTables, teardownPrisma } from '../db/helpers'
import { getPrismaClient } from '../../src/db/client'
import { applyRouterPreferences, loadRouterPreferences } from '../../src/services/router-preference-service'

// Skip the whole suite in environments without a Postgres DATABASE_URL —
// the service is a thin wrapper over prisma, unit-testing it without a
// real DB would just be re-mocking Prisma.
const describeOrSkip = HAS_DB ? describe : describe.skip

describeOrSkip('router-preference-service (DB)', () => {
  beforeEach(async () => {
    await resetDbTables()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('loadRouterPreferences returns empty chain + null constraints on a fresh DB', async () => {
    const profile = await loadRouterPreferences()
    expect(profile.entries).toEqual([])
    expect(profile.constraints).toBeNull()
  })

  test('applyRouterPreferences upserts the singleton and returns success', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.createMany({
      data: [
        { providerId: provider.id, name: 'claude-fable-5', enabled: true },
        { providerId: provider.id, name: 'claude-opus-5', enabled: true }
      ]
    })
    const outcome = await applyRouterPreferences({
      entries: [
        { priority: 1, target: 'anthropic,claude-fable-5', enabled: true, subagentTiers: [] },
        { priority: 2, target: 'anthropic,claude-opus-5', enabled: true, subagentTiers: ['sonnet', 'haiku'] }
      ],
      constraints: { exhaustedBehavior: '429' }
    })
    expect(outcome.success).toBe(true)
    expect(outcome.warnings).toEqual([])

    const round = await loadRouterPreferences()
    expect(round.entries).toHaveLength(2)
    expect(round.entries[0].target).toBe('anthropic,claude-fable-5')
    expect(round.entries[1].target).toBe('anthropic,claude-opus-5')
    expect(round.entries[1].subagentTiers).toEqual(['sonnet', 'haiku'])
    expect(round.constraints).toEqual({ exhaustedBehavior: '429' })
  })

  test('applyRouterPreferences normalises priorities to dense 1..N', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.createMany({
      data: [
        { providerId: provider.id, name: 'a', enabled: true },
        { providerId: provider.id, name: 'b', enabled: true },
        { providerId: provider.id, name: 'c', enabled: true }
      ]
    })
    // Sparse priorities 5, 10, 20 → after apply, should be 1, 2, 3.
    await applyRouterPreferences({
      entries: [
        { priority: 20, target: 'anthropic,c', enabled: true, subagentTiers: [] },
        { priority: 5, target: 'anthropic,a', enabled: true, subagentTiers: [] },
        { priority: 10, target: 'anthropic,b', enabled: true, subagentTiers: [] }
      ],
      constraints: null
    })
    const round = await loadRouterPreferences()
    expect(round.entries.map((e) => e.priority)).toEqual([1, 2, 3])
    expect(round.entries.map((e) => e.target)).toEqual(['anthropic,a', 'anthropic,b', 'anthropic,c'])
  })

  test('applyRouterPreferences drops unknown targets with a warning', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({
      data: { providerId: provider.id, name: 'claude-opus-5', enabled: true }
    })
    const outcome = await applyRouterPreferences({
      entries: [
        { priority: 1, target: 'anthropic,claude-opus-5', enabled: true, subagentTiers: [] },
        { priority: 2, target: 'anthropic,claude-nonexistent', enabled: true, subagentTiers: [] },
        { priority: 3, target: 'malformed', enabled: true, subagentTiers: [] }
      ],
      constraints: null
    })
    expect(outcome.success).toBe(true)
    expect(outcome.warnings).toHaveLength(2)
    expect(outcome.warnings.some((w) => w.includes('claude-nonexistent'))).toBe(true)
    expect(outcome.warnings.some((w) => w.includes('malformed'))).toBe(true)

    const round = await loadRouterPreferences()
    expect(round.entries).toHaveLength(1)
    expect(round.entries[0].target).toBe('anthropic,claude-opus-5')
  })

  test('applyRouterPreferences replaces the chain (not append)', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.createMany({
      data: [
        { providerId: provider.id, name: 'a', enabled: true },
        { providerId: provider.id, name: 'b', enabled: true }
      ]
    })
    await applyRouterPreferences({
      entries: [
        { priority: 1, target: 'anthropic,a', enabled: true, subagentTiers: [] },
        { priority: 2, target: 'anthropic,b', enabled: true, subagentTiers: [] }
      ],
      constraints: null
    })
    // Second apply drops b, adds only a.
    await applyRouterPreferences({
      entries: [{ priority: 1, target: 'anthropic,a', enabled: true, subagentTiers: [] }],
      constraints: null
    })
    const round = await loadRouterPreferences()
    expect(round.entries.map((e) => e.target)).toEqual(['anthropic,a'])
  })

  test('applyRouterPreferences with empty entries clears the chain but keeps the profile row', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({ data: { providerId: provider.id, name: 'x', enabled: true } })
    await applyRouterPreferences({
      entries: [{ priority: 1, target: 'anthropic,x', enabled: true, subagentTiers: [] }],
      constraints: { staleQuotaFactor: 0.5 }
    })
    await applyRouterPreferences({ entries: [], constraints: { staleQuotaFactor: 0.5 } })
    const round = await loadRouterPreferences()
    expect(round.entries).toEqual([])
    expect(round.constraints).toEqual({ staleQuotaFactor: 0.5 })
  })

  test('applyRouterPreferences clears constraints when null is sent', async () => {
    await applyRouterPreferences({ entries: [], constraints: { exhaustedBehavior: '429' } })
    await applyRouterPreferences({ entries: [], constraints: null })
    const round = await loadRouterPreferences()
    expect(round.constraints).toBeNull()
  })
})
