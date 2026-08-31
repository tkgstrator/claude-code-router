/**
 * The inbound-surface registry, loaded once per screen.
 *
 * Both RequestLog and Session now carry an exact `surface` slug, so this
 * is a pure id → descriptor lookup. `inboundType` is deliberately not a
 * fallback: 'openai' covers /v1/chat/completions and /v1/responses, so a
 * null surface is unrecoverable and renders as untracked.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type InboundSurfaceWire } from '@/lib/api'

export interface SurfaceLookup {
  surfaces: InboundSurfaceWire[]
  /** Display path for a RequestLog.surface slug. */
  pathOf: (surfaceId: string | null) => string | null
  /** The client an operator points at that surface — the nearest thing to a caller identity. */
  clientOf: (surfaceId: string | null) => string | null
}

export function useSurfaces(): SurfaceLookup {
  const [surfaces, setSurfaces] = useState<InboundSurfaceWire[]>([])

  useEffect(() => {
    api
      .getInboundSurfaces()
      .then((res) => setSurfaces(res.surfaces))
      .catch(() => {
        // Labels only. A failed probe leaves every endpoint cell untracked
        // instead of blocking the table from rendering.
      })
  }, [])

  return useMemo(() => {
    const byId = new Map<string, InboundSurfaceWire>(surfaces.map((s) => [s.id, s]))
    const find = (id: string | null): InboundSurfaceWire | undefined => (id === null ? undefined : byId.get(id))
    return {
      surfaces,
      pathOf: (id) => {
        const s = find(id)
        return s === undefined ? null : s.path
      },
      clientOf: (id) => {
        const s = find(id)
        return s === undefined ? null : s.client
      }
    }
  }, [surfaces])
}
