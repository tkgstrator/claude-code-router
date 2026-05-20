import { z } from '@hono/zod-openapi'

// Non-null shape of a Claude usage window (utilization + reset time).
// The nullable variant below wraps this in `.nullable()` for use in the
// outer response — separating them lets helper code work with the
// non-null type directly.
export const ClaudeUsageWindowValueSchema = z.object({
  utilization: z.number(),
  resetsAt: z.string().nonempty().nullable()
})

export const ClaudeUsageWindowSchema = ClaudeUsageWindowValueSchema.nullable()

// Non-null shape of a Codex usage window.
export const CodexUsageWindowValueSchema = z.object({
  usedPercent: z.number(),
  resetAt: z.string().nonempty().nullable(),
  windowSeconds: z.number().nullable()
})

export const CodexUsageWindowSchema = CodexUsageWindowValueSchema.nullable()

export const ClaudeUsageSchema = z
  .object({
    fiveHour: ClaudeUsageWindowSchema,
    sevenDay: ClaudeUsageWindowSchema,
    sevenDaySonnet: ClaudeUsageWindowSchema,
    sevenDayOpus: ClaudeUsageWindowSchema,
    extraUsageEnabled: z.boolean(),
    capturedAt: z.string().nonempty()
  })
  .nullable()

export const CodexUsageSchema = z
  .object({
    planType: z.string().nonempty().nullable(),
    primary: CodexUsageWindowSchema,
    secondary: CodexUsageWindowSchema,
    capturedAt: z.string().nonempty()
  })
  .nullable()

export const UsageResponseSchema = z
  .object({
    claude: ClaudeUsageSchema,
    codex: CodexUsageSchema
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
        resetAt: z.string().nonempty().nullable()
      })
    )
  })
  .openapi('UsageHistoryResponse')

export const UsageHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7)
})

// Service-level input/output shapes for fetchUsageSnapshot. Kept as
// schemas so consumers can re-use the inferred type, even though the
// route layer goes via UsageResponseSchema directly.
export const GetUsageInputSchema = z.object({
  // Reserved for future route-level controls.
  forceRefresh: z.boolean().default(false)
})

export const GetUsageOutputSchema = z.object({
  usage: UsageResponseSchema
})

// ---- Wire schemas for the upstream HTTP / on-disk shapes -----------
// These describe what the third-party services and the Codex CLI write
// to disk. Fields we only narrow at runtime stay as z.unknown() so we
// don't accidentally widen the type contract here.

// Shape of ~/.claude/.credentials.json (only the bits we read).
export const ClaudeCredentialsSchema = z.object({
  claudeAiOauth: z
    .object({
      accessToken: z.unknown().optional()
    })
    .optional()
})

// Shape of https://api.anthropic.com/api/oauth/usage. The window
// objects are validated structurally by `windowOf` at the service
// layer, so we leave them as `unknown` here.
export const ClaudeUsageWireSchema = z.object({
  five_hour: z.unknown().optional(),
  seven_day: z.unknown().optional(),
  seven_day_sonnet: z.unknown().optional(),
  seven_day_opus: z.unknown().optional(),
  extra_usage: z.unknown().optional()
})

// Decoded JWT payload (only the `exp` claim is meaningful here).
export const JwtPayloadSchema = z.object({
  exp: z.unknown().optional()
})

// Tokens block inside ~/.codex/auth.json. The CLI keeps these fields
// as strings but tolerates extras, so we mirror that with passthrough.
// Named `CodexCli...` to distinguish from `CodexTokensSchema` in
// subscription.dto, which is the stricter shape used by the account
// sync service.
export const CodexCliTokensSchema = z
  .object({
    access_token: z.unknown().optional(),
    refresh_token: z.unknown().optional(),
    id_token: z.unknown().optional(),
    account_id: z.unknown().optional()
  })
  .loose()

// Full ~/.codex/auth.json. Unknown sibling keys are preserved across
// the refresh-and-rewrite round-trip.
export const CodexAuthFileSchema = z
  .object({
    tokens: CodexCliTokensSchema.optional(),
    last_refresh: z.unknown().optional()
  })
  .loose()

// Shape of https://auth.openai.com/oauth/token refresh response.
export const CodexTokenRefreshResponseSchema = z.object({
  access_token: z.unknown().optional(),
  refresh_token: z.unknown().optional(),
  id_token: z.unknown().optional()
})

// Shape of https://chatgpt.com/backend-api/wham/usage. As with the
// Claude wire shape, window objects are narrowed structurally below.
export const CodexUsageWireSchema = z.object({
  plan_type: z.unknown().optional(),
  rate_limit: z.unknown().optional()
})

// ---- Inferred types ------------------------------------------------

export type ClaudeUsageWindow = z.infer<typeof ClaudeUsageWindowSchema>
export type ClaudeUsageWindowValue = z.infer<typeof ClaudeUsageWindowValueSchema>
export type CodexUsageWindow = z.infer<typeof CodexUsageWindowSchema>
export type CodexUsageWindowValue = z.infer<typeof CodexUsageWindowValueSchema>
export type ClaudeUsage = z.infer<typeof ClaudeUsageSchema>
export type CodexUsage = z.infer<typeof CodexUsageSchema>
export type UsageResponse = z.infer<typeof UsageResponseSchema>
// Use the input side so `forceRefresh` remains optional at the call site
// (Zod `.default(false)` keeps the field required on the parsed output).
export type GetUsageInput = z.input<typeof GetUsageInputSchema>
export type GetUsageOutput = z.infer<typeof GetUsageOutputSchema>
export type CodexCliTokens = z.infer<typeof CodexCliTokensSchema>
export type CodexAuthFile = z.infer<typeof CodexAuthFileSchema>
