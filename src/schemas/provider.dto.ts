import { z } from '@hono/zod-openapi'

export const AuthModeSchema = z.enum(['api_key', 'subscription']).openapi('AuthMode')
export const ProviderAuthModeSchema = AuthModeSchema
export type ProviderAuthMode = z.infer<typeof ProviderAuthModeSchema>

export const ProviderTransformerSchema = z
  .object({
    // Optional: toUiProvider may emit { _disabledModels: [...] } without use.
    use: z
      .array(
        z.union([
          z.string().nonempty(),
          z.array(z.union([z.string().nonempty(), z.record(z.string().nonempty(), z.unknown())]))
        ])
      )
      .optional()
  })
  .catchall(z.any())
export type ProviderTransformer = z.infer<typeof ProviderTransformerSchema>

export const ProviderSchema = z
  .object({
    name: z.string().nonempty(),
    enabled: z.boolean().default(true),
    api_base_url: z.url(),
    // null when the key is unset (fresh seed / cleared). A present
    // value is an arbitrary secret, so no .nonempty() here.
    api_key: z.string().nullable(),
    auth_mode: AuthModeSchema,
    models: z.array(z.string().nonempty()),
    deprecatedModels: z.array(z.string().nonempty()).optional(),
    modelTestStatus: z
      .record(
        z.string().nonempty(),
        z.object({ status: z.enum(['unknown', 'ok', 'fail']), passedAt: z.string().nullable() })
      )
      .optional(),
    modelContextWindows: z.record(z.string().nonempty(), z.number().int().positive()).optional(),
    // Per-model USD/1M prices sourced from the DB (scraped, or seeded from
    // the llm-prices.json snapshot by backfillStaticPrices). The Models
    // dashboard reads prices only from here — there is no frontend static
    // fallback. null legs mean the vendor doesn't publish that side.
    modelPrices: z
      .record(
        z.string().nonempty(),
        z.object({ inputPer1M: z.number().nullable(), outputPer1M: z.number().nullable() })
      )
      .optional(),
    // Per-model manual tier override consumed by the quota-aware
    // preference selector. Absent keys fall back to name-substring
    // inference. Kept as an optional map so providers without any
    // overrides don't bloat the wire.
    modelManualTiers: z.record(z.string().nonempty(), z.enum(['fable', 'opus', 'sonnet', 'haiku'])).optional(),
    // Per-model manual reasoning-effort override consumed at request
    // build time. Absent keys pass through untouched (vendor default).
    modelReasoningEfforts: z
      .record(z.string().nonempty(), z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']))
      .optional(),
    transformer: ProviderTransformerSchema.optional(),
    // Per-account enable/disable for subscription providers. Absent on
    // api_key providers. Only the { id, enabled } pairs the UI sends
    // through get applied — never used to add/remove rows, which is the
    // sync service's job.
    subscription_accounts: z.array(z.object({ id: z.string().nonempty(), enabled: z.boolean() })).optional()
  })
  .openapi('Provider')
export type Provider = z.infer<typeof ProviderSchema>

export const ProviderTestRequestSchema = z
  .object({
    name: z.string().nonempty()
  })
  .openapi('ProviderTestRequest')

export const ProviderTestResponseSchema = z
  .object({
    success: z.boolean(),
    latencyMs: z.number().int().nonnegative().optional(),
    error: z.string().nonempty().optional()
  })
  .openapi('ProviderTestResponse')

// GET /api/providers — flat array of every provider row.
export const ProviderListResponseSchema = z.array(ProviderSchema).openapi('ProviderListResponse')

// Wire shape returned by POST/PATCH /api/providers and
// PATCH /api/providers/:name. Carries the round-tripped Provider plus
// any non-fatal warnings the apply layer produced (e.g. RouterSlots
// nulled out because a removed model was bound).
export const ProviderUpsertResponseSchema = z
  .object({
    success: z.literal(true),
    provider: ProviderSchema,
    warnings: z.array(z.string().nonempty()).optional()
  })
  .openapi('ProviderUpsertResponse')

export const ProviderDeleteResponseSchema = z.object({ success: z.literal(true) }).openapi('ProviderDeleteResponse')

// 404 / 5xx error envelope used by the providers + provider/model
// CRUD endpoints when the resource was not found or the underlying
// service threw. ZodError validation failures use the separate
// ValidationErrorResponseSchema in ../api/zod-response.ts.
export const ProviderErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string().nonempty()
  })
  .openapi('ProviderErrorResponse')
