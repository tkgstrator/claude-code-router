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

import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui-ext/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { modelNameOf } from '@/lib/router/fallback-slots'
import { addRule, emptyRule, moveRule, removeRule, updateRule } from '@/lib/routing-map/edit-actions'
import type { EditScenario, RouteKind } from '@/lib/routing-map/edit-graph'
import { cn } from '@/lib/utils'
import { EFFORT_LEVELS, REQUESTED_MODEL_TIERS, type RouteRule, type RouterConfig } from '@/schemas'

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
                  {/* 1-based priority — rules evaluate in list order,
                      first match wins, so the number IS the priority. */}
                  <span className='w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground'>{index + 1}</span>
                  <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
                    {summarisePredicate(rule, t)}
                  </span>
                  {/* Target at a glance. Model: short name (provider
                      stripped) so it fits without pushing the reorder /
                      remove buttons out. No target (target === null): a
                      "pass-through" pill so the rule doesn't look
                      unfinished — it's a legit config (matched requests
                      hit req.body.model verbatim, no rewrite). */}
                  {rule.target !== null && rule.target.length > 0 ? (
                    <span
                      className='max-w-[9rem] shrink-0 truncate font-mono text-[11px] text-foreground'
                      title={modelLabel(rule.target)}
                    >
                      → {modelNameOf(rule.target)}
                    </span>
                  ) : (
                    <span
                      className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] italic text-muted-foreground'
                      title={t('router.rules.passthroughHint')}
                    >
                      → {t('router.rules.passthrough')}
                    </span>
                  )}
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

// Format a raw token count in "k" units, matching how the min/max
// inputs display them. 60000 → "60k"; 500 → "500".
function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

// A compact predicate summary for the collapsed row. Keeps the header
// readable when the user has many rules; the full form lives inside
// the expanded body. Skips `minTokens: 0` and `maxTokens: 0` — those
// are no-ops semantically (≥0 tokens is always true, ≤0 tokens is
// almost always false) and just create visual noise on rules the
// user never populated a bound on.
function summarisePredicate(rule: RouteRule, t: (key: string) => string): string {
  const parts: string[] = []
  const when = rule.when
  if (when.requestedTier !== undefined) parts.push(`tier:${when.requestedTier.join('|')}`)
  if (when.requestedModel !== undefined) parts.push(`model:${when.requestedModel}`)
  if (when.thinking !== undefined) parts.push(when.thinking ? 'thinking' : 'no-thinking')
  if (when.minTokens !== undefined && when.minTokens > 0) parts.push(`≥${fmtK(when.minTokens)}`)
  if (when.maxTokens !== undefined && when.maxTokens > 0) parts.push(`≤${fmtK(when.maxTokens)}`)
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

  const modelOptions = modelKeys.map((k) => ({ value: k, label: modelLabel(k) }))

  return (
    <div className='space-y-3 text-xs'>
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
          <PopoverSingle
            value={rule.when.thinking === undefined ? undefined : rule.when.thinking ? 'true' : 'false'}
            options={[
              { value: '__unset__', label: t('router.rules.field.thinkingAny') },
              { value: 'true', label: t('router.rules.field.thinkingRequired') },
              { value: 'false', label: t('router.rules.field.thinkingForbidden') }
            ]}
            placeholder={t('router.rules.field.thinkingAny')}
            searchable={false}
            disabled={readOnly}
            onChange={(v) => {
              if (v === undefined || v === '__unset__') patchWhen({ thinking: undefined })
              else patchWhen({ thinking: v === 'true' })
            }}
          />
        </Field>

        {/* Min / max tokens live on one row — they always describe a
            single interval, so aligning them side-by-side reads faster
            than two separate labels stacked. Values are edited in k
            (thousands of tokens) so users type "60" instead of
            "60000"; the wire schema still stores raw token counts, so
            the display divides by 1000 on read and multiplies on save. */}
        <Field label={t('router.rules.field.tokens')}>
          <div className='grid grid-cols-2 gap-2'>
            <TokensInput
              value={rule.when.minTokens}
              placeholder={t('router.rules.field.minTokens')}
              disabled={readOnly}
              onChange={(v) => patchWhen({ minTokens: v })}
            />
            <TokensInput
              value={rule.when.maxTokens}
              placeholder={t('router.rules.field.maxTokens')}
              disabled={readOnly}
              onChange={(v) => patchWhen({ maxTokens: v })}
            />
          </div>
        </Field>

        {/* `hasTool` and `requestedModel` (glob) predicates are still
            supported in the wire schema — they just don't get a UI
            surface. Advanced users edit them via the JSON editor or
            API; the four cases above cover every predicate the map's
            rule editor targets. */}
      </FieldGroup>

      <FieldGroup title={t('router.rules.target')}>
        <Field label={t('router.rules.field.target')}>
          <PopoverSingle
            value={rule.target ?? undefined}
            options={modelOptions}
            placeholder={t('router.rules.passthroughPlaceholder')}
            searchable
            disabled={readOnly}
            onChange={(v) => patch({ target: v === undefined ? null : v })}
          />
          {/* Surface the passthrough behaviour so an empty picker doesn't
              look like an unfinished config — it's a legitimate choice
              (matched requests skip the rewrite and go out as-is). */}
          <p className='text-[10px] italic text-muted-foreground'>
            {rule.target === null || rule.target.length === 0
              ? t('router.rules.passthroughActive')
              : t('router.rules.passthroughHint')}
          </p>
        </Field>
        {/* Rules don't carry their own failover chain — a matched rule
            cascades through the scenario catch-all: rule target →
            scenario primary → scenario fallbacks. Keeping rules
            single-target keeps the priority order flat. */}
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

// Token-count input in "k" units. Stored values are raw token counts
// (60000) but the visible number is thousands (60), which matches how
// users think about context sizes. A small "k" hint sits inside the
// input on the right so the unit is obvious without adding another
// label. Empty input = undefined (no constraint).
function TokensInput({
  value,
  placeholder,
  disabled,
  onChange
}: {
  value: number | undefined
  placeholder: string
  disabled?: boolean
  onChange: (next: number | undefined) => void
}) {
  const displayed = value === undefined ? '' : value / 1000
  return (
    <div className='relative'>
      <Input
        className='h-7 pr-6 text-xs md:text-xs'
        type='number'
        min={0}
        step={1}
        value={displayed}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.valueAsNumber
          // 0 and empty both mean "no bound" — collapse to undefined
          // so the predicate summary + the saved rule stay clean.
          onChange(Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : undefined)
        }}
      />
      <span className='pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground'>
        k
      </span>
    </div>
  )
}

// Single-value picker built on Popover + Command, mirroring the
// MultiCombobox pattern the fallback list uses. `undefined` means no
// selection; the trigger shows `placeholder` in that state. When
// `searchable=false` the CommandInput is dropped so short 3-item
// enums (like the thinking tri-state) don't get an incongruous
// search box. Exported so the routing-map panel can reuse it for its
// own primary / add-fallback pickers.
export function PopoverSingle({
  value,
  options,
  placeholder,
  searchable,
  disabled,
  onChange
}: {
  value: string | undefined
  options: readonly { value: string; label: string }[]
  placeholder: string
  searchable: boolean
  disabled?: boolean
  onChange: (next: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = value === undefined ? undefined : options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type='button'
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='h-7 w-full justify-between px-2 text-xs font-normal'
        >
          <span className={cn('truncate', selected === undefined && 'text-muted-foreground')}>
            {selected === undefined ? placeholder : selected.label}
          </span>
          <ChevronDown className='h-3 w-3 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[--radix-popover-trigger-width] p-0' align='start'>
        <Command>
          {searchable && <CommandInput placeholder='Search…' className='h-7 text-xs md:text-xs' />}
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  className='text-xs'
                  onSelect={() => {
                    onChange(option.value === value ? undefined : option.value)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('mr-1.5 h-3 w-3', option.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className='truncate'>{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
