/**
 * Type definitions for preset functionality
 *
 * Shapes are declared as Zod schemas; the TypeScript types are derived
 * via `z.infer`. Free-form JSON values use the recursive `JsonValue`
 * schema instead of `z.any()` / `z.unknown()` so every value still has
 * a real, validatable type.
 */

import { z } from 'zod'

// --- JSON value (recursive) -------------------------------------------------

export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)])
)

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema)
export type JsonObject = z.infer<typeof JsonObjectSchema>

// --- Enums ------------------------------------------------------------------

export enum InputType {
  PASSWORD = 'password',
  INPUT = 'input',
  SELECT = 'select',
  MULTISELECT = 'multiselect',
  CONFIRM = 'confirm',
  EDITOR = 'editor',
  NUMBER = 'number'
}

export enum MergeStrategy {
  ASK = 'ask',
  OVERWRITE = 'overwrite',
  MERGE = 'merge',
  SKIP = 'skip'
}

const InputTypeSchema = z.nativeEnum(InputType)

// --- Dynamic configuration --------------------------------------------------

export const UserInputValuesSchema = z.record(z.string(), JsonValueSchema)
export type UserInputValues = z.infer<typeof UserInputValuesSchema>

export const InputOptionSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
  icon: z.string().optional()
})
export type InputOption = z.infer<typeof InputOptionSchema>

export const DynamicOptionsSchema = z.object({
  type: z.enum(['static', 'providers', 'models', 'custom']),
  options: z.array(InputOptionSchema).optional(),
  providerField: z.string().optional(),
  source: z.string().optional()
})
export type DynamicOptions = z.infer<typeof DynamicOptionsSchema>

export const ConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'ne', 'in', 'nin', 'gt', 'lt', 'gte', 'lte', 'exists']).optional(),
  value: JsonValueSchema.optional()
})
export type Condition = z.infer<typeof ConditionSchema>

// `validator` cannot be represented in a JSON schema (it may be a
// function), so it is a TS-only union layered on top of the Zod shape.
export type Validator = RegExp | string | ((value: JsonValue) => boolean | string)

const RequiredInputBaseSchema = z.object({
  id: z.string(),
  type: InputTypeSchema.optional(),
  label: z.string().optional(),
  prompt: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.union([z.array(InputOptionSchema), DynamicOptionsSchema]).optional(),
  when: z.union([ConditionSchema, z.array(ConditionSchema)]).optional(),
  defaultValue: JsonValueSchema.optional(),
  required: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  rows: z.number().optional(),
  dependsOn: z.array(z.string()).optional()
})
export const RequiredInputSchema = RequiredInputBaseSchema
export type RequiredInput = z.infer<typeof RequiredInputBaseSchema> & {
  validator?: Validator
}

// --- Provider / Router / Transformer ----------------------------------------

export const ProviderConfigSchema = z
  .object({
    name: z.string(),
    api_base_url: z.string(),
    api_key: z.string(),
    models: z.array(z.string()),
    transformer: JsonValueSchema.optional()
  })
  .catchall(JsonValueSchema)
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const RouterConfigSchema = z
  .object({
    default: z.string().optional(),
    background: z.string().optional(),
    think: z.string().optional(),
    longContext: z.string().optional(),
    longContextThreshold: z.number().optional(),
    webSearch: z.string().optional(),
    image: z.string().optional()
  })
  .catchall(z.union([z.string(), z.number()]))
export type RouterConfig = z.infer<typeof RouterConfigSchema>

export const TransformerConfigSchema = z
  .object({
    path: z.string().optional(),
    use: z.array(z.union([z.string(), z.tuple([z.string(), JsonValueSchema])])),
    options: JsonValueSchema.optional()
  })
  .catchall(JsonValueSchema)
export type TransformerConfig = z.infer<typeof TransformerConfigSchema>

// --- Preset metadata / sections ---------------------------------------------

export const PresetMetadataSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  ccrVersion: z.string().optional(),
  source: z.string().optional(),
  sourceType: z.enum(['local', 'gist', 'registry']).optional(),
  checksum: z.string().optional()
})
export type PresetMetadata = z.infer<typeof PresetMetadataSchema>

export const PresetConfigSectionSchema = z
  .object({
    Providers: z.array(ProviderConfigSchema).optional(),
    Router: RouterConfigSchema.optional(),
    transformers: z.array(TransformerConfigSchema).optional(),
    StatusLine: JsonValueSchema.optional(),
    NON_INTERACTIVE_MODE: z.boolean().optional(),
    noServer: z.boolean().optional(),
    claudeCodeSettings: z
      .object({
        env: z.record(z.string(), JsonValueSchema).optional(),
        statusLine: JsonValueSchema.optional()
      })
      .catchall(JsonValueSchema)
      .optional()
  })
  .catchall(JsonValueSchema)
export type PresetConfigSection = z.infer<typeof PresetConfigSectionSchema>

export const TemplateConfigSchema = z.record(z.string(), JsonValueSchema)
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>

export const ConfigMappingSchema = z.object({
  target: z.string(),
  value: JsonValueSchema,
  when: z.union([ConditionSchema, z.array(ConditionSchema)]).optional()
})
export type ConfigMapping = z.infer<typeof ConfigMappingSchema>

export const PresetFileSchema = z.object({
  metadata: PresetMetadataSchema.optional(),
  config: PresetConfigSectionSchema,
  secrets: z.record(z.string(), z.string()).optional(),
  schema: z.array(RequiredInputBaseSchema).optional(),
  template: TemplateConfigSchema.optional(),
  configMappings: z.array(ConfigMappingSchema).optional()
})
export type PresetFile = {
  metadata?: PresetMetadata
  config: PresetConfigSection
  secrets?: Record<string, string>
  schema?: RequiredInput[]
  template?: TemplateConfig
  configMappings?: ConfigMapping[]
}

export const ManifestFileSchema = PresetMetadataSchema.merge(PresetConfigSectionSchema).extend({
  schema: z.array(RequiredInputBaseSchema).optional(),
  template: TemplateConfigSchema.optional(),
  configMappings: z.array(ConfigMappingSchema).optional(),
  userValues: UserInputValuesSchema.optional()
})
export type ManifestFile = PresetMetadata &
  PresetConfigSection & {
    schema?: RequiredInput[]
    template?: TemplateConfig
    configMappings?: ConfigMapping[]
    userValues?: UserInputValues
  }

export const PresetIndexEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  author: z.string().optional(),
  downloads: z.number().optional(),
  stars: z.number().optional(),
  tags: z.array(z.string()).optional(),
  url: z.string(),
  repo: z.string().optional(),
  checksum: z.string().optional(),
  ccrVersion: z.string().optional()
})
export type PresetIndexEntry = z.infer<typeof PresetIndexEntrySchema>

export const PresetRegistrySchema = z.object({
  version: z.string(),
  lastUpdated: z.string(),
  presets: z.array(PresetIndexEntrySchema)
})
export type PresetRegistry = z.infer<typeof PresetRegistrySchema>

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string())
})
export type ValidationResult = z.infer<typeof ValidationResultSchema>

export const SanitizeResultSchema = z.object({
  sanitizedConfig: JsonObjectSchema,
  sanitizedCount: z.number()
})
export type SanitizeResult = z.infer<typeof SanitizeResultSchema>

export const PresetInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  config: PresetConfigSectionSchema
})
export type PresetInfo = z.infer<typeof PresetInfoSchema>
