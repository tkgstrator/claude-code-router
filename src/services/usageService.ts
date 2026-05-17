import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

export interface CodexUsageWindow {
  usedPercent: number
  resetAt: string | null
  windowSeconds: number | null
}

export interface CodexUsage {
  planType: string | null
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
  capturedAt: string
}

export interface UsageResponse {
  claude: ClaudeUsage | null
  codex: CodexUsage | null
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

// Codex has a pollable usage endpoint after all — the ChatGPT backend
// `/wham/usage` (what the Codex CLI's get_rate_limits hits). CCR holds
// the same creds the /v1 codex path uses, so poll it directly like
// Claude. Shape verified live: { plan_type, rate_limit:{ allowed,
// limit_reached, primary_window, secondary_window } } where a window
// is { used_percent, limit_window_seconds, reset_after_seconds,
// reset_at(epoch s) }.
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const codexStore: { value: CodexUsage | null; at: number } = { value: null, at: 0 }

const codexAuth = async (): Promise<{ token: string; accountId: string | null } | null> => {
  try {
    const raw = await readFile(join(homedir(), '.codex', 'auth.json'), 'utf-8')
    const tokens = (JSON.parse(raw) as { tokens?: { access_token?: unknown; account_id?: unknown } })?.tokens
    const token = tokens?.access_token
    if (typeof token !== 'string' || token.length === 0) return null
    return { token, accountId: typeof tokens?.account_id === 'string' ? tokens.account_id : null }
  } catch {
    return null
  }
}

const codexWindowOf = (v: unknown): CodexUsageWindow | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.used_percent !== 'number') return null
  const resetAt = typeof o.reset_at === 'number' ? new Date(o.reset_at * 1000).toISOString() : null
  return {
    usedPercent: o.used_percent,
    resetAt,
    windowSeconds: typeof o.limit_window_seconds === 'number' ? o.limit_window_seconds : null
  }
}

const requestCodexUsage = async (): Promise<CodexUsage | null> => {
  const auth = await codexAuth()
  if (!auth) return null
  try {
    const res = await fetch(CODEX_USAGE_URL, {
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': 'application/json',
        ...(auth.accountId ? { 'chatgpt-account-id': auth.accountId } : {})
      }
    })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, unknown>
    const rl = j.rate_limit
    const limits = rl && typeof rl === 'object' ? (rl as Record<string, unknown>) : {}
    return {
      planType: typeof j.plan_type === 'string' ? j.plan_type : null,
      primary: codexWindowOf(limits.primary_window),
      secondary: codexWindowOf(limits.secondary_window),
      capturedAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}

const fetchCodexUsage = async (): Promise<CodexUsage | null> => {
  const fresh = codexStore.value && Date.now() - codexStore.at < CLAUDE_TTL_MS
  if (fresh) return codexStore.value
  const next = await requestCodexUsage()
  if (next) {
    codexStore.value = next
    codexStore.at = Date.now()
    return next
  }
  return codexStore.value
}

// Both providers via their official usage endpoints, cached and
// stale-tolerant (each self-rate-limits to varying degrees).
export async function getUsage(): Promise<UsageResponse> {
  const [claude, codex] = await Promise.all([fetchClaudeUsage(), fetchCodexUsage()])
  return { claude, codex }
}
