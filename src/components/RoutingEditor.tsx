/**
 * Routing Map graph — a two-tier config view (scenario lanes → model
 * nodes) whose edges ARE the Router config. When `editable` is false it is
 * read-only (just shows the wiring). When true it becomes interactive:
 * drag a scenario handle onto a model to wire it (primary, then
 * fallbacks), reconnect or delete edges (right-click / Delete key /
 * reconnect-to-empty), and a side panel + persona select + Save persist
 * the changes via api.updateConfig. No traffic overlay — the Routing Map
 * is purely for viewing and editing the routing config.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEnabledModelOptions } from '@/hooks/use-enabled-model-options'
import { api } from '@/lib/api'
import { modelNameOf } from '@/lib/router/fallback-slots'
import { addRule, connectModel, disconnectModel, emptyRule, setPersona } from '@/lib/routing-map/edit-actions'
import {
  buildEditGraph,
  EDIT_SCENARIOS,
  type EditScenario,
  modelKeyFromNodeId,
  type RouteKind,
  scenarioFromNodeId
} from '@/lib/routing-map/edit-graph'
import type { RouterConfig } from '@/schemas'
import type { Config } from '@/types'
import type { ShellOutletContext } from './AppShell'
import { useConfig } from './ConfigProvider'

type AppEditNode = ScenarioEditNodeType | ModelEditNodeType

const isEditScenario = (s: string): s is EditScenario => EDIT_SCENARIOS.some((x) => x === s)

// Radix Select needs a non-empty value; this sentinel maps to "no persona".
const PERSONA_NONE = '__none__'

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

// Human-friendly token count for the longContext threshold caption. Rounds
// to a whole `k` at 1000+ (so 128000 → "128k"), otherwise prints the raw
// number — matches how limits are conventionally quoted in this domain.
function formatTokenCount(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

// Scenario-scoped caption shown on the node under the label. Currently only
// longContext carries one — the token threshold the request must exceed to
// take this lane. Other scenarios have no meaningful summary at this scale.
function scenarioNote(scenario: EditScenario, router: RouterConfig): string | undefined {
  if (scenario === 'longContext') return `≥ ${formatTokenCount(router.longContext.threshold)} tok`
  return undefined
}

// Interpret the /api/config response: { success, message } when present,
// otherwise treat the write as succeeded (mirrors the Router form).
function readSaveResult(res: unknown): { ok: boolean; message: string | undefined } {
  if (typeof res !== 'object' || res === null) return { ok: true, message: undefined }
  const ok = 'success' in res ? res.success === true : true
  const message = 'message' in res && typeof res.message === 'string' ? res.message : undefined
  return { ok, message }
}

export function RoutingEditor({ config, editable }: { config: Config; editable: boolean }) {
  const { t } = useTranslation()
  const { setConfig } = useConfig()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const { resolvedTheme } = useTheme()
  const modelOptions = useEnabledModelOptions()

  const [router, setRouter] = useState<RouterConfig>(config.Router)
  // Pending connection: set when the user drags an edge onto a
  // scenario that already has a primary, so the dialog can ask
  // whether the drag should become a fallback or a new rule.
  const [pending, setPending] = useState<{ scenario: EditScenario; modelKey: string; kind: RouteKind } | null>(null)
  const [selected, setSelected] = useState<EditScenario | null>(null)
  const [saving, setSaving] = useState(false)

  const modelKeys = useMemo(() => modelOptions.map((o) => o.value), [modelOptions])
  const personaOptions = config.Personas.map((p) => ({ id: p.id === undefined ? '' : p.id, name: p.name }))
  const personaValue = router.persona === undefined || router.persona === '' ? PERSONA_NONE : router.persona
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

  // Right-click an edge to delete it (alongside the Delete key and the
  // reconnect-to-empty gesture). The edge's kind decides which route loses it.
  const onEdgeContextMenu = useCallback(
    (event: MouseEvent, edge: Edge) => {
      event.preventDefault()
      const scenario = scenarioFromNodeId(edge.source)
      const modelKey = modelKeyFromNodeId(edge.target)
      if (scenario !== null && modelKey !== null && isEditScenario(scenario)) {
        deleteEdge(scenario, modelKey, kindFromEdge(edge))
      }
    },
    [deleteEdge]
  )

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        const color = strokeColorFor(edge.origin, edge.role)
        // Fallback edges keep their chain-index label so the failover
        // order stays readable at a glance ("1" → tried first, "2" →
        // next, ...). Rule edges (primary + fallback) get no name
        // label — the blue color already signals "rule-owned", and
        // the rule body is edited in the side panel.
        const label: string | undefined = edge.role === 'fallback' ? String(edge.order) : undefined
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          // Pin the edge to its originating handle and stash the kind so
          // delete/reconnect can route the mutation to the right route.
          sourceHandle: edge.kind,
          data: { kind: edge.kind, origin: edge.origin },
          label,
          labelShowBg: label !== undefined,
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          labelStyle: { fill: 'var(--foreground)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--background)', opacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 11, height: 11 },
          // Rule-owned edges are managed via the side panel — the map
          // shows them for orientation only. Blocking delete /
          // reconnect / focus keeps a stray right-click from silently
          // orphaning a rule.
          deletable: edge.origin === 'catch-all',
          focusable: edge.origin === 'catch-all',
          reconnectable: edge.origin === 'catch-all',
          style: {
            stroke: color,
            strokeWidth: edge.role === 'primary' ? 2 : 1.25,
            strokeDasharray: strokeDashFor(edge.role, edge.kind)
          }
        }
      }),
    [graph]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const scenario = scenarioFromNodeId(c.source)
      const modelKey = modelKeyFromNodeId(c.target)
      const kind = kindFromHandle(c.sourceHandle)
      if (scenario === null || modelKey === null || !isEditScenario(scenario)) return
      // First drag on an empty route becomes the primary automatically.
      // Once the primary exists, ask the user whether this drag is a
      // fallback or a new predicated rule — the map has no other way to
      // tell those apart.
      const route = router[scenario][kind]
      if (route.primary === null || route.primary === modelKey) {
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
        // Seed the rule with the dragged model as its primary so the
        // panel opens showing the target the user meant; predicate
        // fields are left blank for them to fill in.
        setRouter((r) => addRule(r, scenario, kind, { ...emptyRule(), primary: modelKey }))
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

  const onSave = useCallback(async () => {
    setSaving(true)
    const updated = { ...config, Router: router }
    setConfig(updated)
    try {
      const { ok, message } = readSaveResult(await api.updateConfig(updated))
      showToast(message || t(ok ? 'app.config_saved_success' : 'app.config_saved_failed'), ok ? 'success' : 'error')
    } catch (err) {
      showToast(`${t('app.config_saved_failed')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [config, router, setConfig, showToast, t])

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {editable && (
        <div className='flex shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5'>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <span>{t('router.persona')}</span>
            <Select
              value={personaValue}
              onValueChange={(v) => setRouter(setPersona(router, v === PERSONA_NONE ? undefined : v))}
            >
              <SelectTrigger size='sm' aria-label={t('router.persona')} className='h-7 w-40 text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PERSONA_NONE}>{t('router.personaNone')}</SelectItem>
                {personaOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type='button' size='sm' onClick={onSave} disabled={saving}>
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
        modelLabel={pending === null ? '' : modelLabel(pending.modelKey)}
        onChoose={applyPending}
      />
    </div>
  )
}
