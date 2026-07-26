/**
 * Pure config-mutation helpers for the routing editor. Each takes the
 * current nested RouterConfig and returns a new one — connecting a model
 * to a scenario (primary when empty, else appended fallback),
 * disconnecting it, reordering a fallback chain, or setting the
 * scenario-scoped knobs. Connect/append enforce the same invariants as
 * the form + server: no duplicate fallback, and no fallback on the
 * primary's provider (per-account quota windows are shared across a
 * provider's models, so a same-provider fallback cannot help).
 */

import { providerOf } from '@/lib/router/fallback-slots'
import type { EditScenario } from '@/lib/routing-map/edit-graph'
import type { RouterConfig } from '@/schemas'

// Connect a model to a scenario: becomes the primary when the slot is
// empty (dropping any fallback that now shares the primary's provider),
// otherwise appended to the fallback chain (unless it is already the
// primary, already present, or on the primary's provider).
export function connectModel(router: RouterConfig, scenario: EditScenario, modelKey: string): RouterConfig {
  const route = router[scenario]
  if (route.primary === null) {
    const provider = providerOf(modelKey)
    const fallbacks = route.fallbacks.filter((fallback) => providerOf(fallback) !== provider)
    return { ...router, [scenario]: { ...route, primary: modelKey, fallbacks } }
  }
  if (modelKey === route.primary || route.fallbacks.includes(modelKey)) return router
  if (providerOf(modelKey) === providerOf(route.primary)) return router
  return { ...router, [scenario]: { ...route, fallbacks: [...route.fallbacks, modelKey] } }
}

// Disconnect a model from a scenario — clears the primary if it matches,
// otherwise drops it from the fallback chain.
export function disconnectModel(router: RouterConfig, scenario: EditScenario, modelKey: string): RouterConfig {
  const route = router[scenario]
  if (route.primary === modelKey) {
    return { ...router, [scenario]: { ...route, primary: null } }
  }
  return { ...router, [scenario]: { ...route, fallbacks: route.fallbacks.filter((fallback) => fallback !== modelKey) } }
}

// Move a fallback within its chain (from → to). Out-of-range or no-op
// indices return the router unchanged. Order is the failover order the
// runtime walks.
export function moveFallback(router: RouterConfig, scenario: EditScenario, from: number, to: number): RouterConfig {
  const route = router[scenario]
  const size = route.fallbacks.length
  if (from < 0 || from >= size || to < 0 || to >= size || from === to) return router
  const fallbacks = [...route.fallbacks]
  const [moved] = fallbacks.splice(from, 1)
  fallbacks.splice(to, 0, moved)
  return { ...router, [scenario]: { ...route, fallbacks } }
}

// Toggle the force flag on a scenario (override the client's bare model).
export function setForce(router: RouterConfig, scenario: EditScenario, force: boolean): RouterConfig {
  return { ...router, [scenario]: { ...router[scenario], force } }
}

// Scenario-scoped scalar knobs live on their owning scenario, so these
// use concrete keys (not a computed scenario) to stay type-safe.
export function setLongContextThreshold(router: RouterConfig, threshold: number): RouterConfig {
  return { ...router, longContext: { ...router.longContext, threshold } }
}

export function setWeeklyDrainMarginPct(router: RouterConfig, weeklyDrainMarginPct: number): RouterConfig {
  return { ...router, default: { ...router.default, weeklyDrainMarginPct } }
}

export function setPersona(router: RouterConfig, persona: string | undefined): RouterConfig {
  return { ...router, persona }
}
