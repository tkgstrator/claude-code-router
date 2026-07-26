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
import { editNodeTypes, type ModelEditNodeType, type ScenarioEditNodeType } from '@/components/routing-map/edit-nodes'
import { RoutingEditorPanel } from '@/components/routing-map/RoutingEditorPanel'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEnabledModelOptions } from '@/hooks/use-enabled-model-options'
import { api } from '@/lib/api'
import { connectModel, disconnectModel, setPersona } from '@/lib/routing-map/edit-actions'
import {
  buildEditGraph,
  EDIT_SCENARIOS,
  type EditScenario,
  modelKeyFromNodeId,
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

const strokeFor = (kind: 'primary' | 'fallback'): string =>
  kind === 'primary' ? 'var(--primary)' : 'var(--muted-foreground)'

// amber-500 — highlights a forced scenario's primary edge (the slot
// overrides the client's bare model instead of honoring the request).
const AMBER = '#f59e0b'

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
        const route = router[s]
        return n + (route.primary === key || route.fallbacks.includes(key) ? 1 : 0)
      }, 0),
    [router]
  )

  const nodes = useMemo<AppEditNode[]>(() => {
    const scenarioNodes: AppEditNode[] = graph.scenarioNodes.map((node) => {
      const route = router[node.scenario]
      return {
        id: node.id,
        type: 'scenarioEdit',
        position: node.position,
        data: {
          label: t(`router.${node.scenario}`),
          primaryLabel: route.primary === null ? '' : modelLabel(route.primary),
          emptyLabel: t('routingMap.editNoPrimary'),
          fallbackCount: route.fallbacks.length,
          fallbackLabel: t('routingMap.editFallbacks'),
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

  const deleteEdge = useCallback((scenario: EditScenario, modelKey: string) => {
    setRouter((r) => disconnectModel(r, scenario, modelKey))
  }, [])

  // Right-click an edge to delete it (alongside the Delete key and the
  // reconnect-to-empty gesture).
  const onEdgeContextMenu = useCallback(
    (event: MouseEvent, edge: Edge) => {
      event.preventDefault()
      const scenario = scenarioFromNodeId(edge.source)
      const modelKey = modelKeyFromNodeId(edge.target)
      if (scenario !== null && modelKey !== null && isEditScenario(scenario)) {
        deleteEdge(scenario, modelKey)
      }
    },
    [deleteEdge]
  )

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        // A forced scenario's primary edge is amber — it overrides the
        // client's model, so the wiring is stronger than a normal primary.
        const forced = edge.kind === 'primary' && router[edge.scenario].force
        const color = forced ? AMBER : strokeFor(edge.kind)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.kind === 'fallback' ? String(edge.order) : undefined,
          labelShowBg: edge.kind === 'fallback',
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          labelStyle: { fill: 'var(--foreground)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--background)', opacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 11, height: 11 },
          style: {
            stroke: color,
            strokeWidth: edge.kind === 'primary' ? 2 : 1.25,
            strokeDasharray: edge.kind === 'fallback' ? '6 4' : undefined
          }
        }
      }),
    [graph, router]
  )

  const onConnect = useCallback((c: Connection) => {
    const scenario = scenarioFromNodeId(c.source)
    const modelKey = modelKeyFromNodeId(c.target)
    if (scenario !== null && modelKey !== null && isEditScenario(scenario)) {
      setRouter((r) => connectModel(r, scenario, modelKey))
    }
  }, [])

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
    const newScenario = scenarioFromNodeId(newConnection.source)
    const newModel = modelKeyFromNodeId(newConnection.target)
    if (
      oldScenario !== null &&
      oldModel !== null &&
      newScenario !== null &&
      newModel !== null &&
      isEditScenario(oldScenario) &&
      isEditScenario(newScenario)
    ) {
      setRouter((r) => connectModel(disconnectModel(r, oldScenario, oldModel), newScenario, newModel))
    }
  }, [])
  const onReconnectEnd = useCallback((_: unknown, edge: Edge) => {
    if (!edgeReconnectSuccessful.current) {
      const scenario = scenarioFromNodeId(edge.source)
      const modelKey = modelKeyFromNodeId(edge.target)
      if (scenario !== null && modelKey !== null && isEditScenario(scenario)) {
        setRouter((r) => disconnectModel(r, scenario, modelKey))
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
          ? disconnectModel(acc, scenario, modelKey)
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
        <div className='flex shrink-0 items-center justify-between gap-3 border-b bg-card/50 px-3 py-1.5'>
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
          onNodeClick={editable ? onNodeClick : undefined}
          colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
          nodesConnectable={editable}
          nodesDraggable={false}
          elementsSelectable={editable}
          deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
        </ReactFlow>
        {editable && selected !== null && (
          <RoutingEditorPanel
            scenario={selected}
            router={router}
            onChange={setRouter}
            modelLabel={modelLabel}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}
