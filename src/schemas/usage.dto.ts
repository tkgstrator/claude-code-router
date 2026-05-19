import { z } from '@hono/zod-openapi'

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

export const UsageHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7)
})
