/**
 * The routing-mode override is the one place where a stored row changes
 * how every /v1 request is dispatched, so these tests pin the two things
 * that must not drift: the shipped defaults reproduce the pre-Rialto
 * hardcoded behaviour, and an override actually takes effect on the hot
 * path (which reads through a cache).
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { getPrismaClient } from '../../src/db/client'
import {
  invalidateSurfaceCache,
  isRoutedPath,
  listSurfaces,
  resolveSurfaceForPath,
  updateSurface
} from '../../src/services/inbound-surface-service'
import { HAS_DB, resetDbTables, teardownPrisma } from './helpers'

const describeDb = HAS_DB ? describe : describe.skip

describeDb('inbound-surface-service', () => {
  beforeEach(async () => {
    await resetDbTables()
    invalidateSurfaceCache()
  })

  afterAll(teardownPrisma)

  test('with no stored rows, defaults reproduce the previous hardcoded bypass', async () => {
    const byId = new Map((await listSurfaces()).map((s) => [s.id, s]))

    expect(byId.get('anthropic-messages')?.routingMode).toBe('routed')
    expect(byId.get('openai-chat')?.routingMode).toBe('passthrough')
    expect(byId.get('openai-responses')?.routingMode).toBe('passthrough')
    expect(byId.get('gemini-generate')?.routingMode).toBe('passthrough')
    expect([...byId.values()].every((s) => !s.overridden)).toBe(true)
  })

  test('isRoutedPath matches the paths scenario-router used to name literally', async () => {
    expect(await isRoutedPath('/v1/messages')).toBe(true)
    expect(await isRoutedPath('/v1/chat/completions')).toBe(false)
    expect(await isRoutedPath('/v1/responses')).toBe(false)
  })

  test('an unknown path stays routed rather than silently bypassing the router', async () => {
    expect(await isRoutedPath('/v1/something-new')).toBe(true)
    expect(await isRoutedPath(undefined)).toBe(true)
  })

  test('the gemini surface resolves from a model-and-action path', async () => {
    const surface = await resolveSurfaceForPath('/v1beta/models/gemini-3-pro:streamGenerateContent')
    expect(surface?.id).toBe('gemini-generate')
  })

  test('an override takes effect on the hot path and is marked as an override', async () => {
    await updateSurface({ surface: 'openai-chat', routingMode: 'routed' })

    expect(await isRoutedPath('/v1/chat/completions')).toBe(true)
    const surface = await resolveSurfaceForPath('/v1/chat/completions')
    expect(surface?.routingMode).toBe('routed')
    expect(surface?.overridden).toBe(true)
    // Sibling surfaces are untouched — the row is per-surface.
    expect(await isRoutedPath('/v1/responses')).toBe(false)
  })

  test('setting a surface back to its default clears the overridden flag', async () => {
    await updateSurface({ surface: 'openai-chat', routingMode: 'routed' })
    await updateSurface({ surface: 'openai-chat', routingMode: 'passthrough' })

    const surface = await resolveSurfaceForPath('/v1/chat/completions')
    expect(surface?.routingMode).toBe('passthrough')
    expect(surface?.overridden).toBe(false)
  })

  test('a surface carries the default profile key until one is chosen', async () => {
    const before = await resolveSurfaceForPath('/v1/messages')
    expect(before?.profileKey).toBe('live')

    await updateSurface({ surface: 'anthropic-messages', routingMode: 'routed', profileKey: 'cost-first' })
    const after = await resolveSurfaceForPath('/v1/messages')
    expect(after?.profileKey).toBe('cost-first')
  })

  test('an unknown surface id is refused rather than written', async () => {
    // The id is a closed enum on the wire, but the service is also
    // reachable from code the schema does not guard, so the runtime
    // check has to hold on its own. The cast is what bypasses the
    // compile-time enum to reach it.
    const unknown = { surface: 'not-a-surface', routingMode: 'routed' } as unknown as Parameters<
      typeof updateSurface
    >[0]
    await expect(updateSurface(unknown)).rejects.toThrow('Unknown inbound surface')
    expect(await getPrismaClient().inboundSurfaceConfig.count()).toBe(0)
  })
})
