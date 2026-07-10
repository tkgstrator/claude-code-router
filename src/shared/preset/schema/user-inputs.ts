/**
 * Apply collected user-input values onto a preset's configuration
 * (template -> configMappings -> legacy path-keyed overrides), the
 * core function shared by the CLI and UI install flows.
 */

import type { PresetConfigSection, PresetFile, RequiredInput, UserInputValues } from '../types'
import { applyConfigMappings } from './mappings'
import { setValueByPath } from './paths'
import { replaceTemplateVariables } from './template'

/**
 * Get all field ids defined in schema
 */
function getSchemaFields(schema?: RequiredInput[]): Set<string> {
  if (!schema) return new Set()
  return new Set(schema.map((field) => field.id))
}

/**
 * Apply user inputs to preset configuration
 * This is the core function of the preset configuration system, uniformly handling
 * configuration application for both CLI and UI layers
 *
 * @param presetFile Preset file object
 * @param values User input values (schema id -> value)
 * @returns Applied configuration object
 */
export function applyUserInputs(presetFile: PresetFile, values: UserInputValues): PresetConfigSection {
  let config: PresetConfigSection = {}

  // Get field ids defined in schema, for subsequent filtering
  const schemaFields = getSchemaFields(presetFile.schema)

  // 1. First apply template (if exists)
  // template completely defines configuration structure, using #{variable} placeholders
  if (presetFile.template) {
    config = replaceTemplateVariables(presetFile.template, values) as any
  } else {
    // If no template, start from preset's existing config
    // Keep all fields, including schema's id fields (because they may contain placeholders)
    // These fields will be updated or replaced in subsequent configMappings
    config = presetFile.config ? { ...presetFile.config } : {}

    // Replace placeholders in config (e.g. #{apiKey} -> actual value)
    config = replaceTemplateVariables(config, values) as any

    // Finally, remove schema id fields (they should not appear in final configuration)
    for (const schemaField of schemaFields) {
      delete config[schemaField]
    }
  }

  // 2. Then apply configMappings (if exists)
  // Map user inputs to specific configuration paths
  if (presetFile.configMappings && presetFile.configMappings.length > 0) {
    config = applyConfigMappings(presetFile.configMappings, values, config)
  }

  // 3. Compatible with legacy: apply to keys containing paths (e.g. "Providers[0].api_key")
  for (const [key, value] of Object.entries(values)) {
    if (key.includes('.') || key.includes('[')) {
      setValueByPath(config, key, value)
    }
  }

  return config
}
