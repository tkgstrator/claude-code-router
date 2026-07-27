/**
 * Side panel for the routing editor. Opens when a scenario node is clicked
 * and edits BOTH of that scenario's routes — Agent and Subagent — with
 * explicit controls: clearing the primary, removing / reordering fallbacks —
 * plus the scenario-scoped knobs (longContext threshold, default margin).
 * This is the clear alternative to fiddly edge-selection deletes: every
 * mutation goes through the pure, kind-aware edit-actions helpers.
 */

import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  disconnectModel,
  moveFallback,
  setLongContextThreshold,
  setWeeklyDrainMarginPct
} from '@/lib/routing-map/edit-actions'
import type { EditScenario, RouteKind } from '@/lib/routing-map/edit-graph'
import type { RouterConfig } from '@/schemas'

interface RoutingEditorPanelProps {
  scenario: EditScenario
  router: RouterConfig
  onChange: (next: RouterConfig) => void
  modelLabel: (key: string) => string
  onClose: () => void
}

// One route (agent or subagent): its primary (with remove) plus the ordered
// fallback chain (reorder up/down, remove). All mutations are kind-scoped.
function RouteSection({
  title,
  scenario,
  kind,
  router,
  onChange,
  modelLabel
}: {
  title: string
  scenario: EditScenario
  kind: RouteKind
  router: RouterConfig
  onChange: (next: RouterConfig) => void
  modelLabel: (key: string) => string
}) {
  const { t } = useTranslation()
  const route = router[scenario][kind]
  const primary = route.primary

  return (
    <div className='space-y-2 rounded-md border p-2'>
      <div className='text-xs font-semibold'>{title}</div>

      <div className='space-y-1'>
        <div className='text-xs text-muted-foreground'>{t('routingMap.editPrimary')}</div>
        {primary === null ? (
          <div className='text-xs text-muted-foreground italic'>{t('routingMap.editNoPrimary')}</div>
        ) : (
          <div className='flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate font-mono text-xs'>{modelLabel(primary)}</span>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='h-6 w-6 shrink-0'
              aria-label={`${title}: ${t('app.remove')} ${modelLabel(primary)}`}
              onClick={() => onChange(disconnectModel(router, scenario, primary, kind))}
            >
              <X className='h-3.5 w-3.5' aria-hidden='true' />
            </Button>
          </div>
        )}
      </div>

      <div className='space-y-1'>
        <div className='text-xs text-muted-foreground'>{t('router.fallbacks')}</div>
        {route.fallbacks.length === 0 ? (
          <div className='text-xs text-muted-foreground italic'>—</div>
        ) : (
          <ul className='space-y-1'>
            {route.fallbacks.map((fallback, index) => (
              <li key={fallback} className='flex items-center gap-1'>
                <span className='w-4 text-[11px] text-muted-foreground tabular-nums'>{index + 1}</span>
                <span className='min-w-0 flex-1 truncate font-mono text-xs'>{modelLabel(fallback)}</span>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-6 w-6'
                  disabled={index === 0}
                  aria-label={`${title}: ${modelLabel(fallback)} ↑`}
                  onClick={() => onChange(moveFallback(router, scenario, index, index - 1, kind))}
                >
                  <ArrowUp className='h-3.5 w-3.5' aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-6 w-6'
                  disabled={index === route.fallbacks.length - 1}
                  aria-label={`${title}: ${modelLabel(fallback)} ↓`}
                  onClick={() => onChange(moveFallback(router, scenario, index, index + 1, kind))}
                >
                  <ArrowDown className='h-3.5 w-3.5' aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-6 w-6'
                  aria-label={`${title}: ${t('app.remove')} ${modelLabel(fallback)}`}
                  onClick={() => onChange(disconnectModel(router, scenario, fallback, kind))}
                >
                  <X className='h-3.5 w-3.5' aria-hidden='true' />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function RoutingEditorPanel({ scenario, router, onChange, modelLabel, onClose }: RoutingEditorPanelProps) {
  const { t } = useTranslation()

  return (
    <div className='absolute inset-y-0 right-0 w-72 space-y-3 overflow-y-auto border-l bg-background p-3 text-sm'>
      <div className='flex items-center justify-between border-b pb-2'>
        <span className='font-medium'>{t(`router.${scenario}`)}</span>
        <Button type='button' size='icon' variant='ghost' className='h-6 w-6' onClick={onClose}>
          <X className='h-4 w-4' aria-hidden='true' />
        </Button>
      </div>

      <RouteSection
        title={t('router.agentRoute')}
        scenario={scenario}
        kind='agent'
        router={router}
        onChange={onChange}
        modelLabel={modelLabel}
      />
      <RouteSection
        title={t('router.subagentRoute')}
        scenario={scenario}
        kind='subagent'
        router={router}
        onChange={onChange}
        modelLabel={modelLabel}
      />

      {scenario === 'longContext' && (
        <div className='flex items-center justify-between gap-2'>
          <span className='text-xs text-muted-foreground'>{t('router.longContextThreshold')}</span>
          <Input
            type='number'
            aria-label={t('router.longContextThreshold')}
            className='h-7 w-24 text-xs'
            value={router.longContext.threshold}
            onChange={(e) => onChange(setLongContextThreshold(router, e.target.valueAsNumber))}
          />
        </div>
      )}

      {scenario === 'default' && (
        <div className='flex items-center justify-between gap-2'>
          <span className='text-xs text-muted-foreground'>{t('routingMap.editMargin')}</span>
          <Input
            type='number'
            aria-label={t('routingMap.editMargin')}
            className='h-7 w-24 text-xs'
            value={router.default.weeklyDrainMarginPct}
            onChange={(e) => onChange(setWeeklyDrainMarginPct(router, e.target.valueAsNumber))}
          />
        </div>
      )}
    </div>
  )
}
