/**
 * The editor pane for one rule.
 *
 * Rules are ordered and first-match-wins, so the list stays on screen
 * beside this — a modal would hide the very ordering the operator is
 * reasoning about.
 */
import { useState } from 'react'
import { Pill, RButton, SurfaceChip } from '@/components/rialto/primitives'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { InboundSurfaceWire } from '@/lib/api'
import type { RouteRule } from '@/schemas'
import { PredicateEditor } from './PredicateEditor'
import { RuleTester } from './RuleTester'
import type { ScopedRule } from './rules'
import type { EnabledTarget } from './types'

const HEADING = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground'
const PICKER =
  'inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted/60'

function ActionPicker({ routes, onChange }: { routes: boolean; onChange: (routes: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const choose = (next: boolean) => () => {
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type='button' className={`${PICKER} min-w-44`}>
          <span>{routes ? 'Route to model' : 'Leave caller model'}</span>
          <i className='ri-arrow-down-s-line ml-auto text-sm text-muted-foreground' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-52 p-1'>
        <button
          type='button'
          className='block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60'
          onClick={choose(true)}
        >
          Route to model
        </button>
        <button
          type='button'
          className='block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60'
          onClick={choose(false)}
        >
          Leave caller model
        </button>
      </PopoverContent>
    </Popover>
  )
}

function TargetPicker({
  target,
  targets,
  onChange
}: {
  target: string
  targets: readonly EnabledTarget[]
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type='button' className={`${PICKER} flex-1`}>
          <span className='truncate font-mono'>{target === '' ? 'pick a model' : target}</span>
          <i className='ri-arrow-down-s-line ml-auto text-sm text-muted-foreground' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='max-h-72 w-80 overflow-y-auto p-1'>
        {targets.map((option) => (
          <button
            key={option.target}
            type='button'
            onClick={() => {
              onChange(option.target)
              setOpen(false)
            }}
            className='block w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs transition-colors hover:bg-muted/60'
          >
            {option.target}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function RuleDetail({
  scoped,
  laneRules,
  surfaces,
  targets,
  onChange,
  onDuplicate,
  onDelete
}: {
  scoped: ScopedRule
  laneRules: readonly RouteRule[]
  surfaces: readonly InboundSurfaceWire[]
  targets: readonly EnabledTarget[]
  onChange: (next: RouteRule) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const rule = scoped.rule
  const routes = rule.target !== null && rule.target.length > 0

  return (
    <div className='min-w-0 overflow-y-auto'>
      <div className='flex items-center gap-3 border-b border-border px-6 py-3'>
        <input
          className='flex h-8 max-w-xs flex-1 items-center rounded-md border border-border bg-transparent px-3 text-xs font-medium outline-none'
          value={rule.name === undefined ? '' : rule.name}
          placeholder={`Rule ${scoped.index + 1}`}
          aria-label='Rule name'
          onChange={(event) => onChange({ ...rule, name: event.target.value === '' ? undefined : event.target.value })}
        />
        <Pill tone='info'>{`${scoped.scenario} · ${scoped.lane}`}</Pill>
        <div className='ml-auto flex items-center gap-2'>
          <RButton variant='ghost' icon='ri-file-copy-line' onClick={onDuplicate}>
            Duplicate
          </RButton>
          <RButton variant='ghost' icon='ri-delete-bin-line' onClick={onDelete}>
            Delete
          </RButton>
        </div>
      </div>

      <div className='px-6 pt-5 pb-2'>
        <h3 className={HEADING}>When</h3>
      </div>
      <PredicateEditor when={rule.when} onChange={(when) => onChange({ ...rule, when })} />

      <div className='px-6 pt-6 pb-2'>
        <h3 className={HEADING}>Then</h3>
      </div>
      <div className='space-y-2 px-6'>
        <div className='flex items-center gap-2'>
          <ActionPicker routes={routes} onChange={(next) => onChange({ ...rule, target: next ? '' : null })} />
          {routes || rule.target === '' ? (
            <TargetPicker
              target={rule.target === null ? '' : rule.target}
              targets={targets}
              onChange={(next) => onChange({ ...rule, target: next })}
            />
          ) : (
            <div className='flex h-8 flex-1 items-center rounded-md border border-dashed border-border px-3 text-[11px] text-muted-foreground'>
              matched requests go out with the model the caller sent
            </div>
          )}
        </div>
      </div>

      <div className='px-6 pt-6 pb-2'>
        <h3 className={HEADING}>Applies to</h3>
      </div>
      <div className='flex flex-wrap gap-2 px-6'>
        {surfaces.map((surface) => (
          <SurfaceChip key={surface.id} path={surface.path} on={surface.routingMode === 'routed'} />
        ))}
        <span className='self-center text-[11px] text-muted-foreground'>only endpoints in routed mode can match</span>
      </div>

      <RuleTester rules={laneRules} />
      <div className='h-8' />
    </div>
  )
}
