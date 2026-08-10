/**
 * Model-routing report section for the Usage page.
 *
 * Two-level breakdown by scenario lane (default, think, …):
 *   Scenario
 *     Target Model (agent / subagent badge)
 *       Requested Model N req · pct
 *       Requested Model N req · pct
 * The rows come from GET /api/request-logs/model-routing. Untracked
 * pre-capture rows are dropped upstream, so every row here carries a
 * requestedModel and a definite agent/subagent lane.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { api, type ModelRoutingResponse, type ModelRoutingRow } from '@/lib/api'

// Period selector values in hours. 0 means "all-time" (no filter). Default
// is 24h so a routing edit that drops a lane fades out of the panel within
// a day instead of lingering forever.
const PERIODS = [6, 24, 168, 0] as const
type Period = (typeof PERIODS)[number]

function periodLabelKey(period: Period): string {
  return period === 6
    ? 'usage.routingPeriod6h'
    : period === 24
      ? 'usage.routingPeriod24h'
      : period === 168
        ? 'usage.routingPeriod7d'
        : 'usage.routingPeriodAll'
}

// Fixed lane order (default first), matching the Router page.
// Historical `RequestLog.scenario = 'background'` rows still surface
// under this lane label so pre-migration traffic remains grouped
// consistently — the DB enum no longer accepts new writes, but old rows
// keep their string value.
const SCENARIO_ORDER = ['default', 'background', 'think', 'longContext', 'webSearch', 'image']

// One "requested model → count" leaf inside a target group.
interface RequestedLeaf {
  requested: string
  count: number
}

// One target model within a scenario, with all requested models that
// were routed to it and the per-scenario share the target holds.
interface TargetGroup {
  provider: string
  model: string
  isSubagent: boolean
  total: number
  requested: RequestedLeaf[]
}

interface ScenarioGroup {
  scenario: string
  total: number
  targets: TargetGroup[]
}

function orderIndex(scenario: string): number {
  const idx = SCENARIO_ORDER.indexOf(scenario)
  return idx === -1 ? SCENARIO_ORDER.length : idx
}

// Stable key for a target group. Two targets differ if provider/model
// differ OR the agent/subagent lane differs (same model on both lanes
// is a valid state and must not collapse).
function targetKey(provider: string, model: string, isSubagent: boolean): string {
  return `${provider}/${model}/${isSubagent ? 'sub' : 'agent'}`
}

// Re-pivot requested-keyed API rows into the two-level shape the UI
// renders. Pre-capture rows (requested === null or scenario === null)
// are dropped at the API but guarded here for defence in depth.
function groupByScenarioAndTarget(rows: ModelRoutingRow[]): ScenarioGroup[] {
  const map = new Map<string, { total: number; targets: Map<string, TargetGroup> }>()
  for (const row of rows) {
    if (row.requestedModel === null) continue
    for (const target of row.targets) {
      if (target.scenario === null) continue
      const scenario = target.scenario
      const existingScenario = map.get(scenario)
      const scenarioBucket =
        existingScenario !== undefined ? existingScenario : { total: 0, targets: new Map<string, TargetGroup>() }
      scenarioBucket.total += target.count
      const key = targetKey(target.provider, target.model, target.isSubagent)
      const existingTarget = scenarioBucket.targets.get(key)
      const targetBucket: TargetGroup =
        existingTarget !== undefined
          ? existingTarget
          : {
              provider: target.provider,
              model: target.model,
              isSubagent: target.isSubagent,
              total: 0,
              requested: []
            }
      targetBucket.total += target.count
      targetBucket.requested.push({ requested: row.requestedModel, count: target.count })
      scenarioBucket.targets.set(key, targetBucket)
      map.set(scenario, scenarioBucket)
    }
  }
  const groups = [...map.entries()].map(([scenario, bucket]) => ({
    scenario,
    total: bucket.total,
    targets: [...bucket.targets.values()]
      .map((t) => ({ ...t, requested: [...t.requested].sort((a, b) => b.count - a.count) }))
      .sort((a, b) => b.total - a.total)
  }))
  return groups.sort((a, b) => orderIndex(a.scenario) - orderIndex(b.scenario))
}

// reloadToken lets the parent (the Sync button) force a refetch by bumping
// a counter — the effect re-runs whenever the value changes.
export function ModelRoutingSection({ reloadToken }: { reloadToken: number }) {
  const { t } = useTranslation()
  const [data, setData] = useState<ModelRoutingResponse | null>(null)
  const [period, setPeriod] = useState<Period>(24)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is a refetch signal, not read in the effect body
  useEffect(() => {
    setData(null)
    api
      .getModelRouting({ sinceHours: period })
      .then(setData)
      .catch(() => setData({ rows: [], total: 0 }))
  }, [reloadToken, period])

  const groups = useMemo(() => (data === null ? [] : groupByScenarioAndTarget(data.rows)), [data])

  return (
    <section className='space-y-3'>
      <div className='flex items-start justify-between gap-2 border-b pb-2'>
        <div className='min-w-0'>
          <h3 className='text-base font-semibold'>{t('usage.routing')}</h3>
          <p className='text-xs text-muted-foreground'>{t('usage.routingHint')}</p>
        </div>
        <div className='flex shrink-0 gap-1'>
          {PERIODS.map((p) => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'ghost'}
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={() => setPeriod(p)}
            >
              {t(periodLabelKey(p))}
            </Button>
          ))}
        </div>
      </div>
      {data === null ? (
        <p className='text-sm text-muted-foreground'>…</p>
      ) : groups.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t('usage.routingEmpty')}</p>
      ) : (
        // Auto-fill grid: each scenario column spans ~22rem so the two-level
        // hierarchy stays readable and multiple lanes tile side-by-side on a
        // wide viewport. `items-start` keeps lanes top-aligned rather than
        // stretching to the tallest cell in their row.
        <div className='grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] items-start gap-x-8 gap-y-6'>
          {groups.map((group) => (
            <ScenarioGroupCard key={group.scenario} group={group} />
          ))}
        </div>
      )}
    </section>
  )
}

function ScenarioGroupCard({ group }: { group: ScenarioGroup }) {
  const { t } = useTranslation()
  const known = SCENARIO_ORDER.includes(group.scenario)
  const label = known ? t(`router.${group.scenario}`) : group.scenario
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
      <div className='space-y-4'>
        {group.targets.map((target) => (
          <TargetGroupRow key={targetKey(target.provider, target.model, target.isSubagent)} target={target} />
        ))}
      </div>
    </div>
  )
}

function TargetGroupRow({ target }: { target: TargetGroup }) {
  const { t } = useTranslation()
  const laneLabel = target.isSubagent ? t('usage.routingLaneSubagent') : t('usage.routingLaneAgent')
  const laneClass = target.isSubagent
    ? 'border border-muted-foreground/40 text-muted-foreground'
    : 'bg-primary/15 text-primary'

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-1.5 text-xs'>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${laneClass}`}>
          {laneLabel}
        </span>
        <span className='min-w-0 truncate font-mono text-foreground'>{target.model}</span>
        <span className='shrink-0 tabular-nums text-muted-foreground'>{target.total.toLocaleString()}</span>
      </div>
      <ul className='space-y-1 pl-3'>
        {target.requested.map((leaf) => (
          <RequestedLeafRow key={leaf.requested} leaf={leaf} total={target.total} />
        ))}
      </ul>
    </div>
  )
}

function RequestedLeafRow({ leaf, total }: { leaf: RequestedLeaf; total: number }) {
  const { t } = useTranslation()
  const pct = total > 0 ? Math.round((leaf.count / total) * 100) : 0
  return (
    <li className='space-y-1'>
      <div className='flex items-center justify-between gap-3 text-xs'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <span className='shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
            {t('usage.routingOriginal')}
          </span>
          <span className='min-w-0 truncate font-mono text-muted-foreground'>{leaf.requested}</span>
        </div>
        <span className='shrink-0 tabular-nums'>
          <span className='text-muted-foreground'>{leaf.count.toLocaleString()}</span>
          <span className='ml-1.5 font-semibold text-foreground'>{pct}%</span>
        </span>
      </div>
      <div className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
        <div className='h-full rounded-full bg-primary' style={{ width: `${pct}%` }} />
      </div>
    </li>
  )
}
