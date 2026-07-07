// Pure evaluation/validation logic for DynamicConfigForm, kept dependency-free
// (no React) so the `when`-condition and validator rules can be reasoned
// about and tested without mounting the form.

import type { Condition, InputOption, PresetConfigSection, RequiredInput } from './types'

// react-i18next's t(), trimmed to the shape validateField actually calls.
type Translate = (key: string, options?: Record<string, unknown>) => string

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

export function validateField(field: RequiredInput, values: FormValues, t: Translate): string | null {
  const value = values[field.id]
  const fieldName = field.label || field.id

  // Check required (for confirm type, false is a valid value)
  const isEmpty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

  if (field.required !== false && isEmpty) {
    return t('presets.form.field_required', { field: fieldName })
  }

  // Type check
  if (field.type === 'number' && value !== '' && isNaN(Number(value))) {
    return t('presets.form.must_be_number', { field: fieldName })
  }

  if (field.type === 'number') {
    const numValue = Number(value)
    if (field.min !== undefined && numValue < field.min) {
      return t('presets.form.must_be_at_least', { field: fieldName, min: field.min })
    }
    if (field.max !== undefined && numValue > field.max) {
      return t('presets.form.must_be_at_most', { field: fieldName, max: field.max })
    }
  }

  // Custom validator
  if (field.validator && value !== '') {
    if (field.validator instanceof RegExp) {
      if (!field.validator.test(String(value))) {
        return t('presets.form.format_invalid', { field: fieldName })
      }
    } else if (typeof field.validator === 'string') {
      const regex = new RegExp(field.validator)
      if (!regex.test(String(value))) {
        return t('presets.form.format_invalid', { field: fieldName })
      }
    }
  }

  return null
}
