import { z } from '@hono/zod-openapi'
import { EmptyStringToNullSchema } from './common.dto'
import { LogLevelSchema } from './env.dto'
import { JsonValueSchema, PresetTransformerConfigSchema } from './preset.dto'
import { ProviderSchema } from './provider.dto'
import { RouterConfigSchema, RouterSchema } from './router.dto'
import { StatusLineConfigSchema } from './status-line.dto'
import { TransformerSchema } from './transformer.dto'

// A single persona in the library. `id` is the stable uuid key every
// reference points at — the URL (/personas/view|edit/:id), the active
// selection (Router.persona), and the server-side prompt lookup — so the
// `name` is a free-form display label and need not be unique. `id` is
// optional in the schema only for back-compat: configs written before
// the uuid migration have personas without one; the boot migration
// (migratePersonaKeys) and the UI both backfill a uuid on load.
export const PersonaSchema = z
  .object({
    id: z.string().optional(),
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

    // What the archive is allowed to keep. Default on, matching the
    // unconditional capture that predates these keys, so an existing
    // install records exactly what it recorded before.
    //
    // `REDACT_TOOL_ARGUMENTS` defaults OFF because turning it on loses
    // information that cannot be recovered later; an operator who needs
    // it will say so.
    CAPTURE_REQUESTS: z.boolean().default(true),
    CAPTURE_MESSAGES: z.boolean().default(true),
    REDACT_TOOL_ARGUMENTS: z.boolean().default(false),

    // Disk-only backing store for the active persona's id (surfaced on
    // the wire as `Router.persona`, not as a top-level field). Absent /
    // empty means "no persona". Round-trips through the disk envelope
    // like the other optional scalars (see CUSTOM_ROUTER_PATH).
    ActivePersona: z.string().optional(),
    // User-editable display name for the live routing (the RouterSlot
    // rows). Presented on the Routing Library grid + Live editor. Absent
    // / empty → UI falls back to the "Live" i18n label. Auto-populated
    // when a preset is applied to Live so the card reads as "Work"
    // instead of the generic "Live".
    LiveRoutingName: z.string().optional(),

    // Object-shaped envelope members that stay on disk for PR #1.
    // Personas is the named persona library; it stays on disk alongside
    // `transformers` (an object-shaped member, not a boot scalar).
    Personas: z.array(PersonaSchema).default([]),
    StatusLine: JsonValueSchema.optional(),
    transformers: z.array(PresetTransformerConfigSchema).optional(),
    plugins: z.array(JsonValueSchema).optional(),
    Plugins: z.array(JsonValueSchema).optional(),

    // Quota-aware preference router (docs/plan/quota-aware-preference-router.md
    // §6.4). All four keys are Phase 2 knobs; the runtime router stays on
    // 'scenario' until every phase ships and rollout is bumped >0. Absent
    // on disk = defaults below (zero behaviour change).
    //
    // Which selector routes /v1 traffic:
    //   'scenario'    — current RouterSlot-based router (default)
    //   'preference'  — gate-only preference selector (L4)
    //   'quota-aware' — scheduler-weighted preference selector (L3+L4)
    ROUTER_MODE: z.enum(['scenario', 'preference', 'quota-aware']).default('scenario'),
    // Run a second selector in parallel and log its would-be decision
    // without affecting routing. 'off' disables shadowing.
    ROUTER_SHADOW: z.enum(['off', 'preference', 'quota-aware']).default('off'),
    // Percentage (0-100) of sessions the non-scenario ROUTER_MODE
    // applies to; the rest stay on the scenario router. Session-hash
    // bucketed so the same session ID always lands in the same bucket.
    ROUTER_ROLLOUT_PCT: z.coerce.number().int().min(0).max(100).default(100),
    // Scheduler tick interval. Default 5 min matches the usage-cache
    // TTL; faster ticks just spin the weight recompute since upstream
    // /usage endpoints are cached. Lower bound 60s is for
    // shadow/staging; production should stay >= 300_000.
    ROUTING_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
    // When true, the failover walker auto-appends peer entries with the
    // same Model.name on OpenAI-family providers (apiStyle openai_chat /
    // openai_responses) after each explicit chain entry. Off by default
    // — enable when you have the same model surfaced by multiple
    // OpenAI-compatible providers and want a 429 on one to hop to the
    // peer without hand-writing the chain.
    CROSS_PROVIDER_FALLBACK: z.coerce.boolean().default(false)
  })
  // Any other keys we don't know about — keep them, don't drop them.
  .catchall(JsonValueSchema)
export type ConfigEnvelope = z.infer<typeof ConfigEnvelopeSchema>

// API wire shape returned by /api/config and emitted by composeUiConfig
// / loadFullConfig. Extends ConfigEnvelopeSchema with DB-resident fields
// (Providers, Router) and overrides the optional path/url scalars so
// "unset" travels as null (composeUiConfig emits null when absent / ''
// on disk). The disk-only ActivePersona backing key is omitted — it
// surfaces solely as Router.persona. Registered as .openapi('Config')
// for the generated OpenAPI document.
export const AppConfigSchema = ConfigEnvelopeSchema.omit({ ActivePersona: true })
  .extend({
    Providers: z.array(ProviderSchema),
    Router: RouterSchema,
    PROXY_URL: z.string().nullable(),
    CLAUDE_PATH: z.string().nullable(),
    CUSTOM_ROUTER_PATH: z.string().nullable(),
    // The persona library stays top-level and is always a plain array
    // (default []); the active persona name rides on Router.persona.
    Personas: z.array(PersonaSchema).default([])
  })
  .openapi('Config')
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
  LOG: z.boolean(),
  LOG_LEVEL: z.string().nonempty(),
  CLAUDE_PATH: z.string().nonempty(),
  HOST: z.string().nonempty(),
  PORT: z.number().int().positive(),
  APIKEY: z.string().nonempty(),
  API_TIMEOUT_MS: z.number().int().nonnegative(),
  PROXY_URL: z.url(),
  CUSTOM_ROUTER_PATH: z.string().nonempty().optional(),
  // Display name for the live routing. Optional; UI falls back to the
  // "Live" i18n label when absent.
  LiveRoutingName: z.string().optional(),
  // Quota-aware router knobs. Kept optional here so an envelope that
  // predates them still parses; the server-side envelope schema
  // (ConfigEnvelopeSchema) supplies the defaults when the disk value
  // is missing. Editable from the Settings page.
  ROUTER_MODE: z.enum(['scenario', 'preference', 'quota-aware']).optional(),
  ROUTER_SHADOW: z.enum(['off', 'preference', 'quota-aware']).optional(),
  ROUTER_ROLLOUT_PCT: z.number().int().min(0).max(100).optional(),
  CROSS_PROVIDER_FALLBACK: z.boolean().optional(),
  // Archive capture switches. Optional here so an envelope written
  // before they existed still parses; ConfigEnvelopeSchema supplies the
  // defaults on the server side.
  CAPTURE_REQUESTS: z.boolean().optional(),
  CAPTURE_MESSAGES: z.boolean().optional(),
  REDACT_TOOL_ARGUMENTS: z.boolean().optional(),
  // Active persona lives on Router.persona (RouterConfigSchema), not as a
  // top-level field. The persona library stays top-level.
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
    // The active persona arrives nested as Router.persona (RouterSchema,
    // empty string clears); only the persona library is top-level here.
    Personas: z.array(PersonaSchema).optional(),
    // Live routing display name. EmptyStringToNullSchema so the client
    // can clear it by sending ''; pruneUnsetEnvelopePaths drops null/''
    // from the on-disk envelope.
    LiveRoutingName: EmptyStringToNullSchema.optional()
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
