/**
 * OpenAI Responses streaming chunk builders.
 *
 * Pure event -> chat-completion-chunk mapping, split out of
 * `response-stream.ts` (which owns the buffered SSE parsing session)
 * purely to keep that file under the line-count budget.
 */

import type { MessageContent, ResponsesStreamEvent } from '@/schemas'
import { firstDefined, modelOr, newChatcmplId, nowSeconds, stringDeltaOrEmpty } from './helpers'

export type StreamIndexState = {
  index: number
  lastEventType: string
}

function buildTextDeltaChunk(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number
): Record<string, unknown> {
  return {
    id: newChatcmplId(data.item_id),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: data.response?.model,
    choices: [
      {
        index: getCurrentIndex(data.type),
        delta: { content: stringDeltaOrEmpty(data.delta) },
        finish_reason: null
      }
    ]
  }
}

function buildFunctionCallAddedChunk(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number
): Record<string, unknown> {
  const item = data.item
  const toolName = item?.name
  if (toolName === undefined) {
    throw new Error('OpenAI Responses stream: function_call output is missing name')
  }
  const callId = firstDefined([item?.call_id, item?.id])
  return {
    id: newChatcmplId(callId),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: modelOr(data.response?.model, 'gpt-5-codex-'),
    choices: [
      {
        index: getCurrentIndex(data.type),
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: callId,
              function: {
                name: toolName,
                arguments: ''
              },
              type: 'function'
            }
          ]
        },
        finish_reason: null
      }
    ]
  }
}

function buildMessageAddedChunk(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number
): Record<string, unknown> | null {
  const item = data.item
  if (!item) return null

  const contentItems: MessageContent[] = []
  const itemContent = item.content
  if (Array.isArray(itemContent)) {
    itemContent.forEach((entry) => {
      if (entry.type === 'output_text' && typeof entry.text === 'string') {
        contentItems.push({
          type: 'text',
          text: entry.text
        })
      }
    })
  }

  const delta: { role: string; content?: string | MessageContent[] } = { role: 'assistant' }
  if (contentItems.length === 1 && contentItems[0].type === 'text') {
    delta.content = contentItems[0].text
  } else if (contentItems.length > 0) {
    delta.content = contentItems
  }
  if (!delta.content) return null

  return {
    id: newChatcmplId(item.id),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: data.response?.model,
    choices: [
      {
        index: getCurrentIndex(data.type),
        delta,
        finish_reason: null
      }
    ]
  }
}

function buildAnnotationChunk(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number
): Record<string, unknown> {
  // ResponsesAnnotationSchema fills missing fields with empty
  // defaults; if `annotation` itself is undefined we synthesise a
  // schema-shaped placeholder so the downstream emit stays uniform.
  const empty = { url: '', title: '', start_index: 0, end_index: 0 }
  const annotation = data.annotation ? data.annotation : empty
  return {
    id: newChatcmplId(data.item_id),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: modelOr(data.response?.model, 'gpt-5-codex'),
    choices: [
      {
        index: getCurrentIndex(data.type),
        delta: {
          annotations: [
            {
              type: 'url_citation',
              url_citation: {
                url: annotation.url,
                title: annotation.title,
                content: '',
                start_index: annotation.start_index,
                end_index: annotation.end_index
              }
            }
          ]
        },
        finish_reason: null
      }
    ]
  }
}

function buildFunctionArgsDeltaChunk(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number
): Record<string, unknown> {
  return {
    id: newChatcmplId(data.item_id),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: modelOr(data.response?.model, 'gpt-5-codex-'),
    choices: [
      {
        index: getCurrentIndex(data.type),
        delta: {
          tool_calls: [
            {
              index: 0,
              function: {
                arguments: stringDeltaOrEmpty(data.delta)
              }
            }
          ]
        },
        finish_reason: null
      }
    ]
  }
}

function buildCompletedChunk(data: ResponsesStreamEvent): Record<string, unknown> {
  const finishReason = data.response?.output?.some((item) => item.type === 'function_call') ? 'tool_calls' : 'stop'
  return {
    id: newChatcmplId(data.response?.id),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: modelOr(data.response?.model, 'gpt-5-codex-'),
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason
      }
    ]
  }
}

function buildReasoningDeltaChunk(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number
): Record<string, unknown> {
  return {
    id: newChatcmplId(data.item_id),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: data.response?.model,
    choices: [
      {
        index: getCurrentIndex(data.type),
        delta: {
          thinking: {
            content: stringDeltaOrEmpty(data.delta)
          }
        },
        finish_reason: null
      }
    ]
  }
}

function buildReasoningSignatureChunk(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number
): Record<string, unknown> {
  // Use the same index as the most recent reasoning_summary_text delta
  // (the original code reused `currentIndex` without bumping). This
  // helper inspects the tracker without mutating it by passing the
  // type that already advanced it.
  return {
    id: newChatcmplId(data.item_id),
    object: 'chat.completion.chunk',
    created: nowSeconds(),
    model: data.response?.model,
    choices: [
      {
        index: getCurrentIndex('response.reasoning_summary_text.delta'),
        delta: {
          thinking: {
            signature: data.item_id
          }
        },
        finish_reason: null
      }
    ]
  }
}

/**
 * Translates a single Responses-API SSE event into the chat-completion
 * chunk(s) the rest of the pipeline expects. Returns `true` when the
 * event indicates the stream is complete (so callers can suppress the
 * extra synthetic `[DONE]`).
 */
export function handleStreamEvent(
  data: ResponsesStreamEvent,
  getCurrentIndex: (eventType: string) => number,
  enqueueChunk: (chunk: unknown) => void
): boolean {
  switch (data.type) {
    case 'response.output_text.delta':
      enqueueChunk(buildTextDeltaChunk(data, getCurrentIndex))
      return false
    case 'response.output_item.added':
      if (data.item?.type === 'function_call') {
        enqueueChunk(buildFunctionCallAddedChunk(data, getCurrentIndex))
      } else if (data.item?.type === 'message') {
        const chunk = buildMessageAddedChunk(data, getCurrentIndex)
        if (chunk) enqueueChunk(chunk)
      }
      return false
    case 'response.output_text.annotation.added':
      enqueueChunk(buildAnnotationChunk(data, getCurrentIndex))
      return false
    case 'response.function_call_arguments.delta':
      enqueueChunk(buildFunctionArgsDeltaChunk(data, getCurrentIndex))
      return false
    case 'response.completed':
      enqueueChunk(buildCompletedChunk(data))
      return true
    case 'response.reasoning_summary_text.delta':
      enqueueChunk(buildReasoningDeltaChunk(data, getCurrentIndex))
      return false
    case 'response.reasoning_summary_part.done':
      if (data.part) enqueueChunk(buildReasoningSignatureChunk(data, getCurrentIndex))
      return false
    default:
      return false
  }
}
