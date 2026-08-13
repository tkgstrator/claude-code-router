/**
 * Gemini → OpenAI-shaped response conversion: shared helpers.
 *
 * Small pieces used by both the blocking-JSON branch
 * (`response-blocking.ts`) and the streaming-SSE branch
 * (`response-streaming.ts`).
 */

import type {
  Annotation,
  GeminiCandidate,
  GeminiResponse,
  GeminiResponsePart,
  PipelineChunkUsage,
  PipelineToolCall
} from '@/schemas'

// Re-exported so the gemini response converters keep their existing
// `./response-shared` import path — the canonical implementation now
// lives at `src/llms/utils/time.ts` alongside the other transformer
// utilities. The gemini directory's flatter re-org is deferred to a
// sibling refactor; until then this re-export avoids touching every
// gemini caller in this PR.
export { nowSeconds } from '../time'

export const genRandomToolId = (prefix: 'tool' | 'ccr_tool' = 'tool'): string =>
  `${prefix}_${Math.random().toString(36).substring(2, 15)}`

/** A zero-filled usage block used when the upstream omitted `usageMetadata`. */
const EMPTY_USAGE: PipelineChunkUsage = {
  completion_tokens: 0,
  prompt_tokens: 0,
  prompt_tokens_details: { cached_tokens: 0 },
  total_tokens: 0,
  output_tokens_details: { reasoning_tokens: 0 }
}

/**
 * Build the OpenAI-shaped `usage` block from Gemini's `usageMetadata`.
 * Returns the zero-filled `EMPTY_USAGE` when the upstream omitted the
 * `usageMetadata` envelope entirely — the inner field defaults are
 * handled by the Zod schema itself.
 */
export function toUsage(meta: GeminiResponse['usageMetadata']): PipelineChunkUsage {
  if (!meta) {
    return EMPTY_USAGE
  }
  return {
    completion_tokens: meta.candidatesTokenCount,
    prompt_tokens: meta.promptTokenCount,
    prompt_tokens_details: { cached_tokens: meta.cachedContentTokenCount },
    total_tokens: meta.totalTokenCount,
    output_tokens_details: { reasoning_tokens: meta.thoughtsTokenCount }
  }
}

/** Empty `segment` block used when no grounding support matches the chunk. */
const EMPTY_SEGMENT = { text: '', startIndex: 0, endIndex: 0 } as const

/**
 * Build the annotations slice — Gemini emits one `groundingChunk` per
 * citation plus optional `groundingSupports` keyed by index.
 */
export function buildAnnotations(candidate: GeminiCandidate): Annotation[] | undefined {
  const grounding = candidate.groundingMetadata
  if (!grounding || grounding.groundingChunks.length === 0) {
    return undefined
  }
  return grounding.groundingChunks.map<Annotation>((groundingChunk, index) => {
    const support = grounding.groundingSupports.find((item) => item.groundingChunkIndices.includes(index))
    const segment = support ? support.segment : EMPTY_SEGMENT
    return {
      type: 'url_citation',
      url_citation: {
        url: groundingChunk.web.uri,
        title: groundingChunk.web.title,
        content: segment.text,
        start_index: segment.startIndex,
        end_index: segment.endIndex
      }
    }
  })
}

/** Extract the parts[] from a candidate, falling back to []. */
export function partsOf(candidate: GeminiCandidate | undefined): GeminiResponsePart[] {
  if (!candidate?.content) {
    return []
  }
  return candidate.content.parts
}

/** Convert Gemini's `finishReason` into the lower-cased pipeline form. */
export function lowercaseFinishReason(candidate: GeminiCandidate): string | null {
  const raw = candidate.finishReason
  if (typeof raw !== 'string') {
    return null
  }
  return raw.toLowerCase()
}

type FunctionCallPart = GeminiResponsePart & {
  functionCall: NonNullable<GeminiResponsePart['functionCall']>
}

const hasFunctionCall = (part: GeminiResponsePart): part is FunctionCallPart => Boolean(part.functionCall)

/** Build the pipeline tool-call list from non-thinking parts. */
export function toPipelineToolCalls(
  parts: GeminiResponsePart[],
  idPrefix: 'tool' | 'ccr_tool' = 'tool'
): PipelineToolCall[] {
  return parts.filter(hasFunctionCall).map(
    (part): PipelineToolCall => ({
      id: part.functionCall.id || genRandomToolId(idPrefix),
      type: 'function' as const,
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args)
      }
    })
  )
}
