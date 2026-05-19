import { z } from '@hono/zod-openapi'
import { ConfigEnvelopeSchema } from '@/shared/db/types'
import { JsonValueSchema } from '@/shared/preset/types'
import { ProviderSchema } from './provider.dto'
import { RouterConfigSchema, RouterSchema } from './router.dto'
import { StatusLineConfigSchema } from './status-line.dto'
import { TransformerSchema } from './transformer.dto'

// API wire shape returned by /api/config. Extends ConfigEnvelopeSchema with
// the DB-resident fields (Providers, Router) and overrides the path/url
// scalars that composeUiConfig normalises from '' on disk to null on the
// wire. Registered as .openapi('Config') for the generated OpenAPI doc.
export const ApiConfigSchema = ConfigEnvelopeSchema.extend({
  Providers: z.array(ProviderSchema),
  Router: RouterSchema,
  // composeUiConfig always emits these as null when unset (absent / '' on disk).
  PROXY_URL: z.string().nullable(),
  CLAUDE_PATH: z.string().nullable(),
  CUSTOM_ROUTER_PATH: z.string().nullable()
}).openapi('Config')

// Legacy UI shape — the type widely consumed by components as `Config`.
// Distinct from ApiConfigSchema because composeUiConfig still emits the
// broader envelope (StatusLine, transformers, LOG, LOG_LEVEL, HOST, PORT,
// APIKEY, API_TIMEOUT_MS, etc.) and the UI types it together.
export const ConfigSchema = z.object({
  Providers: z.array(ProviderSchema),
  Router: RouterConfigSchema,
  transformers: z.array(TransformerSchema),
  StatusLine: StatusLineConfigSchema.optional(),
  forceUseImageAgent: z.boolean().optional(),
  LOG: z.boolean(),
  LOG_LEVEL: z.string().nonempty(),
  CLAUDE_PATH: z.string().nonempty(),
  HOST: z.string().nonempty(),
  PORT: z.number(),
  APIKEY: z.string().nonempty(),
  API_TIMEOUT_MS: z.number().int().nonnegative(),
  PROXY_URL: z.url(),
  CUSTOM_ROUTER_PATH: z.string().nonempty().optional()
})
export type Config = z.infer<typeof ConfigSchema>

// applyUiConfig accepts a Partial-ish shape — Providers/Router optional,
// envelope keys free-form. Mirror that without dropping into z.any.
export const ApplyConfigPayloadSchema = z
  .object({
    Providers: z.array(ProviderSchema).optional(),
    providers: z.array(ProviderSchema).optional(),
    Router: RouterSchema.partial().optional()
  })
  .catchall(JsonValueSchema)
  .openapi('ApplyConfigPayload')

export const ApplyConfigResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string().nonempty(),
    warnings: z.array(z.string().nonempty()).optional()
  })
  .openapi('ApplyConfigResponse')
