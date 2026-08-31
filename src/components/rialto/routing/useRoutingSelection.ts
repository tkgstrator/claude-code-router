/**
 * The Chain view's three selectors, held in the URL.
 *
 * The surface is the screen's outermost axis, so it has to be addressable:
 * "the chain for /v1/responses" is the thing this screen exists to make
 * discussable, and in local state it survives neither a reload nor a link.
 * The scenario and lane ride along on the same mechanism.
 */
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { InboundSurfaceWire, SurfaceId } from '@/lib/api'
import type { Lane, ScenarioKey } from './types'
import { LANES, SCENARIOS } from './types'

export interface RoutingSelection {
  /** Undefined only while the surface registry is still loading. */
  surface: InboundSurfaceWire | undefined
  scenario: ScenarioKey
  lane: Lane
  selectSurface: (id: SurfaceId) => void
  selectScenario: (scenario: ScenarioKey) => void
  selectLane: (lane: Lane) => void
}

export function useRoutingSelection(surfaces: readonly InboundSurfaceWire[]): RoutingSelection {
  const [params, setParams] = useSearchParams()

  const set = useCallback(
    (key: string, value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(key, value)
          return next
        },
        // Clicking through the surface list is browsing, not navigation:
        // Back should leave the screen, not replay every tab that was tried.
        { replace: true }
      )
    },
    [setParams]
  )

  const selectSurface = useCallback((id: SurfaceId) => set('surface', id), [set])
  const selectScenario = useCallback((next: ScenarioKey) => set('scenario', next), [set])
  const selectLane = useCallback((next: Lane) => set('lane', next), [set])

  // An absent or unrecognised param resolves to the first surface, which is
  // what a bare /routing has always shown.
  const requested = params.get('surface')
  const matched = surfaces.find((s) => s.id === requested)
  const scenario = SCENARIOS.find((s) => s === params.get('scenario'))
  const lane = LANES.find((l) => l === params.get('lane'))

  return {
    surface: matched === undefined ? surfaces.at(0) : matched,
    scenario: scenario === undefined ? 'default' : scenario,
    lane: lane === undefined ? 'agent' : lane,
    selectSurface,
    selectScenario,
    selectLane
  }
}
