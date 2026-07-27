/**
 * Custom React Flow nodes for the Routing Map flow:
 *   scenario lane (left) → target model (right).
 * The requested model is chosen from a selector outside the graph (it filters
 * the flow), so it is not a node here. All presentational — every label is
 * translated by the page and passed in via node data.
 */

import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const hiddenHandle = { opacity: 0 } as const

// Shared flat chrome for both node types so they stay visually in sync.
// Canvas nodes keep a 1px border and modest rounding for legibility, but
// no shadow — the graph stays flat like the rest of the UI.
const nodeCardClass = 'rounded-md border bg-background px-3 py-2 transition-opacity'

export interface ScenarioNodeData extends Record<string, unknown> {
  label: string
  requests: number
  requestsLabel: string
  dimmed: boolean
}

export interface ModelNodeData extends Record<string, unknown> {
  provider: string
  model: string
  requests: number
  requestsLabel: string
  // Non-empty when this model is a configured primary for one or more lanes.
  primaryForLabel: string
  dimmed: boolean
}

export type ScenarioNodeType = Node<ScenarioNodeData, 'scenario'>
export type ModelNodeType = Node<ModelNodeData, 'model'>

function ScenarioNode({ data }: NodeProps<ScenarioNodeType>) {
  return (
    <div className={cn(nodeCardClass, 'min-w-[150px] space-y-0.5', data.dimmed && 'opacity-25')}>
      <div className='text-sm font-medium leading-tight'>{data.label}</div>
      <div className='text-[11px] tabular-nums text-muted-foreground'>
        {data.requests.toLocaleString()} {data.requestsLabel}
      </div>
      <Handle type='source' position={Position.Right} isConnectable={false} style={hiddenHandle} />
    </div>
  )
}

function ModelNode({ data }: NodeProps<ModelNodeType>) {
  return (
    <div className={cn(nodeCardClass, 'max-w-[320px] min-w-[200px] space-y-0.5', data.dimmed && 'opacity-25')}>
      <Handle type='target' position={Position.Left} isConnectable={false} style={hiddenHandle} />
      <div className='flex items-center gap-2'>
        {/* min-w-0 lets the flex child shrink so long model names truncate
            instead of pushing the badge outside the card. */}
        <span className='min-w-0 truncate font-mono text-xs font-medium'>{data.model}</span>
        {data.primaryForLabel.length > 0 && (
          <Badge variant='secondary' className='shrink-0 text-[10px]'>
            {data.primaryForLabel}
          </Badge>
        )}
      </div>
      <div className='truncate text-[11px] text-muted-foreground'>{data.provider}</div>
      <div className='text-[11px] tabular-nums text-muted-foreground'>
        {data.requests.toLocaleString()} {data.requestsLabel}
      </div>
    </div>
  )
}

// Stable node-type map — defined at module scope so React Flow doesn't warn
// about a new object identity on every render.
export const nodeTypes = { scenario: ScenarioNode, model: ModelNode }
