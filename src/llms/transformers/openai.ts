/**
 * OpenAI endpoint transformer.
 *
 * Owns the `/v1/chat/completions` path. The endpoint conversion itself
 * is a pass-through — UnifiedChatRequest already matches OpenAI's wire
 * format — but when this transformer is mounted in a provider's
 * `transformer.use` chain it normalises the request for newer OpenAI
 * model families:
 *
 *   - gpt-5.x and o-series chat models reject `max_tokens` and require
 *     `max_completion_tokens` instead (HTTP 400 "Unsupported parameter").
 *     We rename the field in place, leaving older gpt-4.x models alone.
 *
 * Codex-family models on the openai provider are routed through
 * `openai-responses` (a per-model `use` override added by
 * services/openai-overlay.ts), so they never reach this rewrite.
 */

import type { RuntimeProvider, TransformerContext, UnifiedChatRequest } from '@/schemas'
import { Transformer } from './base'

// gpt-5.x and o1/o3/o4 chat completions reject `max_tokens` in favour of
// `max_completion_tokens`. The check is intentionally narrow — gpt-4.x
// still uses the legacy field, and codex/Responses-only models are
// peeled off by the chain before we see them.
const MAX_COMPLETION_TOKENS_MODELS = /^(gpt-5(?:\.\d+)?(?:-|$)|o[1-9](?:-|$))/

function modelNeedsMaxCompletionTokens(model: string | undefined): boolean {
  if (typeof model !== 'string' || model.length === 0) return false
  return MAX_COMPLETION_TOKENS_MODELS.test(model)
}

export class OpenAITransformer extends Transformer {
  readonly name = 'openai'
  readonly endPoint = '/v1/chat/completions'

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: RuntimeProvider,
    _context: TransformerContext
  ): Promise<UnifiedChatRequest> {
    const req = request as UnifiedChatRequest & {
      max_completion_tokens?: number
      reasoning_effort?: string
    }
    if (
      modelNeedsMaxCompletionTokens(req.model) &&
      typeof req.max_tokens === 'number' &&
      req.max_completion_tokens === undefined
    ) {
      req.max_completion_tokens = req.max_tokens
      // biome-ignore plugin: explicit removal of the unified-shape field — the upstream rejects it and the schema does not model field removal.
      delete (req as { max_tokens?: unknown }).max_tokens
    }
    const effort = provider.modelReasoningEfforts?.[req.model ?? '']
    if (effort && modelNeedsMaxCompletionTokens(req.model)) {
      // Chat Completions uses the top-level `reasoning_effort` field on
      // gpt-5.x / o-series models; other families ignore it, so gate on
      // the same predicate we use for max_completion_tokens.
      req.reasoning_effort = effort
    }
    return req
  }
}
