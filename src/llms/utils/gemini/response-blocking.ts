/**
 * Gemini → OpenAI-shaped response conversion: blocking JSON branch.
 *
 * Converts a single (non-streaming) Gemini `generateContent` JSON
 * response into the pipeline's internal OpenAI-flavoured chat.completion
 * shape. See `response-streaming.ts` for the SSE counterpart.
 */

import type { Logger } from 'pino'
import { type GeminiCandidate, type GeminiResponse, type GeminiResponsePart, GeminiResponseSchema } from '@/schemas'
import { cloneResponse } from '../response-clone'
import { nowSeconds, partsOf, toPipelineToolCalls, toUsage } from './response-shared'

/**
 * Split a Gemini response's parts into the thinking text bucket and the
 * remaining (non-thought) parts.
 */
function splitThinking(parts: GeminiResponsePart[]): {
  thinkingContent: string
  nonThinkingParts: GeminiResponsePart[]
} {
  let thinkingContent = ''
  const nonThinkingParts: GeminiResponsePart[] = []
  for (const part of parts) {
    if (part.text && part.thought === true) {
      thinkingContent += part.text
    } else {
      nonThinkingParts.push(part)
    }
  }
  return { thinkingContent, nonThinkingParts }
}

/**
 * Build the assistant `message` shape for the blocking JSON response.
 * Returns an object so the caller can spread it into the choice.
 */
function buildAssistantMessage(parts: GeminiResponsePart[]): {
  content: string
  role: 'assistant'
  tool_calls?: ReturnType<typeof toPipelineToolCalls>
  thinking?: { content: string; signature: string }
} {
  const { thinkingContent, nonThinkingParts } = splitThinking(parts)
  const thinkingSignature = parts.find((part) => part.thoughtSignature)?.thoughtSignature
  const tool_calls = toPipelineToolCalls(nonThinkingParts)
  const textContent = nonThinkingParts
    .filter((part) => typeof part.text === 'string' && part.text.length > 0)
    .map((part) => part.text)
    .join('\n')

  const message: ReturnType<typeof buildAssistantMessage> = {
    content: textContent,
    role: 'assistant',
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined
  }
  if (thinkingSignature) {
    message.thinking = {
      content: thinkingContent || '(no content)',
      signature: thinkingSignature
    }
  }
  return message
}

/** Build the full OpenAI-shaped response body for the blocking JSON branch. */
function buildBlockingResponseBody(jsonResponse: GeminiResponse): unknown {
  const firstCandidate: GeminiCandidate | undefined = jsonResponse.candidates[0]
  const parts = partsOf(firstCandidate)
  const rawFinishReason = firstCandidate?.finishReason
  const finishReason = typeof rawFinishReason === 'string' ? rawFinishReason.toLowerCase() : null
  return {
    id: jsonResponse.responseId,
    choices: [
      {
        finish_reason: finishReason,
        index: 0,
        message: buildAssistantMessage(parts)
      }
    ],
    created: nowSeconds(),
    model: jsonResponse.modelVersion,
    object: 'chat.completion',
    usage: toUsage(jsonResponse.usageMetadata)
  }
}

/** Blocking JSON branch — parses, logs, and reshapes a full Gemini response. */
export async function transformBlockingResponse(
  response: Response,
  providerName: string,
  logger?: Logger
): Promise<Response> {
  const rawJson: unknown = await response.json()
  const parsed = GeminiResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid Gemini JSON response: ${JSON.stringify(parsed.error.issues)}`)
  }
  logger?.debug({ response: parsed.data }, `${providerName} response:`)
  const body = buildBlockingResponseBody(parsed.data)
  return cloneResponse(response, JSON.stringify(body))
}
