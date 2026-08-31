/**
 * Routing → Rules.
 *
 * Rules are stored per (scenario, lane) and evaluated top to bottom within
 * their own lane, so the list groups by lane rather than pretending to be
 * one flat first-match-wins stack — an ordering that spans lanes would be
 * a lie about what the runtime does.
 */
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useConfig } from '@/components/ConfigProvider'
import { Pill, RButton } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'
import { api } from '@/lib/api'
import { addRule, emptyRule, removeRule, updateRule } from '@/lib/routing-map/edit-actions'
import { cn } from '@/lib/utils'
import type { RouterConfig } from '@/schemas'
import { useEnabledTargets, useSurfaces } from './data'
import { splitTarget } from './derive'
import { RoutingViewTabs } from './RoutingTabs'
import { RuleDetail } from './RuleDetail'
import { allRules, type RuleScope, ruleLabel, type ScopedRule, sameScope, summarizePredicate } from './rules'

function RuleRow({ scoped, active, onSelect }: { scoped: ScopedRule; active: boolean; onSelect: () => void }) {
  const target = scoped.rule.target
  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(
        'block w-full border-l-2 px-4 py-3 text-left transition-colors',
        active ? 'border-l-foreground bg-muted/60' : 'border-l-transparent hover:border-l-border hover:bg-muted/50'
      )}
    >
      <div className='flex items-center gap-2'>
        <span className='font-mono text-[11px] tabular-nums text-muted-foreground'>{scoped.index + 1}</span>
        <span className='truncate text-xs font-medium'>{ruleLabel(scoped.rule, scoped.index)}</span>
        <span className='ml-auto shrink-0 font-mono text-[11px] text-muted-foreground'>
          {target === null || target === '' ? 'no rewrite' : splitTarget(target).model}
        </span>
      </div>
      <div className='mt-1 truncate font-mono text-[11px] text-muted-foreground'>{summarizePredicate(scoped.rule)}</div>
    </button>
  )
}

function LaneGroup({
  rules,
  labelled,
  selected,
  onSelect
}: {
  rules: readonly ScopedRule[]
  labelled: boolean
  selected: RuleScope | null
  onSelect: (scope: RuleScope) => void
}) {
  const head = rules.at(0)
  if (head === undefined) return null
  return (
    <div>
      {labelled ? (
        <div className='px-4 pt-4 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground/70'>
          {`${head.scenario} · ${head.lane}`}
        </div>
      ) : null}
      {rules.map((scoped) => (
        <RuleRow
          key={`${scoped.scenario}-${scoped.lane}-${scoped.index}`}
          scoped={scoped}
          active={selected !== null && sameScope(selected, scoped)}
          onSelect={() => onSelect(scoped)}
        />
      ))}
    </div>
  )
}

function RuleList({
  rules,
  selected,
  onSelect
}: {
  rules: readonly ScopedRule[]
  selected: RuleScope | null
  onSelect: (scope: RuleScope) => void
}) {
  // Group headers only earn their space once more than one lane carries
  // rules; the common single-lane config reads as a plain ordered list.
  const lanes = [...new Set(rules.map((r) => `${r.scenario}/${r.lane}`))]
  return (
    <>
      {lanes.map((key) => (
        <LaneGroup
          key={key}
          rules={rules.filter((r) => `${r.scenario}/${r.lane}` === key)}
          labelled={lanes.length > 1}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

export function RoutingRules() {
  const { config, setConfig } = useConfig()
  const { surfaces } = useSurfaces()
  const targets = useEnabledTargets()
  // Local draft of the whole Router. Rules ride on /api/config, which is a
  // whole-document write, so edits are staged until Save rather than
  // written per keystroke.
  const [draft, setDraft] = useState<RouterConfig | null>(null)
  const [selected, setSelected] = useState<RuleScope | null>(null)
  const [saving, setSaving] = useState(false)

  const live = config === null ? null : config.Router
  const router = draft === null ? live : draft
  const rules = useMemo(() => (router === null ? [] : allRules(router)), [router])
  const current = selected === null ? undefined : rules.find((r) => sameScope(r, selected))
  const laneRules =
    current === undefined ? [] : rules.filter((r) => r.scenario === current.scenario && r.lane === current.lane)
  // The tester walks raw rules, in lane order — the same array the runtime
  // would evaluate, taken from the draft rather than the last save.
  const laneDraft = laneRules.map((scoped) => scoped.rule)

  const edit = useCallback(
    (fn: (base: RouterConfig) => RouterConfig) => {
      if (router === null) return
      setDraft(fn(router))
    },
    [router]
  )

  const add = useCallback(() => {
    const scenario = current === undefined ? 'default' : current.scenario
    const lane = current === undefined ? 'agent' : current.lane
    const index = rules.filter((r) => r.scenario === scenario && r.lane === lane).length
    edit((base) => addRule(base, scenario, lane, emptyRule()))
    setSelected({ scenario, lane, index })
  }, [current, rules, edit])

  const save = useCallback(() => {
    if (config === null || draft === null) return
    setSaving(true)
    const next = { ...config, Router: draft }
    api
      .updateConfig(next)
      .then(() => {
        setConfig(next)
        setDraft(null)
        toast.success('Rules saved')
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false))
  }, [config, draft, setConfig])

  return (
    <Screen
      title='Routing rules'
      subtitle={`${rules.length} rules · evaluated before the chain`}
      actions={
        <>
          <RButton variant='ghost' onClick={() => setDraft(null)} disabled={draft === null}>
            Discard
          </RButton>
          <RButton variant='primary' icon='ri-check-line' onClick={save} disabled={draft === null || saving}>
            Save
          </RButton>
        </>
      }
    >
      <RoutingViewTabs active='rules' ruleCount={rules.length} />

      <div className='grid h-full grid-cols-[20rem_1fr]'>
        <aside className='min-w-0 overflow-y-auto border-r border-border'>
          <div className='flex items-center gap-2 px-4 pt-5 pb-2'>
            <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Rules</h2>
            <span className='text-[11px] text-muted-foreground'>first match wins</span>
            {draft === null ? null : (
              <Pill tone='warn' className='ml-auto'>
                unsaved
              </Pill>
            )}
          </div>
          <RuleList rules={rules} selected={selected} onSelect={setSelected} />
          <div className='p-4'>
            <RButton variant='outline' icon='ri-add-line' onClick={add}>
              Add rule
            </RButton>
          </div>

          <div className='border-t border-border px-4 py-4'>
            <p className='text-[11px] leading-relaxed text-muted-foreground'>
              Evaluated top to bottom against the request, before the preference chain. A rule that matches replaces the
              target outright; the chain still supplies failover.
            </p>
          </div>
        </aside>

        {current === undefined ? (
          <div className='px-6 py-6 text-xs text-muted-foreground'>
            {rules.length === 0
              ? 'No rules yet. Add one to override the chain for a class of request.'
              : 'Select a rule.'}
          </div>
        ) : (
          <RuleDetail
            scoped={current}
            laneRules={laneDraft}
            surfaces={surfaces}
            targets={targets}
            onChange={(next) => edit((base) => updateRule(base, current.scenario, current.lane, current.index, next))}
            onDuplicate={() => {
              edit((base) => addRule(base, current.scenario, current.lane, { ...current.rule }))
              setSelected({ scenario: current.scenario, lane: current.lane, index: laneRules.length })
            }}
            onDelete={() => {
              edit((base) => removeRule(base, current.scenario, current.lane, current.index))
              setSelected(null)
            }}
          />
        )}
      </div>
    </Screen>
  )
}
