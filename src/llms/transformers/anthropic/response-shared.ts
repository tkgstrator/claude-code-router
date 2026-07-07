/**
 * Response-side helpers shared by the blocking (`response-blocking.ts`)
 * and streaming (`response-stream/`) Anthropic response conversion.
 */

import type { ChatCompletion } from 'openai/resources'

// Stop reason mapping (OpenAI finish_reason -> Anthropic stop_reason).
const STOP_REASON_MAPPING: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'stop_sequence'
}

export function mapFinishReason(finishReason: string | null | undefined): string {
  if (!finishReason) return 'end_turn'
  const mapped = STOP_REASON_MAPPING[finishReason]
  return mapped === undefined ? 'end_turn' : mapped
}

// Compute the (input_tokens, output_tokens, cache_read_input_tokens)
// triple from an OpenAI usage object. The fields are genuinely optional
// upstream; absence means zero, which is the correct billing value.
function defaultZero(n: number | undefined): number {
  return typeof n === 'number' ? n : 0
}

type UsageLike = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export function computeUsage(usage: UsageLike | ChatCompletion['usage']): {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
} {
  const promptN = defaultZero(usage?.prompt_tokens)
  const completionN = defaultZero(usage?.completion_tokens)
  const cachedN = defaultZero(usage?.prompt_tokens_details?.cached_tokens)
  return {
    input_tokens: promptN - cachedN,
    output_tokens: completionN,
    cache_read_input_tokens: cachedN
  }
}
