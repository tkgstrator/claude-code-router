/**
 * Gemini SSE → `GenerateContentResponse` aggregation.
 *
 * The gemini surface's entry in `InboundSurface.aggregateSse`. Fires in
 * the `formatResponse` branch that trips when the client asked for a
 * blocking `:generateContent` but the upstream answered with a stream —
 * which a provider can force regardless of what the caller asked for.
 *
 * Lives here rather than in `sse-aggregate.ts` so it sits with the rest
 * of the Gemini wire conversion (`gemini-request`, `gemini-response`,
 * `gemini-inbound-response`); the registry is what indexes the four
 * aggregators, so nothing depends on them sharing a file.
 */

import { parseSseEvents } from './sse-aggregate'

/**
 * Aggregate a Gemini `streamGenerateContent?alt=sse` stream into the
 * single `GenerateContentResponse` a `:generateContent` caller expects.
 *
 * Every chunk is a complete response envelope carrying one increment:
 * candidate-level fields (`finishReason`, `safetyRatings`, …) are
 * re-sent as they become known, and `usageMetadata` lands on the last
 * chunk. So the fold is "last value wins" for everything except
 * `content.parts`, which genuinely accumulates.
 *
 * Text parts are concatenated only across a run with the same `thought`
 * flag: Gemini emits reasoning and answer text as separate parts on the
 * same candidate, and merging them would hand the client a response
 * where the model's private reasoning reads as its answer.
 */
export async function aggregateGeminiSseToJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  const envelope: Record<string, unknown> = {}
  const candidates = new Map<number, GeminiCandidateAcc>()

  for (const event of parseSseEvents(text)) {
    if (event === null || typeof event !== 'object') continue
    const chunk = event as Record<string, unknown>
    for (const key of Object.keys(chunk)) {
      // `candidates` accumulates below; everything else (usageMetadata,
      // modelVersion, responseId, promptFeedback) is a whole-response
      // field the stream restates, so the newest value is the answer.
      if (key !== 'candidates') envelope[key] = chunk[key]
    }
    if (!Array.isArray(chunk.candidates)) continue
    for (const raw of chunk.candidates) {
      if (raw === null || typeof raw !== 'object') continue
      const candidate = raw as Record<string, unknown>
      const index = typeof candidate.index === 'number' ? candidate.index : 0
      mergeGeminiCandidate(candidateAcc(candidates, index), candidate)
    }
  }

  envelope.candidates = [...candidates.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, acc]) => finaliseGeminiCandidate(index, acc))
  return envelope
}

type GeminiTextRun = { text: string; thought: unknown }

type GeminiCandidateAcc = {
  /** Candidate-level fields other than `content`; last chunk wins. */
  fields: Record<string, unknown>
  /** `content` fields other than `parts` — `role`, essentially. */
  contentFields: Record<string, unknown>
  /** Closed parts, in stream order. */
  parts: Record<string, unknown>[]
  /** The text run still being appended to, if the last part was text. */
  openText: GeminiTextRun | null
}

function candidateAcc(all: Map<number, GeminiCandidateAcc>, index: number): GeminiCandidateAcc {
  const existing = all.get(index)
  if (existing !== undefined) return existing
  const fresh: GeminiCandidateAcc = { fields: {}, contentFields: {}, parts: [], openText: null }
  all.set(index, fresh)
  return fresh
}

function mergeGeminiCandidate(acc: GeminiCandidateAcc, candidate: Record<string, unknown>): void {
  for (const key of Object.keys(candidate)) {
    if (key !== 'content' && key !== 'index') acc.fields[key] = candidate[key]
  }
  const content = candidate.content
  if (content === null || typeof content !== 'object') return
  const contentObj = content as Record<string, unknown>
  for (const key of Object.keys(contentObj)) {
    if (key !== 'parts') acc.contentFields[key] = contentObj[key]
  }
  if (!Array.isArray(contentObj.parts)) return
  for (const part of contentObj.parts) {
    if (part === null || typeof part !== 'object') continue
    appendGeminiPart(acc, part as Record<string, unknown>)
  }
}

// A text part extends the open run when its `thought` flag matches;
// anything else (functionCall, inlineData, a flag change) closes the run
// and lands verbatim.
function appendGeminiPart(acc: GeminiCandidateAcc, part: Record<string, unknown>): void {
  const isPlainText = typeof part.text === 'string' && Object.keys(part).every((k) => k === 'text' || k === 'thought')
  if (!isPlainText) {
    closeGeminiTextRun(acc)
    acc.parts.push(part)
    return
  }
  const open = acc.openText
  if (open !== null && open.thought === part.thought) {
    open.text += part.text
    return
  }
  closeGeminiTextRun(acc)
  acc.openText = { text: String(part.text), thought: part.thought }
}

function closeGeminiTextRun(acc: GeminiCandidateAcc): void {
  const open = acc.openText
  if (open === null) return
  const part: Record<string, unknown> = { text: open.text }
  if (open.thought !== undefined) part.thought = open.thought
  acc.parts.push(part)
  acc.openText = null
}

function finaliseGeminiCandidate(index: number, acc: GeminiCandidateAcc): Record<string, unknown> {
  closeGeminiTextRun(acc)
  return {
    ...acc.fields,
    index,
    content: { ...acc.contentFields, parts: acc.parts }
  }
}
