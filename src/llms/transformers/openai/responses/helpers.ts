/**
 * Small stateless helpers shared across the OpenAI Responses request /
 * response conversion modules.
 */

import type { ResponsesStreamEvent } from '@/schemas'

export function newChatcmplId(seed: string | undefined): string {
  if (seed && seed.length > 0) return seed
  return `chatcmpl-${Date.now()}`
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function stringDeltaOrEmpty(delta: ResponsesStreamEvent['delta']): string {
  return typeof delta === 'string' ? delta : ''
}

/**
 * Return the first defined string from a candidate list. Used to
 * select an upstream identifier (call_id, id) without a `??` chain.
 */
export function firstDefined(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Returns the provided model name or the fallback placeholder used by
 * the original transformer when upstream omitted it. Keeps the wire
 * shape stable for downstream consumers that expect a non-empty model.
 */
export function modelOr(model: string | undefined, fallback: string): string {
  return typeof model === 'string' && model.length > 0 ? model : fallback
}
