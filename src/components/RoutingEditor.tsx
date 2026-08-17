/**
 * Routing Map graph — a two-tier config view (scenario lanes → model
 * nodes) whose edges ARE the Router config. When `editable` is false it is
 * read-only (just shows the wiring). When true it becomes interactive:
 * drag a scenario handle onto a model to wire it (primary, then
 * fallbacks), reconnect or delete edges (right-click / Delete key /
 * reconnect-to-empty), and a side panel + Save persist the changes via
 * api.updateConfig. Persona activation lives on the Personas page (one
 * canonical picker) and is no longer duplicated here. No traffic
 * overlay — the Routing Map is purely for viewing and editing the
 * routing config.
 */

import '@xyflow/react/dist/style.css'
import { Background, type Connection, type Edge, MarkerType, type Node, ReactFlow } from '@xyflow/react'
import { Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { type MouseEvent, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { type ConnectionChoice, ConnectionChoiceDialog } from '@/components/routing-map/ConnectionChoiceDialog'
import { editNodeTypes, type ModelEditNodeType, type ScenarioEditNodeType } from '@/components/routing-map/edit-nodes'
import { RoutingEditorPanel } from '@/components/routing-map/RoutingEditorPanel'
import { Button } from '@/components/ui/button'
import { useEnabledModelOptions } from '@/hooks/use-enabled-model-options'
import { modelNameOf } from '@/lib/router/fallback-slots'
import { addRule, connectModel, disconnectModel, emptyRule, removeRule } from '@/lib/routing-map/edit-actions'
import {
  buildEditGraph,
  EDIT_SCENARIOS,
  type EditScenario,
  modelKeyFromNodeId,
  type RouteKind,
  scenarioFromNodeId
} from '@/lib/routing-map/edit-graph'
import type { RouterConfig } from '@/schemas'
import type { ShellOutletContext } from './AppShell'

type AppEditNode = ScenarioEditNodeType | ModelEditNodeType

const isEditScenario = (s: string): s is EditScenario => EDIT_SCENARIOS.some((x) => x === s)

// Edge color encodes the ORIGIN (catch-all vs rule) and the ROLE
// (primary vs fallback). Rule-owned edges get a distinctive blue so
// the map advertises "this target only fires when a rule matches"
// without overloading the catch-all wiring. Within each origin, the
// primary is fully saturated and the fallbacks fade into muted.
// Dash pattern still encodes the KIND (agent solid, subagent dotted).
const strokeColorFor = (origin: 'catch-all' | 'rule', role: 'primary' | 'fallback'): string => {
  if (origin === 'rule') return role === 'primary' ? 'var(--color-blue-500)' : 'var(--color-blue-400)'
  return role === 'primary' ? 'var(--primary)' : 'var(--muted-foreground)'
}
const strokeDashFor = (role: 'primary' | 'fallback', kind: RouteKind): string | undefined =>
  role === 'fallback' ? '6 4' : kind === 'subagent' ? '2 4' : undefined

// Read a source-handle id as a route kind, defaulting to agent when absent.
const kindFromHandle = (handle: string | null | undefined): RouteKind => (handle === 'subagent' ? 'subagent' : 'agent')

// Recover an edge's route kind for delete/reconnect: prefer the value
// stashed in edge.data, fall back to parsing the id, else default to agent.
// The kind is always the second-to-last '__'-delimited id segment, so match
// that segment exactly rather than substring-scanning (a model key could
// itself contain the token).
function kindFromEdge(edge: Edge): RouteKind {
  const data = edge.data
  if (data !== undefined && data !== null && typeof data === 'object' && 'kind' in data) {
    const raw = data.kind
    if (raw === 'subagent' || raw === 'agent') return raw
  }
  return edge.id.split('__').at(-2) === 'subagent' ? 'subagent' : 'agent'
}

// Pull the (origin, ruleIndex) an edge was built with so a context-menu
// handler can distinguish "delete a catch-all wiring" from "delete a rule
// row". Everything of interest lives on edge.data — the id is only used
// as a last-ditch fallback for edges predating the data payload.
function ruleContextFromEdge(edge: Edge): { origin: 'catch-all' | 'rule'; ruleIndex: number | null } {
  const data = edge.data
  if (data !== undefined && data !== null && typeof data === 'object') {
    const origin = 'origin' in data ? data.origin : undefined
    const ruleIndex = 'ruleIndex' in data ? data.ruleIndex : undefined
    if (origin === 'rule' && typeof ruleIndex === 'number') return { origin, ruleIndex }
    if (origin === 'catch-all') return { origin, ruleIndex: null }
  }
  return { origin: 'catch-all', ruleIndex: null }
}

// Human-friendly token count for the longContext threshold caption. Rounds
// to a whole `k` at 1000+ (so 128000 → "128k"), otherwise prints the raw
// number — matches how limits are conventionally quoted in this domain.
function formatTokenCount(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

// Scenario-scoped caption shown on the node under the label. Currently only
// longContext carries one — the token threshold the request must exceed to
// take this lane. `null` threshold means "auto"; the concrete value is
// resolved at runtime from the default primary's context window, so the
// node just labels the mode. Other scenarios have no meaningful summary
// at this scale.
function scenarioNote(scenario: EditScenario, router: RouterConfig): string | undefined {
  if (scenario !== 'longContext') return undefined
  const t = router.longContext.threshold
  if (t === null) return 'auto'
  return `≥ ${formatTokenCount(t)} tok`
}

export interface RoutingEditorProps {
  // Seed value for the editor's draft state; the editor re-mounts (via
  // React key) when this needs to be re-seeded from outside.
  initialRouter: RouterConfig
  // Persist the draft. Return `ok: false` and the editor surfaces the
  // message as an error toast; return `ok: true` for a success toast.
  onSave: (router: RouterConfig) => Promise<{ ok: boolean; message?: string }>
  // Read-only view: no Save button, no edit gestures.
  editable: boolean
}

export function RoutingEditor({ initialRouter, onSave, editable }: RoutingEditorProps) {
  const { t } = useTranslation()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const { resolvedTheme } = useTheme()
  const modelOptions = useEnabledModelOptions()

  const [router, setRouter] = useState<RouterConfig>(initialRouter)
  // Pending connection: set when the user drags an edge onto a
  // scenario that already has a primary, so the dialog can ask
  // whether the drag should become a fallback or a new rule.
  const [pending, setPending] = useState<{ scenario: EditScenario; modelKey: string; kind: RouteKind } | null>(null)
  const [selected, setSelected] = useState<EditScenario | null>(null)
  const [saving, setSaving] = useState(false)

  const modelKeys = useMemo(() => modelOptions.map((o) => o.value), [modelOptions])
  const graph = useMemo(() => buildEditGraph(router, modelKeys), [router, modelKeys])

  const modelLabel = useCallback(
    (key: string): string => {
      const opt = modelOptions.find((o) => o.value === key)
      return opt === undefined ? key : opt.label
    },
    [modelOptions]
  )
  const usedBy = useCallback(
    (key: string): number =>
      EDIT_SCENARIOS.reduce((n, s) => {
        const agent = router[s].agent
        const subagent = router[s].subagent
        const inAgent = agent.primary === key || agent.fallbacks.includes(key)
        const inSubagent = subagent.primary === key || subagent.fallbacks.includes(key)
        return n + (inAgent || inSubagent ? 1 : 0)
      }, 0),
    [router]
  )

  const nodes = useMemo<AppEditNode[]>(() => {
    const scenarioNodes: AppEditNode[] = graph.scenarioNodes.map((node) => {
      const agent = router[node.scenario].agent
      const subagent = router[node.scenario].subagent
      // Provider prefix is dropped from the scenario summary — the map
      // itself makes the provider obvious (each model node lives on
      // its provider's row), so repeating it here just eats width.
      return {
        id: node.id,
        type: 'scenarioEdit',
        position: node.position,
        data: {
          label: t(`router.${node.scenario}`),
          note: scenarioNote(node.scenario, router),
          agentPrimaryLabel: modelNameOf(agent.primary),
          agentFallbackCount: agent.fallbacks.length,
          agentRuleCount: agent.rules.length,
          subagentPrimaryLabel: modelNameOf(subagent.primary),
          subagentFallbackCount: subagent.fallbacks.length,
          subagentRuleCount: subagent.rules.length,
          emptyLabel: t('routingMap.editNoPrimary'),
          fallbackLabel: t('routingMap.editFallbacks'),
          ruleLabel: t('router.rules.title'),
          agentRouteLabel: t('router.agentRoute'),
          subagentRouteLabel: t('router.subagentRoute'),
          selected: selected === node.scenario
        }
      }
    })
    const modelNodes: AppEditNode[] = graph.modelNodes.map((node) => ({
      id: node.id,
      type: 'modelEdit',
      position: node.position,
      data: { provider: node.provider, model: node.model, usedBy: usedBy(node.modelKey) }
    }))
    return [...scenarioNodes, ...modelNodes]
  }, [graph, router, selected, modelLabel, usedBy, t])

  const deleteEdge = useCallback((scenario: EditScenario, modelKey: string, kind: RouteKind) => {
    setRouter((r) => disconnectModel(r, scenario, modelKey, kind))
  }, [])

  const deleteRule = useCallback((scenario: EditScenario, kind: RouteKind, ruleIndex: number) => {
    setRouter((r) => removeRule(r, scenario, kind, ruleIndex))
  }, [])

  // Right-click an edge to delete it (alongside the Delete key and the
  // reconnect-to-empty gesture). Catch-all edges drop the model from the
  // route's primary / fallback slot; rule edges drop the whole rule row
  // from route.rules (the side panel's × button does the same thing).
  const onEdgeContextMenu = useCallback(
    (event: MouseEvent, edge: Edge) => {
      event.preventDefault()
      const scenario = scenarioFromNodeId(edge.source)
      const modelKey = modelKeyFromNodeId(edge.target)
      if (scenario === null || modelKey === null || !isEditScenario(scenario)) return
      const kind = kindFromEdge(edge)
      const { origin, ruleIndex } = ruleContextFromEdge(edge)
      if (origin === 'rule' && ruleIndex !== null) {
        deleteRule(scenario, kind, ruleIndex)
      } else {
        deleteEdge(scenario, modelKey, kind)
      }
    },
    [deleteEdge, deleteRule]
  )

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = graph.edges.map((edge) => {
      const color = strokeColorFor(edge.origin, edge.role)
      // Label encodes the priority the runtime evaluates in:
      //   - catch-all fallback → `1`, `2`, ... (failover chain index)
      //   - rule primary       → `R1`, `R2`, ... (rule stack index)
      // Catch-all primary stays unlabelled — the map's default arrow
      // already reads as "this scenario's primary" without extra
      // chrome. Rules don't emit fallback edges, so there's no
      // rule-fallback label form.
      const label = ((): string | undefined => {
        if (edge.origin === 'catch-all') {
          return edge.role === 'fallback' ? String(edge.order) : undefined
        }
        const rank = edge.ruleIndex !== null ? edge.ruleIndex + 1 : 0
        return `R${rank}`
      })()
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // Pin the edge to its originating handle and stash the kind /
        // origin / ruleIndex so delete/reconnect can route the mutation
        // to the right route (or the right rule row).
        sourceHandle: edge.kind,
        data: { kind: edge.kind, origin: edge.origin, ruleIndex: edge.ruleIndex },
        label,
        labelShowBg: label !== undefined,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        // Bigger + opaque background + stroke ring so the badge sits
        // legibly on top of the edge line instead of blending in.
        // Text color follows the edge color so rule badges pick up
        // the blue and catch-all badges stay neutral.
        labelStyle: { fill: color, fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: 'var(--background)', opacity: 1, stroke: color, strokeWidth: 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 11, height: 11 },
        // Delete-key removal + drag-to-reconnect only apply to catch-all
        // wiring; a rule edge is not a wire the user can rewire, it
        // stands in for a whole rule row. Right-click still fires
        // onEdgeContextMenu for both — that's how rule rows are dropped
        // from the map (equivalent to the side panel's × button).
        deletable: edge.origin === 'catch-all',
        focusable: edge.origin === 'catch-all',
        reconnectable: edge.origin === 'catch-all',
        style: {
          stroke: color,
          strokeWidth: edge.role === 'primary' ? 2 : 1.25,
          strokeDasharray: strokeDashFor(edge.role, edge.kind)
        }
      }
    })
    return list
  }, [graph])

  const onConnect = useCallback(
    (c: Connection) => {
      const scenario = scenarioFromNodeId(c.source)
      const modelKey = modelKeyFromNodeId(c.target)
      const kind = kindFromHandle(c.sourceHandle)
      if (scenario === null || modelKey === null || !isEditScenario(scenario)) return
      // First drag on an empty route becomes the primary automatically.
      // Any subsequent drag opens the choice dialog — even when the
      // target is the same model as the current primary, because the
      // user may legitimately want a Rule that fires on a predicate
      // and lands on the primary model (e.g. "for haiku requests,
      // ALSO route to the primary opus" as a Rule form for docs).
      const route = router[scenario][kind]
      if (route.primary === null) {
        setRouter((r) => connectModel(r, scenario, modelKey, kind))
        return
      }
      setPending({ scenario, modelKey, kind })
    },
    [router]
  )

  const applyPending = useCallback(
    (choice: ConnectionChoice) => {
      if (pending === null) return
      const { scenario, modelKey, kind } = pending
      if (choice === 'fallback') {
        setRouter((r) => connectModel(r, scenario, modelKey, kind))
      } else {
        // Seed the rule with the dragged model as its target so the
        // panel opens showing the model the user meant; predicate
        // fields are left blank for them to fill in.
        setRouter((r) => addRule(r, scenario, kind, { ...emptyRule(), target: modelKey }))
        setSelected(scenario)
      }
      setPending(null)
    },
    [pending]
  )

  // Edge reconnection: drag either end of an edge onto a different handle
  // to rewire it (move the source scenario or the target model), or drop it
  // on empty space to delete it. The ref records whether the drag landed on
  // a valid handle (onReconnect fired) so onReconnectEnd can delete the edge
  // when it didn't.
  const edgeReconnectSuccessful = useRef(true)
  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false
  }, [])
  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    edgeReconnectSuccessful.current = true
    const oldScenario = scenarioFromNodeId(oldEdge.source)
    const oldModel = modelKeyFromNodeId(oldEdge.target)
    const oldKind = kindFromEdge(oldEdge)
    const newScenario = scenarioFromNodeId(newConnection.source)
    const newModel = modelKeyFromNodeId(newConnection.target)
    const newKind = kindFromHandle(newConnection.sourceHandle)
    if (
      oldScenario !== null &&
      oldModel !== null &&
      newScenario !== null &&
      newModel !== null &&
      isEditScenario(oldScenario) &&
      isEditScenario(newScenario)
    ) {
      setRouter((r) => connectModel(disconnectModel(r, oldScenario, oldModel, oldKind), newScenario, newModel, newKind))
    }
  }, [])
  const onReconnectEnd = useCallback((_: unknown, edge: Edge) => {
    if (!edgeReconnectSuccessful.current) {
      const scenario = scenarioFromNodeId(edge.source)
      const modelKey = modelKeyFromNodeId(edge.target)
      if (scenario !== null && modelKey !== null && isEditScenario(scenario)) {
        setRouter((r) => disconnectModel(r, scenario, modelKey, kindFromEdge(edge)))
      }
    }
    edgeReconnectSuccessful.current = true
  }, [])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    setRouter((r) =>
      deleted.reduce((acc, edge) => {
        const scenario = scenarioFromNodeId(edge.source)
        const modelKey = modelKeyFromNodeId(edge.target)
        return scenario !== null && modelKey !== null && isEditScenario(scenario)
          ? disconnectModel(acc, scenario, modelKey, kindFromEdge(edge))
          : acc
      }, r)
    )
  }, [])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const scenario = scenarioFromNodeId(node.id)
    if (scenario !== null && isEditScenario(scenario)) {
      setSelected((cur) => (cur === scenario ? null : scenario))
    } else {
      setSelected(null)
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const { ok, message } = await onSave(router)
      showToast(
        message === undefined ? t(ok ? 'app.config_saved_success' : 'app.config_saved_failed') : message,
        ok ? 'success' : 'error'
      )
    } catch (err) {
      showToast(`${t('app.config_saved_failed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [router, onSave, showToast, t])

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {editable && (
        <div className='flex shrink-0 items-center justify-end gap-3 border-b px-3 py-1.5'>
          <Button type='button' size='sm' onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden='true' />}
            {t('app.save')}
          </Button>
        </div>
      )}
      <div className='relative min-h-0 flex-1'>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={editNodeTypes}
          onConnect={editable ? onConnect : undefined}
          onEdgeContextMenu={editable ? onEdgeContextMenu : undefined}
          onReconnect={editable ? onReconnect : undefined}
          onReconnectStart={editable ? onReconnectStart : undefined}
          onReconnectEnd={editable ? onReconnectEnd : undefined}
          onEdgesDelete={editable ? onEdgesDelete : undefined}
          onNodeClick={onNodeClick}
          colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
          nodesConnectable={editable}
          nodesDraggable={false}
          elementsSelectable
          deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
        </ReactFlow>
        {selected !== null && (
          <RoutingEditorPanel
            scenario={selected}
            router={router}
            onChange={setRouter}
            modelKeys={modelKeys}
            modelLabel={modelLabel}
            onClose={() => setSelected(null)}
            readOnly={!editable}
          />
        )}
      </div>
      <ConnectionChoiceDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null)
        }}
        scenarioLabel={pending === null ? '' : t(`router.${pending.scenario}`)}
        kindLabel={pending === null ? '' : t(pending.kind === 'agent' ? 'router.agentRoute' : 'router.subagentRoute')}
        modelLabel={pending === null ? '' : modelLabel(pending.modelKey)}
        // Fallback is a no-op when the target is already wired as the
        // primary or an existing fallback (connectModel dedups). Disable
        // the button in those cases so the dialog doesn't offer a
        // silently-inert action; Rule is still available.
        canFallback={((): boolean => {
          if (pending === null) return true
          const route = router[pending.scenario][pending.kind]
          if (route.primary === pending.modelKey) return false
          if (route.fallbacks.includes(pending.modelKey)) return false
          return true
        })()}
        onChoose={applyPending}
      />
    </div>
  )
}
