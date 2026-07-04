/**
 * Schemas the pipeline uses to extract token-usage stats from upstream
 * responses (JSON and SSE).
 *
 * The shape unifies the fields Anthropic and OpenAI publish. Every
 * field is optional because providers differ; the consumer treats
 * missing fields as zero.
 */

import { z } from '@hono/zod-openapi'

// ─── Unified usage block ───────────────────────────────────────────────

export const UsageBlockSchema = z.object({
  // Anthropic
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  // OpenAI Chat Completions
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
  // OpenAI Responses
  input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().optional() }).optional()
})
export type UsageBlock = z.infer<typeof UsageBlockSchema>

// ─── Non-stream JSON response envelope ─────────────────────────────────

export const JsonResponseWithUsageSchema = z.object({
  usage: UsageBlockSchema.optional()
})
export type JsonResponseWithUsage = z.infer<typeof JsonResponseWithUsageSchema>

// ─── SSE event envelopes carrying usage ────────────────────────────────

// Anthropic SSE: `event: message_start` — full usage block on `.message.usage`.
export const AnthropicMessageStartEventSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({ usage: UsageBlockSchema })
})

// Anthropic SSE: `event: message_delta` — partial usage on the event itself.
export const AnthropicMessageDeltaEventSchema = z.object({
  type: z.literal('message_delta'),
  usage: UsageBlockSchema
})

// OpenAI Responses SSE: `event: response.completed` — full usage on `.response.usage`.
export const ResponsesCompletedEventSchema = z.object({
  type: z.literal('response.completed'),
  response: z.object({ usage: UsageBlockSchema })
})

// OpenAI Chat Completions SSE: the last chunk MAY carry a top-level
// usage object alongside the rest of its fields. No discriminator —
// match by presence of `usage.prompt_tokens`.
export const ChatCompletionUsageChunkSchema = z.object({
  usage: UsageBlockSchema.refine(
    (u): u is UsageBlock & { prompt_tokens: number } => typeof u.prompt_tokens === 'number'
  )
})

// ─── Persisted request-log row (UsageRecord) ───────────────────────────

/**
 * What the pipeline writes to the `request_logs` table after a
 * successful upstream call. Pure data — every field is required
 * because the consumer (`recordUsage` deps callback) writes it
 * straight into Prisma.
 */
export const UsageRecordSchema = z.object({
  sessionId: z.string().nonempty(),
  provider: z.string().nonempty(),
  model: z.string().nonempty(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  cacheHitPct: z.number().int().min(0).max(100),
  durationMs: z.number().int().nonnegative(),
  status: z.number().int()
})
export type UsageRecord = z.infer<typeof UsageRecordSchema>

// One row per chat turn to append to the Message table. The pipeline
// emits these alongside UsageRecord: one 'user' entry for the last user
// block on request send, and one 'assistant' entry with the assembled
// text / tool_use blocks once the response stream completes. content is
// the Anthropic wire block array, tool_use `input` is truncated to keep
// storage bounded.
export const MessageRecordSchema = z.object({
  sessionId: z.string().nonempty(),
  role: z.enum(['user', 'assistant']),
  content: z.unknown()
})
export type MessageRecord = z.infer<typeof MessageRecordSchema>
