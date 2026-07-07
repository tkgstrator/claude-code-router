/**
 * Anthropic outbound (OpenAI-shaped -> Anthropic) blocking JSON response
 * conversion. See `response-stream/` for the SSE counterpart.
 */

import { HTTPException } from 'hono/http-exception'
import type { ChatCompletion } from 'openai/resources'
import type { Logger } from 'pino'
import { v4 } from 'uuid'
import { computeUsage, mapFinishReason } from './response-shared'

// Structural guard for the subset of `ChatCompletion` fields this
// transformer reads. We accept the upstream payload as `unknown` and
// gate it through this guard so the field access below is type-safe
// without an `as` cast.
function isChatCompletionLike(value: unknown): value is ChatCompletion {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('model' in value) || typeof value.model !== 'string') return false
  if (!('choices' in value) || !Array.isArray(value.choices)) return false
  return true
}

// Annotation shape attached to an OpenAI ChatCompletion message when the
// upstream model uses web search. The SDK type doesn't declare it, so we
// narrow defensively using a type guard.
type ChatMessageAnnotation = { url_citation: { url: string; title: string } }

function isChatMessageAnnotation(value: unknown): value is ChatMessageAnnotation {
  if (typeof value !== 'object' || value === null) return false
  if (!('url_citation' in value)) return false
  const { url_citation } = value
  if (typeof url_citation !== 'object' || url_citation === null) return false
  if (!('url' in url_citation) || !('title' in url_citation)) return false
  return typeof url_citation.url === 'string' && typeof url_citation.title === 'string'
}

function getMessageAnnotations(
  message: ChatCompletion['choices'][number]['message']
): ChatMessageAnnotation[] | undefined {
  if (!('annotations' in message)) return undefined
  const { annotations } = message
  if (!Array.isArray(annotations)) return undefined
  return annotations.filter(isChatMessageAnnotation)
}

// Optional thinking block on a ChatCompletion message (SDK doesn't
// declare it; provider-specific extension).
type ChatMessageThinking = { content?: string; signature?: string }

function getMessageThinking(message: ChatCompletion['choices'][number]['message']): ChatMessageThinking | undefined {
  if (!('thinking' in message)) return undefined
  const { thinking } = message
  if (typeof thinking !== 'object' || thinking === null) return undefined
  const content = 'content' in thinking && typeof thinking.content === 'string' ? thinking.content : undefined
  const signature = 'signature' in thinking && typeof thinking.signature === 'string' ? thinking.signature : undefined
  if (content === undefined && signature === undefined) return undefined
  return { content, signature }
}

function appendAnnotationContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  const annotations = getMessageAnnotations(message)
  if (!annotations || annotations.length === 0) return
  const id = `srvtoolu_${v4()}`
  content.push({
    type: 'server_tool_use',
    id,
    name: 'web_search',
    input: { query: '' }
  })
  content.push({
    type: 'web_search_tool_result',
    tool_use_id: id,
    content: annotations.map((item) => ({
      type: 'web_search_result',
      url: item.url_citation.url,
      title: item.url_citation.title
    }))
  })
}

function appendTextContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  if (message.content) {
    content.push({ type: 'text', text: message.content })
  }
}

type OpenAIToolCall = {
  id: string
  function: { name: string; arguments?: unknown }
}

function isOpenAIToolCall(value: unknown): value is OpenAIToolCall {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('function' in value)) return false
  const fn = value.function
  if (typeof fn !== 'object' || fn === null) return false
  if (!('name' in fn)) return false
  return typeof fn.name === 'string'
}

function parseToolCallInput(toolCall: OpenAIToolCall): unknown {
  const argumentsRaw = toolCall.function.arguments
  try {
    if (argumentsRaw === undefined || argumentsRaw === null) return {}
    if (typeof argumentsRaw === 'object') return argumentsRaw
    if (typeof argumentsRaw === 'string') {
      if (argumentsRaw.length === 0) return {}
      return JSON.parse(argumentsRaw)
    }
    return {}
  } catch {
    return { text: typeof argumentsRaw === 'string' ? argumentsRaw : '' }
  }
}

function appendToolCallContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  if (!message.tool_calls || message.tool_calls.length === 0) return
  for (const toolCall of message.tool_calls) {
    if (!isOpenAIToolCall(toolCall)) continue
    const parsedInput = parseToolCallInput(toolCall)
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parsedInput
    })
  }
}

function appendThinkingContent(
  content: Array<Record<string, unknown>>,
  message: ChatCompletion['choices'][number]['message']
): void {
  const thinking = getMessageThinking(message)
  if (thinking?.content) {
    content.push({
      type: 'thinking',
      thinking: thinking.content,
      signature: thinking.signature
    })
  }
}

/**
 * Convert a blocking OpenAI-shaped `ChatCompletion` response into the
 * Anthropic non-stream message shape.
 */
export function convertOpenAIResponseToAnthropic(
  openaiResponse: unknown,
  reqId: string | undefined,
  logger: Logger | undefined
): Record<string, unknown> {
  logger?.debug({ reqId, response: openaiResponse }, `Original OpenAI response`)
  if (!isChatCompletionLike(openaiResponse)) {
    throw new HTTPException(500, { message: `Provider error: ${JSON.stringify(openaiResponse)}` })
  }
  try {
    const choice = openaiResponse.choices[0]
    if (!choice) {
      throw new Error('No choices found in OpenAI response')
    }
    const content: Array<Record<string, unknown>> = []
    appendAnnotationContent(content, choice.message)
    appendTextContent(content, choice.message)
    appendToolCallContent(content, choice.message)
    appendThinkingContent(content, choice.message)

    const usage = computeUsage(openaiResponse.usage)
    const result = {
      id: openaiResponse.id,
      type: 'message',
      role: 'assistant',
      model: openaiResponse.model,
      content,
      stop_reason: mapFinishReason(choice.finish_reason),
      stop_sequence: null,
      usage
    }
    logger?.debug({ reqId, result }, `Conversion complete, final Anthropic response`)
    return result
  } catch {
    throw new HTTPException(500, { message: `Provider error: ${JSON.stringify(openaiResponse)}` })
  }
}
