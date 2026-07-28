/**
 * Side panel for the routing editor. Opens when a scenario node is clicked
 * and edits BOTH of that scenario's routes — Agent and Subagent — with
 * explicit controls: clearing the primary, removing / reordering fallbacks —
 * plus the longContext threshold. This is the clear alternative to fiddly
 * edge-selection deletes: every mutation goes through the pure, kind-aware
 * edit-actions helpers.
 */

import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { connectModel, disconnectModel, moveFallback, setLongContextThreshold } from '@/lib/routing-map/edit-actions'
import type { EditScenario, RouteKind } from '@/lib/routing-map/edit-graph'
import type { RouterConfig } from '@/schemas'
import { PopoverSingle, RuleEditor } from './RuleEditor'

interface RoutingEditorPanelProps {
  scenario: EditScenario
  router: RouterConfig
  onChange: (next: RouterConfig) => void
  modelKeys: readonly string[]
  modelLabel: (key: string) => string
  onClose: () => void
  // View-only mode: hides remove/reorder buttons and renders scenario knobs
  // as static text instead of an editable input. Enabled when the parent
  // RoutingEditor is running with editable=false, so tapping a node still
  // reveals the full routing config without exposing mutation controls.
  readOnly?: boolean
}

// One route (agent or subagent): its primary (with remove) plus the ordered
// fallback chain (reorder up/down, remove). All mutations are kind-scoped.
// In readOnly mode, remove/reorder controls are omitted — the list becomes
// a plain view of the current wiring.
function RouteSection({
  title,
  scenario,
  kind,
  router,
  onChange,
  modelKeys,
  modelLabel,
  readOnly
}: {
  title: string
  scenario: EditScenario
  kind: RouteKind
  router: RouterConfig
  onChange: (next: RouterConfig) => void
  modelKeys: readonly string[]
  modelLabel: (key: string) => string
  readOnly: boolean
}) {
  const { t } = useTranslation()
  const route = router[scenario][kind]
  const primary = route.primary
  const modelOptions = useMemo(
    () => modelKeys.map((k) => ({ value: k, label: modelLabel(k) })),
    [modelKeys, modelLabel]
  )
  // Add-fallback picker filters out models that are already wired here
  // (primary or an existing fallback) so the same model can't be added
  // twice — mirrors connectModel's own guard.
  const fallbackOptions = useMemo(
    () => modelOptions.filter((o) => o.value !== primary && !route.fallbacks.includes(o.value)),
    [modelOptions, primary, route.fallbacks]
  )

  return (
    <div className='space-y-2'>
      <div className='border-b pb-1 text-xs font-semibold text-foreground'>{title}</div>

      <div className='space-y-1'>
        <div className='text-xs text-muted-foreground'>{t('routingMap.editPrimary')}</div>
        {primary === null ? (
          !readOnly ? (
            <PopoverSingle
              value={undefined}
              options={modelOptions}
              placeholder={t('router.selectModel')}
              searchable
              onChange={(v) => {
                if (v !== undefined) onChange(connectModel(router, scenario, v, kind))
              }}
            />
          ) : (
            <div className='text-xs text-muted-foreground italic'>{t('routingMap.editNoPrimary')}</div>
          )
        ) : (
          <div className='flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate font-mono text-xs'>{modelLabel(primary)}</span>
            {!readOnly && (
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
            )}
          </div>
        )}
      </div>

      <div className='space-y-1'>
        <div className='text-xs text-muted-foreground'>
          {t('router.fallbacks')}{' '}
          <span className='text-[10px] font-normal'>({t('router.rules.fallbacksCatchAll')})</span>
        </div>
        {route.fallbacks.length === 0 ? (
          <div className='text-xs text-muted-foreground italic'>—</div>
        ) : (
          <ul className='space-y-1'>
            {route.fallbacks.map((fallback, index) => (
              <li key={fallback} className='flex items-center gap-1'>
                <span className='w-4 text-[11px] text-muted-foreground tabular-nums'>{index + 1}</span>
                <span className='min-w-0 flex-1 truncate font-mono text-xs'>{modelLabel(fallback)}</span>
                {!readOnly && (
                  <>
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
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && fallbackOptions.length > 0 && (
          <PopoverSingle
            value={undefined}
            options={fallbackOptions}
            placeholder={t('router.rules.field.fallbacksPlaceholder')}
            searchable
            onChange={(v) => {
              if (v !== undefined) onChange(connectModel(router, scenario, v, kind))
            }}
          />
        )}
      </div>

      <RuleEditor
        scenario={scenario}
        kind={kind}
        router={router}
        onChange={onChange}
        modelKeys={modelKeys}
        modelLabel={modelLabel}
        readOnly={readOnly}
      />
    </div>
  )
}

export function RoutingEditorPanel({
  scenario,
  router,
  onChange,
  modelKeys,
  modelLabel,
  onClose,
  readOnly = false
}: RoutingEditorPanelProps) {
  const { t } = useTranslation()

  return (
    <div className='absolute inset-y-0 right-0 w-[28rem] space-y-3 overflow-y-auto border-l bg-background p-3 text-sm'>
      <div className='flex items-start justify-between gap-2 border-b pb-2'>
        <div className='min-w-0 space-y-0.5'>
          <div className='font-medium'>{t(`router.${scenario}`)}</div>
          <p className='text-xs text-muted-foreground'>{t(`router.trigger.${scenario}`)}</p>
        </div>
        <Button type='button' size='icon' variant='ghost' className='h-6 w-6 shrink-0' onClick={onClose}>
          <X className='h-4 w-4' aria-hidden='true' />
        </Button>
      </div>

      <RouteSection
        title={t('router.agentRoute')}
        scenario={scenario}
        kind='agent'
        router={router}
        onChange={onChange}
        modelKeys={modelKeys}
        modelLabel={modelLabel}
        readOnly={readOnly}
      />
      <RouteSection
        title={t('router.subagentRoute')}
        scenario={scenario}
        kind='subagent'
        router={router}
        onChange={onChange}
        modelKeys={modelKeys}
        modelLabel={modelLabel}
        readOnly={readOnly}
      />

      {scenario === 'longContext' &&
        (readOnly ? (
          <div className='flex items-center justify-between gap-2'>
            <span className='text-xs text-muted-foreground'>{t('router.longContextThreshold')}</span>
            <span className='font-mono text-xs tabular-nums'>{router.longContext.threshold}</span>
          </div>
        ) : (
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
        ))}
    </div>
  )
}
