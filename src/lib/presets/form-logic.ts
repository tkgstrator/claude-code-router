// Pure evaluation/validation logic for DynamicConfigForm, kept dependency-free
// (no React) so the `when`-condition and validator rules can be reasoned
// about and tested without mounting the form.

import type { Condition, InputOption, PresetConfigSection, RequiredInput } from './types'

// biome-ignore lint/suspicious/noExplicitAny: form values are keyed by schema field id and hold arbitrary JSON
type FormValues = Record<string, any>

export function evaluateCondition(condition: Condition, values: FormValues): boolean {
  const actualValue = values[condition.field]

  if (condition.operator === 'exists') {
    return actualValue !== undefined && actualValue !== null
  }

  if (condition.operator === 'in') {
    return Array.isArray(condition.value) && condition.value.includes(actualValue)
  }

  if (condition.operator === 'nin') {
    return Array.isArray(condition.value) && !condition.value.includes(actualValue)
  }

  switch (condition.operator) {
    case 'eq':
      return actualValue === condition.value
    case 'ne':
      return actualValue !== condition.value
    case 'gt':
      return actualValue > condition.value
    case 'lt':
      return actualValue < condition.value
    case 'gte':
      return actualValue >= condition.value
    case 'lte':
      return actualValue <= condition.value
    default:
      return actualValue === condition.value
  }
}

export function shouldShowField(field: RequiredInput, values: FormValues): boolean {
  if (!field.when) {
    return true
  }
  const conditions = Array.isArray(field.when) ? field.when : [field.when]
  return conditions.every((condition) => evaluateCondition(condition, values))
}

export function getOptions(field: RequiredInput, presetConfig: PresetConfigSection, values: FormValues): InputOption[] {
  if (!field.options) {
    return []
  }

  const options = field.options
  if (Array.isArray(options)) {
    return options
  }

  if (options.type === 'static') {
    return options.options || []
  }

  if (options.type === 'providers') {
    const providers = presetConfig.Providers || []
    return providers.map((p) => ({
      label: p.name || p.id || String(p),
      value: p.name || p.id || String(p),
      description: p.api_base_url
    }))
  }

  if (options.type === 'models') {
    const providerField = options.providerField
    if (!providerField) {
      return []
    }

    const providerId = String(providerField).replace(/^{{(.+)}}$/, '$1')
    const selectedProvider = values[providerId]

    if (!selectedProvider || !presetConfig.Providers) {
      return []
    }

    const provider = presetConfig.Providers.find((p) => p.name === selectedProvider || p.id === selectedProvider)

    if (!provider || !provider.models) {
      return []
    }

    return provider.models.map((model: string) => ({
      label: model,
      value: model
    }))
  }

  return []
}

// `validateField` lived here and was the only reader of the five
// `presets.form.*` locale keys. Nothing called it: the required-input
// check moved to `missingInputIds` (src/lib/rialto/settings-content/presets.ts),
// which `SettingsPresets` and `PresetPane` actually use. Keeping a dead
// function alive kept five keys alive with it, and a key-parity check
// cannot tell that apart from a real reference.
//
// Note what did NOT move with it: `missingInputIds` only tests for
// emptiness, so a preset manifest's `min` / `max` / `validator` on a
// required input is accepted and ignored. That gap predates this
// deletion — the code implementing it had already stopped running.
