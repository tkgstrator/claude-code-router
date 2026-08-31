/**
 * Per-surface routing configuration.
 *
 * Reads `InboundSurfaceConfig` and layers it over the descriptors in
 * `llms/inbound/surfaces.ts`. A surface with no row keeps its
 * `defaultRoutingMode`, which reproduces the pre-Rialto behaviour exactly:
 * `/v1/messages` routed, the OpenAI-compat and gemini surfaces
 * passthrough. Nothing changes until an operator changes it.
 *
 * The router reads this on the hot path, so the resolved map is cached and
 * invalidated on write rather than re-queried per request.
 */

import { getPrismaClient } from '../db/client'
import {
  INBOUND_SURFACES,
  type InboundSurface,
  type RoutingMode,
  type SurfaceId,
  surfaceById
} from '../llms/inbound/surfaces'

export interface ResolvedSurface extends InboundSurface {
  routingMode: RoutingMode
  /** RouterPreferenceProfile.key this surface's chain comes from. */
  profileKey: string
  /** True when an operator has overridden the descriptor default. */
  overridden: boolean
}

export const DEFAULT_PROFILE_KEY = 'live'

// Resolved snapshot, rebuilt on write. `null` means "not loaded yet".
// Deliberately module-level: one process serves the router, and a stale
// read here would silently route a request the operator just re-pointed.
const cache: { value: ResolvedSurface[] | null } = { value: null }

export function invalidateSurfaceCache(): void {
  cache.value = null
}

const isRoutingMode = (v: string): v is RoutingMode => v === 'routed' || v === 'passthrough'

export async function listSurfaces(): Promise<ResolvedSurface[]> {
  const cached = cache.value
  if (cached !== null) return cached

  const rows = await getPrismaClient()
    .inboundSurfaceConfig.findMany()
    .catch(() => [])
  const byId = new Map(rows.map((r) => [r.surface, r]))

  const resolved = INBOUND_SURFACES.map((surface) => {
    const row = byId.get(surface.id)
    const stored = row !== undefined && isRoutingMode(row.routingMode) ? row.routingMode : undefined
    return {
      ...surface,
      routingMode: stored !== undefined ? stored : surface.defaultRoutingMode,
      profileKey: row?.profileKey !== undefined && row.profileKey !== null ? row.profileKey : DEFAULT_PROFILE_KEY,
      overridden: stored !== undefined && stored !== surface.defaultRoutingMode
    }
  })
  cache.value = resolved
  return resolved
}

export async function resolveSurfaceForPath(path: string | undefined): Promise<ResolvedSurface | undefined> {
  if (typeof path !== 'string' || path.length === 0) return undefined
  const all = await listSurfaces()
  const exact = all.find((s) => s.path === path)
  if (exact !== undefined) return exact
  if (path.startsWith('/v1beta/models/')) return all.find((s) => s.id === 'gemini-generate')
  return undefined
}

/**
 * Whether the full scenario → rule → preference-chain → failover pipeline
 * applies to this path.
 *
 * An unknown path is treated as routed: that is what `/v1/messages` (the
 * only path the old code did not name) did, and the caller only reaches
 * here from a mounted surface anyway.
 */
export async function isRoutedPath(path: string | undefined): Promise<boolean> {
  const surface = await resolveSurfaceForPath(path)
  return surface === undefined ? true : surface.routingMode === 'routed'
}

export interface SurfaceUpdate {
  surface: SurfaceId
  routingMode: RoutingMode
  profileKey?: string | null
}

export async function updateSurface(input: SurfaceUpdate): Promise<ResolvedSurface[]> {
  const descriptor = surfaceById(input.surface)
  if (descriptor === undefined) throw new Error(`Unknown inbound surface: ${input.surface}`)

  const profileKey = input.profileKey === undefined ? null : input.profileKey
  await getPrismaClient().inboundSurfaceConfig.upsert({
    where: { surface: input.surface },
    create: { surface: input.surface, routingMode: input.routingMode, profileKey },
    update: { routingMode: input.routingMode, profileKey }
  })
  invalidateSurfaceCache()
  return listSurfaces()
}
