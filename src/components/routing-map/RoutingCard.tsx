/**
 * Grid card for the Routing Library. One card per routing entity:
 * either the Live routing (RouterSlot) or a saved preset. The card is
 * the read-only overview — clicking it navigates to the corresponding
 * editor page. Preset cards carry inline actions (Apply / Rename /
 * Delete) via a popover triggered by a kebab button.
 *
 * Visual pattern: flat, no card background. A left-border accent picks
 * up hover / focus-visible, matching the Personas list and the rest of
 * the app (per the "no shadcn Card" convention).
 */

import { MoreHorizontal } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ScenarioSummaryRow } from '@/lib/routing-map/summary'

export interface RoutingCardAction {
  key: string
  label: string
  onClick: () => void
  destructive?: boolean
}

interface Props {
  title: string
  // Optional short caption under the title (e.g. persona name).
  caption?: string | null
  // Small pill on the right of the title (e.g. "適用中" for Live).
  badge?: ReactNode
  summary: ScenarioSummaryRow[]
  onOpen: () => void
  // Actions surfaced in the kebab popover. Live cards typically pass an
  // empty array — there's nothing to Apply or Delete on Live itself.
  actions: RoutingCardAction[]
}

export function RoutingCard({ title, caption, badge, summary, onOpen, actions }: Props) {
  const { t } = useTranslation()

  return (
    // biome-ignore lint/a11y/useSemanticElements: swapping to <button> is impossible — the kebab menu inside is itself a <button>, and buttons can't nest. role='button' + tabIndex + keydown gives the same a11y semantics as a <button> without violating that constraint.
    <div
      role='button'
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className='group flex cursor-pointer flex-col gap-3 border-l-2 border-transparent px-3 py-3 transition-colors hover:border-primary hover:bg-muted/50 focus-visible:border-primary focus-visible:outline-none'
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 flex-1 space-y-0.5'>
          <div className='flex items-center gap-2'>
            <p className='truncate text-sm font-semibold text-foreground group-hover:underline'>{title}</p>
            {badge}
          </div>
          {caption !== null && caption !== undefined && caption !== '' && (
            <p className='truncate text-xs text-muted-foreground'>{caption}</p>
          )}
        </div>
        {actions.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                aria-label={t('router.presetActions')}
                onClick={(e: MouseEvent) => e.stopPropagation()}
                className='h-7 w-7 shrink-0 p-0'
              >
                <MoreHorizontal className='h-4 w-4' aria-hidden='true' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-48 p-1' align='end' onClick={(e: MouseEvent) => e.stopPropagation()}>
              <div className='flex flex-col'>
                {actions.map((a) => (
                  <button
                    key={a.key}
                    type='button'
                    onClick={a.onClick}
                    className={`rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                      a.destructive === true ? 'text-destructive' : ''
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <ul className='space-y-1 text-xs'>
        {summary.map((row) => (
          <ScenarioSummaryLine key={row.scenario} row={row} />
        ))}
      </ul>
    </div>
  )
}

function ScenarioSummaryLine({ row }: { row: ScenarioSummaryRow }) {
  const { t } = useTranslation()
  const label = t(`router.${row.scenario}`)
  return (
    <li className='flex items-baseline gap-2'>
      <span className='w-24 shrink-0 truncate text-muted-foreground'>{label}</span>
      <span className='min-w-0 flex-1 truncate font-mono text-foreground'>
        {row.agent === null ? <span className='text-muted-foreground'>—</span> : row.agent}
        {row.agentExtras > 0 && <span className='ml-1 text-muted-foreground'>+{row.agentExtras}</span>}
        {row.subagent !== null && row.subagent !== row.agent && (
          <span className='ml-2 text-muted-foreground'>
            {t('router.subagentRoute')}: {row.subagent}
            {row.subagentExtras > 0 && ` +${row.subagentExtras}`}
          </span>
        )}
      </span>
    </li>
  )
}

// Convenience Live badge — a small primary pill so it reads as active
// state, not just a label. Callers pass this into `badge`.
export function LiveBadge() {
  const { t } = useTranslation()
  return (
    <Badge variant='default' className='shrink-0 text-[10px]'>
      {t('router.liveBadge')}
    </Badge>
  )
}
