import { z } from '@hono/zod-openapi'
import { EmptyStringToNullSchema } from './common.dto'
import { LogLevelSchema } from './env.dto'
import { JsonValueSchema, PresetTransformerConfigSchema } from './preset.dto'
import { ProviderSchema } from './provider.dto'
import { RouterConfigSchema, RouterSchema } from './router.dto'
import { StatusLineConfigSchema } from './status-line.dto'
import { TransformerSchema } from './transformer.dto'

// A single named persona in the library: a non-empty `name` (the value
// `ActivePersona` points at) and its `prompt` text (may be empty while
// the user is still editing).
export const PersonaSchema = z
  .object({
    name: z.string().nonempty(),
    prompt: z.string()
  })
  .openapi('Persona')
export type Persona = z.infer<typeof PersonaSchema>

// Whitelist of what is allowed to stay on disk in
// ~/.claude-code-router/config.json once Providers / Router have been
// moved into the DB.
export const ConfigEnvelopeSchema = z
  .object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.number().int().positive().default(3456),
    APIKEY: z.string().nonempty(),
    LOG: z.boolean().default(false),
    LOG_LEVEL: LogLevelSchema.default('info'),
    PROXY_URL: z.string().default(''),
    API_TIMEOUT_MS: z.coerce.number().int().nonnegative().optional(),
    CLAUDE_PATH: z.string().default(''),
    NON_INTERACTIVE_MODE: z.boolean().optional(),

    // Name of the currently active persona, or absent/empty for "no
    // persona". Round-trips through the disk envelope like the other
    // optional scalars (see CUSTOM_ROUTER_PATH).
    ActivePersona: z.string().optional(),

    // Object-shaped envelope members that stay on disk for PR #1.
    // Personas is the named persona library; it stays on disk alongside
    // `transformers` (an object-shaped member, not a boot scalar).
    Personas: z.array(PersonaSchema).default([]),
    StatusLine: JsonValueSchema.optional(),
    transformers: z.array(PresetTransformerConfigSchema).optional(),
    plugins: z.array(JsonValueSchema).optional(),
    Plugins: z.array(JsonValueSchema).optional()
  })
  // Any other keys we don't know about — keep them, don't drop them.
  .catchall(JsonValueSchema)
export type ConfigEnvelope = z.infer<typeof ConfigEnvelopeSchema>

// API wire shape returned by /api/config and emitted by composeUiConfig
// / loadFullConfig. Extends ConfigEnvelopeSchema with DB-resident fields
// (Providers, Router) and overrides the optional path/url scalars so
// "unset" travels as null (composeUiConfig emits null when absent / ''
// on disk). Registered as .openapi('Config') for the generated OpenAPI
// document.
export const AppConfigSchema = ConfigEnvelopeSchema.extend({
  Providers: z.array(ProviderSchema),
  Router: RouterSchema,
  PROXY_URL: z.string().nullable(),
  CLAUDE_PATH: z.string().nullable(),
  CUSTOM_ROUTER_PATH: z.string().nullable(),
  // Active persona name travels as null on the wire when unset; the
  // persona library is always a plain array (default []).
  ActivePersona: z.string().nullable(),
  Personas: z.array(PersonaSchema).default([])
}).openapi('Config')
export type AppConfig = z.infer<typeof AppConfigSchema>

// UI-side config shape consumed by components. Differs from
// AppConfigSchema in that it requires the envelope scalars (LOG,
// LOG_LEVEL, HOST, PORT, APIKEY, API_TIMEOUT_MS) and uses the broader
// RouterConfigSchema (allows the `custom` field). Kept distinct because
// the frontend types this directly off the JSON it receives.
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
  PORT: z.number().int().positive(),
  APIKEY: z.string().nonempty(),
  API_TIMEOUT_MS: z.number().int().nonnegative(),
  PROXY_URL: z.url(),
  CUSTOM_ROUTER_PATH: z.string().nonempty().optional(),
  ActivePersona: z.string().nonempty().optional(),
  Personas: z.array(PersonaSchema).default([])
})
export type Config = z.infer<typeof ConfigSchema>

// applyUiConfig accepts a partial-update payload — Providers/Router
// and the path scalars are all optional so any caller can send only
// the slice they're touching. Path scalars use EmptyStringToNullSchema
// to coerce the React-Hook-Form default of "" to null on the way in;
// pruneUnsetEnvelopePaths then collapses null to "key absent on disk".
// The .optional() suffix represents "this key was not included in
// this update" (vs. null / "" which both mean "explicitly unset").
export const ApplyConfigPayloadSchema = z
  .object({
    Providers: z.array(ProviderSchema).optional(),
    Router: RouterSchema.partial().optional(),
    CLAUDE_PATH: EmptyStringToNullSchema.optional(),
    PROXY_URL: EmptyStringToNullSchema.optional(),
    CUSTOM_ROUTER_PATH: EmptyStringToNullSchema.optional(),
    // Empty string clears the active persona (collapsed to null, then
    // pruned off disk); the persona library is written as an array.
    ActivePersona: EmptyStringToNullSchema.optional(),
    Personas: z.array(PersonaSchema).optional()
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
