import { z } from '@hono/zod-openapi'
import { SCENARIO_KEYS } from '@/shared/db/types'
import { EmptyStringToNullSchema } from './common.dto'

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
    // Genuinely optional: composeUiConfig omits the key entirely when
    // there's no threshold (it is not emitted as null), so .optional()
    // matches the wire — .nullable() would reject the absent key.
    longContextThreshold: z.number().int().positive().default(60000)
  })
  .catchall(z.union([z.string().nonempty(), z.number(), z.null()]))
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
  longContextThreshold: z.number(),
  webSearch: z.string().nullable(),
  image: z.string().nullable(),
  custom: z.unknown().optional()
})
export type RouterConfig = z.infer<typeof RouterConfigSchema>

// Mirrors the Prisma ScenarioKey enum and the legacy `Router.*` keys so
// the migration, configService, and UI all speak the same vocabulary.
// Derived from the SCENARIO_KEYS const tuple (kept in shared/db/types
// because it's plain data, not a Zod schema).
export const ScenarioKeySchema = z.enum(SCENARIO_KEYS)
export type ScenarioKey = z.infer<typeof ScenarioKeySchema>
