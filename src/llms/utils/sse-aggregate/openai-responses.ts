/**
 * OpenAI Responses SSE → its `response` envelope.
 *
 * The `/v1/responses` surface's `aggregateSse`. Barely a fold: the
 * Responses stream restates the whole envelope on `response.completed`,
 * so the work is finding that event — and reconstructing something
 * coherent from the text deltas when it never arrives.
 */

import { parseSseEvents } from './parse'

/**
 * Aggregate an OpenAI Responses SSE stream into its `response` envelope.
 * The Responses stream carries the fully-assembled envelope on the final
 * `response.completed` event, so aggregation is essentially "find the
 * last completed event and hand back its `response` payload". Falls
 * back to partial accumulation across `output_text.delta` when the
 * upstream cut off before completing.
 */
export async function aggregateOpenAiResponsesSseToJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  let latestSkeleton: Record<string, unknown> | null = null
  let completed: Record<string, unknown> | null = null
  // Fallback text accumulator keyed on output_index — only used when
  // `response.completed` never lands.
  const textByIndex = new Map<number, string>()

  for (const event of parseSseEvents(text)) {
    if (event === null || typeof event !== 'object') continue
    const type = Reflect.get(event, 'type')
    if (type === 'response.created' || type === 'response.in_progress') {
      const resp = Reflect.get(event, 'response')
      if (resp !== null && typeof resp === 'object') latestSkeleton = { ...(resp as Record<string, unknown>) }
      continue
    }
    if (type === 'response.completed') {
      const resp = Reflect.get(event, 'response')
      if (resp !== null && typeof resp === 'object') completed = { ...(resp as Record<string, unknown>) }
      continue
    }
    if (type === 'response.output_text.delta') {
      const index = Reflect.get(event, 'output_index')
      const delta = Reflect.get(event, 'delta')
      if (typeof index === 'number' && typeof delta === 'string') {
        textByIndex.set(index, (textByIndex.get(index) ?? '') + delta)
      }
    }
  }

  if (completed !== null) return completed
  if (latestSkeleton === null) return { object: 'response', status: 'incomplete', output: [] }
  // Upstream cut off before `response.completed` — patch the skeleton
  // with whatever text we saw so the client still gets a coherent
  // envelope.
  if (textByIndex.size > 0) {
    const outputs: Array<Record<string, unknown>> = []
    for (const [, txt] of [...textByIndex.entries()].sort(([a], [b]) => a - b)) {
      outputs.push({
        type: 'message',
        role: 'assistant',
        status: 'incomplete',
        content: [{ type: 'output_text', text: txt, annotations: [] }]
      })
    }
    latestSkeleton.output = outputs
  }
  latestSkeleton.status = 'incomplete'
  return latestSkeleton
}
