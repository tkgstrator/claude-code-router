/**
 * Custom React Flow nodes for the EDITABLE routing graph:
 *   scenario lane (left) → target model (right).
 * Unlike the read-only nodes (nodes.tsx), the handles here are
 * connectable. A scenario node exposes TWO source handles on its right
 * edge — an `agent` route (top) and a `subagent` route (bottom) — so
 * dragging from either wires the model into THAT route (primary, then
 * fallbacks). All presentational — every label is translated by the page
 * and passed in via node data.
 */

import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'

// Canvas nodes keep a 1px border and modest rounding for legibility, but
// no shadow — selection is expressed via border color instead of a ring.
const nodeCardClass = 'rounded-md border bg-background px-3 py-2 transition-colors'

// Handle colors mirror the edge stroke: agent rides --primary, subagent
// rides --muted-foreground, so the two exits read the same on node and edge.
const AGENT_COLOR = 'var(--primary)'
const SUBAGENT_COLOR = 'var(--muted-foreground)'

export interface ScenarioEditNodeData extends Record<string, unknown> {
  label: string
  // Scenario-scoped knob shown as a small caption under the label. Currently
  // used to surface the longContext token threshold ("≥ 128k tok") so the
  // node communicates *when* the lane fires without opening the side panel.
  // Undefined for scenarios without a knob (background/think/webSearch/image).
  note?: string
  // Agent route summary: primary model label ('' when unset) + fallback count.
  agentPrimaryLabel: string
  agentFallbackCount: number
  // Number of predicated rules on the agent route. Rendered as a compact
  // "N rules" chip so the node signals rule presence at a glance.
  agentRuleCount: number
  // Subagent route summary: primary model label ('' when unset) + fallback count.
  subagentPrimaryLabel: string
  subagentFallbackCount: number
  subagentRuleCount: number
  // Localized "no primary" placeholder shown when a primary label is empty.
  emptyLabel: string
  // Localized "fallback(s)" suffix for the +n counters.
  fallbackLabel: string
  // Localized "rule(s)" suffix for the rule count chip.
  ruleLabel: string
  // Localized route names, used as the handle aria-labels.
  agentRouteLabel: string
  subagentRouteLabel: string
  selected: boolean
}

export interface ModelEditNodeData extends Record<string, unknown> {
  provider: string
  model: string
  // Number of scenarios wiring this model (in either route, primary or fallback).
  usedBy: number
}

export type ScenarioEditNodeType = Node<ScenarioEditNodeData, 'scenarioEdit'>
export type ModelEditNodeType = Node<ModelEditNodeData, 'modelEdit'>

// One compact route summary row: a chip marker (A / S), the primary model
// label (or the localized empty placeholder), a +n fallback counter, and
// a rule count chip when the route carries any predicated rules.
function RouteSummary({
  chip,
  chipClass,
  primaryLabel,
  emptyLabel,
  fallbackCount,
  fallbackLabel,
  ruleCount,
  ruleLabel
}: {
  chip: string
  chipClass: string
  primaryLabel: string
  emptyLabel: string
  fallbackCount: number
  fallbackLabel: string
  ruleCount: number
  ruleLabel: string
}) {
  return (
    <div className='flex items-center gap-1.5'>
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-semibold leading-none',
          chipClass
        )}
      >
        {chip}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[11px]',
          primaryLabel === '' ? 'text-muted-foreground italic' : 'font-mono'
        )}
      >
        {primaryLabel === '' ? emptyLabel : primaryLabel}
      </span>
      {ruleCount > 0 && (
        <span className='shrink-0 rounded bg-accent px-1 text-[10px] tabular-nums text-accent-foreground'>
          {ruleCount} {ruleLabel}
        </span>
      )}
      {fallbackCount > 0 && (
        <span className='shrink-0 text-[10px] tabular-nums text-muted-foreground'>
          +{fallbackCount} {fallbackLabel}
        </span>
      )}
    </div>
  )
}

function ScenarioEditNode({ data }: NodeProps<ScenarioEditNodeType>) {
  return (
    <div className={cn(nodeCardClass, 'min-w-[210px] space-y-1', data.selected && 'border-2 border-primary')}>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='text-sm font-medium leading-tight'>{data.label}</span>
        {data.note !== undefined && (
          <span className='shrink-0 text-[10px] tabular-nums text-muted-foreground'>{data.note}</span>
        )}
      </div>
      <RouteSummary
        chip='A'
        chipClass='bg-primary text-primary-foreground'
        primaryLabel={data.agentPrimaryLabel}
        emptyLabel={data.emptyLabel}
        fallbackCount={data.agentFallbackCount}
        fallbackLabel={data.fallbackLabel}
        ruleCount={data.agentRuleCount}
        ruleLabel={data.ruleLabel}
      />
      <RouteSummary
        chip='S'
        chipClass='border border-muted-foreground/50 text-muted-foreground'
        primaryLabel={data.subagentPrimaryLabel}
        emptyLabel={data.emptyLabel}
        fallbackCount={data.subagentFallbackCount}
        fallbackLabel={data.fallbackLabel}
        ruleCount={data.subagentRuleCount}
        ruleLabel={data.ruleLabel}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='agent'
        aria-label={data.agentRouteLabel}
        title={data.agentRouteLabel}
        style={{ top: '35%', background: AGENT_COLOR }}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='subagent'
        aria-label={data.subagentRouteLabel}
        title={data.subagentRouteLabel}
        style={{ top: '65%', background: SUBAGENT_COLOR }}
      />
    </div>
  )
}

function ModelEditNode({ data }: NodeProps<ModelEditNodeType>) {
  return (
    <div className={cn(nodeCardClass, 'max-w-[320px] min-w-[190px] space-y-0.5', data.usedBy === 0 && 'opacity-60')}>
      <Handle type='target' position={Position.Left} />
      <div className='truncate font-mono text-xs font-medium'>{data.model}</div>
      <div className='truncate text-[11px] text-muted-foreground'>{data.provider}</div>
    </div>
  )
}

// Stable node-type map — defined at module scope so React Flow doesn't
// warn about a new object identity on every render.
export const editNodeTypes = { scenarioEdit: ScenarioEditNode, modelEdit: ModelEditNode }
