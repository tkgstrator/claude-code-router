/**
 * Pure config-mutation helpers for the routing editor. Each takes the
 * current nested RouterConfig and a caller `kind` (agent / subagent) and
 * returns a new one — connecting a model to that scenario+kind route
 * (primary when empty, else appended fallback), disconnecting it,
 * reordering a fallback chain, or setting the scenario-scoped knobs.
 * Connect/append enforce the same invariants as the form + server: no
 * duplicate fallback, and no fallback on the primary's provider (per-account
 * quota windows are shared across a provider's models, so a same-provider
 * fallback cannot help). A mutation on one kind leaves the other kind's
 * route untouched.
 */

import { providerOf } from '@/lib/router/fallback-slots'
import type { EditScenario, RouteKind } from '@/lib/routing-map/edit-graph'
import type { RouterConfig } from '@/schemas'

// One caller kind's route target (primary + ordered fallback chain).
type RouteTarget = RouterConfig[EditScenario]['agent']

// Replace one kind's route on a scenario slot, preserving the slot's own
// shape (currently only `threshold` on longContext). Branching on `kind`
// keeps each spread a literal-key spread so it stays type-safe without
// assertions.
function withRoute<S extends { agent: RouteTarget; subagent: RouteTarget }>(
  slot: S,
  kind: RouteKind,
  route: RouteTarget
): S {
  return kind === 'agent' ? { ...slot, agent: route } : { ...slot, subagent: route }
}

// Connect a model to a scenario's route for `kind`: becomes the primary
// when the slot is empty (dropping any fallback that now shares the
// primary's provider), otherwise appended to the fallback chain (unless it
// is already the primary, already present, or on the primary's provider).
export function connectModel(
  router: RouterConfig,
  scenario: EditScenario,
  modelKey: string,
  kind: RouteKind
): RouterConfig {
  const route = router[scenario][kind]
  if (route.primary === null) {
    const provider = providerOf(modelKey)
    const fallbacks = route.fallbacks.filter((fallback) => providerOf(fallback) !== provider)
    return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, primary: modelKey, fallbacks }) }
  }
  if (modelKey === route.primary || route.fallbacks.includes(modelKey)) return router
  if (providerOf(modelKey) === providerOf(route.primary)) return router
  return {
    ...router,
    [scenario]: withRoute(router[scenario], kind, { ...route, fallbacks: [...route.fallbacks, modelKey] })
  }
}

// Disconnect a model from a scenario's route for `kind` — clears the
// primary if it matches, otherwise drops it from the fallback chain.
export function disconnectModel(
  router: RouterConfig,
  scenario: EditScenario,
  modelKey: string,
  kind: RouteKind
): RouterConfig {
  const route = router[scenario][kind]
  if (route.primary === modelKey) {
    return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, primary: null }) }
  }
  return {
    ...router,
    [scenario]: withRoute(router[scenario], kind, {
      ...route,
      fallbacks: route.fallbacks.filter((fallback) => fallback !== modelKey)
    })
  }
}

// Move a fallback within a scenario+kind route's chain (from → to).
// Out-of-range or no-op indices return the router unchanged. Order is the
// failover order the runtime walks.
export function moveFallback(
  router: RouterConfig,
  scenario: EditScenario,
  from: number,
  to: number,
  kind: RouteKind
): RouterConfig {
  const route = router[scenario][kind]
  const size = route.fallbacks.length
  if (from < 0 || from >= size || to < 0 || to >= size || from === to) return router
  const fallbacks = [...route.fallbacks]
  const [moved] = fallbacks.splice(from, 1)
  fallbacks.splice(to, 0, moved)
  return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, fallbacks }) }
}

// Scenario-scoped scalar knobs live on their owning scenario, so these
// use concrete keys (not a computed scenario) to stay type-safe.
export function setLongContextThreshold(router: RouterConfig, threshold: number): RouterConfig {
  return { ...router, longContext: { ...router.longContext, threshold } }
}

export function setPersona(router: RouterConfig, persona: string | undefined): RouterConfig {
  return { ...router, persona }
}
