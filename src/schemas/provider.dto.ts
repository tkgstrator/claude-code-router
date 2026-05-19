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
    modelContextWindows: z.record(z.string().nonempty(), z.number()).optional(),
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
    latencyMs: z.number().optional(),
    error: z.string().optional()
  })
  .openapi('ProviderTestResponse')
