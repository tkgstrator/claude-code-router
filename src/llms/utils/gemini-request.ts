/**
 * Gemini request shaping helpers.
 *
 * `buildRequestBody` converts a unified chat request into the Gemini
 * `generateContent` wire shape; `transformRequestOut` performs the
 * reverse for inbound Gemini-shaped requests (used when the Gemini
 * transformer is acting as the endpoint).
 */

import type { Content, ContentListUnion, FunctionDeclaration, Part, Tool, ToolListUnion } from '@google/genai'
import type { ThinkLevel, UnifiedChatRequest, UnifiedMessage } from '../types'
import { type GeminiFunctionDeclaration, type GeminiTool, tTool } from './gemini-schema'

// ─── Gemini wire shapes (subset we emit / consume) ──────────────────────

interface GeminiInlineData {
  mime_type: string
  data: string
}

interface GeminiFileData {
  mime_type: string
  file_uri: string
}

interface GeminiFunctionCallPart {
  functionCall: {
    id: string
    name: string
    args: Record<string, unknown>
  }
  thoughtSignature?: string
}

interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string | undefined
    response: { result: string | unknown }
  }
}

interface GeminiTextPart {
  text: string
  thoughtSignature?: string
}

interface GeminiInlineDataPart {
  inlineData: GeminiInlineData
}

interface GeminiFileDataPart {
  file_data: GeminiFileData
}

type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFileDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiThinkingConfig {
  includeThoughts: boolean
  thinkingLevel?: ThinkLevel
  thinkingBudget?: number
}

interface GeminiGenerationConfig {
  thinkingConfig?: GeminiThinkingConfig
}

interface GeminiFunctionCallingConfig {
  mode?: 'auto' | 'none' | 'any'
  allowedFunctionNames?: string[]
}

interface GeminiToolConfig {
  functionCallingConfig: GeminiFunctionCallingConfig
}

export interface GeminiRequestBody {
  contents: GeminiContent[]
  tools?: GeminiTool[]
  generationConfig: GeminiGenerationConfig
  toolConfig?: GeminiToolConfig
}

/**
 * Best-effort narrowing for the `tool_choice` union — `UnifiedChatRequest`
 * allows arbitrary strings plus a structured object, and we want the
 * `function.name` branch typed for downstream consumers.
 */
interface ToolChoiceFunctionObject {
  type?: 'function'
  function: { name: string }
}

const isToolChoiceFunctionObject = (value: unknown): value is ToolChoiceFunctionObject =>
  typeof value === 'object' &&
  value !== null &&
  'function' in value &&
  typeof (value as { function?: { name?: unknown } }).function?.name === 'string'

/**
 * Convert a unified chat request into the Gemini `generateContent`
 * request body shape.
 */
export function buildRequestBody(request: UnifiedChatRequest): GeminiRequestBody {
  const tools: GeminiTool[] = []
  const functionDeclarations: GeminiFunctionDeclaration[] | undefined = request.tools
    ?.filter((tool) => tool.function.name !== 'web_search')
    ?.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parametersJsonSchema: tool.function.parameters
    }))
  if (functionDeclarations?.length) {
    tools.push(
      tTool({
        functionDeclarations
      })
    )
  }
  const webSearch = request.tools?.find((tool) => tool.function.name === 'web_search')
  if (webSearch) {
    tools.push({
      googleSearch: {}
    })
  }

  const contents: GeminiContent[] = []
  const toolResponses = request.messages.filter((item) => item.role === 'tool')
  request.messages
    .filter((item) => item.role !== 'tool')
    .forEach((message: UnifiedMessage) => {
      let role: 'user' | 'model'
      if (message.role === 'assistant') {
        role = 'model'
      } else if (['user', 'system'].includes(message.role)) {
        role = 'user'
      } else {
        role = 'user' // Default to user if role is not recognized
      }
      const parts: GeminiPart[] = []
      if (typeof message.content === 'string') {
        const part: GeminiTextPart = {
          text: message.content
        }
        if (message?.thinking?.signature) {
          part.thoughtSignature = message.thinking.signature
        }
        parts.push(part)
      } else if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'text') {
            parts.push({
              text: content.text || ''
            })
            continue
          }
          if (content.type === 'image_url') {
            if (content.image_url.url.startsWith('http')) {
              parts.push({
                file_data: {
                  mime_type: content.media_type,
                  file_uri: content.image_url.url
                }
              })
            } else {
              parts.push({
                inlineData: {
                  mime_type: content.media_type,
                  data: content.image_url.url?.split(',')?.pop() || content.image_url.url
                }
              })
            }
          }
        }
      } else if (message.content && typeof message.content === 'object') {
        // Object like { text: "..." } — defensive branch retained from
        // the vendor implementation; the unified type does not allow it,
        // so cast through `unknown` and probe.
        const objContent = message.content as unknown as { text?: unknown }
        if (typeof objContent.text === 'string') {
          parts.push({ text: objContent.text })
        } else {
          parts.push({ text: JSON.stringify(message.content) })
        }
      }

      if (Array.isArray(message.tool_calls)) {
        message.tool_calls.forEach((toolCall, index) => {
          const part: GeminiFunctionCallPart = {
            functionCall: {
              id: toolCall.id || `tool_${Math.random().toString(36).substring(2, 15)}`,
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>
            }
          }
          if (index === 0 && message.thinking?.signature) {
            part.thoughtSignature = message.thinking.signature
          }
          parts.push(part)
        })
      }

      if (parts.length === 0) {
        parts.push({ text: '' })
      }

      contents.push({
        role,
        parts
      })

      if (role === 'model' && message.tool_calls) {
        const functionResponses: GeminiFunctionResponsePart[] = message.tool_calls.map((tool) => {
          const response = toolResponses.find((item) => item.tool_call_id === tool.id)
          return {
            functionResponse: {
              name: tool?.function?.name,
              response: { result: response?.content }
            }
          }
        })
        contents.push({
          role: 'user',
          parts: functionResponses
        })
      }
    })

  const generationConfig: GeminiGenerationConfig = {}

  if (request.reasoning && request.reasoning.effort && request.reasoning.effort !== 'none') {
    const thinkingConfig: GeminiThinkingConfig = {
      includeThoughts: true
    }
    if (request.model.includes('gemini-3')) {
      thinkingConfig.thinkingLevel = request.reasoning.effort
    } else {
      const thinkingBudgets = request.model.includes('pro') ? [128, 32768] : [0, 24576]
      let thinkingBudget: number | undefined
      const max_tokens = request.reasoning.max_tokens
      if (typeof max_tokens !== 'undefined') {
        if (max_tokens >= thinkingBudgets[0] && max_tokens <= thinkingBudgets[1]) {
          thinkingBudget = max_tokens
        } else if (max_tokens < thinkingBudgets[0]) {
          thinkingBudget = thinkingBudgets[0]
        } else if (max_tokens > thinkingBudgets[1]) {
          thinkingBudget = thinkingBudgets[1]
        }
        thinkingConfig.thinkingBudget = thinkingBudget
      }
    }
    generationConfig.thinkingConfig = thinkingConfig
  }

  const body: GeminiRequestBody = {
    contents,
    tools: tools.length ? tools : undefined,
    generationConfig
  }

  if (request.tool_choice) {
    const toolConfig: GeminiToolConfig = {
      functionCallingConfig: {}
    }
    if (request.tool_choice === 'auto') {
      toolConfig.functionCallingConfig.mode = 'auto'
    } else if (request.tool_choice === 'none') {
      toolConfig.functionCallingConfig.mode = 'none'
    } else if (request.tool_choice === 'required') {
      toolConfig.functionCallingConfig.mode = 'any'
    } else if (isToolChoiceFunctionObject(request.tool_choice)) {
      toolConfig.functionCallingConfig.mode = 'any'
      toolConfig.functionCallingConfig.allowedFunctionNames = [request.tool_choice.function.name]
    }
    body.toolConfig = toolConfig
  }

  return body
}

/**
 * Inverse of `buildRequestBody`: parse an inbound Gemini-shaped request
 * back into the unified `UnifiedChatRequest` representation. Used when
 * the Gemini transformer is the endpoint transformer for an upstream
 * Gemini-compatible client.
 */
export function transformRequestOut(request: Record<string, unknown>): UnifiedChatRequest {
  const contents = request.contents as ContentListUnion | undefined
  const tools = request.tools as ToolListUnion | undefined
  const model = request.model as string
  const max_tokens = request.max_tokens as number | undefined
  const temperature = request.temperature as number | undefined
  const stream = request.stream as boolean | undefined
  const tool_choice = request.tool_choice as UnifiedChatRequest['tool_choice'] | undefined

  const unifiedChatRequest: UnifiedChatRequest = {
    messages: [],
    model,
    max_tokens,
    temperature,
    stream,
    tool_choice
  }

  if (Array.isArray(contents)) {
    contents.forEach((content) => {
      if (typeof content === 'string') {
        unifiedChatRequest.messages.push({
          role: 'user',
          content
        })
      } else if (typeof (content as Part).text === 'string') {
        unifiedChatRequest.messages.push({
          role: 'user',
          content: (content as Part).text || null
        })
      } else if ((content as Content).role === 'user') {
        unifiedChatRequest.messages.push({
          role: 'user',
          content:
            (content as Content)?.parts?.map((part: Part) => ({
              type: 'text',
              text: part.text || ''
            })) || []
        })
      } else if ((content as Content).role === 'model') {
        unifiedChatRequest.messages.push({
          role: 'assistant',
          content:
            (content as Content)?.parts?.map((part: Part) => ({
              type: 'text',
              text: part.text || ''
            })) || []
        })
      }
    })
  }

  if (Array.isArray(tools)) {
    unifiedChatRequest.tools = []
    tools.forEach((tool) => {
      const declarations = (tool as Tool).functionDeclarations
      if (Array.isArray(declarations)) {
        declarations.forEach((decl: FunctionDeclaration) => {
          unifiedChatRequest.tools!.push({
            type: 'function',
            function: {
              name: decl.name ?? '',
              description: decl.description ?? '',
              parameters: (decl.parameters as unknown as UnifiedChatRequest['tools'] extends Array<infer T>
                ? T extends { function: { parameters: infer P } }
                  ? P
                  : never
                : never) ?? {
                type: 'object',
                properties: {}
              }
            }
          })
        })
      }
    })
  }

  return unifiedChatRequest
}
