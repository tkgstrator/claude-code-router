import { JsonValueSchema } from '@ccr/shared'
import { z } from '@hono/zod-openapi'

// Zod schemas for the @hono/zod-openapi routes in src/index.ts. These
// mirror the shapes returned by @ccr/server/{config,subscriptions,
// providers,models,update} so the Hono root validates the same wire
// shape the legacy Fastify server emitted.

// --- Provider --------------------------------------------------------------

export const AuthModeSchema = z.enum(['api_key', 'subscription']).openapi('AuthMode')

export const ProviderSchema = z
  .object({
    name: z.string().min(1),
    api_base_url: z.string(),
    // null when the key is unset (fresh seed / cleared). A present
    // value is an arbitrary secret, so no .nonempty() here.
    api_key: z.string().nullable(),
    auth_mode: AuthModeSchema,
    models: z.array(z.string()),
    deprecatedModels: z.array(z.string()).optional(),
    modelTestStatus: z
      .record(z.string(), z.object({ status: z.enum(['unknown', 'ok', 'fail']), passedAt: z.string().nullable() }))
      .optional(),
    transformer: z.record(z.string(), JsonValueSchema).optional()
  })
  .openapi('Provider')
export type Provider = z.infer<typeof ProviderSchema>

// --- Router ----------------------------------------------------------------

export const RouterSchema = z
  .object({
    // Values are "providerName,modelName", or null when the slot is
    // unassigned. Kept in literal form (not derived from SCENARIO_KEYS)
    // so the generated OpenAPI schema lists each slot explicitly.
    default: z.string().nonempty().nullable(),
    background: z.string().nonempty().nullable(),
    think: z.string().nonempty().nullable(),
    longContext: z.string().nonempty().nullable(),
    webSearch: z.string().nonempty().nullable(),
    image: z.string().nonempty().nullable(),
    // Genuinely optional: composeUiConfig omits the key entirely when
    // there's no threshold (it is not emitted as null), so .optional()
    // matches the wire — .nullable() would reject the absent key.
    longContextThreshold: z.number().int().positive().optional()
  })
  .catchall(z.union([z.string().nonempty(), z.number(), z.null()]))
  .openapi('Router')
export type Router = z.infer<typeof RouterSchema>

// --- Config (envelope + providers + router) -------------------------------

// Mirrors LegacyConfig from packages/server/src/services/configService.ts.
// Envelope fields are deliberately loose (LOG_LEVEL as string,
// API_TIMEOUT_MS as number|string) to match what composeUiConfig
// returns; tightening them here would force casts at the boundary.
// StatusLine / transformers / plugins are kept on the response via
// .passthrough() — their internal shape is free-form JSON.
export const ConfigSchema = z
  .object({
    Providers: z.array(ProviderSchema),
    Router: RouterSchema,
    HOST: z.string().optional(),
    PORT: z.number().optional(),
    APIKEY: z.string().optional(),
    LOG: z.boolean().optional(),
    LOG_LEVEL: z.string().optional(),
    // composeUiConfig always emits these optional path/url scalars, as
    // a non-empty string or null when unset (absent / '' on disk).
    PROXY_URL: z.string().nullable(),
    API_TIMEOUT_MS: z.union([z.number(), z.string()]).optional(),
    CLAUDE_PATH: z.string().nullable(),
    CUSTOM_ROUTER_PATH: z.string().nullable(),
    NON_INTERACTIVE_MODE: z.boolean().optional()
  })
  .openapi('Config')
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
    message: z.string(),
    warnings: z.array(z.string()).optional()
  })
  .openapi('ApplyConfigResponse')

// --- Subscriptions ---------------------------------------------------------

export const SubscriptionInfoSchema = z
  .object({
    providerName: z.string(),
    plan: z.string().nullable(),
    rateLimitTier: z.string().nullable(),
    expiresAt: z.number().nullable(),
    scopes: z.array(z.string()).nullable()
  })
  .openapi('SubscriptionInfo')

export const SubscriptionsResponseSchema = z
  .object({
    subscriptions: z.array(SubscriptionInfoSchema)
  })
  .openapi('SubscriptionsResponse')

export const EnabledModelSchema = z
  .object({
    provider: z.string().nonempty(),
    model: z.string().nonempty()
  })
  .openapi('EnabledModel')

export const EnabledModelsResponseSchema = z
  .object({
    models: z.array(EnabledModelSchema)
  })
  .openapi('EnabledModelsResponse')

const ClaudeUsageWindowSchema = z
  .object({
    utilization: z.number(),
    resetsAt: z.string().nullable()
  })
  .nullable()

const CodexUsageWindowSchema = z
  .object({
    usedPercent: z.number(),
    resetAt: z.string().nullable(),
    windowSeconds: z.number().nullable()
  })
  .nullable()

export const UsageResponseSchema = z
  .object({
    claude: z
      .object({
        fiveHour: ClaudeUsageWindowSchema,
        sevenDay: ClaudeUsageWindowSchema,
        sevenDaySonnet: ClaudeUsageWindowSchema,
        sevenDayOpus: ClaudeUsageWindowSchema,
        extraUsageEnabled: z.boolean(),
        capturedAt: z.string().nonempty()
      })
      .nullable(),
    codex: z
      .object({
        planType: z.string().nullable(),
        primary: CodexUsageWindowSchema,
        secondary: CodexUsageWindowSchema,
        capturedAt: z.string().nonempty()
      })
      .nullable()
  })
  .openapi('UsageResponse')

// Thin DB passthrough: one raw snapshot row per capture. The frontend
// derives the chart series (deltas, reset clamping, moving average).
export const UsageHistoryResponseSchema = z
  .object({
    samples: z.array(
      z.object({
        metric: z.string().nonempty(),
        percent: z.number(),
        t: z.string().nonempty(),
        resetAt: z.string().nullable()
      })
    )
  })
  .openapi('UsageHistoryResponse')

// --- Providers test --------------------------------------------------------

export const ProviderTestRequestSchema = z
  .object({
    name: z.string().min(1)
  })
  .openapi('ProviderTestRequest')

export const ProviderTestResponseSchema = z
  .object({
    success: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.string().optional()
  })
  .openapi('ProviderTestResponse')

// --- Refresh models --------------------------------------------------------

export const RefreshOutcomeSchema = z
  .object({
    provider: z.string(),
    added: z.array(z.string()),
    error: z.string().optional()
  })
  .openapi('RefreshOutcome')

export const RefreshModelsResponseSchema = z
  .object({
    outcomes: z.array(RefreshOutcomeSchema)
  })
  .openapi('RefreshModelsResponse')

// --- Update check / perform ------------------------------------------------

export const UpdateCheckResponseSchema = z
  .object({
    hasUpdate: z.boolean(),
    latestVersion: z.string().optional(),
    changelog: z.string().optional()
  })
  .openapi('UpdateCheckResponse')

export const UpdatePerformResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string()
  })
  .openapi('UpdatePerformResponse')

// --- Transformers ----------------------------------------------------------

export const TransformerEntrySchema = z
  .object({
    name: z.string(),
    endpoint: z.string().nullable()
  })
  .openapi('TransformerEntry')

export const TransformersResponseSchema = z
  .object({
    transformers: z.array(TransformerEntrySchema)
  })
  .openapi('TransformersResponse')

// --- Price scraper ---------------------------------------------------------

export const ScrapePricesVendorSchema = z.enum(['openai', 'anthropic', 'google', 'all']).openapi('ScrapePricesVendor')

// --- Model inference test --------------------------------------------------

export const ModelTestRequestSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1)
  })
  .openapi('ModelTestRequest')

export const ModelTestResultSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    status: z.enum(['ok', 'fail']),
    error: z.string().optional(),
    latencyMs: z.number()
  })
  .openapi('ModelTestResult')

export const ModelTestAllRequestSchema = z
  .object({
    scope: z.enum(['all', 'failing'])
  })
  .openapi('ModelTestAllRequest')

export const ModelTestAllResponseSchema = z
  .object({
    total: z.number(),
    ok: z.number(),
    fail: z.number(),
    results: z.array(ModelTestResultSchema)
  })
  .openapi('ModelTestAllResponse')

// --- Validation errors -----------------------------------------------------

export const ValidationErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.string()
  })
  .openapi('ValidationError')
