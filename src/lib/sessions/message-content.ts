// Coerce the raw Anthropic content shape stored per Message row into a flat
// list of blocks the Sessions renderer knows how to draw, and classify each
// block so the UI can hide framework-injected noise from real chat.

export type NormalisedBlock =
  | { kind: 'text'; text: string }
  | { kind: 'system_text'; text: string; preview: string }
  | { kind: 'tool_use'; name: string; input: string; truncated: boolean }
  | { kind: 'tool_result'; text: string }
  | { kind: 'raw'; text: string }

// Text blocks in CCR sessions are a mix of natural chat and framework-injected
// noise: <system-reminder> / <command-*> wrappers, proxied tool traffic
// serialised as {"Agent": …} / {"Bash": …} / {"user": …}, bracketed mode
// instructions like [SUGGESTION MODE …], and tagless dumps Claude Code
// appends before each turn (agent list, skills list, file contents,
// harness metadata). The classifier strips the tag-wrapped pieces out
// of the block and then decides whether anything user-typed remains.
const CLAUDE_CODE_WRAPPER_TAGS = [
  'system-reminder',
  'command-name',
  'command-message',
  'command-args',
  'command-stdout',
  'local-command-stdout',
  'local-command-caveat',
  'user-prompt-submit-hook'
]

// Prefixes Claude Code injects *without* a surrounding tag. These start a
// tagless system dump (agent inventory, skill inventory, file contents,
// harness metadata) that should never appear in the chat view.
const CLAUDE_CODE_TAGLESS_PREFIXES: RegExp[] = [
  /^Available agent types\b/,
  /^The following (deferred tools|skills|files|MCP)\b/,
  /^The following agent types\b/,
  /^Contents of\s/,
  /^Codebase and user instructions\b/,
  /^Tool loaded\.\s*$/,
  /^#\s+(claudeMd|gitStatus|environment|userEmail|currentDate)\b/m,
  // Recap-on-return directive Claude Code prepends when the user steps
  // away and comes back ("The user stepped away and is coming back.
  // Recap in under 40 words, ..."). No sentinel — matched by opener.
  /^The user stepped away and is coming back\b/,
  // Context-compaction request Claude Code emits when it wants a
  // conversation summary ("CRITICAL: Respond with TEXT ONLY. Do NOT call
  // any tools. ... create a detailed summary of the conversation ...").
  /^CRITICAL: Respond with TEXT ONLY\. Do NOT call any tools\b/,
  // Interruption sentinel Claude Code injects when the user cancels
  // mid-turn ("[Request interrupted by user]" and the "for tool use"
  // variant). Either arrives on its own or as the opener of a combined
  // block whose remainder is another sentinel (e.g. the stepped-away
  // recap), so the first character check `isBracketMode` misses it —
  // "[Request" starts with a lowercase run.
  /^\[Request interrupted by user(?: for tool use)?\]/
]

// Detect the permission-gate boilerplate Claude Code prepends before it
// evaluates certain tool calls. Every observed variant (with/without the
// "Err on the side of blocking" opener; ending in `<block>`/`<allow>` or
// `<severity>` sentinels) shares the exact sentence "Stage 1 does NOT
// apply user intent" verbatim, so key on that phrase — it's specific
// enough to keep the false-positive risk low against genuine chat.
function looksLikePermissionGate(text: string): boolean {
  return /Stage 1 does NOT apply user intent/.test(text)
}

export function normaliseContent(content: unknown): NormalisedBlock[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }]
  if (!Array.isArray(content)) return [{ kind: 'raw', text: safeJson(content) }]
  return content.map(normaliseBlock)
}

function normaliseBlock(raw: unknown): NormalisedBlock {
  if (raw === null || typeof raw !== 'object') return { kind: 'raw', text: String(raw) }
  const type = Reflect.get(raw, 'type')
  if (type === 'text') return classifyTextBlock(readString(raw, 'text', ''))
  if (type === 'tool_use') return normaliseToolUse(raw)
  if (type === 'tool_result') return { kind: 'tool_result', text: flattenToolResult(Reflect.get(raw, 'content')) }
  return { kind: 'raw', text: safeJson(raw) }
}

function stripClaudeCodeWrappers(text: string): string {
  const stripped = CLAUDE_CODE_WRAPPER_TAGS.reduce(
    (acc, tag) => acc.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'g'), ''),
    text
  )
  return stripped.trim()
}

function classifyTextBlock(text: string): NormalisedBlock {
  const cleaned = stripClaudeCodeWrappers(text)
  // Whole block is wrapper noise → hide behind the collapsible preview.
  if (cleaned.length === 0) {
    return { kind: 'system_text', text, preview: makePreview(text.trimStart()) }
  }
  // Tagless system dump — Claude Code appends these verbatim before the
  // user's turn, and they surface here as plain text.
  if (CLAUDE_CODE_TAGLESS_PREFIXES.some((re) => re.test(cleaned)) || looksLikePermissionGate(cleaned)) {
    return { kind: 'system_text', text, preview: makePreview(cleaned) }
  }
  const head = cleaned.charAt(0)
  const isXmlish = head === '<' && /^<[a-zA-Z/!?][^>]{0,120}>/.test(cleaned)
  const isJsonish = (head === '{' || head === '[') && looksLikeJson(cleaned)
  const isBracketMode = head === '[' && /^\[[A-Z][A-Z_ -]{2,60}[\]:]/.test(cleaned)
  if (isXmlish || isJsonish || isBracketMode) {
    return { kind: 'system_text', text, preview: makePreview(cleaned) }
  }
  // Emit the cleaned remnant when stripping actually removed something,
  // so a user turn with a trailing <system-reminder> doesn't drag the
  // reminder body into the chat bubble.
  return { kind: 'text', text: cleaned === text.trim() ? text : cleaned }
}

function looksLikeJson(s: string): boolean {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

function makePreview(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine
}

function normaliseToolUse(raw: object): NormalisedBlock {
  const input = Reflect.get(raw, 'input')
  return {
    kind: 'tool_use',
    name: readString(raw, 'name', 'tool'),
    input: typeof input === 'string' ? input : safeJson(input),
    truncated: Reflect.get(raw, 'input_truncated') === true
  }
}

function readString(source: object, key: string, fallback: string): string {
  const value = Reflect.get(source, key)
  return typeof value === 'string' ? value : fallback
}

// tool_result.content is either a string or a block array of text blocks;
// flatten both into a single string for the chat view.
function flattenToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return safeJson(content)
  return content.map(flattenToolResultBlock).join('\n')
}

function flattenToolResultBlock(block: unknown): string {
  if (block === null || typeof block !== 'object') return String(block)
  if (Reflect.get(block, 'type') === 'text') return readString(block, 'text', '')
  return safeJson(block)
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2)
    return typeof s === 'string' ? s : String(value)
  } catch {
    return String(value)
  }
}
