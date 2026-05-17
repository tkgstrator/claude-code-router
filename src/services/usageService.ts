import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type CodexUsageSnapshot, getCodexUsageSnapshot } from './codexUsageCache'

export interface ClaudeUsageWindow {
  utilization: number
  resetsAt: string | null
}

export interface ClaudeUsage {
  fiveHour: ClaudeUsageWindow | null
  sevenDay: ClaudeUsageWindow | null
  sevenDaySonnet: ClaudeUsageWindow | null
  sevenDayOpus: ClaudeUsageWindow | null
  extraUsageEnabled: boolean
  capturedAt: string
}

export interface UsageResponse {
  claude: ClaudeUsage | null
  codex: CodexUsageSnapshot | null
}

const claudeToken = async (): Promise<string | null> => {
  try {
    const raw = await readFile(join(homedir(), '.claude', '.credentials.json'), 'utf-8')
    const tok = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } })?.claudeAiOauth?.accessToken
    return typeof tok === 'string' && tok.length > 0 ? tok : null
  } catch {
    return null
  }
}

const windowOf = (v: unknown): ClaudeUsageWindow | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.utilization !== 'number') return null
  return { utilization: o.utilization, resetsAt: typeof o.resets_at === 'string' ? o.resets_at : null }
}

// Claude exposes a real usage endpoint for subscription OAuth tokens.
// It is not an inference call — safe to hit on demand. Shape verified
// live: { five_hour:{utilization,resets_at}, seven_day:{...},
// seven_day_sonnet, seven_day_opus, extra_usage:{is_enabled,...} }.
// The official usage endpoint is itself aggressively rate-limited and
// returns persistent 429s when polled (anthropics/claude-code#31021;
// Claude Code's own statusline caches around this). The 5h/7d windows
// move slowly, so cache the last good value and reuse it within the
// TTL; on a failed refresh, serve the last value stale rather than
// dropping the whole panel. This is a deliberate boundary cache, not a
// swallow — a refresh either updates the snapshot or keeps the prior.
const CLAUDE_TTL_MS = 5 * 60_000
const claudeStore: { value: ClaudeUsage | null; at: number } = { value: null, at: 0 }

const requestClaudeUsage = async (): Promise<ClaudeUsage | null> => {
  const token = await claudeToken()
  if (!token) return null
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'content-type': 'application/json'
      }
    })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, unknown>
    const extra = j.extra_usage
    return {
      fiveHour: windowOf(j.five_hour),
      sevenDay: windowOf(j.seven_day),
      sevenDaySonnet: windowOf(j.seven_day_sonnet),
      sevenDayOpus: windowOf(j.seven_day_opus),
      extraUsageEnabled:
        typeof extra === 'object' && extra !== null && (extra as Record<string, unknown>).is_enabled === true,
      capturedAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}

const fetchClaudeUsage = async (): Promise<ClaudeUsage | null> => {
  const fresh = claudeStore.value && Date.now() - claudeStore.at < CLAUDE_TTL_MS
  if (fresh) return claudeStore.value
  const next = await requestClaudeUsage()
  if (next) {
    claudeStore.value = next
    claudeStore.at = Date.now()
    return next
  }
  // Refresh failed (usually the endpoint's own 429) — keep showing the
  // last known value instead of blanking the panel.
  return claudeStore.value
}

// Claude via its official usage endpoint (cached/stale-tolerant —
// the endpoint self-rate-limits); Codex from the in-memory snapshot
// captured off real /v1 traffic (no probe spend).
export async function getUsage(): Promise<UsageResponse> {
  const claude = await fetchClaudeUsage()
  return { claude, codex: getCodexUsageSnapshot() }
}
