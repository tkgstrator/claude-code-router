/**
 * Zod schemas for the Gemini wire formats consumed/produced by the
 * Gemini transformer's request/response conversion helpers.
 *
 * These describe the subset of the Gemini `generateContent` /
 * `streamGenerateContent` JSON shapes we actually read. They exist so
 * the gemini-conversion helpers can `safeParse` an inbound payload once
 * and pass typed structures to the rest of the conversion code instead
 * of sprinkling `as` assertions over `unknown` fields.
 */

import { z } from '@hono/zod-openapi'
import { AnnotationSchema, ThinkLevelSchema } from './llm-chat.dto'

// ─── Gemini response sub-shapes ────────────────────────────────────────

// Token-count fields default to `0` so callers can treat missing values
// the same as zero — that matches the OpenAI-shaped usage block we
// emit, where each field is a required number.
export const GeminiUsageMetadataSchema = z
  .object({
    candidatesTokenCount: z.number().int().nonnegative().default(0),
    promptTokenCount: z.number().int().nonnegative().default(0),
    cachedContentTokenCount: z.number().int().nonnegative().default(0),
    totalTokenCount: z.number().int().nonnegative().default(0),
    thoughtsTokenCount: z.number().int().nonnegative().default(0)
  })
  .loose()
export type GeminiUsageMetadata = z.infer<typeof GeminiUsageMetadataSchema>

// Inner `segment` defaults to an empty record (with default-filled
// fields) so callers can access `.text` / `.startIndex` directly.
const GeminiSegmentSchema = z
  .object({
    text: z.string().default(''),
    startIndex: z.number().int().nonnegative().default(0),
    endIndex: z.number().int().nonnegative().default(0)
  })
  .loose()

export const GeminiGroundingSupportSchema = z
  .object({
    groundingChunkIndices: z.array(z.number().int().nonnegative()).default([]),
    segment: GeminiSegmentSchema.default({ text: '', startIndex: 0, endIndex: 0 })
  })
  .loose()
export type GeminiGroundingSupport = z.infer<typeof GeminiGroundingSupportSchema>

const GeminiWebSchema = z
  .object({
    uri: z.string().default(''),
    title: z.string().default('')
  })
  .loose()

export const GeminiGroundingChunkSchema = z
  .object({
    web: GeminiWebSchema.default({ uri: '', title: '' })
  })
  .loose()
export type GeminiGroundingChunk = z.infer<typeof GeminiGroundingChunkSchema>

export const GeminiGroundingMetadataSchema = z
  .object({
    groundingChunks: z.array(GeminiGroundingChunkSchema).default([]),
    groundingSupports: z.array(GeminiGroundingSupportSchema).default([])
  })
  .loose()
export type GeminiGroundingMetadata = z.infer<typeof GeminiGroundingMetadataSchema>

// ─── Gemini Part / Content ─────────────────────────────────────────────

// `text` defaults to '' so callers can read `.text` directly. `thought`
// defaults to false (Gemini omits the field for non-reasoning parts).
export const GeminiResponsePartSchema = z
  .object({
    text: z.string().default(''),
    thought: z.boolean().default(false),
    thoughtSignature: z.string().nonempty().optional(),
    functionCall: z
      .object({
        id: z.string().nonempty().optional(),
        name: z.string().nonempty().optional(),
        args: z.record(z.string().nonempty(), z.unknown()).default({})
      })
      .loose()
      .optional()
  })
  .loose()
export type GeminiResponsePart = z.infer<typeof GeminiResponsePartSchema>

export const GeminiCandidateSchema = z
  .object({
    content: z
      .object({
        parts: z.array(GeminiResponsePartSchema).default([])
      })
      .loose()
      .optional(),
    finishReason: z.string().nonempty().optional(),
    groundingMetadata: GeminiGroundingMetadataSchema.optional()
  })
  .loose()
export type GeminiCandidate = z.infer<typeof GeminiCandidateSchema>

// ─── Gemini blocking response / streaming chunk ────────────────────────

export const GeminiResponseSchema = z
  .object({
    candidates: z.array(GeminiCandidateSchema),
    // Gemini emits `responseId` for every response but it's officially
    // optional on the wire — fall back to '' so the OpenAI-shaped `id`
    // is always a string.
    responseId: z.string().default(''),
    modelVersion: z.string().nonempty().optional(),
    usageMetadata: GeminiUsageMetadataSchema.optional()
  })
  .loose()
export type GeminiResponse = z.infer<typeof GeminiResponseSchema>

export const GeminiStreamChunkSchema = GeminiResponseSchema.extend({
  modelVersion: z.string().nonempty()
})
export type GeminiStreamChunk = z.infer<typeof GeminiStreamChunkSchema>

// ─── Inbound Gemini-shaped request (for transformRequestOut) ───────────

// Empty default so consumers don't need `?? ''` fallbacks. The inbound
// Gemini wire shape always carries at least an empty text field on each
// part (Gemini emits `text: ''` when there is no content).
const GeminiInboundPartSchema = z
  .object({
    text: z.string().default('')
  })
  .loose()

const GeminiInboundContentObjectSchema = z
  .object({
    role: z.string().nonempty().optional(),
    parts: z.array(GeminiInboundPartSchema).default([]),
    text: z.string().default('')
  })
  .loose()

const GeminiInboundContentSchema = z.union([z.string().nonempty(), GeminiInboundContentObjectSchema])
export type GeminiInboundContent = z.infer<typeof GeminiInboundContentSchema>

const GeminiInboundFunctionDeclarationSchema = z
  .object({
    name: z.string().default(''),
    description: z.string().default(''),
    parameters: z.unknown().optional()
  })
  .loose()
export type GeminiInboundFunctionDeclaration = z.infer<typeof GeminiInboundFunctionDeclarationSchema>

const GeminiInboundToolSchema = z
  .object({
    functionDeclarations: z.array(GeminiInboundFunctionDeclarationSchema).default([])
  })
  .loose()
export type GeminiInboundTool = z.infer<typeof GeminiInboundToolSchema>

export const GeminiInboundRequestSchema = z
  .object({
    contents: z.array(GeminiInboundContentSchema).default([]),
    tools: z.array(GeminiInboundToolSchema).default([]),
    model: z.string().nonempty(),
    max_tokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
    stream: z.boolean().default(false),
    tool_choice: z.unknown().optional()
  })
  .loose()
export type GeminiInboundRequest = z.infer<typeof GeminiInboundRequestSchema>

// ─── OpenAI-shaped pipeline output (chat.completion.chunk) ─────────────
//
// gemini-response converts Gemini wire chunks into these OpenAI-shaped
// envelopes for the rest of the pipeline (anthropic transformer reads
// them as if they came from a chat-completions endpoint).

export const PipelineToolCallSchema = z.object({
  id: z.string().nonempty(),
  type: z.literal('function'),
  function: z.object({
    name: z.string().nonempty().optional(),
    arguments: z.string().min(0)
  })
})
export type PipelineToolCall = z.input<typeof PipelineToolCallSchema>

export const PipelineToolCallDeltaSchema = PipelineToolCallSchema.extend({
  index: z.number().int().nonnegative()
})
export type PipelineToolCallDelta = z.input<typeof PipelineToolCallDeltaSchema>

export const PipelineDeltaSchema = z.object({
  role: z.literal('assistant'),
  content: z.union([z.string().min(0), z.null()]).optional(),
  thinking: z
    .object({
      content: z.string().min(0).optional(),
      signature: z.string().nonempty().optional()
    })
    .optional(),
  tool_calls: z.array(PipelineToolCallDeltaSchema).default([]),
  annotations: z.array(AnnotationSchema).default([])
})
export type PipelineDelta = z.input<typeof PipelineDeltaSchema>

export const PipelineChunkChoiceSchema = z.object({
  delta: PipelineDeltaSchema,
  finish_reason: z.union([z.string().nonempty(), z.null()]),
  index: z.number().int().nonnegative(),
  logprobs: z.null()
})
export type PipelineChunkChoice = z.input<typeof PipelineChunkChoiceSchema>

export const PipelineChunkUsageSchema = z.object({
  completion_tokens: z.number().int().nonnegative(),
  prompt_tokens: z.number().int().nonnegative(),
  prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }),
  total_tokens: z.number().int().nonnegative(),
  output_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative() })
})
export type PipelineChunkUsage = z.input<typeof PipelineChunkUsageSchema>

export const PipelineStreamChunkSchema = z.object({
  choices: z.array(PipelineChunkChoiceSchema),
  // Unix epoch seconds (OpenAI uses seconds; Gemini conversion emits seconds).
  created: z.number().int().nonnegative(),
  id: z.string().nonempty(),
  model: z.string().nonempty(),
  object: z.literal('chat.completion.chunk'),
  system_fingerprint: z.string().nonempty(),
  usage: PipelineChunkUsageSchema.optional()
})
export type PipelineStreamChunk = z.input<typeof PipelineStreamChunkSchema>

// ─── Gemini outbound wire shapes (what we emit to Gemini) ──────────────

export const GeminiInlineDataSchema = z.object({
  mime_type: z.string().nonempty(),
  data: z.string().nonempty()
})
export type GeminiInlineData = z.input<typeof GeminiInlineDataSchema>

export const GeminiFileDataSchema = z.object({
  mime_type: z.string().nonempty(),
  file_uri: z.string().nonempty()
})
export type GeminiFileData = z.input<typeof GeminiFileDataSchema>

export const GeminiFunctionCallPartSchema = z.object({
  functionCall: z.object({
    id: z.string().nonempty(),
    name: z.string().nonempty(),
    args: z.record(z.string().nonempty(), z.unknown())
  }),
  thoughtSignature: z.string().nonempty().optional()
})
export type GeminiFunctionCallPart = z.input<typeof GeminiFunctionCallPartSchema>

export const GeminiFunctionResponsePartSchema = z.object({
  functionResponse: z.object({
    name: z.string().nonempty().optional(),
    response: z.object({ result: z.union([z.string().min(0), z.unknown()]) })
  })
})
export type GeminiFunctionResponsePart = z.input<typeof GeminiFunctionResponsePartSchema>

export const GeminiTextPartSchema = z.object({
  text: z.string().min(0),
  thoughtSignature: z.string().nonempty().optional()
})
export type GeminiTextPart = z.input<typeof GeminiTextPartSchema>

export const GeminiInlineDataPartSchema = z.object({ inlineData: GeminiInlineDataSchema })
export type GeminiInlineDataPart = z.input<typeof GeminiInlineDataPartSchema>

export const GeminiFileDataPartSchema = z.object({ file_data: GeminiFileDataSchema })
export type GeminiFileDataPart = z.input<typeof GeminiFileDataPartSchema>

export const GeminiPartSchema = z.union([
  GeminiTextPartSchema,
  GeminiInlineDataPartSchema,
  GeminiFileDataPartSchema,
  GeminiFunctionCallPartSchema,
  GeminiFunctionResponsePartSchema
])
export type GeminiPart = z.input<typeof GeminiPartSchema>

export const GeminiContentSchema = z.object({
  role: z.enum(['user', 'model']),
  parts: z.array(GeminiPartSchema)
})
export type GeminiContent = z.input<typeof GeminiContentSchema>

export const GeminiThinkingConfigSchema = z.object({
  includeThoughts: z.boolean(),
  thinkingLevel: ThinkLevelSchema.optional(),
  thinkingBudget: z.number().int().nonnegative().optional()
})
export type GeminiThinkingConfig = z.input<typeof GeminiThinkingConfigSchema>

export const GeminiGenerationConfigSchema = z.object({
  thinkingConfig: GeminiThinkingConfigSchema.optional()
})
export type GeminiGenerationConfig = z.input<typeof GeminiGenerationConfigSchema>

export const GeminiFunctionCallingConfigSchema = z.object({
  mode: z.enum(['auto', 'none', 'any']).optional(),
  allowedFunctionNames: z.array(z.string().nonempty()).default([])
})
export type GeminiFunctionCallingConfig = z.input<typeof GeminiFunctionCallingConfigSchema>

export const GeminiToolConfigSchema = z.object({
  functionCallingConfig: GeminiFunctionCallingConfigSchema
})
export type GeminiToolConfig = z.input<typeof GeminiToolConfigSchema>

/** Tool-choice narrowing helper shape — UnifiedChatRequest's tool_choice
 *  union allows arbitrary strings plus a structured object; this is the
 *  structured object variant. */
export const ToolChoiceFunctionObjectSchema = z.object({
  type: z.literal('function').optional(),
  function: z.object({ name: z.string().nonempty() })
})
export type ToolChoiceFunctionObject = z.input<typeof ToolChoiceFunctionObjectSchema>

// ─── Gemini outbound request body (what we POST upstream) ──────────────
//
// Imported here from `./llm-gemini-schema-tools` would be cleaner, but
// the `GeminiTool` schema lives inside the conversion utility right now.
// Until that moves into this file, GeminiRequestBody stays as the
// plain type alias re-exported from gemini-request.ts. (The tool schema
// is a recursive structure that the conversion helper builds manually.)
