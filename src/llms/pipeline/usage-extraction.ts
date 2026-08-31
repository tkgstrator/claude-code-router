/**
 * Best-effort usage-row extraction from an upstream response clone.
 *
 * Parses either a blocking JSON body or an SSE stream for the usage
 * block and records it via `deps.recordUsage`. Never throws — callers
 * treat this as fire-and-forget so a parse failure never affects the
 * response the client actually receives.
 */

import {
  AnthropicMessageDeltaEventSchema,
  AnthropicMessageStartEventSchema,
  ChatCompletionUsageChunkSchema,
  JsonResponseWithUsageSchema,
  ResponsesCompletedEventSchema,
  type TransformerContext,
  type UsageBlock,
  viewPipelineBody
} from '@/schemas'
import type { ResolvedProvider } from '../registry/provider'
import { resolveSessionId } from './session-id'
import type { PipelineDeps } from './types'

export async function captureUsage(
  resp: Response,
  context: TransformerContext,
  provider: ResolvedProvider,
  body: unknown,
  status: number,
  durationMs: number,
  deps: PipelineDeps
): Promise<void> {
  const usage = await extractUsage(resp)
  if (!usage) return

  const sessionId = resolveSessionId(context)
  const tokens = computeTokenStats(usage)
  const view = viewPipelineBody(body)

  // The client's original model, the routing lane, and the subagent flag
  // all ride on context.req (stamped in resolveInvocationForModel).
  // requestedModel / scenario fall back to null so a request that never
  // went through scenario routing still records a valid row; isSubagent
  // is always known (defaults false at the route builder), so it stays a
  // plain boolean here.
  const requestedModel = context.req?.requestedModel
  const scenario = context.req?.scenarioType
  const isSubagent = context.req?.isSubagent === true
  const inboundType = context.req?.inboundType
  const surface = context.req?.surface

  await deps.recordUsage?.({
    sessionId,
    provider: provider.name,
    model: view.model !== undefined ? view.model : 'unknown',
    requestedModel: requestedModel !== undefined ? requestedModel : null,
    scenario: scenario !== undefined ? scenario : null,
    inboundType: inboundType !== undefined ? inboundType : null,
    surface: surface !== undefined ? surface : null,
    isSubagent,
    inputTokens: tokens.rawInput,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cachedTokens,
    cacheWriteTokens: tokens.writtenTokens,
    totalInputTokens: tokens.totalInputTokens,
    cacheHitPct: tokens.cacheHitPct,
    durationMs,
    status
  })
}

type TokenStats = {
  cachedTokens: number
  writtenTokens: number
  outputTokens: number
  rawInput: number
  totalInputTokens: number
  cacheHitPct: number
}

function computeTokenStats(usage: UsageBlock): TokenStats {
  const cachedTokens =
    numberOrZero(usage.cache_read_input_tokens) || numberOrZero(usage.input_tokens_details?.cached_tokens)
  const writtenTokens = numberOrZero(usage.cache_creation_input_tokens)
  const outputTokens = numberOrZero(usage.output_tokens) || numberOrZero(usage.completion_tokens)
  // Anthropic input_tokens is the non-cached portion only; OpenAI uses prompt_tokens.
  const rawInput = numberOrZero(usage.input_tokens) || numberOrZero(usage.prompt_tokens)
  const totalInputTokens = rawInput + writtenTokens + cachedTokens
  const cacheHitPct = totalInputTokens > 0 ? Math.round((cachedTokens / totalInputTokens) * 100) : 0
  return { cachedTokens, writtenTokens, outputTokens, rawInput, totalInputTokens, cacheHitPct }
}

/** Coerce an optional `unknown` numeric usage field to a finite number, defaulting to 0. */
function numberOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function extractUsage(resp: Response): Promise<UsageBlock | null> {
  try {
    const ct = resp.headers.get('content-type')
    const contentType = (typeof ct === 'string' ? ct : '').toLowerCase()
    if (contentType.includes('application/json')) {
      return await extractJsonUsage(resp)
    }
    // SSE or unknown content type — parse line-by-line.
    return await extractStreamUsage(resp)
  } catch {
    return null
  }
}

async function extractJsonUsage(resp: Response): Promise<UsageBlock | null> {
  const json = await resp.json().catch(() => null)
  const result = JsonResponseWithUsageSchema.safeParse(json)
  if (!result.success) return null
  return result.data.usage !== undefined ? result.data.usage : null
}

async function extractStreamUsage(resp: Response): Promise<UsageBlock | null> {
  const text = await resp.text()
  let usage: UsageBlock | null = null
  for (const block of text.split('\n\n')) {
    usage = applySseBlock(block, usage)
  }
  if (!usage) usage = fallbackJsonParse(text)
  return usage
}

function applySseBlock(block: string, current: UsageBlock | null): UsageBlock | null {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return current
  const raw = dataLine.slice(5).trim()
  if (raw === '[DONE]') return current
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return current
  }

  const start = AnthropicMessageStartEventSchema.safeParse(obj)
  if (start.success) return { ...start.data.message.usage }

  const delta = AnthropicMessageDeltaEventSchema.safeParse(obj)
  if (delta.success) return { ...(current !== null ? current : {}), ...delta.data.usage }

  const completed = ResponsesCompletedEventSchema.safeParse(obj)
  if (completed.success) return { ...completed.data.response.usage }

  const chunk = ChatCompletionUsageChunkSchema.safeParse(obj)
  if (chunk.success) return { ...chunk.data.usage }

  return current
}

function fallbackJsonParse(text: string): UsageBlock | null {
  try {
    const result = JsonResponseWithUsageSchema.safeParse(JSON.parse(text))
    if (result.success && result.data.usage) return result.data.usage
  } catch {
    // not JSON
  }
  return null
}
