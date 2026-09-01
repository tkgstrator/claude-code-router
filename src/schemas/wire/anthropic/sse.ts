/**
 * Strict zod schemas for the Anthropic SSE wire shape Rialto emits on
 * /v1/messages.
 *
 * Designed as the validator against the fixture corpus under
 * `__tests__/providers/__fixtures__/`. Required fields stay required:
 * .optional() / .nullable() is only added when a real captured payload
 * actually omits or nulls the field. The fixture-validation test
 * (`__tests__/providers/fixture-schemas.test.ts`) drives that
 * discovery — tighten first, loosen as the corpus demands.
 *
 * Every leaf object uses .strict() so unknown keys from the wire are
 * caught immediately rather than silently stripped. The discriminated
 * unions on `type` guarantee the correct variant is selected before
 * strictness is applied.
 */

import { z } from '@hono/zod-openapi'

// ─── Usage block (Anthropic-shaped on SSE) ─────────────────────────────

export const AnthropicSSEUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    // Cache fields are Anthropic-native. OpenAI/Gemini routes via Rialto's
    // transformers don't surface them on the SSE wire — proven by the
    // fixture corpus (the openai/google streams omit these even though
    // they're zero on the upstream side).
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    // Breakdown of cache creation by TTL bucket (ephemeral_5m / ephemeral_1h).
    cache_creation: z
      .object({
        ephemeral_5m_input_tokens: z.number().int().nonnegative(),
        ephemeral_1h_input_tokens: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    // Routing metadata Anthropic attaches to usage blocks.
    service_tier: z.string().optional(),
    inference_geo: z.string().optional(),
    // Agentic loop iteration details (appears on extended-thinking responses).
    // Wire shape is an array of per-iteration token objects, not a scalar.
    iterations: z.array(z.unknown()).optional()
  })
  .strict()
export type AnthropicSSEUsage = z.infer<typeof AnthropicSSEUsageSchema>

// ─── Content blocks (assistant output) ─────────────────────────────────

export const AnthropicTextBlockSchema = z
  .object({
    type: z.literal('text'),
    // Empty on a content_block_start opener; filled by subsequent text_delta
    // events. Final JSON-response content blocks carry the full string here.
    text: z.string().min(0)
  })
  .strict()

export const AnthropicToolUseBlockSchema = z
  .object({
    type: z.literal('tool_use'),
    id: z.string().nonempty(),
    name: z.string().nonempty(),
    input: z.record(z.string().nonempty(), z.unknown()),
    // Caller metadata added by Claude Code to identify which agent invoked the tool.
    caller: z.unknown().optional()
  })
  .strict()

export const AnthropicThinkingBlockSchema = z
  .object({
    type: z.literal('thinking'),
    // Same empty-opener pattern as AnthropicTextBlockSchema — thinking
    // streams in via thinking_delta events.
    thinking: z.string().min(0),
    // Anthropic attaches a cryptographic signature to thinking blocks so
    // the content can be verified when passed back in a multi-turn request.
    signature: z.string().min(0).optional()
  })
  .strict()

export const AnthropicContentBlockUnionSchema = z.discriminatedUnion('type', [
  AnthropicTextBlockSchema,
  AnthropicToolUseBlockSchema,
  AnthropicThinkingBlockSchema
])
export type AnthropicContentBlockUnion = z.infer<typeof AnthropicContentBlockUnionSchema>

// ─── Deltas (content_block_delta.delta) ────────────────────────────────

export const AnthropicTextDeltaSchema = z
  .object({
    type: z.literal('text_delta'),
    text: z.string().nonempty()
  })
  .strict()

export const AnthropicInputJsonDeltaSchema = z
  .object({
    type: z.literal('input_json_delta'),
    // Streams a tool's input JSON in chunks — the first chunk is
    // observed as "" before the model has emitted any character.
    partial_json: z.string().min(0)
  })
  .strict()

export const AnthropicThinkingDeltaSchema = z
  .object({
    type: z.literal('thinking_delta'),
    thinking: z.string().nonempty()
  })
  .strict()

export const AnthropicSignatureDeltaSchema = z
  .object({
    type: z.literal('signature_delta'),
    signature: z.string().nonempty()
  })
  .strict()

export const AnthropicDeltaUnionSchema = z.discriminatedUnion('type', [
  AnthropicTextDeltaSchema,
  AnthropicInputJsonDeltaSchema,
  AnthropicThinkingDeltaSchema,
  AnthropicSignatureDeltaSchema
])
export type AnthropicDeltaUnion = z.infer<typeof AnthropicDeltaUnionSchema>

// ─── SSE event payloads (the JSON after `data: ` for each event) ───────

export const AnthropicMessageStartPayloadSchema = z
  .object({
    type: z.literal('message_start'),
    message: z
      .object({
        id: z.string().nonempty(),
        type: z.literal('message'),
        role: z.literal('assistant'),
        model: z.string().nonempty(),
        content: z.array(z.unknown()),
        stop_reason: z.null(),
        stop_sequence: z.null(),
        // Observed null in real captures; present in both Opus and Haiku streams.
        stop_details: z.null().optional(),
        // Internal diagnostics Anthropic attaches to the message envelope.
        diagnostics: z.unknown().optional(),
        usage: AnthropicSSEUsageSchema
      })
      .strict()
  })
  .strict()

export const AnthropicContentBlockStartPayloadSchema = z
  .object({
    type: z.literal('content_block_start'),
    index: z.number().int(),
    content_block: AnthropicContentBlockUnionSchema
  })
  .strict()

export const AnthropicContentBlockDeltaPayloadSchema = z
  .object({
    type: z.literal('content_block_delta'),
    index: z.number().int(),
    delta: AnthropicDeltaUnionSchema
  })
  .strict()

export const AnthropicContentBlockStopPayloadSchema = z
  .object({
    type: z.literal('content_block_stop'),
    index: z.number().int()
  })
  .strict()

export const AnthropicMessageDeltaPayloadSchema = z
  .object({
    type: z.literal('message_delta'),
    delta: z
      .object({
        stop_reason: z.string().nonempty(),
        stop_sequence: z.string().nonempty().nullable(),
        // Observed null in real captures.
        stop_details: z.null().optional()
      })
      .strict(),
    usage: AnthropicSSEUsageSchema,
    // Claude Code injects context management hints (e.g. clear_thinking) into
    // message_delta events. Typed loosely — shape may evolve.
    context_management: z.unknown().optional()
  })
  .strict()

export const AnthropicMessageStopPayloadSchema = z
  .object({
    type: z.literal('message_stop')
  })
  .strict()

export const AnthropicPingPayloadSchema = z
  .object({
    type: z.literal('ping')
  })
  .strict()

// All possible payloads on the SSE wire — discriminated by `type`.
// Each variant is .strict() so the union rejects any unrecognised key
// after the discriminator selects the correct shape.
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

export const AnthropicMessageResponseSchema = z
  .object({
    id: z.string().nonempty(),
    type: z.literal('message'),
    role: z.literal('assistant'),
    model: z.string().nonempty(),
    content: z.array(AnthropicContentBlockUnionSchema),
    stop_reason: z.string().nonempty(),
    stop_sequence: z.string().nonempty().nullable(),
    // Observed null in non-streaming responses, same as SSE message_start/delta.
    stop_details: z.null().optional(),
    usage: AnthropicSSEUsageSchema,
    // Context-management metadata Anthropic injects into non-streaming responses.
    context_management: z.unknown().optional()
  })
  .strict()
export type AnthropicMessageResponse = z.infer<typeof AnthropicMessageResponseSchema>

// ─── Error response ────────────────────────────────────────────────────

export const AnthropicErrorResponseSchema = z
  .object({
    type: z.literal('error'),
    error: z
      .object({
        type: z.string().nonempty(),
        message: z.string().nonempty()
      })
      .strict(),
    request_id: z.string().nonempty().optional()
  })
  .strict()
export type AnthropicErrorResponse = z.infer<typeof AnthropicErrorResponseSchema>
