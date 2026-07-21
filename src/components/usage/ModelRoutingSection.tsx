/**
 * Model-routing report section for the Usage page.
 *
 * Shows, per requested model (what Claude Code sent in body.model), the
 * distribution of models CCR actually sent upstream — so the operator can
 * see how often a requested model is honored vs rerouted, and to where.
 * Data comes from GET /api/request-logs/model-routing.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type ModelRoutingResponse, type ModelRoutingRow } from '@/lib/api'

// reloadToken lets the parent (the Sync button) force a refetch by bumping
// a counter — the effect re-runs whenever the value changes.
export function ModelRoutingSection({ reloadToken }: { reloadToken: number }) {
  const { t } = useTranslation()
  const [data, setData] = useState<ModelRoutingResponse | null>(null)

  useEffect(() => {
    api
      .getModelRouting()
      .then(setData)
      .catch(() => setData({ rows: [], total: 0 }))
  }, [reloadToken])

  return (
    <section className='space-y-3'>
      <div>
        <h3 className='text-base font-semibold'>{t('usage.routing')}</h3>
        <p className='text-xs text-muted-foreground'>{t('usage.routingHint')}</p>
      </div>
      {data === null ? (
        <p className='text-sm text-muted-foreground'>…</p>
      ) : data.rows.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t('usage.routingEmpty')}</p>
      ) : (
        <div className='space-y-3'>
          {data.rows.map((row) => (
            <RoutingRow key={row.requestedModel === null ? '__untracked__' : row.requestedModel} row={row} />
          ))}
        </div>
      )}
    </section>
  )
}

function RoutingRow({ row }: { row: ModelRoutingRow }) {
  const { t } = useTranslation()
  const requestedLabel = row.requestedModel === null ? t('usage.routingUntracked') : row.requestedModel

  return (
    <div className='rounded-md border'>
      <div className='flex items-center justify-between gap-2 border-b px-4 py-2'>
        <span className='truncate font-mono text-sm font-medium'>{requestedLabel}</span>
        <span className='shrink-0 text-xs text-muted-foreground'>
          {row.total.toLocaleString()} {t('usage.apiCostRequests')}
        </span>
      </div>
      <div className='space-y-2 px-4 py-3'>
        {row.targets.map((target) => {
          const pct = row.total > 0 ? Math.round((target.count / row.total) * 100) : 0
          // "Rerouted" = the upstream model differs from what was asked for.
          // A different provider with the same model name still counts as
          // honored (same model, just a different account/lane).
          const rerouted = row.requestedModel !== null && target.model !== row.requestedModel
          const scenarioKey = target.scenario === null ? '' : target.scenario
          return (
            <div key={`${target.provider}/${target.model}/${scenarioKey}`} className='space-y-1'>
              <div className='flex items-center justify-between gap-3'>
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate font-mono text-xs'>
                    {target.provider} / {target.model}
                  </span>
                  {target.scenario !== null && (
                    <span className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                      {target.scenario}
                    </span>
                  )}
                  {rerouted && (
                    <span className='shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400'>
                      {t('usage.routingRerouted')}
                    </span>
                  )}
                </div>
                <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                  {target.count.toLocaleString()} · {pct}%
                </span>
              </div>
              <div className='h-1 w-full overflow-hidden rounded-full bg-muted'>
                <div
                  className={`h-full rounded-full ${rerouted ? 'bg-amber-500' : 'bg-primary/60'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
