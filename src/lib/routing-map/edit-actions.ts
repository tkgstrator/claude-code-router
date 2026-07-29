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

import type { EditScenario, RouteKind } from '@/lib/routing-map/edit-graph'
import type { RouteRule, RouterConfig } from '@/schemas'

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

// Connect a model to a scenario's route for `kind`: becomes the
// primary when the slot is empty, otherwise appended to the fallback
// chain (unless it is already the primary or already in the chain).
// Same-provider fallbacks are allowed now that exhaustion is tracked
// per (provider, model) — a Fable → Opus intra-account rescue is a
// legitimate configuration.
export function connectModel(
  router: RouterConfig,
  scenario: EditScenario,
  modelKey: string,
  kind: RouteKind
): RouterConfig {
  const route = router[scenario][kind]
  if (route.primary === null) {
    return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, primary: modelKey }) }
  }
  if (modelKey === route.primary || route.fallbacks.includes(modelKey)) return router
  return {
    ...router,
    [scenario]: withRoute(router[scenario], kind, { ...route, fallbacks: [...route.fallbacks, modelKey] })
  }
}

// Set the primary target of a scenario's route directly to `modelKey`
// (or `null` to unset). Unlike connectModel — which is a no-op when the
// primary is already set — this replaces any existing primary, so the
// side panel's PopoverSingle can swap primaries without an X-then-add
// intermediate step. If the new primary was previously in the fallback
// list it's pulled out to avoid holding the same model in two slots.
export function setPrimary(
  router: RouterConfig,
  scenario: EditScenario,
  kind: RouteKind,
  modelKey: string | null
): RouterConfig {
  const route = router[scenario][kind]
  if (route.primary === modelKey) return router
  const fallbacks = modelKey === null ? route.fallbacks : route.fallbacks.filter((f) => f !== modelKey)
  return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, primary: modelKey, fallbacks }) }
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

// ── Route rules ──────────────────────────────────────────────────────
// Mutations on the ordered `rules[]` a route target carries. Rules are
// evaluated at runtime in list order (first-match wins), and each rule
// overrides the route's catch-all `{primary, fallbacks}` when its
// predicate matches. Editor helpers stay pure — the caller decides
// when to persist the new RouterConfig.

// A blank rule the editor can insert and fill in via the drawer.
// Empty predicate (`{}`) means "always matches" — the caller is
// expected to open the editor immediately after append.
export function emptyRule(): RouteRule {
  return { name: '', when: {}, target: null }
}

// Append a new rule to a route's rule stack. Idempotent-ish: the same
// rule object identity added twice will still append twice (rules are
// ordered and duplicates might be intentional), so callers pass a
// fresh object per invocation.
export function addRule(router: RouterConfig, scenario: EditScenario, kind: RouteKind, rule: RouteRule): RouterConfig {
  const route = router[scenario][kind]
  const nextRoute = { ...route, rules: [...route.rules, rule] }
  return { ...router, [scenario]: withRoute(router[scenario], kind, nextRoute) }
}

// Replace the rule at `index` with a new rule object. No-op when
// `index` is out of range — the caller shouldn't rely on this
// silently ignoring bad state, but it keeps a stale UI reference from
// crashing.
export function updateRule(
  router: RouterConfig,
  scenario: EditScenario,
  kind: RouteKind,
  index: number,
  rule: RouteRule
): RouterConfig {
  const route = router[scenario][kind]
  if (index < 0 || index >= route.rules.length) return router
  const rules = [...route.rules]
  rules[index] = rule
  return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, rules }) }
}

// Remove the rule at `index` from a route's rule stack.
export function removeRule(router: RouterConfig, scenario: EditScenario, kind: RouteKind, index: number): RouterConfig {
  const route = router[scenario][kind]
  if (index < 0 || index >= route.rules.length) return router
  const rules = route.rules.filter((_, i) => i !== index)
  return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, rules }) }
}

// Move a rule within a route's rule stack (from → to). Out-of-range
// or no-op indices return the router unchanged. Order is the
// first-match-wins order the runtime evaluates in.
export function moveRule(
  router: RouterConfig,
  scenario: EditScenario,
  kind: RouteKind,
  from: number,
  to: number
): RouterConfig {
  const route = router[scenario][kind]
  const size = route.rules.length
  if (from < 0 || from >= size || to < 0 || to >= size || from === to) return router
  const rules = [...route.rules]
  const [moved] = rules.splice(from, 1)
  rules.splice(to, 0, moved)
  return { ...router, [scenario]: withRoute(router[scenario], kind, { ...route, rules }) }
}
