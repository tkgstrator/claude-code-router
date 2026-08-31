import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { HAS_DB, resetDbTables, teardownPrisma } from '../db/helpers'
import { getPrismaClient } from '../../src/db/client'
import {
  applyRouterPreferences,
  loadPreferenceChain,
  loadRouterPreferences
} from '../../src/services/router-preference-service'
import type { PreferenceKind, RouterPreferenceEntry } from '../../src/schemas/domain/preference'
const describeOrSkip = HAS_DB ? describe : describe.skip

// Helper: build an entriesByScenario map where only the given
// (scenario, kind) chain carries entries and every other lane is
// empty. Reflects the new per-(scenario, kind) split — the sub-tab
// UI writes each lane independently.
const only = (
  scenario: 'default' | 'think' | 'longContext' | 'webSearch' | 'image',
  kind: PreferenceKind,
  entries: RouterPreferenceEntry[]
) => {
  const emptyPair = () => ({ agent: [] as RouterPreferenceEntry[], subagent: [] as RouterPreferenceEntry[] })
  const out = {
    default: emptyPair(),
    think: emptyPair(),
    longContext: emptyPair(),
    webSearch: emptyPair(),
    image: emptyPair()
  }
  out[scenario][kind] = entries
  return out
}

describeOrSkip('router-preference-service (DB)', () => {
  beforeEach(async () => {
    await resetDbTables()
  })

  afterAll(async () => {
    await teardownPrisma()
  })

  test('loadRouterPreferences returns empty per-(scenario, kind) map + null constraints on a fresh DB', async () => {
    const profile = await loadRouterPreferences()
    for (const s of ['default', 'think', 'longContext', 'webSearch', 'image'] as const) {
      expect(profile.entriesByScenario[s].agent).toEqual([])
      expect(profile.entriesByScenario[s].subagent).toEqual([])
    }
    expect(profile.constraints).toBeNull()
  })

  test('applyRouterPreferences round-trips one (scenario, kind) chain', async () => {
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
      entriesByScenario: only('think', 'agent', [
        { priority: 1, target: 'anthropic,claude-fable-5', enabled: true },
        { priority: 2, target: 'anthropic,claude-opus-5', enabled: true }
      ]),
      constraints: { exhaustedBehavior: '429' }
    })
    expect(outcome.success).toBe(true)
    expect(outcome.warnings).toEqual([])

    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.think.agent).toHaveLength(2)
    expect(round.entriesByScenario.think.subagent).toEqual([])
    expect(round.entriesByScenario.default.agent).toEqual([])
    expect(round.constraints).toEqual({ exhaustedBehavior: '429' })
  })

  test('agent and subagent chains in the same scenario are independent', async () => {
    // The same scenario can carry a different ordering per kind. This
    // is the whole point of the (scenario, kind) split — the subagent
    // lane isn't forced to inherit the agent lane's priority order.
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.createMany({
      data: [
        { providerId: provider.id, name: 'opus-5', enabled: true },
        { providerId: provider.id, name: 'sonnet-5', enabled: true }
      ]
    })
    await applyRouterPreferences({
      entriesByScenario: {
        default: {
          agent: [
            { priority: 1, target: 'anthropic,opus-5', enabled: true },
            { priority: 2, target: 'anthropic,sonnet-5', enabled: true }
          ],
          subagent: [
            // Subagent flips the priority: sonnet-first for cheaper subagent calls.
            { priority: 1, target: 'anthropic,sonnet-5', enabled: true }
          ]
        },
        think: { agent: [], subagent: [] },
        longContext: { agent: [], subagent: [] },
        webSearch: { agent: [], subagent: [] },
        image: { agent: [], subagent: [] }
      },
      constraints: null
    })
    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.default.agent.map((e) => e.target)).toEqual([
      'anthropic,opus-5',
      'anthropic,sonnet-5'
    ])
    expect(round.entriesByScenario.default.subagent.map((e) => e.target)).toEqual(['anthropic,sonnet-5'])
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
        default: {
          agent: [{ priority: 1, target: 'anthropic,sonnet-5', enabled: true }],
          subagent: []
        },
        think: {
          agent: [
            { priority: 1, target: 'anthropic,opus-5', enabled: true },
            { priority: 2, target: 'anthropic,fable-5', enabled: true }
          ],
          subagent: []
        },
        longContext: {
          agent: [{ priority: 1, target: 'anthropic,fable-5', enabled: true }],
          subagent: []
        },
        webSearch: { agent: [], subagent: [] },
        image: { agent: [], subagent: [] }
      },
      constraints: null
    })
    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.default.agent.map((e) => e.target)).toEqual(['anthropic,sonnet-5'])
    expect(round.entriesByScenario.think.agent.map((e) => e.target)).toEqual(['anthropic,opus-5', 'anthropic,fable-5'])
    expect(round.entriesByScenario.longContext.agent.map((e) => e.target)).toEqual(['anthropic,fable-5'])
  })

  test('loadPreferenceChain returns just the requested (scenario, kind) slice', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({ data: { providerId: provider.id, name: 'sonnet-5', enabled: true } })
    await applyRouterPreferences({
      entriesByScenario: only('default', 'agent', [
        { priority: 1, target: 'anthropic,sonnet-5', enabled: true }
      ]),
      constraints: null
    })
    const defaultAgent = await loadPreferenceChain('default', 'agent')
    const defaultSubagent = await loadPreferenceChain('default', 'subagent')
    const think = await loadPreferenceChain('think', 'agent')
    expect(defaultAgent.entries).toHaveLength(1)
    expect(defaultSubagent.entries).toEqual([])
    expect(think.entries).toEqual([])
  })

  test('applyRouterPreferences normalises priorities per (scenario, kind) to dense 1..N', async () => {
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
      entriesByScenario: only('default', 'agent', [
        { priority: 20, target: 'anthropic,c', enabled: true },
        { priority: 5, target: 'anthropic,a', enabled: true },
        { priority: 10, target: 'anthropic,b', enabled: true }
      ]),
      constraints: null
    })
    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.default.agent.map((e) => e.priority)).toEqual([1, 2, 3])
    expect(round.entriesByScenario.default.agent.map((e) => e.target)).toEqual([
      'anthropic,a',
      'anthropic,b',
      'anthropic,c'
    ])
  })

  test('applyRouterPreferences drops unknown targets with per-(scenario, kind) warnings', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({ data: { providerId: provider.id, name: 'claude-opus-5', enabled: true } })
    const outcome = await applyRouterPreferences({
      entriesByScenario: only('think', 'subagent', [
        { priority: 1, target: 'anthropic,claude-opus-5', enabled: true },
        { priority: 2, target: 'anthropic,claude-nonexistent', enabled: true },
        { priority: 3, target: 'malformed', enabled: true }
      ]),
      constraints: null
    })
    expect(outcome.success).toBe(true)
    expect(outcome.warnings).toHaveLength(2)
    expect(
      outcome.warnings.some(
        (w) => w.includes('claude-nonexistent') && w.includes('think') && w.includes('subagent')
      )
    ).toBe(true)

    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.think.subagent).toHaveLength(1)
    expect(round.entriesByScenario.think.subagent[0].target).toBe('anthropic,claude-opus-5')
  })

  test('empty per-(scenario, kind) map clears chains but preserves constraints', async () => {
    const prisma = getPrismaClient()
    const provider = await prisma.provider.create({
      data: { name: 'anthropic', apiBaseUrl: 'https://api.anthropic.com', authMode: 'api_key', apiStyle: 'anthropic' }
    })
    await prisma.model.create({ data: { providerId: provider.id, name: 'x', enabled: true } })
    await applyRouterPreferences({
      entriesByScenario: only('default', 'agent', [
        { priority: 1, target: 'anthropic,x', enabled: true }
      ]),
      constraints: { staleQuotaFactor: 0.5 }
    })
    await applyRouterPreferences({
      entriesByScenario: only('default', 'agent', []),
      constraints: { staleQuotaFactor: 0.5 }
    })
    const round = await loadRouterPreferences()
    expect(round.entriesByScenario.default.agent).toEqual([])
    expect(round.constraints).toEqual({ staleQuotaFactor: 0.5 })
  })
})
