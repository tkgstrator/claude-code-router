import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { HAS_DB, resetDbTables, teardownPrisma } from '../db/helpers'
import { getPrismaClient } from '../../src/db/client'
import {
  applyRouterPreferences,
  loadPreferenceChain,
  loadRouterPreferences
} from '../../src/services/router-preference-service'
import type { RouterPreferenceEntry } from '../../src/schemas'

const describeOrSkip = HAS_DB ? describe : describe.skip

// Helper: build an entriesByScenario map where only the given scenario
// carries entries and every other scenario is empty.
const only = (
  scenario: 'default' | 'think' | 'longContext' | 'webSearch' | 'image',
  entries: RouterPreferenceEntry[]
) => ({
  default: scenario === 'default' ? entries : [],
  think: scenario === 'think' ? entries : [],
  longContext: scenario === 'longContext' ? entries : [],
  webSearch: scenario === 'webSearch' ? entries : [],
  image: scenario === 'image' ? entries : []
})

describeOrSkip('router-preference-service (DB)', () => {
  beforeEach(async () => {
    await resetDbTables()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('loadRouterPreferences returns empty per-scenario map + null constraints on a fresh DB', async () => {
    const profile = await loadRouterPreferences()
    expect(profile.entriesByScenario.default).toEqual([])
    expect(profile.entriesByScenario.think).toEqual([])
    expect(profile.entriesByScenario.longContext).toEqual([])
    expect(profile.entriesByScenario.webSearch).toEqual([])
    expect(profile.entriesByScenario.image).toEqual([])
    expect(profile.constraints).toBeNull()
  })

  test('applyRouterPreferences round-trips one scenario', async () => {
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
      entriesByScenario: only('think', [
        { priority: 1, target: 'anthropic,claude-fable-5', enabled: true, subagentTiers: [] },
        { priority: 2, target: 'anthropic,claude-opus-5', enabled: true, subagentTiers: ['sonnet', 'haiku'] }
      ]),
      constraints: { exhaustedBehavior: '429' }
    })
    expect(outcome.success).toBe(true)
    expect(outcome.warnings).toEqual([])

    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.think).toHaveLength(2)
    expect(round.entriesByScenario.default).toEqual([])
    expect(round.entriesByScenario.think[1].subagentTiers).toEqual(['sonnet', 'haiku'])
    expect(round.constraints).toEqual({ exhaustedBehavior: '429' })
  })

  test('different scenarios can hold independent chains for the same model', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.createMany({
      data: [
        { providerId: provider.id, name: 'sonnet-5', enabled: true },
        { providerId: provider.id, name: 'opus-5', enabled: true },
        { providerId: provider.id, name: 'fable-5', enabled: true }
      ]
    })
    await applyRouterPreferences({
      entriesByScenario: {
        default: [{ priority: 1, target: 'anthropic,sonnet-5', enabled: true, subagentTiers: [] }],
        think: [
          { priority: 1, target: 'anthropic,opus-5', enabled: true, subagentTiers: [] },
          { priority: 2, target: 'anthropic,fable-5', enabled: true, subagentTiers: [] }
        ],
        longContext: [{ priority: 1, target: 'anthropic,fable-5', enabled: true, subagentTiers: [] }],
        webSearch: [],
        image: []
      },
      constraints: null
    })
    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.default.map((e) => e.target)).toEqual(['anthropic,sonnet-5'])
    expect(round.entriesByScenario.think.map((e) => e.target)).toEqual(['anthropic,opus-5', 'anthropic,fable-5'])
    expect(round.entriesByScenario.longContext.map((e) => e.target)).toEqual(['anthropic,fable-5'])
  })

  test('loadPreferenceChain returns just the requested scenario', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({ data: { providerId: provider.id, name: 'sonnet-5', enabled: true } })
    await applyRouterPreferences({
      entriesByScenario: only('default', [
        { priority: 1, target: 'anthropic,sonnet-5', enabled: true, subagentTiers: [] }
      ]),
      constraints: null
    })
    const dflt = await loadPreferenceChain('default')
    const think = await loadPreferenceChain('think')
    expect(dflt.entries).toHaveLength(1)
    expect(think.entries).toEqual([])
  })

  test('applyRouterPreferences normalises priorities per scenario to dense 1..N', async () => {
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
    await applyRouterPreferences({
      entriesByScenario: only('default', [
        { priority: 20, target: 'anthropic,c', enabled: true, subagentTiers: [] },
        { priority: 5, target: 'anthropic,a', enabled: true, subagentTiers: [] },
        { priority: 10, target: 'anthropic,b', enabled: true, subagentTiers: [] }
      ]),
      constraints: null
    })
    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.default.map((e) => e.priority)).toEqual([1, 2, 3])
    expect(round.entriesByScenario.default.map((e) => e.target)).toEqual(['anthropic,a', 'anthropic,b', 'anthropic,c'])
  })

  test('applyRouterPreferences drops unknown targets with per-scenario warnings', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({ data: { providerId: provider.id, name: 'claude-opus-5', enabled: true } })
    const outcome = await applyRouterPreferences({
      entriesByScenario: only('think', [
        { priority: 1, target: 'anthropic,claude-opus-5', enabled: true, subagentTiers: [] },
        { priority: 2, target: 'anthropic,claude-nonexistent', enabled: true, subagentTiers: [] },
        { priority: 3, target: 'malformed', enabled: true, subagentTiers: [] }
      ]),
      constraints: null
    })
    expect(outcome.success).toBe(true)
    expect(outcome.warnings).toHaveLength(2)
    expect(outcome.warnings.some((w) => w.includes('claude-nonexistent') && w.includes('think'))).toBe(true)

    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.think).toHaveLength(1)
    expect(round.entriesByScenario.think[0].target).toBe('anthropic,claude-opus-5')
  })

  test('empty per-scenario map clears chains but preserves constraints', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({ data: { providerId: provider.id, name: 'x', enabled: true } })
    await applyRouterPreferences({
      entriesByScenario: only('default', [
        { priority: 1, target: 'anthropic,x', enabled: true, subagentTiers: [] }
      ]),
      constraints: { staleQuotaFactor: 0.5 }
    })
    await applyRouterPreferences({
      entriesByScenario: only('default', []),
      constraints: { staleQuotaFactor: 0.5 }
    })
    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.default).toEqual([])
    expect(round.constraints).toEqual({ staleQuotaFactor: 0.5 })
  })
})
