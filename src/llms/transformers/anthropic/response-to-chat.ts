/**
 * Anthropic Messages API response → OpenAI Chat Completions envelope.
 *
 * The reverse of what `anthropic/response-blocking.ts` does (Chat →
 * Anthropic). Used by `claude-code-oauth` on non-bypass provider-chain
 * paths so an OpenAI-compat caller who targeted `claude-code,*` gets
 * `{object:'chat.completion', choices:[{message,finish_reason}], usage}`
 * back instead of the raw Anthropic message envelope.
 *
 * Non-stream only — the SSE counterpart is deliberately deferred to a
 * follow-up (Anthropic's `message_start` / `content_block_delta` stream
 * needs an incremental converter, ~100 more lines).
 */

import { nowSeconds } from '../openai-responses/helpers'

// Anthropic wire types — kept structurally-typed (readonly) so the
// converter can be called with `unknown` upstream JSON and validated
// with the runtime guards below.

interface AnthropicTextBlock {
  type: 'text'
  text: string
}

interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string; [k: string]: unknown }

interface AnthropicMessageResponse {
  id?: string
  model?: string
  content?: AnthropicContentBlock[]
  stop_reason?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Runtime guard: the upstream body should be Anthropic-shape. When it
// isn't (already Chat-shape from a bypassed path, or unrelated), the
// caller passes through unchanged.
export function isAnthropicMessageResponse(value: unknown): value is AnthropicMessageResponse {
  if (!isObject(value)) return false
  // The `type: "message"` marker + array `content` are the strongest
  // distinguishing signals; Anthropic always emits both on a
  // successful response, and neither shape (Chat / Responses) uses
  // them at the top level.
  return value.type === 'message' && Array.isArray(value.content)
}

// Anthropic → OpenAI finish_reason. Missing / unknown maps to 'stop'
// so the client always gets one of the canonical values it expects.
function mapStopReason(stopReason: string | null | undefined): string {
  if (stopReason === 'tool_use') return 'tool_calls'
  if (stopReason === 'max_tokens') return 'length'
  if (stopReason === 'stop_sequence') return 'stop'
  return 'stop'
}

function collectTextContent(content: AnthropicContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof (block as AnthropicTextBlock).text === 'string') {
      parts.push((block as AnthropicTextBlock).text)
    }
  }
  return parts.join('')
}

function collectToolCalls(content: AnthropicContentBlock[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    const tu = block as AnthropicToolUseBlock
    // OpenAI's tool_calls[].function.arguments is always a JSON string;
    // Anthropic's tool_use.input is already the decoded object. Stringify
    // it back so the client parses it the same way it would an OpenAI
    // response.
    const args = tu.input === undefined ? '{}' : JSON.stringify(tu.input)
    out.push({
      id: tu.id,
      type: 'function',
      function: {
        name: tu.name,
        arguments: args
      }
    })
  }
  return out
}

/**
 * Convert an Anthropic Messages API JSON response to the OpenAI Chat
 * Completions envelope. Non-stream only. Callers should guard with
 * `isAnthropicMessageResponse` first — this function assumes the
 * shape has already been validated (defensive fallbacks are used
 * only for optional Anthropic fields, not the required outer shape).
 */
export function convertAnthropicResponseToChat(anthropic: AnthropicMessageResponse): Record<string, unknown> {
  const content = Array.isArray(anthropic.content) ? anthropic.content : []
  const textContent = collectTextContent(content)
  const toolCalls = collectToolCalls(content)

  const message: Record<string, unknown> = {
    role: 'assistant',
    // Chat's `content` is null when the assistant emitted tool_calls
    // only. Non-null text is always a plain string (not blocks).
    content: textContent.length > 0 ? textContent : null
  }
  if (toolCalls.length > 0) message.tool_calls = toolCalls

  // Anthropic separates cached input tokens; OpenAI folds them into
  // prompt_tokens (total input regardless of caching). total_tokens is
  // the sum of the two categories.
  const usage = anthropic.usage
  const promptTokens = usage
    ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    : 0
  const completionTokens = usage?.output_tokens ?? 0
  const usageBlock = usage
    ? {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    : undefined

  const envelope: Record<string, unknown> = {
    id: anthropic.id ?? `chatcmpl-${nowSeconds()}`,
    object: 'chat.completion',
    created: nowSeconds(),
    model: anthropic.model ?? '',
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(anthropic.stop_reason)
      }
    ]
  }
  if (usageBlock !== undefined) envelope.usage = usageBlock
  return envelope
}
