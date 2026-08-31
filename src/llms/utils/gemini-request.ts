/**
 * Gemini request shaping helpers.
 *
 * `buildRequestBody` converts a unified chat request into the Gemini
 * `generateContent` wire shape; `transformRequestOut` performs the
 * reverse for inbound Gemini-shaped requests (used when the Gemini
 * transformer is acting as the endpoint). The outbound builders
 * themselves live in `./gemini/request-content.ts` (contents[]) and
 * `./gemini/request-config.ts` (generationConfig / toolConfig / tools[]).
 */

import { HTTPException } from 'hono/http-exception'
import type { UnifiedChatRequest, UnifiedMessage, UnifiedTool } from '@/schemas/domain/unified'
import {
  type GeminiContent,
  type GeminiGenerationConfig,
  type GeminiInboundContent,
  GeminiInboundRequestSchema,
  type GeminiInboundTool,
  type GeminiToolConfig
} from '@/schemas/wire/gemini/content'
import { buildGenerationConfig, buildToolConfig, buildTools, isToolChoiceFunctionObject } from './gemini/request-config'
import { buildContents } from './gemini/request-content'
import type { GeminiTool } from './gemini-schema'

// ─── Gemini wire shapes ─────────────────────────────────────────────────
// All schemas live in `@/schemas/wire/gemini/content`; this file imports the
// inferred types and emits values that match them.

/** Gemini `generateContent` request body (what we POST upstream). */
export type GeminiRequestBody = {
  contents: GeminiContent[]
  tools?: GeminiTool[]
  generationConfig: GeminiGenerationConfig
  toolConfig?: GeminiToolConfig
}

/**
 * Narrow an inbound (Zod-parsed) `tool_choice` value into the shape the
 * unified chat request accepts: one of the literal strings, the
 * structured function-object, or `undefined` if absent / unrecognised.
 */
function normalizeToolChoice(value: unknown): UnifiedChatRequest['tool_choice'] {
  if (value === undefined) {
    return undefined
  }
  if (value === 'auto' || value === 'none' || value === 'required') {
    return value
  }
  if (typeof value === 'string') {
    return value
  }
  if (isToolChoiceFunctionObject(value)) {
    return { type: 'function', function: { name: value.function.name } }
  }
  return undefined
}

/**
 * Convert a unified chat request into the Gemini `generateContent`
 * request body shape.
 */
export function buildRequestBody(request: UnifiedChatRequest): GeminiRequestBody {
  const tools = buildTools(request.tools)
  const contents = buildContents(request.messages)
  const generationConfig = buildGenerationConfig(request)

  const body: GeminiRequestBody = {
    contents,
    tools: tools.length ? tools : undefined,
    generationConfig
  }

  const toolConfig = buildToolConfig(request.tool_choice)
  if (toolConfig) {
    body.toolConfig = toolConfig
  }
  return body
}

// ─── Inbound (Gemini-shaped → unified) ─────────────────────────────────

/**
 * Convert one inbound Gemini `contents[]` entry into a unified message,
 * or return `null` if the entry shape is unsupported.
 */
function inboundContentToMessage(content: GeminiInboundContent): UnifiedMessage | null {
  if (typeof content === 'string') {
    return { role: 'user', content }
  }
  if (typeof content.text === 'string') {
    return { role: 'user', content: content.text.length > 0 ? content.text : null }
  }
  if (content.role === 'user') {
    return {
      role: 'user',
      content: content.parts.map((part) => ({ type: 'text', text: part.text }))
    }
  }
  if (content.role === 'model') {
    return {
      role: 'assistant',
      content: content.parts.map((part) => ({ type: 'text', text: part.text }))
    }
  }
  return null
}

/** Default JSON Schema body for a Gemini tool whose parameters are omitted. */
const EMPTY_PARAMETERS: UnifiedTool['function']['parameters'] = {
  type: 'object',
  properties: {}
}

/**
 * Loose type guard for the JSON-Schema-shaped `parameters` block on a
 * Gemini function declaration. We only check the `type === 'object'`
 * top-level marker — deeper validation is the schema's job.
 */
function isUnifiedToolParameters(value: unknown): value is UnifiedTool['function']['parameters'] {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return 'type' in value && value.type === 'object'
}

/**
 * Convert an inbound Gemini `tools[]` entry into the unified tool
 * representation. The Gemini wire schema is JSON-Schema-shaped so we
 * pass `parameters` through unchanged (with an empty-object fallback).
 */
function inboundToolToUnifiedTools(tool: GeminiInboundTool): UnifiedTool[] {
  const declarations = tool.functionDeclarations
  if (!Array.isArray(declarations)) {
    return []
  }
  return declarations.map((decl): UnifiedTool => {
    const parameters = isUnifiedToolParameters(decl.parameters) ? decl.parameters : EMPTY_PARAMETERS
    return {
      type: 'function',
      function: {
        name: decl.name,
        description: decl.description,
        parameters
      }
    }
  })
}

/**
 * Inverse of `buildRequestBody`: parse an inbound Gemini-shaped request
 * back into the unified `UnifiedChatRequest` representation. Used when
 * the Gemini transformer is the endpoint transformer for an upstream
 * Gemini-compatible client.
 */
export function transformRequestOut(request: Record<string, unknown>): UnifiedChatRequest {
  const parsed = GeminiInboundRequestSchema.safeParse(request)
  if (!parsed.success) {
    throw new HTTPException(500, {
      message: `Invalid inbound Gemini request: ${JSON.stringify(parsed.error.issues)}`
    })
  }
  const { contents, tools, model, max_tokens, temperature, stream, tool_choice } = parsed.data

  const unifiedChatRequest: UnifiedChatRequest = {
    messages: [],
    model,
    max_tokens,
    temperature,
    stream,
    tool_choice: normalizeToolChoice(tool_choice)
  }

  if (Array.isArray(contents)) {
    for (const content of contents) {
      const message = inboundContentToMessage(content)
      if (message) {
        unifiedChatRequest.messages.push(message)
      }
    }
  }

  if (Array.isArray(tools)) {
    const unifiedTools: UnifiedTool[] = []
    for (const tool of tools) {
      unifiedTools.push(...inboundToolToUnifiedTools(tool))
    }
    unifiedChatRequest.tools = unifiedTools
  }

  return unifiedChatRequest
}
