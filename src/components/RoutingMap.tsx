/**
 * Routing Map page — a read-only React Flow view of the scenario → model
 * routing: scenario lanes (left) → target models (right). Edges overlay the
 * Router *config* (each lane's primary + fallback chain) with observed
 * *traffic* (which model actually answered and its share).
 *
 * The requested model is picked from a selector in the header (not a graph
 * node): choosing one filters the whole flow — lanes and percentages — to
 * that model's traffic, so the flow stays large and readable. "All" shows
 * every request combined.
 *
 * Purely presentational — routing is edited on the Router page. Clicking a
 * scenario / model node highlights its connections.
 */

import '@xyflow/react/dist/style.css'
import { Background, type Edge, MarkerType, MiniMap, type Node, Panel, ReactFlow, useNodesState } from '@xyflow/react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { type ModelNodeType, nodeTypes, type ScenarioNodeType } from '@/components/routing-map/nodes'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api, type ModelRoutingResponse } from '@/lib/api'
import {
  buildRoutingGraph,
  type RoutingGraph,
  type RoutingGraphEdge,
  SCENARIOS,
  UNTRACKED
} from '@/lib/routing-map/build-graph'
import { useConfig } from './ConfigProvider'

type AppNode = ScenarioNodeType | ModelNodeType

// amber-500 — matches the "rerouted" accent used on the Usage page.
const AMBER = '#f59e0b'
// Radix Select needs a non-empty value; this maps to "no filter".
const ALL_REQUESTS = '__all__'

const RANGES = [
  { key: 'range24h', hours: 24 },
  { key: 'range7d', hours: 168 },
  { key: 'rangeAll', hours: 0 }
] as const

const knownScenarios = new Set<string>(SCENARIOS)

const EMPTY_GRAPH: RoutingGraph = {
  requestedNodes: [],
  scenarioNodes: [],
  modelNodes: [],
  requestedEdges: [],
  edges: []
}

// Stroke colour by edge kind: rerouted (amber) > has-traffic (primary) >
// configured-but-idle (muted) > fallback-only (border).
function edgeStroke(edge: RoutingGraphEdge): string {
  if (edge.rerouted) return AMBER
  if (edge.count > 0) return 'var(--primary)'
  if (edge.isPrimary) return 'var(--muted-foreground)'
  return 'var(--border)'
}

// Traffic edges share one fixed width (the % is shown by the label, not the
// stroke); idle config / fallback edges get a thinner dashed stroke.
function edgeWidth(edge: RoutingGraphEdge): number {
  if (edge.count > 0) return 2
  return edge.isPrimary ? 1.25 : 1
}

function toFlowEdge(edge: RoutingGraphEdge, selectedId: string | null): Edge {
  const stroke = edgeStroke(edge)
  const dimmed = selectedId !== null && edge.source !== selectedId && edge.target !== selectedId
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.count > 0 ? `${edge.pct}%` : undefined,
    labelShowBg: true,
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    labelStyle: { fill: 'var(--foreground)', fontSize: 10 },
    labelBgStyle: { fill: 'var(--background)', opacity: 0.85 },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 11, height: 11 },
    style: {
      stroke,
      strokeWidth: edgeWidth(edge),
      strokeDasharray: edge.count > 0 ? undefined : '6 4',
      opacity: dimmed ? 0.1 : 1
    }
  }
}

export function RoutingMap() {
  const { config } = useConfig()
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()

  const [sinceHours, setSinceHours] = useState<number>(0)
  const [routing, setRouting] = useState<ModelRoutingResponse | null>(null)
  const [showFallbacks, setShowFallbacks] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The requested model the flow is filtered to (null = all requests).
  const [focusRequested, setFocusRequested] = useState<string | null>(null)

  const loadRouting = useCallback(() => {
    api
      .getModelRouting({ sinceHours })
      .then(setRouting)
      .catch(() => setRouting({ rows: [], total: 0 }))
  }, [sinceHours])

  useEffect(() => {
    loadRouting()
  }, [loadRouting])

  const scenarioLabel = useCallback(
    (scenario: string): string => {
      if (scenario === UNTRACKED) return t('usage.routingUntracked')
      return knownScenarios.has(scenario) ? t(`router.${scenario}`) : scenario
    },
    [t]
  )
  const requestedLabel = useCallback(
    (requested: string): string => (requested === UNTRACKED ? t('usage.routingUntracked') : requested),
    [t]
  )

  const graph = useMemo<RoutingGraph>(() => {
    const traffic = routing === null ? { rows: [], total: 0 } : routing
    if (!config) return EMPTY_GRAPH
    return buildRoutingGraph(config.Router, traffic, focusRequested)
  }, [config, routing, focusRequested])

  // Seed React Flow nodes from the graph (and re-seed when labels change).
  // The map is read-only (nodes aren't draggable); onNodesChange is kept only
  // so React Flow can record measured node dimensions for edge routing.
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const requestsLabel = t('routingMap.requests')
  const primaryBadge = t('routingMap.primaryBadge')

  useEffect(() => {
    const scenarioNodes: AppNode[] = graph.scenarioNodes.map((node) => ({
      id: node.id,
      type: 'scenario',
      position: node.position,
      data: { label: scenarioLabel(node.scenario), requests: node.requests, requestsLabel, dimmed: false }
    }))
    const modelNodes: AppNode[] = graph.modelNodes.map((node) => ({
      id: node.id,
      type: 'model',
      position: node.position,
      data: {
        provider: node.provider,
        model: node.model,
        requests: node.requests,
        requestsLabel,
        primaryForLabel: node.primaryFor.length > 0 ? primaryBadge : '',
        dimmed: false
      }
    }))
    setNodes([...scenarioNodes, ...modelNodes])
  }, [graph, scenarioLabel, requestsLabel, primaryBadge, setNodes])

  // Styled edges + the set of nodes connected to the clicked node (one hop).
  const { edges, activeNodeIds } = useMemo(() => {
    const visible = graph.edges.filter((edge) => edge.count > 0 || edge.isPrimary || (edge.isFallback && showFallbacks))
    const active = new Set<string>()
    if (selectedId !== null) {
      active.add(selectedId)
      for (const edge of visible) {
        if (edge.source === selectedId) active.add(edge.target)
        if (edge.target === selectedId) active.add(edge.source)
      }
    }
    return { edges: visible.map((edge) => toFlowEdge(edge, selectedId)), activeNodeIds: active }
  }, [graph.edges, selectedId, showFallbacks])

  // Inject selection dimming without disturbing dragged positions. The
  // per-type branches keep the discriminated node union intact (spreading a
  // union node would collapse `data` and lose the type↔data correlation).
  const displayNodes = useMemo<AppNode[]>(() => {
    return nodes.map((node): AppNode => {
      const dimmed = selectedId !== null && !activeNodeIds.has(node.id)
      if (node.type === 'scenario') return { ...node, data: { ...node.data, dimmed } }
      if (node.type === 'model') return { ...node, data: { ...node.data, dimmed } }
      return node
    })
  }, [nodes, selectedId, activeNodeIds])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedId((current) => (current === node.id ? null : node.id))
  }, [])
  const onPaneClick = useCallback(() => setSelectedId(null), [])

  const onRequestedChange = useCallback((value: string) => {
    setSelectedId(null)
    setFocusRequested(value === ALL_REQUESTS ? null : value)
  }, [])

  const isEmpty = graph.modelNodes.length === 0 && graph.requestedNodes.length === 0
  // Initial fetch in flight — refresh keeps the previous data on screen.
  const isLoading = routing === null

  return (
    <PageContainer>
      <PageHeader
        title={t('routingMap.title')}
        extra={
          <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
            <div className='flex items-center gap-2'>
              <label htmlFor='routing-requested' className='shrink-0 text-xs font-medium text-muted-foreground'>
                {t('routingMap.requested')}
              </label>
              <Select value={focusRequested === null ? ALL_REQUESTS : focusRequested} onValueChange={onRequestedChange}>
                <SelectTrigger id='routing-requested' size='sm' className='w-[210px] text-xs'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_REQUESTS}>{t('routingMap.allRequests')}</SelectItem>
                  {graph.requestedNodes.map((node) => (
                    <SelectItem key={node.id} value={node.requestedModel} className='font-mono text-xs'>
                      {requestedLabel(node.requestedModel)} ({node.requests.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Semantic group for the range toggle; preflight strips fieldset chrome. */}
            <fieldset
              aria-label={t('routingMap.rangeLabel')}
              className='flex h-8 items-center gap-0.5 rounded-md border p-0.5'
            >
              {RANGES.map((range) => (
                <Button
                  key={range.key}
                  type='button'
                  size='sm'
                  variant={sinceHours === range.hours ? 'default' : 'ghost'}
                  aria-pressed={sinceHours === range.hours}
                  className='h-full px-2.5 text-xs'
                  onClick={() => setSinceHours(range.hours)}
                >
                  {t(`routingMap.${range.key}`)}
                </Button>
              ))}
            </fieldset>
            <label htmlFor='routing-fallbacks' className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Switch id='routing-fallbacks' checked={showFallbacks} onCheckedChange={setShowFallbacks} />
              {t('routingMap.showFallbacks')}
            </label>
          </div>
        }
      >
        <Button type='button' size='sm' variant='outline' onClick={loadRouting}>
          <RefreshCw className='h-3.5 w-3.5' aria-hidden='true' />
          {t('routingMap.refresh')}
        </Button>
      </PageHeader>

      <div className='relative min-h-0 flex-1'>
        {isLoading ? (
          <div role='status' className='flex h-full flex-col items-center justify-center gap-3 text-muted-foreground'>
            <Loader2 className='h-5 w-5 animate-spin' aria-hidden='true' />
            <span className='text-sm'>{t('routingMap.loading')}</span>
          </div>
        ) : isEmpty ? (
          <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
            {t('routingMap.empty')}
          </div>
        ) : (
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <MiniMap pannable zoomable nodeStrokeWidth={2} />
            <Panel position='top-left'>
              <Legend />
            </Panel>
          </ReactFlow>
        )}
      </div>
    </PageContainer>
  )
}

function Legend() {
  const { t } = useTranslation()
  const items = [
    { color: 'var(--primary)', dashed: false, label: t('routingMap.legendHonored') },
    { color: AMBER, dashed: false, label: t('routingMap.legendRerouted') },
    { color: 'var(--muted-foreground)', dashed: true, label: t('routingMap.legendConfigured') },
    { color: 'var(--border)', dashed: true, label: t('routingMap.legendFallback') }
  ]
  return (
    <ul className='space-y-1.5 rounded-md border bg-card/90 px-3 py-2 text-[11px] shadow-sm backdrop-blur'>
      {items.map((item) => (
        <li key={item.label} className='flex items-center gap-2 leading-none'>
          <span
            aria-hidden='true'
            className='inline-block h-0 w-6 shrink-0'
            style={{
              borderTopWidth: 2,
              borderTopStyle: item.dashed ? 'dashed' : 'solid',
              borderTopColor: item.color
            }}
          />
          <span className='text-muted-foreground'>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}
