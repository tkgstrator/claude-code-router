/**
 * Session-id resolution shared by the provider-send and usage-extraction
 * modules (usage rows and message-capture rows must agree on the same
 * session id for a given request).
 */

import { randomUUID } from 'node:crypto'
import type { TransformerContext } from '@/schemas'

export function resolveSessionId(context: TransformerContext): string {
  const headers = context.req?.headers !== undefined ? context.req.headers : {}
  const threadId = typeof headers.thread_id === 'string' ? headers.thread_id : undefined
  if (threadId) return threadId
  const ccSession =
    typeof headers['x-claude-code-session-id'] === 'string' ? headers['x-claude-code-session-id'] : undefined
  if (ccSession) return ccSession
  return randomUUID()
}
