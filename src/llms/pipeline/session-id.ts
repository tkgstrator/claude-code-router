/**
 * Session-id resolution shared by the provider-send and usage-extraction
 * modules (usage rows and message-capture rows must agree on the same
 * session id for a given request).
 *
 * Order of preference:
 *   1. `thread_id` header
 *   2. `x-claude-code-session-id` header
 *   3. the session id inside the request body's `metadata.user_id`
 *      (Claude Code sends it there as a JSON blob, or the legacy
 *      "<user>_session_<id>" form)
 *   4. a single random id minted once per request and reused for every
 *      recording — without this, the three resolveSessionId calls for one
 *      request (user turn, usage row, assistant turn) each got a fresh
 *      random id and scattered across three separate sessions.
 */

import { randomUUID } from 'node:crypto'
import type { TransformerContext } from '@/schemas'

// Per-request cache for the random fallback, so every recording of one
// request shares an id. Keyed on the (stable, per-request) context object;
// WeakMap lets entries GC with the request.
const randomSessionByContext = new WeakMap<object, string>()

// Pull the Claude Code session id out of the request body's
// `metadata.user_id`. Real Claude Code sends it as a JSON string
// `{ device_id, account_uuid, session_id }`; older traffic used the
// "<user>_session_<id>" shape. Returns undefined when neither is present.
function sessionFromBody(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const metadata = Reflect.get(body, 'metadata')
  if (metadata === null || typeof metadata !== 'object') return undefined
  const userId = Reflect.get(metadata, 'user_id')
  if (typeof userId !== 'string' || userId.length === 0) return undefined
  const parts = userId.split('_session_')
  if (parts.length > 1 && parts[1].length > 0) return parts[1]
  if (userId.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(userId)
      const sid = parsed !== null && typeof parsed === 'object' ? Reflect.get(parsed, 'session_id') : undefined
      if (typeof sid === 'string' && sid.length > 0) return sid
    } catch {
      // user_id is not JSON — fall through to the random fallback.
    }
  }
  return undefined
}

export function resolveSessionId(context: TransformerContext): string {
  const headers = context.req?.headers !== undefined ? context.req.headers : {}
  const threadId = typeof headers.thread_id === 'string' ? headers.thread_id : undefined
  if (threadId) return threadId
  const ccSession =
    typeof headers['x-claude-code-session-id'] === 'string' ? headers['x-claude-code-session-id'] : undefined
  if (ccSession) return ccSession
  const bodySession = sessionFromBody(context.req?.body)
  if (bodySession) return bodySession
  const cached = randomSessionByContext.get(context)
  if (cached) return cached
  const fresh = randomUUID()
  randomSessionByContext.set(context, fresh)
  return fresh
}
