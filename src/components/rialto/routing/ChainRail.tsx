/**
 * Right rail of the Chain view: the selector's global constraints, the
 * rules that run before the chain, and the saved routing snapshots.
 *
 * All three are context for the chain rather than part of it, which is why
 * they sit beside the table instead of above it — the operator reads them
 * while reordering, not before.
 */
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfig } from '@/components/ConfigProvider'
import { api, type RoutingPresetItem } from '@/lib/api'
import { applyPresetToLive } from '@/lib/routing-map/apply-to-live'
import type { RouteRule } from '@/schemas/domain/router'
import { summarizePredicate, summarizeTarget } from './rules'

const ROW = 'border-l-2 border-l-transparent px-4 py-3 transition-colors hover:border-l-border hover:bg-muted/50'
const HEADING = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground'

const readBool = (raw: Record<string, unknown> | null, key: string, fallback: boolean): boolean => {
  const value = raw === null ? undefined : raw[key]
  return typeof value === 'boolean' ? value : fallback
}

const readNum = (raw: Record<string, unknown> | null, key: string, fallback: number): number => {
  const value = raw === null ? undefined : raw[key]
  return typeof value === 'number' ? value : fallback
}

// Two directional gates read better as one four-state answer than as two
// booleans the operator has to combine in their head.
const substitutionLabel = (up: boolean, down: boolean, t: TFunction): string => {
  if (up && down) return t('routing.chain.substitutionUpDown')
  if (up) return t('routing.chain.substitutionUp')
  if (down) return t('routing.chain.substitutionDown')
  return t('routing.chain.substitutionSame')
}

function ConstraintRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={ROW}>
      <div className='flex items-baseline gap-2'>
        <span className='text-xs'>{label}</span>
        <span className='ml-auto font-mono text-xs'>{value}</span>
      </div>
      <div className='mt-0.5 text-[11px] text-muted-foreground'>{hint}</div>
    </div>
  )
}

function Constraints({ constraints }: { constraints: Record<string, unknown> | null }) {
  const { t } = useTranslation()
  const escalation = readBool(constraints, 'allowEscalation', true)
  const demotion = readBool(constraints, 'allowDemotion', true)
  const exhausted = constraints === null ? '429' : constraints.exhaustedBehavior
  return (
    <>
      <ConstraintRow
        label={t('routing.chain.tierSubstitution')}
        value={substitutionLabel(escalation, demotion, t)}
        hint={t('routing.chain.tierSubstitutionHint')}
      />
      <ConstraintRow
        label={t('routing.chain.weightFloor')}
        value={`${Math.round(readNum(constraints, 'healthinessThreshold', 0.05) * 100)}%`}
        hint={t('routing.chain.weightFloorHint')}
      />
      <ConstraintRow
        label={t('routing.chain.whenExhausted')}
        value={exhausted === 'passthrough' ? t('routing.common.modePassthrough') : '429'}
        hint={t('routing.chain.whenExhaustedHint')}
      />
      <ConstraintRow
        label={t('routing.chain.quotaSkip')}
        value={`${readNum(constraints, 'quotaSkipPct', 100)}%`}
        hint={t('routing.chain.quotaSkipHint')}
      />
    </>
  )
}

function RuleSummary({ rule }: { rule: RouteRule }) {
  const { t } = useTranslation()
  return (
    <div className={ROW}>
      <div className='text-[11px] uppercase tracking-wider text-muted-foreground'>{t('routing.chain.when')}</div>
      <div className='mt-0.5 text-xs'>{summarizePredicate(rule, t)}</div>
      <div className='mt-2 text-[11px] uppercase tracking-wider text-muted-foreground'>{t('routing.chain.then')}</div>
      <div className='mt-0.5 font-mono text-xs'>{summarizeTarget(rule, t)}</div>
    </div>
  )
}

function Presets({ onNotify }: { onNotify: (message: string, ok: boolean) => void }) {
  const { t } = useTranslation()
  const { config, setConfig } = useConfig()
  const [presets, setPresets] = useState<RoutingPresetItem[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .listRoutingPresets()
      .then((res) => setPresets(res.presets))
      .catch(() => {
        // An empty rail is the correct rendering when no snapshot store
        // answers; the chain itself does not depend on it.
      })
  }, [])

  const apply = useCallback(
    async (preset: RoutingPresetItem) => {
      if (config === null) return
      setBusy(true)
      const result = await applyPresetToLive(config, preset.config, preset.name)
      setBusy(false)
      if (result.ok) {
        setConfig(result.updatedConfig)
        onNotify(t('routing.common.presetApplied', { name: preset.name }), true)
      } else {
        onNotify(result.message, false)
      }
    },
    [config, setConfig, onNotify, t]
  )

  if (presets.length === 0) {
    return <div className='px-4 pb-6 text-[11px] text-muted-foreground'>{t('routing.common.noSnapshots')}</div>
  }
  return (
    <div className='px-4 pb-6'>
      {presets.map((preset, index) => (
        <button
          key={preset.id}
          type='button'
          disabled={busy}
          onClick={() => void apply(preset)}
          className={`flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs ${
            index === 0 ? '' : 'mt-2'
          }`}
        >
          <i className='ri-bookmark-line text-sm text-muted-foreground' />
          <span className='truncate'>{preset.name}</span>
          <span className='ml-auto shrink-0 text-[11px] text-muted-foreground'>{t('routing.common.apply')}</span>
        </button>
      ))}
    </div>
  )
}

export function ChainRail({
  constraints,
  rules,
  onNotify
}: {
  constraints: Record<string, unknown> | null
  rules: readonly RouteRule[]
  onNotify: (message: string, ok: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <aside className='min-w-0'>
      <div className='px-4 pt-5 pb-2'>
        <h2 className={HEADING}>{t('routing.chain.constraints')}</h2>
      </div>
      <Constraints constraints={constraints} />

      <div className='border-t border-border px-4 pt-5 pb-2'>
        <h2 className={HEADING}>{t('routing.common.rules')}</h2>
      </div>
      {rules.length === 0 ? (
        <div className='px-4 pb-2 text-[11px] text-muted-foreground'>{t('routing.chain.noLaneRules')}</div>
      ) : (
        rules.map((rule, index) => (
          // Rules are order-defined and unnamed by default, so position is
          // the only stable identity a list row has.
          // biome-ignore lint/suspicious/noArrayIndexKey: order is the identity
          <RuleSummary key={index} rule={rule} />
        ))
      )}

      <div className='border-t border-border px-4 pt-5 pb-2'>
        <h2 className={HEADING}>{t('routing.common.presets')}</h2>
      </div>
      <Presets onNotify={onNotify} />
    </aside>
  )
}
