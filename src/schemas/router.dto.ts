import { z } from '@hono/zod-openapi'
import { SCENARIO_KEYS } from '@/shared/db/types'
import { EmptyStringToNullSchema } from './common.dto'

// Per-scenario ordered fallback chains. Each entry is a
// "providerName,modelName" string; the router walks the list in order
// when the primary slot model is rate-limited (proactively on a high
// usage percentage, or reactively on a 429). A missing list is an empty
// list — no fallbacks configured for that scenario.
const FallbackListSchema = z.array(z.string().nonempty()).default([])

export const RouterFallbacksSchema = z
  .object({
    default: FallbackListSchema,
    background: FallbackListSchema,
    think: FallbackListSchema,
    longContext: FallbackListSchema,
    webSearch: FallbackListSchema,
    image: FallbackListSchema
  })
  .openapi('RouterFallbacks')
export type RouterFallbacks = z.infer<typeof RouterFallbacksSchema>

// The all-empty fallbacks object. Used as the schema default (the
// object's output type requires every scenario key, so an empty `{}`
// default would not type-check) and by composeUiConfig.
export const emptyFallbacks = (): RouterFallbacks => ({
  default: [],
  background: [],
  think: [],
  longContext: [],
  webSearch: [],
  image: []
})

// API wire shape returned by /api/config.
export const RouterSchema = z
  .object({
    // Values are "providerName,modelName", or null when the slot is
    // unassigned. Kept in literal form (not derived from SCENARIO_KEYS)
    // so the generated OpenAPI schema lists each slot explicitly.
    default: EmptyStringToNullSchema,
    background: EmptyStringToNullSchema,
    think: EmptyStringToNullSchema,
    longContext: EmptyStringToNullSchema,
    webSearch: EmptyStringToNullSchema,
    image: EmptyStringToNullSchema,
    // Ordered per-scenario fallback chains (see RouterFallbacksSchema).
    // composeUiConfig always emits the full object (empty arrays for
    // scenarios with no fallbacks), so the default covers an absent key.
    fallbacks: RouterFallbacksSchema.default(emptyFallbacks),
    // Genuinely optional: composeUiConfig omits the key entirely when
    // there's no threshold (it is not emitted as null), so .optional()
    // matches the wire — .nullable() would reject the absent key.
    longContextThreshold: z.number().int().positive().default(60000),
    // Name of the active persona for this router, or null/absent for
    // "no persona". composeUiConfig folds it in from the disk envelope;
    // applyUiConfig reads it back out. Nullable so an explicit "clear"
    // ('' coerced to null) travels on the wire alongside the absent key.
    persona: EmptyStringToNullSchema.optional()
  })
  // The fallbacks object is a declared field; the catchall union must
  // include its shape so the (declared keys + index signature) type
  // stays consistent. Unknown keys still accept scalar JSON.
  .catchall(z.union([z.string().nonempty(), z.number(), z.null(), RouterFallbacksSchema]))
  .openapi('Router')
export type Router = z.infer<typeof RouterSchema>

// Legacy UI shape — kept distinct from RouterSchema because it has
// historically allowed `custom: unknown` and required (non-optional)
// nullable slot values without the empty-string coercion. Used only
// to derive the RouterConfig type consumed by the UI.
export const RouterConfigSchema = z.object({
  default: z.string().nullable(),
  background: z.string().nullable(),
  think: z.string().nullable(),
  longContext: z.string().nullable(),
  longContextThreshold: z.number().int().positive(),
  webSearch: z.string().nullable(),
  image: z.string().nullable(),
  fallbacks: RouterFallbacksSchema.default(emptyFallbacks),
  // Active persona name for this router. Optional so existing
  // per-project/session router-override files (which never carried a
  // persona) still parse; empty/absent means "no persona".
  persona: z.string().nonempty().optional(),
  custom: z.unknown().optional()
})
export type RouterConfig = z.infer<typeof RouterConfigSchema>

// Mirrors the Prisma ScenarioKey enum and the legacy `Router.*` keys so
// the migration, configService, and UI all speak the same vocabulary.
// Derived from the SCENARIO_KEYS const tuple (kept in shared/db/types
// because it's plain data, not a Zod schema).
export const ScenarioKeySchema = z.enum(SCENARIO_KEYS)
export type ScenarioKey = z.infer<typeof ScenarioKeySchema>
