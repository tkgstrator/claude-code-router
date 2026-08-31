/**
 * Zod schemas for preset functionality.
 *
 * Free-form JSON values use the recursive `JsonValue` schema instead of
 * `z.any()` / `z.unknown()` so every value still has a real, validatable
 * type.
 *
 * `PresetProviderSchema` is deliberately a narrower projection of
 * domain/provider.ts, not an alias of it: a preset is shareable, so auth
 * modes, sub-accounts and test state must not be able to ride along.
 * The same reasoning gives `PresetRouterConfigSchema` and
 * `PresetTransformerConfigSchema` their own names.
 */

import { z } from '@hono/zod-openapi'

// --- Enums ------------------------------------------------------------------
//
// Defined here (rather than in `@/shared/preset/types`) because they are
// also wrapped in Zod schemas below — keeping the enum + schema together
// avoids a circular import between `@/schemas` and `@/shared/preset`.

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

// --- JSON value (recursive) -------------------------------------------------

// Empty strings are legal JSON string values — a rule's `name: ""` is a
// legitimate config, not a schema violation. Object KEYS keep the
// nonempty guard below (record keys) so we still reject `{"": ...}`
// entries that could shadow real keys.
export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string().nonempty(), JsonValueSchema)])
)

export const JsonObjectSchema = z.record(z.string().nonempty(), JsonValueSchema)
export type JsonObject = z.infer<typeof JsonObjectSchema>

// --- InputType enum schema (mirrors the shared enum) ------------------------

const InputTypeSchema = z.nativeEnum(InputType)

// --- Dynamic configuration --------------------------------------------------

export const UserInputValuesSchema = z.record(z.string().nonempty(), JsonValueSchema)
export type UserInputValues = z.infer<typeof UserInputValuesSchema>

export const InputOptionSchema = z.object({
  label: z.string().nonempty(),
  value: z.union([z.string().nonempty(), z.number(), z.boolean()]),
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
  field: z.string().nonempty(),
  operator: z.enum(['eq', 'ne', 'in', 'nin', 'gt', 'lt', 'gte', 'lte', 'exists']).optional(),
  value: JsonValueSchema.optional()
})
export type Condition = z.infer<typeof ConditionSchema>

// `validator` cannot be represented in a JSON schema (it may be a
// function), so it is a TS-only union layered on top of the Zod shape.
export type Validator = RegExp | string | ((value: JsonValue) => boolean | string)

const RequiredInputBaseSchema = z.object({
  id: z.string().nonempty(),
  type: InputTypeSchema.optional(),
  label: z.string().optional(),
  prompt: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.union([z.array(InputOptionSchema), DynamicOptionsSchema]).optional(),
  when: z.union([ConditionSchema, z.array(ConditionSchema)]).optional(),
  defaultValue: JsonValueSchema.optional(),
  required: z.boolean().optional(),
  // min/max are validator bounds for the input value, which may be a
  // float (e.g. 0.5 ≤ temperature ≤ 1.0) — kept as plain numbers.
  min: z.number().optional(),
  max: z.number().optional(),
  rows: z.number().int().positive().optional(),
  dependsOn: z.array(z.string().nonempty()).optional()
})
export const RequiredInputSchema = RequiredInputBaseSchema
export type RequiredInput = z.infer<typeof RequiredInputBaseSchema> & {
  validator?: Validator
}

// --- Preset Provider / Router / Transformer ---------------------------------
//
// These are the preset-file shapes (manifest.json contents). They are
// distinct from the API-wire Provider/Router/Transformer shapes in the
// sibling *.dto.ts files, hence the `Preset` prefix.

export const PresetProviderSchema = z
  .object({
    name: z.string().nonempty(),
    api_base_url: z.url(),
    api_key: z.string().nonempty(),
    models: z.array(z.string().nonempty()).default([]),
    transformer: JsonValueSchema.optional()
  })
  .catchall(JsonValueSchema)
export type PresetProvider = z.infer<typeof PresetProviderSchema>

export const PresetRouterConfigSchema = z
  .object({
    default: z.string().nonempty().optional(),
    // `background` was removed as a first-class scenario; presets may
    // still carry it in the catchall bucket for backward compatibility,
    // but the installer maps it into a haiku-predicated rule on default.
    think: z.string().nonempty().optional(),
    longContext: z.string().nonempty().optional(),
    longContextThreshold: z.number().optional(),
    webSearch: z.string().nonempty().optional(),
    image: z.string().nonempty().optional()
  })
  .catchall(z.union([z.string().nonempty(), z.number()]))
export type PresetRouterConfig = z.infer<typeof PresetRouterConfigSchema>

export const PresetTransformerConfigSchema = z
  .object({
    path: z.string().optional(),
    use: z.array(z.union([z.string().nonempty(), z.tuple([z.string().nonempty(), JsonValueSchema])])),
    options: JsonValueSchema.optional()
  })
  .catchall(JsonValueSchema)
export type PresetTransformerConfig = z.infer<typeof PresetTransformerConfigSchema>

// --- Preset metadata / sections ---------------------------------------------

export const PresetMetadataSchema = z.object({
  name: z.string().nonempty(),
  version: z.string().nonempty(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string().nonempty()).optional(),
  // The app version the preset was authored against. `ccrVersion` is the
  // pre-rename spelling and stays accepted: preset manifests are files
  // users already have on disk or share with each other, and an object
  // schema drops keys it does not declare — so removing it would quietly
  // strip the field on the next round-trip through the UI.
  rialtoVersion: z.string().optional(),
  ccrVersion: z.string().optional(),
  source: z.string().optional(),
  sourceType: z.enum(['local', 'gist', 'registry']).optional(),
  checksum: z.string().optional()
})
export type PresetMetadata = z.infer<typeof PresetMetadataSchema>

export const PresetConfigSectionSchema = z
  .object({
    Providers: z.array(PresetProviderSchema).optional(),
    Router: PresetRouterConfigSchema.optional(),
    transformers: z.array(PresetTransformerConfigSchema).optional(),
    StatusLine: JsonValueSchema.optional(),
    NON_INTERACTIVE_MODE: z.boolean().optional(),
    noServer: z.boolean().optional(),
    claudeCodeSettings: z
      .object({
        env: z.record(z.string().nonempty(), JsonValueSchema).optional(),
        statusLine: JsonValueSchema.optional()
      })
      .catchall(JsonValueSchema)
      .optional()
  })
  .catchall(JsonValueSchema)
export type PresetConfigSection = z.infer<typeof PresetConfigSectionSchema>

export const TemplateConfigSchema = z.record(z.string().nonempty(), JsonValueSchema)
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>

export const ConfigMappingSchema = z.object({
  target: z.string().nonempty(),
  value: JsonValueSchema,
  when: z.union([ConditionSchema, z.array(ConditionSchema)]).optional()
})
export type ConfigMapping = z.infer<typeof ConfigMappingSchema>

export const PresetFileSchema = z.object({
  metadata: PresetMetadataSchema.optional(),
  config: PresetConfigSectionSchema,
  secrets: z.record(z.string().nonempty(), z.string().nonempty()).optional(),
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
  id: z.string().nonempty(),
  name: z.string().nonempty(),
  description: z.string().optional(),
  version: z.string().nonempty(),
  author: z.string().optional(),
  downloads: z.number().optional(),
  stars: z.number().optional(),
  tags: z.array(z.string().nonempty()).optional(),
  url: z.string().nonempty(),
  repo: z.string().optional(),
  checksum: z.string().optional(),
  rialtoVersion: z.string().optional(),
  // Pre-rename spelling — see PresetMetadataSchema.
  ccrVersion: z.string().optional()
})
export type PresetIndexEntry = z.infer<typeof PresetIndexEntrySchema>

export const PresetRegistrySchema = z.object({
  version: z.string().nonempty(),
  lastUpdated: z.string().nonempty(),
  presets: z.array(PresetIndexEntrySchema)
})
export type PresetRegistry = z.infer<typeof PresetRegistrySchema>

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string().nonempty()),
  warnings: z.array(z.string().nonempty())
})
export type ValidationResult = z.infer<typeof ValidationResultSchema>

export const SanitizeResultSchema = z.object({
  sanitizedConfig: JsonObjectSchema,
  sanitizedCount: z.number().int().nonnegative()
})
export type SanitizeResult = z.infer<typeof SanitizeResultSchema>

export const PresetInfoSchema = z.object({
  name: z.string().nonempty(),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  config: PresetConfigSectionSchema
})
export type PresetInfo = z.infer<typeof PresetInfoSchema>
