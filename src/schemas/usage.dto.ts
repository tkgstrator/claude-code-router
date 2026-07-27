import { z } from '@hono/zod-openapi'

export const ClaudeUsageWindowValueSchema = z.object({
  utilization: z.number(),
  resetsAt: z.string().nonempty().nullable()
})

export const ClaudeUsageWindowSchema = ClaudeUsageWindowValueSchema.nullable()

export const CodexUsageWindowValueSchema = z.object({
  usedPercent: z.number(),
  resetAt: z.string().nonempty().nullable(),
  windowSeconds: z.number().nullable()
})

export const CodexUsageWindowSchema = CodexUsageWindowValueSchema.nullable()

// Per-account usage snapshots. accountLabel is the human-readable name
// (userName ?? userEmail ?? userId) resolved at fetch time from the DB row.
// subAccountId is the stable SubAccount id, used by the UI to join usage
// bars onto the account roster from /api/subscriptions.
export const ClaudeUsageSchema = z.object({
  subAccountId: z.string().nonempty(),
  accountLabel: z.string(),
  fiveHour: ClaudeUsageWindowSchema,
  sevenDay: ClaudeUsageWindowSchema,
  sevenDaySonnet: ClaudeUsageWindowSchema,
  sevenDayOpus: ClaudeUsageWindowSchema,
  extraUsageEnabled: z.boolean(),
  capturedAt: z.string().nonempty()
})

export const CodexUsageSchema = z.object({
  subAccountId: z.string().nonempty(),
  accountLabel: z.string(),
  planType: z.string().nonempty().nullable(),
  primary: CodexUsageWindowSchema,
  secondary: CodexUsageWindowSchema,
  capturedAt: z.string().nonempty()
})

// Empty array = no connected accounts for that vendor.
export const UsageResponseSchema = z
  .object({
    claude: z.array(ClaudeUsageSchema),
    codex: z.array(CodexUsageSchema)
  })
  .openapi('UsageResponse')

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

export const GetUsageInputSchema = z.object({
  forceRefresh: z.boolean().default(false)
})

export const GetUsageOutputSchema = z.object({
  usage: UsageResponseSchema
})

// Wire schemas for upstream HTTP shapes (kept for the usage fetch only).
export const ClaudeUsageWireSchema = z.object({
  five_hour: z.unknown().optional(),
  seven_day: z.unknown().optional(),
  seven_day_sonnet: z.unknown().optional(),
  seven_day_opus: z.unknown().optional(),
  extra_usage: z.unknown().optional()
})

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
export type GetUsageInput = z.input<typeof GetUsageInputSchema>
export type GetUsageOutput = z.infer<typeof GetUsageOutputSchema>
