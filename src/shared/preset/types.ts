/**
 * Plain TypeScript types and enums for preset functionality.
 *
 * Zod schemas (and the `InputType` / `MergeStrategy` enums they wrap)
 * have been relocated to `src/schemas/preset.dto.ts` so that all Zod
 * schemas in the repo live under `src/schemas/*.dto.ts`. The types and
 * enums below are re-exported from there via the `@/schemas` barrel —
 * this module exists so legacy `from '@/shared/preset/types'` imports
 * (notably the preset CLI tests and `shared/preset/schema.ts`) keep
 * working without churn.
 */

import type {
  Condition,
  ConfigMapping,
  DynamicOptions,
  InputOption,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ManifestFile,
  PresetConfigSection,
  PresetFile,
  PresetIndexEntry,
  PresetInfo,
  PresetMetadata,
  PresetProvider,
  PresetRegistry,
  PresetRouterConfig,
  PresetTransformerConfig,
  RequiredInput,
  SanitizeResult,
  TemplateConfig,
  UserInputValues,
  ValidationResult,
  Validator
} from '@/schemas'
import { InputType, MergeStrategy } from '@/schemas'

// Re-export the relocated types so legacy `from '@/shared/preset/types'`
// imports keep working.
export type {
  Condition,
  ConfigMapping,
  DynamicOptions,
  InputOption,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ManifestFile,
  PresetConfigSection,
  PresetFile,
  PresetIndexEntry,
  PresetInfo,
  PresetMetadata,
  PresetProvider,
  PresetRegistry,
  PresetRouterConfig,
  PresetTransformerConfig,
  RequiredInput,
  SanitizeResult,
  TemplateConfig,
  UserInputValues,
  ValidationResult,
  Validator
}

// Re-export the enum values too (these are runtime values, not just types).
export { InputType, MergeStrategy }

// Legacy aliases for the renamed preset-specific shapes. The originals
// shadowed the API-wire Provider/Router/Transformer types in the
// `@/schemas` barrel; the new names disambiguate. These aliases keep
// the legacy preset code (CLI export/install, etc.) compiling.
export type ProviderConfig = PresetProvider
export type RouterConfig = PresetRouterConfig
export type TransformerConfig = PresetTransformerConfig
