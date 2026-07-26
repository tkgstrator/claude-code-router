/**
 * Custom React Flow nodes for the EDITABLE routing graph:
 *   scenario lane (left) → target model (right).
 * Unlike the read-only nodes (nodes.tsx), the handles here are
 * connectable: dragging from a scenario's right handle to a model's left
 * handle wires that model into the scenario (primary, then fallbacks).
 * All presentational — every label is translated by the page and passed
 * in via node data.
 */

import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'

// Canvas nodes keep a 1px border and modest rounding for legibility, but
// no shadow — selection is expressed via border color instead of a ring.
const nodeCardClass = 'rounded-md border bg-background px-3 py-2 transition-colors'

export interface ScenarioEditNodeData extends Record<string, unknown> {
  label: string
  // The primary model label, or an empty string when the slot is unset.
  primaryLabel: string
  // Localized "no primary" placeholder shown when primaryLabel is empty.
  emptyLabel: string
  fallbackCount: number
  fallbackLabel: string
  selected: boolean
}

export interface ModelEditNodeData extends Record<string, unknown> {
  provider: string
  model: string
  // Number of scenarios wiring this model (primary or fallback).
  usedBy: number
}

export type ScenarioEditNodeType = Node<ScenarioEditNodeData, 'scenarioEdit'>
export type ModelEditNodeType = Node<ModelEditNodeData, 'modelEdit'>

function ScenarioEditNode({ data }: NodeProps<ScenarioEditNodeType>) {
  return (
    <div className={cn(nodeCardClass, 'min-w-[170px] space-y-1', data.selected && 'border-2 border-primary')}>
      <div className='text-sm font-medium leading-tight'>{data.label}</div>
      <div
        className={cn('truncate text-[11px]', data.primaryLabel === '' ? 'text-muted-foreground italic' : 'font-mono')}
      >
        {data.primaryLabel === '' ? data.emptyLabel : data.primaryLabel}
      </div>
      {data.fallbackCount > 0 && (
        <div className='text-[11px] tabular-nums text-muted-foreground'>
          +{data.fallbackCount} {data.fallbackLabel}
        </div>
      )}
      <Handle type='source' position={Position.Right} />
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
