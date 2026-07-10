/**
 * Resolve a schema field's dynamic option list (static / providers /
 * models / custom) against the preset's own config + user inputs.
 */

import type { DynamicOptions, InputOption, PresetConfigSection, UserInputValues } from '../types'

/**
 * Get dynamic options list
 */
export function getDynamicOptions(
  dynamicOptions: DynamicOptions,
  presetConfig: PresetConfigSection,
  values: UserInputValues
): InputOption[] {
  switch (dynamicOptions.type) {
    case 'static':
      return dynamicOptions.options || []

    case 'providers': {
      // Extract options from preset's Providers
      const providers = presetConfig.Providers || []
      return providers.map((p: any) => ({
        label: p.name || p.id || String(p),
        value: p.name || p.id || String(p),
        description: p.api_base_url
      }))
    }

    case 'models': {
      // Extract from specified provider's models
      const providerField = dynamicOptions.providerField
      if (!providerField) {
        return []
      }

      // Parse provider reference (e.g. #{selectedProvider})
      const providerId = String(providerField).replace(/^#{(.+)}$/, '$1')
      const selectedProvider = values[providerId]

      if (!selectedProvider || !presetConfig.Providers) {
        return []
      }

      // Find corresponding provider
      const provider = presetConfig.Providers.find((p: any) => p.name === selectedProvider || p.id === selectedProvider)

      if (!provider?.models) {
        return []
      }

      return provider.models.map((model: string) => ({
        label: model,
        value: model
      }))
    }

    case 'custom':
      // Reserved, not implemented yet
      return []

    default:
      return []
  }
}
