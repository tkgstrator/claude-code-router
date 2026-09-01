/**
 * The reserved `passthrough` profile.
 *
 * Routing mode is otherwise a property of the inbound surface, which
 * makes it all-or-nothing: every client on an endpoint is routed, or
 * none is. Pointing a token or a surface at this key opts that traffic
 * out on its own, so what has to hold is that it never behaves like a
 * chain — it cannot be written to, it does not appear as one in the
 * picker, and a surface carrying it is passthrough whatever its mode
 * column says.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { getPrismaClient } from '../../src/db/client'
import { invalidateSurfaceCache, isRoutedPath, updateSurface } from '../../src/services/inbound-surface-service'
import {
  applyRouterPreferences,
  DEFAULT_PROFILE_KEY,
  listPreferenceProfiles,
  PASSTHROUGH_PROFILE_KEY
} from '../../src/services/router-preference-service'
import { HAS_DB, resetDbTables, teardownPrisma } from './helpers'

const emptyChain = () => ({
  entriesByScenario: {
    default: { agent: [], subagent: [] },
    think: { agent: [], subagent: [] },
    longContext: { agent: [], subagent: [] },
    webSearch: { agent: [], subagent: [] },
    image: { agent: [], subagent: [] }
  },
  constraints: null
})

describe.skipIf(!HAS_DB)('passthrough profile', () => {
  beforeEach(async () => {
    await resetDbTables()
    invalidateSurfaceCache()
  })

  afterAll(teardownPrisma)

  test('is offered by the picker alongside the real chains', async () => {
    const profiles = await listPreferenceProfiles()
    const reserved = profiles.find((p) => p.key === PASSTHROUGH_PROFILE_KEY)
    expect(reserved?.kind).toBe('passthrough')
    expect(reserved?.entryCount).toBe(0)
    expect(profiles.find((p) => p.key === DEFAULT_PROFILE_KEY)?.kind).toBe('chain')
  })

  test('refuses to store a chain, rather than storing one that never runs', async () => {
    const outcome = await applyRouterPreferences(emptyChain(), undefined, PASSTHROUGH_PROFILE_KEY)
    expect(outcome.success).toBe(false)
    expect(outcome.warnings.join(' ')).toContain('reserved')
    expect(await getPrismaClient().routerPreferenceProfile.count()).toBe(0)
  })

  test('a surface pointed at it is passthrough even with routingMode routed', async () => {
    // The reserved key has to mean the same thing wherever it appears,
    // or the two fields can disagree about the same request.
    await updateSurface({ surface: 'anthropic-messages', routingMode: 'routed', profileKey: PASSTHROUGH_PROFILE_KEY })
    expect(await isRoutedPath('/v1/messages')).toBe(false)
  })

  test('pointing a surface back at a real profile restores routing', async () => {
    await updateSurface({ surface: 'anthropic-messages', routingMode: 'routed', profileKey: PASSTHROUGH_PROFILE_KEY })
    await updateSurface({ surface: 'anthropic-messages', routingMode: 'routed', profileKey: DEFAULT_PROFILE_KEY })
    expect(await isRoutedPath('/v1/messages')).toBe(true)
  })

  test('a stored row using the reserved key never shadows the real behaviour', async () => {
    // The write path refuses it, but a row predating that guard must not
    // make the picker offer it as an editable chain.
    await getPrismaClient().routerPreferenceProfile.create({ data: { key: PASSTHROUGH_PROFILE_KEY } })
    const profiles = await listPreferenceProfiles()
    expect(profiles.filter((p) => p.key === PASSTHROUGH_PROFILE_KEY)).toHaveLength(1)
    expect(profiles.find((p) => p.key === PASSTHROUGH_PROFILE_KEY)?.kind).toBe('passthrough')
  })
})
