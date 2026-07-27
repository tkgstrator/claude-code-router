/**
 * Model-routing report section for the Usage page.
 *
 * Grouped by scenario lane (default, think, …): for each lane it lists every
 * "requested model → model CCR actually sent upstream" pair, so the operator
 * can read, per lane, which model the request came in as and where CCR routed
 * it — with a "rerouted" flag whenever the upstream model differs from what
 * was asked for. Data comes from GET /api/request-logs/model-routing.
 */

import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type ModelRoutingResponse, type ModelRoutingRow } from '@/lib/api'

// Traffic whose scenario wasn't captured buckets under this synthetic lane.
const UNTRACKED = '__untracked__'
// Fixed lane order (default first), matching the Router page.
const SCENARIO_ORDER = ['default', 'background', 'think', 'longContext', 'webSearch', 'image']

// One "requested → actual" routing outcome within a lane.
interface Pair {
  requested: string | null
  provider: string
  model: string
  count: number
}
interface ScenarioGroup {
  scenario: string
  total: number
  pairs: Pair[]
}

function orderIndex(scenario: string): number {
  if (scenario === UNTRACKED) return SCENARIO_ORDER.length + 1
  const idx = SCENARIO_ORDER.indexOf(scenario)
  return idx === -1 ? SCENARIO_ORDER.length : idx
}

// Re-pivot the requested-model-keyed API rows into scenario-keyed groups, each
// carrying its requested→actual pairs (busiest first) and lane total.
function groupByScenario(rows: ModelRoutingRow[]): ScenarioGroup[] {
  const map = new Map<string, { total: number; pairs: Pair[] }>()
  for (const row of rows) {
    for (const target of row.targets) {
      const scenario = target.scenario === null ? UNTRACKED : target.scenario
      const existing = map.get(scenario)
      const group = existing === undefined ? { total: 0, pairs: [] } : existing
      group.total += target.count
      group.pairs.push({
        requested: row.requestedModel,
        provider: target.provider,
        model: target.model,
        count: target.count
      })
      map.set(scenario, group)
    }
  }
  const groups = [...map.entries()].map(([scenario, group]) => ({
    scenario,
    total: group.total,
    pairs: [...group.pairs].sort((a, b) => b.count - a.count)
  }))
  return groups.sort((a, b) => orderIndex(a.scenario) - orderIndex(b.scenario))
}

// reloadToken lets the parent (the Sync button) force a refetch by bumping
// a counter — the effect re-runs whenever the value changes.
export function ModelRoutingSection({ reloadToken }: { reloadToken: number }) {
  const { t } = useTranslation()
  const [data, setData] = useState<ModelRoutingResponse | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is a refetch signal, not read in the effect body
  useEffect(() => {
    api
      .getModelRouting()
      .then(setData)
      .catch(() => setData({ rows: [], total: 0 }))
  }, [reloadToken])

  const groups = useMemo(() => (data === null ? [] : groupByScenario(data.rows)), [data])

  // Body only — the enclosing Card on the Usage page provides the title
  // and hint header.
  if (data === null) {
    return <p className='text-sm text-muted-foreground'>…</p>
  }
  if (groups.length === 0) {
    return <p className='text-sm text-muted-foreground'>{t('usage.routingEmpty')}</p>
  }
  // Auto-fill grid: each "requested → actual" row spans one ~22rem column
  // instead of stretching edge-to-edge (the gap between the model names and
  // the percentage would otherwise read as too wide). The column count grows
  // with the viewport since the section is allowed to use the full width.
  // `items-start` keeps groups top-aligned rather than stretching to the
  // tallest cell in their row.
  return (
    <div className='grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] items-start gap-x-8 gap-y-6'>
      {groups.map((group) => (
        <ScenarioGroupCard key={group.scenario} group={group} />
      ))}
    </div>
  )
}

function ScenarioGroupCard({ group }: { group: ScenarioGroup }) {
  const { t } = useTranslation()
  const known = group.scenario !== UNTRACKED && SCENARIO_ORDER.includes(group.scenario)
  const label =
    group.scenario === UNTRACKED ? t('usage.routingUntracked') : known ? t(`router.${group.scenario}`) : group.scenario
  // What kind of request lands in this lane (the router's trigger condition),
  // so the panel reads as "this sort of request → here" rather than just
  // observed counts.
  const trigger = known ? t(`router.trigger.${group.scenario}`) : null

  return (
    <div className='space-y-3'>
      <div className='flex items-start justify-between gap-2 border-b pb-2'>
        <div className='min-w-0'>
          <span className='text-sm font-semibold'>{label}</span>
          {trigger && <p className='text-[11px] leading-snug text-muted-foreground'>{trigger}</p>}
        </div>
        <span className='shrink-0 text-xs text-muted-foreground'>
          {group.total.toLocaleString()} {t('usage.apiCostRequests')}
        </span>
      </div>
      <div className='space-y-3'>
        {group.pairs.map((pair) => (
          <PairRow key={`${pair.requested}/${pair.provider}/${pair.model}`} pair={pair} total={group.total} />
        ))}
      </div>
    </div>
  )
}

function PairRow({ pair, total }: { pair: Pair; total: number }) {
  const { t } = useTranslation()
  const pct = total > 0 ? Math.round((pair.count / total) * 100) : 0
  const requestedLabel = pair.requested === null ? t('usage.routingUntracked') : pair.requested
  // "Rerouted" = CCR sent upstream a different model than the request asked
  // for. A different provider with the same model name still counts as honored
  // (same model, just a different account/lane).
  const rerouted = pair.requested !== null && pair.model !== pair.requested

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-1.5 font-mono text-xs'>
          <span className='min-w-0 truncate text-muted-foreground'>{requestedLabel}</span>
          <ArrowRight className={`h-3 w-3 shrink-0 ${rerouted ? 'text-amber-500' : 'text-muted-foreground/50'}`} />
          <span className='min-w-0 truncate text-foreground'>{pair.model}</span>
          {rerouted && (
            <span className='shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400'>
              {t('usage.routingRerouted')}
            </span>
          )}
        </div>
        <span className='shrink-0 tabular-nums'>
          <span className='text-xs text-muted-foreground'>{pair.count.toLocaleString()}</span>
          <span className='ml-1.5 text-sm font-semibold text-foreground'>{pct}%</span>
        </span>
      </div>
      <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
        <div
          className={`h-full rounded-full ${rerouted ? 'bg-amber-500' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
