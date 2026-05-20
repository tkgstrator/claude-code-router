/**
 * Strict zod schemas for the Anthropic SSE wire shape CCR emits on
 * /v1/messages.
 *
 * Designed as the validator against the fixture corpus under
 * `__tests__/providers/__fixtures__/`. Required fields stay required:
 * .optional() / .nullable() is only added when a real captured payload
 * actually omits or nulls the field. The fixture-validation test
 * (`__tests__/providers/fixture-schemas.test.ts`) drives that
 * discovery — tighten first, loosen as the corpus demands.
 *
 * Unknown extra keys are silently stripped by zod's default object
 * mode; only missing or mistyped REQUIRED fields error.
 */

import { z } from '@hono/zod-openapi'

// ─── Usage block (Anthropic-shaped on SSE) ─────────────────────────────

export const AnthropicSSEUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  // Cache fields are Anthropic-native. OpenAI/Gemini routes via CCR's
  // transformers don't surface them on the SSE wire — proven by the
  // fixture corpus (the openai/google streams omit these even though
  // they're zero on the upstream side).
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional()
})
export type AnthropicSSEUsage = z.infer<typeof AnthropicSSEUsageSchema>

// ─── Content blocks (assistant output) ─────────────────────────────────

export const AnthropicTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string()
})

export const AnthropicToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().nonempty(),
  name: z.string().nonempty(),
  input: z.record(z.string(), z.unknown())
})

export const AnthropicThinkingBlockSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string()
})

export const AnthropicContentBlockUnionSchema = z.discriminatedUnion('type', [
  AnthropicTextBlockSchema,
  AnthropicToolUseBlockSchema,
  AnthropicThinkingBlockSchema
])
export type AnthropicContentBlockUnion = z.infer<typeof AnthropicContentBlockUnionSchema>

// ─── Deltas (content_block_delta.delta) ────────────────────────────────

export const AnthropicTextDeltaSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string()
})

export const AnthropicInputJsonDeltaSchema = z.object({
  type: z.literal('input_json_delta'),
  partial_json: z.string()
})

export const AnthropicThinkingDeltaSchema = z.object({
  type: z.literal('thinking_delta'),
  thinking: z.string()
})

export const AnthropicSignatureDeltaSchema = z.object({
  type: z.literal('signature_delta'),
  signature: z.string()
})

export const AnthropicDeltaUnionSchema = z.discriminatedUnion('type', [
  AnthropicTextDeltaSchema,
  AnthropicInputJsonDeltaSchema,
  AnthropicThinkingDeltaSchema,
  AnthropicSignatureDeltaSchema
])
export type AnthropicDeltaUnion = z.infer<typeof AnthropicDeltaUnionSchema>

// ─── SSE event payloads (the JSON after `data: ` for each event) ───────

export const AnthropicMessageStartPayloadSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    id: z.string().nonempty(),
    type: z.literal('message'),
    role: z.literal('assistant'),
    model: z.string().nonempty(),
    content: z.array(z.unknown()),
    stop_reason: z.null(),
    stop_sequence: z.null(),
    usage: AnthropicSSEUsageSchema
  })
})

export const AnthropicContentBlockStartPayloadSchema = z.object({
  type: z.literal('content_block_start'),
  index: z.number().int(),
  content_block: AnthropicContentBlockUnionSchema
})

export const AnthropicContentBlockDeltaPayloadSchema = z.object({
  type: z.literal('content_block_delta'),
  index: z.number().int(),
  delta: AnthropicDeltaUnionSchema
})

export const AnthropicContentBlockStopPayloadSchema = z.object({
  type: z.literal('content_block_stop'),
  index: z.number().int()
})

export const AnthropicMessageDeltaPayloadSchema = z.object({
  type: z.literal('message_delta'),
  delta: z.object({
    stop_reason: z.string().nonempty(),
    stop_sequence: z.string().nullable()
  }),
  usage: AnthropicSSEUsageSchema
})

export const AnthropicMessageStopPayloadSchema = z.object({
  type: z.literal('message_stop')
})

export const AnthropicPingPayloadSchema = z.object({
  type: z.literal('ping')
})

// All possible payloads on the SSE wire — discriminated by `type`.
export const AnthropicSSEPayloadSchema = z.discriminatedUnion('type', [
  AnthropicMessageStartPayloadSchema,
  AnthropicContentBlockStartPayloadSchema,
  AnthropicContentBlockDeltaPayloadSchema,
  AnthropicContentBlockStopPayloadSchema,
  AnthropicMessageDeltaPayloadSchema,
  AnthropicMessageStopPayloadSchema,
  AnthropicPingPayloadSchema
])
export type AnthropicSSEPayload = z.infer<typeof AnthropicSSEPayloadSchema>

// ─── Non-stream JSON response ──────────────────────────────────────────

export const AnthropicMessageResponseSchema = z.object({
  id: z.string().nonempty(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  model: z.string().nonempty(),
  content: z.array(AnthropicContentBlockUnionSchema),
  stop_reason: z.string().nonempty(),
  stop_sequence: z.string().nullable(),
  usage: AnthropicSSEUsageSchema
})
export type AnthropicMessageResponse = z.infer<typeof AnthropicMessageResponseSchema>
