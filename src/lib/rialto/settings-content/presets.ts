/**
 * Pure helpers for the Presets settings section.
 *
 * The interesting one is `presetDiff`: the old flow asked the operator to
 * confirm an apply without ever showing what it would overwrite. The diff
 * is computed entirely client-side from the preset manifest and the live
 * config, so it costs no round-trip and can be shown before the operator
 * commits.
 */
import type { PresetConfigSection, RequiredInput } from '@/lib/presets/types'
import type { Config } from '@/types'

export interface PresetCounts {
  providers: number
  models: number
}

const readArray = (source: object, key: string): unknown[] => {
  const value = Reflect.get(source, key)
  return Array.isArray(value) ? value : []
}

const readString = (source: unknown, key: string): string | null => {
  if (source === null || typeof source !== 'object') return null
  const value = Reflect.get(source, key)
  return typeof value === 'string' && value !== '' ? value : null
}

/** Providers and models a preset carries, for the list row's second line. */
export function presetCounts(config: PresetConfigSection | undefined): PresetCounts {
  if (config === undefined) return { providers: 0, models: 0 }
  const providers = readArray(config, 'Providers')
  const models = providers.reduce<number>(
    (total, provider) =>
      provider !== null && typeof provider === 'object' ? total + readArray(provider, 'models').length : total,
    0
  )
  return { providers: providers.length, models }
}

export type DiffKind = 'add' | 'change' | 'same'

export interface DiffRow {
  key: string
  kind: DiffKind
  /** The thing being changed: `provider`, `Router.default.agent`. */
  label: string
  /** Emphasised subject, for rows that name one. */
  name: string | null
  from: string | null
  to: string | null
}

// The scenarios a preset manifest can bind. `background` is deliberately
// absent — it stopped being a first-class scenario, and the installer
// folds a legacy value into a predicated rule on `default` instead.
const SCENARIOS = ['default', 'think', 'longContext', 'webSearch', 'image'] as const

const providerRows = (presetConfig: PresetConfigSection, current: Config): DiffRow[] =>
  readArray(presetConfig, 'Providers').flatMap<DiffRow>((provider) => {
    const name = readString(provider, 'name')
    if (name === null) return []
    const existing = current.Providers.find((p) => p.name === name)
    if (existing === undefined) {
      return [{ key: `provider:${name}`, kind: 'add' as const, label: 'provider', name, from: null, to: null }]
    }
    const incoming = provider !== null && typeof provider === 'object' ? readArray(provider, 'models').length : 0
    if (incoming === existing.models.length) return []
    return [
      {
        key: `provider:${name}`,
        kind: 'change' as const,
        label: 'provider',
        name,
        from: `${existing.models.length} models`,
        to: `${incoming} models`
      }
    ]
  })

const routerRows = (presetConfig: PresetConfigSection, current: Config): DiffRow[] => {
  const presetRouter = Reflect.get(presetConfig, 'Router')
  if (presetRouter === null || typeof presetRouter !== 'object') return []
  return SCENARIOS.flatMap<DiffRow>((scenario) => {
    const to = readString(presetRouter, scenario)
    if (to === null) return []
    const from = current.Router[scenario].agent.primary
    if (from === to) return []
    return [
      {
        key: `router:${scenario}`,
        kind: 'change' as const,
        label: `Router.${scenario}.agent`,
        name: null,
        from: from === null ? '(unset)' : from,
        to
      }
    ]
  })
}

/**
 * What applying this preset would do to the live config. Subscription
 * providers get their own row because a preset can never touch them —
 * their credentials are OAuth accounts, not manifest fields — and that is
 * the reassurance the operator needs before pressing Apply.
 */
export function presetDiff(presetConfig: PresetConfigSection | undefined, current: Config): DiffRow[] {
  if (presetConfig === undefined) return []
  const untouched = current.Providers.filter((p) => p.auth_mode === 'subscription').length
  const tail: DiffRow[] =
    untouched === 0
      ? []
      : [
          {
            key: 'subscriptions',
            kind: 'same',
            label: `${untouched} subscription provider${untouched === 1 ? '' : 's'} untouched`,
            name: null,
            from: null,
            to: null
          }
        ]
  return [...providerRows(presetConfig, current), ...routerRows(presetConfig, current), ...tail]
}

export interface SeededInputs {
  values: Record<string, unknown>
  /** Fields whose value the server already holds and must not re-emit. */
  storedIds: string[]
}

/**
 * Initial state for the input form.
 *
 * A `password` field is never seeded, even when the server sent back a
 * previously-saved value: replaying a key into the DOM puts it in the
 * page source, the accessibility tree, and any screenshot of the screen.
 * It is reported as stored instead, so the operator knows they do not
 * have to retype it.
 */
export function seedInputs(schema: RequiredInput[], userValues: Record<string, unknown> | undefined): SeededInputs {
  const saved = userValues === undefined ? {} : userValues
  const storedIds = schema
    .filter((field) => field.type === 'password' && saved[field.id] !== undefined && saved[field.id] !== '')
    .map((field) => field.id)
  const values: Record<string, unknown> = {}
  for (const field of schema) {
    if (field.type === 'password') continue
    const savedValue = saved[field.id]
    values[field.id] =
      savedValue === undefined ? (field.defaultValue === undefined ? '' : field.defaultValue) : savedValue
  }
  return { values, storedIds }
}

/**
 * Ids of required inputs the operator has not filled. `confirm` fields
 * are excluded from the empty test: `false` is an answer. A secret the
 * server already holds counts as filled — `seedInputs` deliberately
 * leaves its box empty, and demanding it again would be a lie.
 */
export function missingInputIds(
  schema: RequiredInput[],
  values: Record<string, unknown>,
  storedIds: string[] = []
): string[] {
  return schema
    .filter((field) => {
      if (field.required === false || storedIds.includes(field.id)) return false
      const value = values[field.id]
      if (typeof value === 'boolean') return false
      if (Array.isArray(value)) return value.length === 0
      return value === undefined || value === null || value === ''
    })
    .map((field) => field.id)
}
