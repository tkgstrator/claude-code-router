/**
 * Chat-view message capture.
 *
 * Pulls the last user turn from the outbound request body, and — from
 * the response side — assembles the assistant's text / tool_use blocks
 * (from either a blocking JSON body or the Anthropic SSE stream) for
 * archival in the Message table. Best-effort: never throws.
 */

import type { PipelineDeps } from './types'

// Pull the last user message from an Anthropic-shaped request body. Same
// shape holds for bypass (verbatim upstream body) and unified paths.
// Returns null when there is no trailing user turn — a tool_result-only
// turn from the client still counts (its role is 'user' in Anthropic's
// wire format).
export function extractLastUserContent(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return null
  const messages = Reflect.get(body, 'messages')
  if (!Array.isArray(messages) || messages.length === 0) return null
  const last = messages[messages.length - 1]
  if (last === null || typeof last !== 'object') return null
  if (Reflect.get(last, 'role') !== 'user') return null
  const content = Reflect.get(last, 'content')
  return content !== undefined ? content : null
}

// Truncate tool_use input JSON so a single verbose tool call doesn't
// blow the row size. The full input still exists in the upstream
// response the client received — this is only the chat-view archive.
const TOOL_INPUT_PREVIEW_CHARS = 2_000

type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name?: string; input: unknown; input_truncated?: boolean }

// Assemble assistant content by streaming the Anthropic SSE response.
// text_delta events append to the current text block; input_json_delta
// events append raw JSON fragments that are parsed at content_block_stop
// (Anthropic ships tool arguments as a stream of json fragments). Other
// block types (thinking, redacted_thinking) are dropped — they're not
// useful for the chat view and would leak model reasoning into storage.
export async function captureAssistantMessage(resp: Response, sessionId: string, deps: PipelineDeps): Promise<void> {
  const rawContentType = resp.headers.get('content-type')
  const contentType = typeof rawContentType === 'string' ? rawContentType.toLowerCase() : ''
  const blocks = contentType.includes('application/json') ? await assembleFromJson(resp) : await assembleFromSse(resp)
  if (blocks.length === 0) return
  await deps.recordMessages?.([{ sessionId, role: 'assistant', content: blocks }])
}

async function assembleFromJson(resp: Response): Promise<AssistantBlock[]> {
  const json = await resp.json().catch(() => null)
  if (json === null || typeof json !== 'object') return []
  const content = Reflect.get(json, 'content')
  if (!Array.isArray(content)) return []
  const out: AssistantBlock[] = []
  for (const block of content) {
    const b = normaliseBlock(block)
    if (b) out.push(b)
  }
  return out
}

function normaliseBlock(block: unknown): AssistantBlock | null {
  if (block === null || typeof block !== 'object') return null
  const type = Reflect.get(block, 'type')
  if (type === 'text') {
    const text = Reflect.get(block, 'text')
    return typeof text === 'string' ? { type: 'text', text } : null
  }
  if (type === 'tool_use') {
    const id = Reflect.get(block, 'id')
    const name = Reflect.get(block, 'name')
    const input = Reflect.get(block, 'input')
    return {
      type: 'tool_use',
      id: typeof id === 'string' ? id : undefined,
      name: typeof name === 'string' ? name : undefined,
      ...truncateToolInput(input)
    }
  }
  return null
}

function truncateToolInput(input: unknown): { input: unknown; input_truncated?: boolean } {
  const serialised = safeSerialise(input)
  if (serialised.length <= TOOL_INPUT_PREVIEW_CHARS) return { input }
  return { input: `${serialised.slice(0, TOOL_INPUT_PREVIEW_CHARS)}…`, input_truncated: true }
}

function safeSerialise(value: unknown): string {
  try {
    const s = JSON.stringify(value)
    return typeof s === 'string' ? s : ''
  } catch {
    return ''
  }
}

// Per-index assembly state so parallel content blocks (Anthropic streams
// text + tool_use blocks by index) accumulate independently.
type AssemblyState = {
  type?: string
  text: string
  toolId?: string
  toolName?: string
  jsonParts: string
}

async function assembleFromSse(resp: Response): Promise<AssistantBlock[]> {
  const text = await resp.text().catch(() => '')
  if (text.length === 0) return []
  const state = new Map<number, AssemblyState>()
  const finalised: Array<{ index: number; block: AssistantBlock }> = []
  for (const rawEvent of text.split('\n\n')) {
    const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'))
    if (!dataLine) continue
    const raw = dataLine.slice(5).trim()
    if (raw === '' || raw === '[DONE]') continue
    let event: unknown
    try {
      event = JSON.parse(raw)
    } catch {
      continue
    }
    handleSseEvent(event, state, finalised)
  }
  // Blocks not explicitly closed (upstream cut off) — best-effort finalise
  // so a truncated stream still yields whatever text arrived.
  for (const [index, s] of state.entries()) {
    const b = finaliseState(s)
    if (b) finalised.push({ index, block: b })
  }
  finalised.sort((a, b) => a.index - b.index)
  return finalised.map((f) => f.block)
}

function handleSseEvent(
  event: unknown,
  state: Map<number, AssemblyState>,
  finalised: Array<{ index: number; block: AssistantBlock }>
): void {
  if (event === null || typeof event !== 'object') return
  const type = Reflect.get(event, 'type')
  const index = Reflect.get(event, 'index')
  if (typeof index !== 'number') return
  if (type === 'content_block_start') {
    const cb = Reflect.get(event, 'content_block')
    state.set(index, initState(cb))
    return
  }
  const s = state.get(index)
  if (!s) return
  if (type === 'content_block_delta') {
    applyDelta(s, Reflect.get(event, 'delta'))
    return
  }
  if (type === 'content_block_stop') {
    const b = finaliseState(s)
    if (b) finalised.push({ index, block: b })
    state.delete(index)
  }
}

function initState(cb: unknown): AssemblyState {
  const state: AssemblyState = { text: '', jsonParts: '' }
  if (cb === null || typeof cb !== 'object') return state
  const type = Reflect.get(cb, 'type')
  if (typeof type === 'string') state.type = type
  if (type === 'tool_use') {
    const id = Reflect.get(cb, 'id')
    const name = Reflect.get(cb, 'name')
    if (typeof id === 'string') state.toolId = id
    if (typeof name === 'string') state.toolName = name
  }
  return state
}

function applyDelta(s: AssemblyState, delta: unknown): void {
  if (delta === null || typeof delta !== 'object') return
  const dtype = Reflect.get(delta, 'type')
  if (dtype === 'text_delta') {
    const chunk = Reflect.get(delta, 'text')
    if (typeof chunk === 'string') s.text += chunk
    return
  }
  if (dtype === 'input_json_delta') {
    const chunk = Reflect.get(delta, 'partial_json')
    if (typeof chunk === 'string') s.jsonParts += chunk
  }
}

function finaliseState(s: AssemblyState): AssistantBlock | null {
  if (s.type === 'text') {
    return s.text.length > 0 ? { type: 'text', text: s.text } : null
  }
  if (s.type === 'tool_use') {
    const input = parseToolInput(s.jsonParts)
    return {
      type: 'tool_use',
      id: s.toolId,
      name: s.toolName,
      ...truncateToolInput(input)
    }
  }
  return null
}

function parseToolInput(raw: string): unknown {
  if (raw.length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
