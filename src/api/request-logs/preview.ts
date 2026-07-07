/**
 * Chat-style preview extraction for the session list — pulls a short
 * plain-text snippet out of the earliest archived user Message per
 * session.
 */

import { getPrismaClient } from '../../db/client'

// Max chars kept in the session-list preview. Long enough for a full one-line
// prompt, short enough that we can ship it inside every SessionSummary row
// without bloating the /sessions payload.
const PREVIEW_MAX_CHARS = 160

function flattenUserText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (Reflect.get(block, 'type') !== 'text') continue
    const text = Reflect.get(block, 'text')
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

// Pull a chat-style preview out of an archived user Message row. Content is
// either a string (Codex-style plain text) or an Anthropic block array; we
// concatenate the text blocks and drop tool_result-only turns (they're just
// the client echoing tool output back and don't reflect user intent).
function extractPreview(content: unknown): string | null {
  const text = flattenUserText(content).trim()
  if (text.length === 0) return null
  return text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : text
}

// Fetch preview text for a batch of sessions in a single query. Grouped by
// sessionId → the earliest user Message row is returned per session.
export async function loadPreviews(sessionIds: string[]): Promise<Map<string, string | null>> {
  const previews = new Map<string, string | null>()
  if (sessionIds.length === 0) return previews
  const prisma = getPrismaClient()
  const rows = await prisma.message.findMany({
    where: { sessionId: { in: sessionIds }, role: 'user' },
    orderBy: { createdAt: 'asc' },
    select: { sessionId: true, content: true }
  })
  for (const row of rows) {
    if (previews.has(row.sessionId)) continue
    const preview = extractPreview(row.content)
    if (preview !== null) previews.set(row.sessionId, preview)
  }
  for (const id of sessionIds) if (!previews.has(id)) previews.set(id, null)
  return previews
}
