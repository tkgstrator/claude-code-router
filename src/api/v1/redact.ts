/**
 * Tool-argument redaction for the message archive.
 *
 * Tool arguments are where file paths, shell commands and pasted
 * secrets end up, and unlike the prose they are rarely what someone
 * opens the session view to read. Redaction is destructive and
 * irreversible, so it only runs when REDACT_TOOL_ARGUMENTS is on.
 *
 * Returns new objects rather than editing in place: the same content is
 * still on its way to the client, and mutating it here would redact the
 * live response as well as the archive.
 */

export const REDACTED = '[redacted]'

export function redactToolArguments(content: unknown): unknown {
  if (Array.isArray(content)) return content.map(redactToolArguments)
  if (content === null || typeof content !== 'object') return content
  const block: Record<string, unknown> = { ...content }
  if (block.type === 'tool_use' && block.input !== undefined) block.input = REDACTED
  if (block.type === 'tool_result' && block.content !== undefined) block.content = REDACTED
  return block
}
