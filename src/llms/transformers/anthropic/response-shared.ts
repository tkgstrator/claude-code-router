/**
 * Response-side helpers shared by the blocking (`response-blocking.ts`)
 * and streaming (`response-stream/`) Anthropic response conversion.
 *
 * The OpenAI-finish → Anthropic-stop reason mapping used to live here;
 * it now lives (with its inverse) in `src/llms/utils/finish-reason.ts`
 * so both directions stay derived from a single canonical table.
 */

import type { ChatCompletion } from 'openai/resources'

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
