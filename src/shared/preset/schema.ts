/**
 * Dynamic configuration Schema handler
 * Responsible for parsing and validating configuration schema, handling conditional logic and variable replacement
 */

import path from 'node:path'
import {
  type Condition,
  type ConfigMapping,
  type DynamicOptions,
  type InputOption,
  InputType,
  type ManifestFile,
  type PresetConfigSection,
  type PresetFile,
  type RequiredInput,
  type UserInputValues
} from './types'

/**
 * Parse field path (supports arrays and nesting)
 * Example: Providers[0].name => ['Providers', '0', 'name']
 */
export function parseFieldPath(path: string): string[] {
  const regex = /(\w+)|\[(\d+)\]/g
  const parts: string[] = []
  let match: RegExpExecArray | null = regex.exec(path)

  while (match !== null) {
    parts.push(match[1] || match[2])
    match = regex.exec(path)
  }

  return parts
}

/**
 * Set value in object by field path
 */
export function setValueByPath(obj: any, path: string, value: any): void {
  const parts = parseFieldPath(path)
  const lastKey = parts.pop()!
  let current = obj

  for (const part of parts) {
    if (!(part in current)) {
      // Determine if it's an array or object
      const nextPart = parts[parts.indexOf(part) + 1]
      if (nextPart && /^\d+$/.test(nextPart)) {
        current[part] = []
      } else {
        current[part] = {}
      }
    }
    current = current[part]
  }

  current[lastKey] = value
}

/**
 * Evaluate conditional expression
 */
export function evaluateCondition(condition: Condition, values: UserInputValues): boolean {
  const actualValue = values[condition.field]

  // Handle exists operator
  if (condition.operator === 'exists') {
    return actualValue !== undefined && actualValue !== null
  }

  // Handle in operator
  if (condition.operator === 'in') {
    return Array.isArray(condition.value) && condition.value.includes(actualValue)
  }

  // Handle nin operator
  if (condition.operator === 'nin') {
    return Array.isArray(condition.value) && !condition.value.includes(actualValue)
  }

  // Handle other operators
  switch (condition.operator) {
    case 'eq':
      return actualValue === condition.value
    case 'ne':
      return actualValue !== condition.value
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      // Relational operators only make sense for numeric values.
      if (typeof actualValue !== 'number' || typeof condition.value !== 'number') {
        return false
      }
      if (condition.operator === 'gt') return actualValue > condition.value
      if (condition.operator === 'lt') return actualValue < condition.value
      if (condition.operator === 'gte') return actualValue >= condition.value
      return actualValue <= condition.value
    }
    default:
      // Default to eq
      return actualValue === condition.value
  }
}

/**
 * Evaluate multiple conditions (AND logic)
 */
export function evaluateConditions(conditions: Condition | Condition[], values: UserInputValues): boolean {
  if (!conditions) {
    return true
  }

  if (!Array.isArray(conditions)) {
    return evaluateCondition(conditions, values)
  }

  // If array, use AND logic (all conditions must be satisfied)
  return conditions.every((condition) => evaluateCondition(condition, values))
}

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

/**
 * Template variable replacement
 * Supports #{variable} syntax (different from statusline's {{variable}} format)
 */
export function replaceTemplateVariables(template: any, values: UserInputValues): any {
  if (template === null || template === undefined) {
    return template
  }

  // Handle strings
  if (typeof template === 'string') {
    return template.replace(/#{(\w+)}/g, (_, key) => {
      return values[key] !== undefined ? String(values[key]) : ''
    })
  }

  // Handle arrays
  if (Array.isArray(template)) {
    return template.map((item) => replaceTemplateVariables(item, values))
  }

  // Handle objects
  if (typeof template === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(template)) {
      result[key] = replaceTemplateVariables(value, values)
    }
    return result
  }

  // Return other types directly
  return template
}

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

/**
 * Build field dependency graph (for optimizing update order)
 */
export function buildDependencyGraph(fields: RequiredInput[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  for (const field of fields) {
    const deps = new Set<string>()

    // Extract from dependsOn
    if (field.dependsOn) {
      for (const dep of field.dependsOn) {
        deps.add(dep)
      }
    }

    // Extract dependencies from when conditions
    if (field.when) {
      const conditions = Array.isArray(field.when) ? field.when : [field.when]
      for (const cond of conditions) {
        deps.add(cond.field)
      }
    }

    // Extract dependencies from dynamic options
    if (field.options) {
      const options = field.options as any
      if (options.type === 'models' && options.providerField) {
        const providerId = String(options.providerField).replace(/^#{(.+)}$/, '$1')
        deps.add(providerId)
      }
    }

    graph.set(field.id, deps)
  }

  return graph
}

/**
 * Process StatusLine configuration, convert relative scriptPath to absolute path
 * @param statusLineConfig StatusLine configuration
 * @param presetDir Preset directory path
 */
function processStatusLineConfig(statusLineConfig: any, presetDir?: string): any {
  if (!statusLineConfig || typeof statusLineConfig !== 'object') {
    return statusLineConfig
  }

  const result = { ...statusLineConfig }

  // Process each theme's modules
  for (const themeKey of Object.keys(result)) {
    const theme = result[themeKey]
    if (theme && typeof theme === 'object' && theme.modules) {
      const modules = Array.isArray(theme.modules) ? theme.modules : []
      const processedModules = modules.map((module: any) => {
        // If module has scriptPath and presetDir is provided, convert to absolute path
        if (module.scriptPath && presetDir && !module.scriptPath.startsWith('/')) {
          return {
            ...module,
            scriptPath: path.join(presetDir, module.scriptPath)
          }
        }
        return module
      })
      result[themeKey] = {
        ...theme,
        modules: processedModules
      }
    }
  }

  return result
}

/**
 * Process transformers configuration, convert relative path to absolute path
 * @param transformersConfig Transformers configuration array
 * @param presetDir Preset directory path
 */
function processTransformersConfig(transformersConfig: any[], presetDir?: string): any[] {
  if (!transformersConfig || !Array.isArray(transformersConfig)) {
    return transformersConfig
  }

  if (!presetDir) {
    return transformersConfig
  }

  return transformersConfig.map((transformer: any) => {
    // If transformer has path and it's a relative path, convert to absolute path
    if (transformer.path && !transformer.path.startsWith('/')) {
      return {
        ...transformer,
        path: path.join(presetDir, transformer.path)
      }
    }
    return transformer
  })
}
