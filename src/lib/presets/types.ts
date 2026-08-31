// Shared shapes for the Presets page and its DynamicConfigForm sub-component.
// These mirror the preset manifest schema (see src/schemas/domain/preset.ts) but
// are kept local/loose on purpose: the UI only ever reads these fields off of
// already-parsed API responses, it never re-validates them.

export interface InputOption {
  label: string
  value: string | number | boolean
  description?: string
  disabled?: boolean
}

export interface DynamicOptions {
  type: 'static' | 'providers' | 'models' | 'custom'
  options?: InputOption[]
  providerField?: string
}

export interface Condition {
  field: string
  operator?: 'eq' | 'ne' | 'in' | 'nin' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists'
  // biome-ignore lint/suspicious/noExplicitAny: condition values are arbitrary JSON from the preset manifest
  value?: any
}

export interface RequiredInput {
  id: string
  type?: 'password' | 'input' | 'select' | 'multiselect' | 'confirm' | 'editor' | 'number'
  label?: string
  prompt?: string
  placeholder?: string
  options?: InputOption[] | DynamicOptions
  when?: Condition | Condition[]
  // biome-ignore lint/suspicious/noExplicitAny: default values are arbitrary JSON from the preset manifest
  defaultValue?: any
  required?: boolean
  // biome-ignore lint/suspicious/noExplicitAny: custom validators may accept any JSON value
  validator?: RegExp | string | ((value: any) => boolean | string)
  min?: number
  max?: number
  rows?: number
  dependsOn?: string[]
}

export interface PresetConfigSection {
  Providers?: Array<{
    name: string
    api_base_url?: string
    models?: string[]
    // biome-ignore lint/suspicious/noExplicitAny: passthrough of arbitrary manifest fields
    [key: string]: any
  }>
  // biome-ignore lint/suspicious/noExplicitAny: passthrough of arbitrary manifest fields
  [key: string]: any
}

export interface PresetMetadata {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  ccrVersion?: string
  source?: string
  sourceType?: 'local' | 'gist' | 'registry'
  checksum?: string
  installed: boolean
}

export interface PresetDetail extends PresetMetadata {
  config?: PresetConfigSection
  schema?: RequiredInput[]
  // biome-ignore lint/suspicious/noExplicitAny: raw manifest template, shape varies per preset
  template?: any
  // biome-ignore lint/suspicious/noExplicitAny: raw manifest config mappings, shape varies per preset
  configMappings?: any[]
  // biome-ignore lint/suspicious/noExplicitAny: user-submitted form values, one entry per schema field
  userValues?: Record<string, any>
}

export interface MarketPreset {
  id: string
  name: string
  author?: string
  description?: string
  repo: string
}
