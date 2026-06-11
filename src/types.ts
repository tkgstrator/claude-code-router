// Type-only shim that re-exports every domain type from src/schemas.
// New code should import from '@/schemas' directly; this file exists
// so existing `from '@/types'` imports keep working without churn.
export type {
  AccessLevel,
  Config,
  Persona,
  Provider,
  ProviderAuthMode,
  ProviderTransformer,
  RouterConfig,
  StatusLineConfig,
  StatusLineModuleConfig,
  StatusLineThemeConfig,
  Transformer
} from '@/schemas'

// Schemas that were value-exported from this file before the move.
export {
  AccessLevelSchema,
  ConfigSchema,
  ProviderAuthModeSchema,
  ProviderSchema,
  ProviderTransformerSchema,
  RouterConfigSchema,
  StatusLineConfigSchema,
  StatusLineModuleConfigSchema,
  StatusLineThemeConfigSchema,
  TransformerSchema
} from '@/schemas'
