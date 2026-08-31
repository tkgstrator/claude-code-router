/**
 * Pure builder for the EDITABLE routing graph. Unlike build-graph.ts —
 * which overlays the Router config with observed traffic for the
 * read-only map — this builds a clean two-tier CONFIG view: scenario
 * lanes (left) → target models (right). The editor mutates it directly:
 * connecting a scenario to a model sets that scenario's primary (or
 * appends a fallback), disconnecting removes it. No traffic, no
 * requested tier — just the config being edited.
 */

import type { RouterConfig } from '@/schemas/domain/router'
// The fixed scenario lanes, top-to-bottom. Mirrors SCENARIO_KEYS; kept
// local so the editor graph never depends on traffic-side ordering. The
// former `background` lane is gone — it is now a predicated rule on the
// `default` lane (see migration `20260728_router_rules_drop_background`).
export const EDIT_SCENARIOS = ['default', 'think', 'longContext', 'webSearch', 'image'] as const
export type EditScenario = (typeof EDIT_SCENARIOS)[number]

// The two caller kinds each scenario routes independently: `agent` for
// normal traffic, `subagent` for a request carrying a <RIALTO-SUBAGENT-MODEL>
// tag. Both are first-class exits on a scenario node.
export const ROUTE_KINDS = ['agent', 'subagent'] as const
export type RouteKind = (typeof ROUTE_KINDS)[number]

// Column x + row spacing for the two-tier layout. Scenario nodes are
// 260px wide and model nodes 280px, so a MODEL_X of 640 leaves ~380px
// of empty canvas between the columns — enough room that catch-all
// and rule edges don't visually collide at the mid-point when a
// scenario fans out to several models.
const SCENARIO_X = 0
const MODEL_X = 640
const ROW_GAP = 96

export interface EditScenarioNode {
  id: string
  scenario: EditScenario
  position: { x: number; y: number }
}

export interface EditModelNode {
  id: string
  provider: string
  model: string
  modelKey: string
  position: { x: number; y: number }
}

// An edge on the editor graph. `source: 'catch-all'` covers the
// scenario's top-level primary + fallback list — the wiring the map
// has always drawn. `source: 'rule'` covers a predicated rule's own
// primary + fallbacks; those get a distinct visual style (blue) so
// the map can advertise "this target only fires when a rule matches"
// without overloading the primary/fallback edges.
export interface EditGraphEdge {
  id: string
  // scenario node id → model node id
  source: string
  target: string
  scenario: EditScenario
  modelKey: string
  // Which route (source handle) this edge leaves the scenario from.
  kind: RouteKind
  // Whether the edge participates in the catch-all list or a rule.
  origin: 'catch-all' | 'rule'
  // Whether this edge is the route's primary or a fallback chain entry.
  role: 'primary' | 'fallback'
  // Fallback position in the chain (1-based); 0 for the primary edge.
  // For rule edges this is the rule's own chain index, not the
  // scenario-level index.
  order: number
  // Index of the owning rule in `route.rules`, or null for a
  // catch-all edge. Kept so the UI can label / group rule edges.
  ruleIndex: number | null
  // The rule's `name` when `origin === 'rule'` — used as the edge
  // label so the map surfaces which rule pinned this target.
  ruleName: string | null
}

export interface EditGraph {
  scenarioNodes: EditScenarioNode[]
  modelNodes: EditModelNode[]
  edges: EditGraphEdge[]
}

export const editScenarioNodeId = (scenario: string): string => `es:${scenario}`
export const editModelNodeId = (modelKey: string): string => `em:${modelKey}`

// Recover the "provider,model" key from a model node id.
export const modelKeyFromNodeId = (nodeId: string): string | null => (nodeId.startsWith('em:') ? nodeId.slice(3) : null)
// Recover the scenario from a scenario node id.
export const scenarioFromNodeId = (nodeId: string): string | null => (nodeId.startsWith('es:') ? nodeId.slice(3) : null)

function splitModelKey(modelKey: string): { provider: string; model: string } {
  const idx = modelKey.indexOf(',')
  if (idx === -1) return { provider: modelKey, model: '' }
  return { provider: modelKey.slice(0, idx), model: modelKey.slice(idx + 1) }
}

// Build the editable graph from the Router config plus the universe of
// enabled model keys. The model universe is every enabled model, unioned
// with any key the config already references (so a slot still pointing at
// a now-disabled model keeps its node instead of dangling).
export function buildEditGraph(router: RouterConfig, enabledModelKeys: readonly string[]): EditGraph {
  const keys = new Set<string>(enabledModelKeys)
  for (const scenario of EDIT_SCENARIOS) {
    for (const kind of ROUTE_KINDS) {
      const route = router[scenario][kind]
      if (route.primary !== null) keys.add(route.primary)
      for (const fallback of route.fallbacks) keys.add(fallback)
      // Rule targets participate in the model universe too, so a rule
      // pointing at a model that's not otherwise referenced still gets
      // a node instead of an "unknown target" gap.
      for (const rule of route.rules) {
        if (rule.target !== null && rule.target.length > 0) keys.add(rule.target)
      }
    }
  }
  const orderedKeys = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const scenarioNodes: EditScenarioNode[] = EDIT_SCENARIOS.map((scenario, index) => ({
    id: editScenarioNodeId(scenario),
    scenario,
    position: { x: SCENARIO_X, y: index * ROW_GAP }
  }))

  const modelNodes: EditModelNode[] = orderedKeys.map((modelKey, index) => {
    const { provider, model } = splitModelKey(modelKey)
    return { id: editModelNodeId(modelKey), provider, model, modelKey, position: { x: MODEL_X, y: index * ROW_GAP } }
  })

  const edges: EditGraphEdge[] = []
  for (const scenario of EDIT_SCENARIOS) {
    for (const kind of ROUTE_KINDS) {
      const route = router[scenario][kind]
      // Catch-all primary + fallback edges — the same wiring users
      // drag onto the canvas. Fallbacks stay visible so the drag
      // gesture that appended them shows its result.
      if (route.primary !== null) {
        edges.push({
          id: `${editScenarioNodeId(scenario)}__${editModelNodeId(route.primary)}__${kind}__primary`,
          source: editScenarioNodeId(scenario),
          target: editModelNodeId(route.primary),
          scenario,
          modelKey: route.primary,
          kind,
          origin: 'catch-all',
          role: 'primary',
          order: 0,
          ruleIndex: null,
          ruleName: null
        })
      }
      route.fallbacks.forEach((fallback, index) => {
        edges.push({
          id: `${editScenarioNodeId(scenario)}__${editModelNodeId(fallback)}__${kind}__fb${index}`,
          source: editScenarioNodeId(scenario),
          target: editModelNodeId(fallback),
          scenario,
          modelKey: fallback,
          kind,
          origin: 'catch-all',
          role: 'fallback',
          order: index + 1,
          ruleIndex: null,
          ruleName: null
        })
      })
      // Rule edges — one per rule target. Rules don't have their own
      // fallback chain; a matched rule cascades through the scenario
      // catch-all (rule target → scenario primary → scenario
      // fallbacks), so no rule-fallback edges are drawn.
      route.rules.forEach((rule, ruleIndex) => {
        const ruleName = rule.name !== undefined && rule.name.length > 0 ? rule.name : null
        if (rule.target !== null && rule.target.length > 0) {
          edges.push({
            id: `${editScenarioNodeId(scenario)}__${editModelNodeId(rule.target)}__${kind}__r${ruleIndex}__target`,
            source: editScenarioNodeId(scenario),
            target: editModelNodeId(rule.target),
            scenario,
            modelKey: rule.target,
            kind,
            origin: 'rule',
            role: 'primary',
            order: 0,
            ruleIndex,
            ruleName
          })
        }
      })
    }
  }

  return { scenarioNodes, modelNodes, edges }
}
