/**
 * Rule editor sub-panel for the routing editor. Renders the ordered
 * `rules[]` on a single (scenario, kind) route as an accordion — each
 * item is a form for one rule (name + predicate + primary/fallbacks).
 * Rules evaluate at runtime in list order (first-match wins) and
 * override the catch-all `{primary, fallbacks}` on the route target
 * when their predicate matches; a rule with an empty predicate always
 * matches, so a fully-blank rule at the top of the stack is a
 * "route everything HERE, ignore the catch-all" override.
 *
 * Every mutation flows through the pure edit-actions helpers
 * (addRule / updateRule / removeRule / moveRule), same pattern the
 * primary/fallback controls use.
 */

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { addRule, emptyRule, moveRule, removeRule, updateRule } from '@/lib/routing-map/edit-actions'
import type { EditScenario, RouteKind } from '@/lib/routing-map/edit-graph'
import { EFFORT_LEVELS, REQUESTED_MODEL_TIERS, type RouteRule, type RouterConfig } from '@/schemas'

// The three states the `thinking` predicate can be in from the UI's
// perspective: unconstrained (undefined), required (true), forbidden
// (false). Bound to a Select so the tri-state stays discoverable.
const THINKING_UNSET = '__unset__'
const THINKING_TRUE = 'true'
const THINKING_FALSE = 'false'

interface RuleEditorProps {
  scenario: EditScenario
  kind: RouteKind
  router: RouterConfig
  onChange: (next: RouterConfig) => void
  modelKeys: readonly string[]
  modelLabel: (key: string) => string
  readOnly: boolean
}

export function RuleEditor({ scenario, kind, router, onChange, modelKeys, modelLabel, readOnly }: RuleEditorProps) {
  const { t } = useTranslation()
  const rules = router[scenario][kind].rules
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const handleAdd = () => {
    const rule = emptyRule()
    onChange(addRule(router, scenario, kind, rule))
    // Open the new rule immediately so the user can start editing.
    setExpanded((prev) => new Set(prev).add(rules.length))
  }

  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between'>
        <div className='text-xs text-muted-foreground'>{t('router.rules.title')}</div>
        {!readOnly && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='h-6 gap-1 px-1.5 text-xs'
            onClick={handleAdd}
            aria-label={t('router.rules.add')}
          >
            <Plus className='h-3 w-3' aria-hidden='true' />
            {t('router.rules.add')}
          </Button>
        )}
      </div>

      {rules.length === 0 ? (
        <div className='text-xs italic text-muted-foreground'>{t('router.rules.empty')}</div>
      ) : (
        <ul className='space-y-1'>
          {rules.map((rule, index) => {
            const isOpen = expanded.has(index)
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: rules are order-defined and small; index is stable within a single edit session
              <li key={index} className='rounded border border-border/50'>
                <div className='flex items-center gap-1 px-1.5 py-1'>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='h-5 w-5 shrink-0'
                    onClick={() => toggle(index)}
                    aria-label={isOpen ? t('router.rules.collapse') : t('router.rules.expand')}
                  >
                    {isOpen ? (
                      <ChevronDown className='h-3 w-3' aria-hidden='true' />
                    ) : (
                      <ChevronRight className='h-3 w-3' aria-hidden='true' />
                    )}
                  </Button>
                  <span className='min-w-0 flex-1 truncate text-xs'>
                    {rule.name !== undefined && rule.name.length > 0 ? (
                      rule.name
                    ) : (
                      <span className='italic text-muted-foreground'>{t('router.rules.unnamed')}</span>
                    )}
                    <span className='ml-2 text-[10px] text-muted-foreground'>{summarisePredicate(rule, t)}</span>
                  </span>
                  {!readOnly && (
                    <>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='h-5 w-5'
                        disabled={index === 0}
                        onClick={() => onChange(moveRule(router, scenario, kind, index, index - 1))}
                        aria-label={t('router.rules.moveUp')}
                      >
                        <ArrowUp className='h-3 w-3' aria-hidden='true' />
                      </Button>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='h-5 w-5'
                        disabled={index === rules.length - 1}
                        onClick={() => onChange(moveRule(router, scenario, kind, index, index + 1))}
                        aria-label={t('router.rules.moveDown')}
                      >
                        <ArrowDown className='h-3 w-3' aria-hidden='true' />
                      </Button>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='h-5 w-5'
                        onClick={() => onChange(removeRule(router, scenario, kind, index))}
                        aria-label={t('router.rules.remove')}
                      >
                        <Trash2 className='h-3 w-3' aria-hidden='true' />
                      </Button>
                    </>
                  )}
                </div>
                {isOpen && (
                  <div className='border-t border-border/50 px-2 py-2'>
                    <RuleForm
                      rule={rule}
                      onChange={(next) => onChange(updateRule(router, scenario, kind, index, next))}
                      modelKeys={modelKeys}
                      modelLabel={modelLabel}
                      readOnly={readOnly}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// A compact predicate summary for the collapsed row. Keeps the header
// readable when the user has many rules; the full form lives inside
// the expanded body.
function summarisePredicate(rule: RouteRule, t: (key: string) => string): string {
  const parts: string[] = []
  const when = rule.when
  if (when.requestedTier !== undefined) parts.push(`tier:${when.requestedTier.join('|')}`)
  if (when.requestedModel !== undefined) parts.push(`model:${when.requestedModel}`)
  if (when.thinking !== undefined) parts.push(when.thinking ? 'thinking' : 'no-thinking')
  if (when.minTokens !== undefined) parts.push(`≥${when.minTokens}`)
  if (when.maxTokens !== undefined) parts.push(`≤${when.maxTokens}`)
  if (when.hasTool !== undefined) parts.push(`tool:${when.hasTool}`)
  if (when.effort !== undefined) parts.push(`effort:${when.effort.join('|')}`)
  return parts.length === 0 ? t('router.rules.matchesAll') : parts.join(' · ')
}

interface RuleFormProps {
  rule: RouteRule
  onChange: (next: RouteRule) => void
  modelKeys: readonly string[]
  modelLabel: (key: string) => string
  readOnly: boolean
}

function RuleForm({ rule, onChange, modelKeys, modelLabel, readOnly }: RuleFormProps) {
  const { t } = useTranslation()
  const uid = useId()
  const patch = (partial: Partial<RouteRule>) => onChange({ ...rule, ...partial })
  const patchWhen = (partial: Partial<RouteRule['when']>) => patch({ when: { ...rule.when, ...partial } })

  const toggleTier = (tier: (typeof REQUESTED_MODEL_TIERS)[number]) => {
    const current = rule.when.requestedTier ?? []
    const next = current.includes(tier) ? current.filter((v) => v !== tier) : [...current, tier]
    patchWhen({ requestedTier: next.length > 0 ? (next as [typeof tier, ...(typeof tier)[]]) : undefined })
  }
  const toggleEffort = (level: (typeof EFFORT_LEVELS)[number]) => {
    const current = rule.when.effort ?? []
    const next = current.includes(level) ? current.filter((v) => v !== level) : [...current, level]
    patchWhen({ effort: next.length > 0 ? (next as [typeof level, ...(typeof level)[]]) : undefined })
  }

  const thinkingValue: string =
    rule.when.thinking === undefined ? THINKING_UNSET : rule.when.thinking ? THINKING_TRUE : THINKING_FALSE

  const modelOptions = modelKeys.map((k) => ({ value: k, label: modelLabel(k) }))

  return (
    <div className='space-y-3 text-xs'>
      <Field label={t('router.rules.field.name')}>
        <Input
          className='h-7 text-xs'
          value={rule.name ?? ''}
          onChange={(e) => patch({ name: e.target.value })}
          disabled={readOnly}
          placeholder={t('router.rules.field.namePlaceholder')}
        />
      </Field>

      <FieldGroup title={t('router.rules.predicate')}>
        <Field label={t('router.rules.field.requestedTier')}>
          <div className='flex flex-wrap gap-x-3 gap-y-1'>
            {REQUESTED_MODEL_TIERS.map((tier) => {
              const id = `${uid}-tier-${tier}`
              return (
                <div key={tier} className='flex items-center gap-1'>
                  <Checkbox
                    id={id}
                    checked={rule.when.requestedTier?.includes(tier) ?? false}
                    onCheckedChange={() => toggleTier(tier)}
                    disabled={readOnly}
                  />
                  <label htmlFor={id} className='text-[11px]'>
                    {tier}
                  </label>
                </div>
              )
            })}
          </div>
        </Field>

        <Field label={t('router.rules.field.effort')}>
          <div className='flex flex-wrap gap-x-3 gap-y-1'>
            {EFFORT_LEVELS.map((level) => {
              const id = `${uid}-effort-${level}`
              return (
                <div key={level} className='flex items-center gap-1'>
                  <Checkbox
                    id={id}
                    checked={rule.when.effort?.includes(level) ?? false}
                    onCheckedChange={() => toggleEffort(level)}
                    disabled={readOnly}
                  />
                  <label htmlFor={id} className='text-[11px]'>
                    {level}
                  </label>
                </div>
              )
            })}
          </div>
        </Field>

        <Field label={t('router.rules.field.thinking')}>
          <Select
            value={thinkingValue}
            onValueChange={(v) => {
              if (v === THINKING_UNSET) patchWhen({ thinking: undefined })
              else if (v === THINKING_TRUE) patchWhen({ thinking: true })
              else patchWhen({ thinking: false })
            }}
            disabled={readOnly}
          >
            <SelectTrigger className='h-7 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={THINKING_UNSET}>{t('router.rules.field.thinkingAny')}</SelectItem>
              <SelectItem value={THINKING_TRUE}>{t('router.rules.field.thinkingRequired')}</SelectItem>
              <SelectItem value={THINKING_FALSE}>{t('router.rules.field.thinkingForbidden')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {/* Min / max tokens live on one row — they always describe a
            single interval, so aligning them side-by-side reads faster
            than two separate labels stacked. */}
        <Field label={t('router.rules.field.tokens')}>
          <div className='grid grid-cols-2 gap-2'>
            <Input
              className='h-7 text-xs'
              type='number'
              min={0}
              value={rule.when.minTokens ?? ''}
              placeholder={t('router.rules.field.minTokens')}
              onChange={(e) => {
                const v = e.target.valueAsNumber
                patchWhen({ minTokens: Number.isFinite(v) ? v : undefined })
              }}
              disabled={readOnly}
            />
            <Input
              className='h-7 text-xs'
              type='number'
              min={0}
              value={rule.when.maxTokens ?? ''}
              placeholder={t('router.rules.field.maxTokens')}
              onChange={(e) => {
                const v = e.target.valueAsNumber
                patchWhen({ maxTokens: Number.isFinite(v) ? v : undefined })
              }}
              disabled={readOnly}
            />
          </div>
        </Field>

        <Field label={t('router.rules.field.hasTool')}>
          <Input
            className='h-7 text-xs font-mono'
            value={rule.when.hasTool ?? ''}
            onChange={(e) => patchWhen({ hasTool: e.target.value === '' ? undefined : e.target.value })}
            disabled={readOnly}
            placeholder='web_search_*'
          />
        </Field>

        <Field label={t('router.rules.field.requestedModel')}>
          <Input
            className='h-7 text-xs font-mono'
            value={rule.when.requestedModel ?? ''}
            onChange={(e) => patchWhen({ requestedModel: e.target.value === '' ? undefined : e.target.value })}
            disabled={readOnly}
            placeholder='*haiku*'
          />
        </Field>
      </FieldGroup>

      <FieldGroup title={t('router.rules.target')}>
        <Field label={t('router.rules.field.primary')}>
          <Select
            value={rule.primary ?? ''}
            onValueChange={(v) => patch({ primary: v === '' ? null : v })}
            disabled={readOnly}
          >
            <SelectTrigger className='h-7 text-xs'>
              <SelectValue placeholder={t('router.selectModel')} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('router.rules.field.fallbacks')}>
          {/* MultiCombobox ships with default h-9 shadcn Button sizing;
              override to the h-7/text-xs the rest of this panel uses so
              controls line up. Reaches the inner Button via arbitrary
              variant so we don't have to fork the ui/ primitive. */}
          <div className='[&_button]:h-7 [&_button]:text-xs [&_.font-normal]:text-xs'>
            <MultiCombobox
              options={modelOptions}
              value={rule.fallbacks}
              onChange={(next) => patch({ fallbacks: next })}
              placeholder={t('router.rules.field.fallbacksPlaceholder')}
            />
          </div>
        </Field>
      </FieldGroup>
    </div>
  )
}

// Vertical label-above-input layout. All fields share the same label
// typography (11px muted) and the same 28px control height so the
// form matches the surrounding panel density.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-0.5'>
      <div className='text-[11px] text-muted-foreground'>{label}</div>
      <div className='min-w-0'>{children}</div>
    </div>
  )
}

// A titled group of related fields — a subtle top border + small
// heading, so `When (predicate)` and `Then route to` read as
// distinct sections without adding heavy visual chrome.
function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='space-y-2 border-t pt-2'>
      <div className='text-[11px] font-semibold text-foreground'>{title}</div>
      {children}
    </div>
  )
}
