/**
 * SSE→JSON aggregators for each wire shape the pipeline can hand back.
 *
 * Needed because some provider paths (codex-oauth notably) force
 * `stream=true` upstream even when the inbound client asked for a
 * blocking JSON response. Without a per-shape aggregator the /v1
 * handler would `JSON.parse("event: ...\ndata: ...")` and 500.
 *
 * Three wire shapes are covered here — one per endpoint transformer:
 *
 *   - Anthropic messages   (`aggregateAnthropicSseToJson`)
 *   - OpenAI Chat          (`aggregateOpenAiChatSseToJson`)
 *   - OpenAI Responses     (`aggregateOpenAiResponsesSseToJson`)
 *
 * Unrecognised event types and malformed events are dropped rather than
 * throwing — a partial reconstruction beats a 500 for the client.
 */

// ─── Common SSE parser ─────────────────────────────────────────────────

// Split an SSE payload into event records. Each event may carry an
// `event:` label plus one or more `data:` lines. We only care about the
// JSON on the `data:` lines — the `type` field on the JSON payload is
// authoritative, so the `event:` label is redundant.
export function* parseSseEvents(raw: string): Generator<unknown> {
  for (const chunk of raw.split(/\r?\n\r?\n/)) {
    if (chunk.length === 0) continue
    const dataLines = chunk
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (dataLines.length === 0) continue
    const joined = dataLines.join('\n')
    if (joined === '' || joined === '[DONE]') continue
    try {
      yield JSON.parse(joined)
    } catch {
      // dropped: malformed event
    }
  }
}

export function isSseContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('text/event-stream') === true
}

// ─── Anthropic messages aggregator ─────────────────────────────────────

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name?: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: string; [k: string]: unknown }

type AnthropicBlockState = {
  block: Record<string, unknown>
  jsonParts: string
}

function initAnthropicBlock(open: unknown): AnthropicBlockState {
  if (open === null || typeof open !== 'object') return { block: { type: 'text', text: '' }, jsonParts: '' }
  return { block: { ...(open as Record<string, unknown>) }, jsonParts: '' }
}

function applyAnthropicDelta(state: AnthropicBlockState, delta: unknown): void {
  if (delta === null || typeof delta !== 'object') return
  const dtype = Reflect.get(delta, 'type')
  if (dtype === 'text_delta') {
    const chunk = Reflect.get(delta, 'text')
    if (typeof chunk === 'string')
      state.block.text = `${typeof state.block.text === 'string' ? state.block.text : ''}${chunk}`
    return
  }
  if (dtype === 'input_json_delta') {
    const chunk = Reflect.get(delta, 'partial_json')
    if (typeof chunk === 'string') state.jsonParts += chunk
    return
  }
  if (dtype === 'thinking_delta') {
    const chunk = Reflect.get(delta, 'thinking')
    if (typeof chunk === 'string') {
      state.block.thinking = `${typeof state.block.thinking === 'string' ? state.block.thinking : ''}${chunk}`
    }
    return
  }
  if (dtype === 'signature_delta') {
    const sig = Reflect.get(delta, 'signature')
    if (typeof sig === 'string') state.block.signature = sig
  }
}

function finaliseAnthropicBlock(state: AnthropicBlockState): AnthropicBlock {
  const block = state.block
  if (block.type === 'tool_use') {
    // Anthropic streams tool arguments as a series of partial_json
    // fragments — reassemble + parse at close so the client sees the
    // same shape it would from a non-streaming call.
    if (state.jsonParts.length > 0) {
      try {
        block.input = JSON.parse(state.jsonParts)
      } catch {
        block.input = state.jsonParts
      }
    } else if (!('input' in block)) {
      block.input = {}
    }
  }
  return block as AnthropicBlock
}

function mergeUsage(base: unknown, incoming: unknown): Record<string, unknown> {
  const baseObj = base !== null && typeof base === 'object' ? (base as Record<string, unknown>) : {}
  const incObj = incoming !== null && typeof incoming === 'object' ? (incoming as Record<string, unknown>) : {}
  return { ...baseObj, ...incObj }
}

export async function aggregateAnthropicSseToJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  let message: Record<string, unknown> = {}
  const blockStates = new Map<number, AnthropicBlockState>()
  const finalisedByIndex = new Map<number, AnthropicBlock>()

  for (const event of parseSseEvents(text)) {
    if (event === null || typeof event !== 'object') continue
    const type = Reflect.get(event, 'type')
    if (type === 'message_start') {
      const start = Reflect.get(event, 'message')
      if (start !== null && typeof start === 'object') {
        message = { ...(start as Record<string, unknown>) }
      }
      continue
    }
    if (type === 'content_block_start') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      blockStates.set(index, initAnthropicBlock(Reflect.get(event, 'content_block')))
      continue
    }
    if (type === 'content_block_delta') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      const state = blockStates.get(index)
      if (state) applyAnthropicDelta(state, Reflect.get(event, 'delta'))
      continue
    }
    if (type === 'content_block_stop') {
      const index = Reflect.get(event, 'index')
      if (typeof index !== 'number') continue
      const state = blockStates.get(index)
      if (state) {
        finalisedByIndex.set(index, finaliseAnthropicBlock(state))
        blockStates.delete(index)
      }
      continue
    }
    if (type === 'message_delta') {
      const delta = Reflect.get(event, 'delta')
      if (delta !== null && typeof delta === 'object') {
        message = { ...message, ...(delta as Record<string, unknown>) }
      }
      const usage = Reflect.get(event, 'usage')
      if (usage !== undefined) message.usage = mergeUsage(message.usage, usage)
    }
    // message_stop / ping / anything else — nothing to accumulate.
  }
  // Upstream cut off mid-block: finalise whatever survived so the client
  // still gets something coherent instead of an empty content array.
  for (const [index, state] of blockStates) finalisedByIndex.set(index, finaliseAnthropicBlock(state))
  const content = [...finalisedByIndex.entries()].sort(([a], [b]) => a - b).map(([, b]) => b)
  message.content = content
  return message
}

// ─── OpenAI Chat aggregator ────────────────────────────────────────────

/**
 * Aggregate an OpenAI Chat-Completions SSE stream into the non-stream
 * `chat.completion` envelope. Per-choice deltas merge into per-choice
 * message accumulators; tool_calls are keyed on the `index` field the
 * stream re-uses to say "this chunk belongs to the same call as earlier
 * chunks with the same index".
 */
export async function aggregateOpenAiChatSseToJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  const chunks: Record<string, unknown>[] = []
  for (const event of parseSseEvents(text)) {
    if (event !== null && typeof event === 'object') chunks.push(event as Record<string, unknown>)
  }
  return foldOpenAiChatChunks(chunks)
}

function foldOpenAiChatChunks(chunks: Record<string, unknown>[]): Record<string, unknown> {
  type ChoiceAcc = {
    role: string
    content: string
    toolCalls: Map<
      number,
      {
        id?: string
        type?: string
        function: { name?: string; arguments: string }
      }
    >
    finishReason: string | null
  }
  const choices = new Map<number, ChoiceAcc>()
  let id: string | undefined
  let model: string | undefined
  let created: number | undefined
  let systemFingerprint: string | undefined
  let usage: Record<string, unknown> | undefined
  const getChoice = (idx: number): ChoiceAcc => {
    const existing = choices.get(idx)
    if (existing) return existing
    const fresh: ChoiceAcc = { role: 'assistant', content: '', toolCalls: new Map(), finishReason: null }
    choices.set(idx, fresh)
    return fresh
  }
  for (const chunk of chunks) {
    if (typeof chunk.id === 'string' && !id) id = chunk.id
    if (typeof chunk.model === 'string' && !model) model = chunk.model
    if (typeof chunk.created === 'number' && !created) created = chunk.created
    if (typeof chunk.system_fingerprint === 'string' && !systemFingerprint) systemFingerprint = chunk.system_fingerprint
    if (chunk.usage !== null && typeof chunk.usage === 'object') usage = chunk.usage as Record<string, unknown>
    if (!Array.isArray(chunk.choices)) continue
    for (const raw of chunk.choices) {
      if (raw === null || typeof raw !== 'object') continue
      const rawObj = raw as Record<string, unknown>
      const index = typeof rawObj.index === 'number' ? rawObj.index : 0
      const acc = getChoice(index)
      const delta = rawObj.delta
      if (delta !== null && typeof delta === 'object') {
        const deltaObj = delta as Record<string, unknown>
        if (typeof deltaObj.role === 'string') acc.role = deltaObj.role
        if (typeof deltaObj.content === 'string') acc.content += deltaObj.content
        if (Array.isArray(deltaObj.tool_calls)) {
          for (const tc of deltaObj.tool_calls) {
            if (tc === null || typeof tc !== 'object') continue
            const tcObj = tc as Record<string, unknown>
            const tcIndex = typeof tcObj.index === 'number' ? tcObj.index : 0
            const existing = acc.toolCalls.get(tcIndex) ?? { function: { arguments: '' } }
            if (typeof tcObj.id === 'string') existing.id = tcObj.id
            if (typeof tcObj.type === 'string') existing.type = tcObj.type
            const fn = tcObj.function
            if (fn !== null && typeof fn === 'object') {
              const fnObj = fn as Record<string, unknown>
              if (typeof fnObj.name === 'string') existing.function.name = fnObj.name
              if (typeof fnObj.arguments === 'string') existing.function.arguments += fnObj.arguments
            }
            acc.toolCalls.set(tcIndex, existing)
          }
        }
      }
      if (typeof rawObj.finish_reason === 'string') acc.finishReason = rawObj.finish_reason
    }
  }
  const outChoices = [...choices.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, acc]) => {
      const message: Record<string, unknown> = { role: acc.role, content: acc.content }
      if (acc.toolCalls.size > 0) {
        message.tool_calls = [...acc.toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, tc]) => ({
            id: tc.id,
            type: tc.type ?? 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
      }
      return { index, message, finish_reason: acc.finishReason }
    })
  const envelope: Record<string, unknown> = {
    id: id ?? '',
    object: 'chat.completion',
    created: created ?? Math.floor(Date.now() / 1000),
    model: model ?? '',
    choices: outChoices
  }
  if (systemFingerprint !== undefined) envelope.system_fingerprint = systemFingerprint
  if (usage !== undefined) envelope.usage = usage
  return envelope
}

// ─── OpenAI Responses aggregator ───────────────────────────────────────

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
