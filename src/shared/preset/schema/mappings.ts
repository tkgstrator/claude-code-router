/**
 * Apply a preset's `configMappings` (user-input -> config-path
 * assignments), each optionally gated by a `when` condition.
 */

import type { ConfigMapping, PresetConfigSection, UserInputValues } from '../types'
import { evaluateConditions } from './conditions'
import { setValueByPath } from './paths'

/**
 * Apply configuration mappings
 */
export function applyConfigMappings(
  mappings: ConfigMapping[],
  values: UserInputValues,
  config: PresetConfigSection
): PresetConfigSection {
  const result = { ...config }

  for (const mapping of mappings) {
    // Check condition
    if (mapping.when && !evaluateConditions(mapping.when, values)) {
      continue
    }

    // Resolve value
    let value: any
    if (typeof mapping.value === 'string' && mapping.value.startsWith('#')) {
      // Variable reference
      const varName = mapping.value.replace(/^#{(.+)}$/, '$1')
      value = values[varName]
    } else {
      // Fixed value
      value = mapping.value
    }

    // Apply to target path
    setValueByPath(result, mapping.target, value)
  }

  return result
}
