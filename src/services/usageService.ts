import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import dayjs from '../lib/dayjs'

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
      capturedAt: dayjs().toISOString()
    }
  } catch {
    return null
  }
}

const fetchClaudeUsage = async (): Promise<ClaudeUsage | null> => {
  const fresh = claudeStore.value && dayjs().valueOf() - claudeStore.at < CLAUDE_TTL_MS
  if (fresh) return claudeStore.value
  const next = await requestClaudeUsage()
  if (next) {
    claudeStore.value = next
    claudeStore.at = dayjs().valueOf()
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

// Public OAuth values baked into the OSS Codex CLI (openai/codex). CCR
// only ever read auth.json before; mirror the CLI and refresh the
// access token when it is close to expiry so the capture job keeps
// flowing instead of silently dropping codex once the token lapses.
const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json')
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_SKEW_S = 30 * 60

interface CodexTokens {
  access_token?: unknown
  refresh_token?: unknown
  id_token?: unknown
  account_id?: unknown
}
interface CodexAuthFile {
  tokens?: CodexTokens
  last_refresh?: unknown
  [k: string]: unknown
}

// `exp` (epoch seconds) out of a JWT access token, or null if the
// token isn't a decodable JWT.
const jwtExp = (jwt: string): number | null => {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const payload = JSON.parse(json) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

// Exchange the refresh token for a new access token and persist it
// back to auth.json (atomic via tmp + rename, unknown fields kept).
// Returns the fresh access token, or null on any failure.
const refreshCodexToken = async (auth: CodexAuthFile, refreshToken: string): Promise<string | null> => {
  try {
    const res = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CODEX_CLIENT_ID,
        scope: 'openid profile email'
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[codex] token refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`)
      return null
    }
    const j = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; id_token?: unknown }
    if (typeof j.access_token !== 'string' || j.access_token.length === 0) {
      console.warn('[codex] token refresh: response had no access_token')
      return null
    }
    const prev = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {}
    const tokens: CodexTokens = {
      ...prev,
      access_token: j.access_token,
      refresh_token:
        typeof j.refresh_token === 'string' && j.refresh_token.length > 0 ? j.refresh_token : prev.refresh_token,
      id_token: typeof j.id_token === 'string' && j.id_token.length > 0 ? j.id_token : prev.id_token
    }
    const next: CodexAuthFile = { ...auth, tokens, last_refresh: dayjs().toISOString() }
    const tmp = `${CODEX_AUTH_PATH}.tmp`
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, CODEX_AUTH_PATH)
    return j.access_token
  } catch (e) {
    console.warn(`[codex] token refresh threw: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

const codexAuth = async (): Promise<{ token: string; accountId: string | null } | null> => {
  try {
    const raw = await readFile(CODEX_AUTH_PATH, 'utf-8')
    const auth = JSON.parse(raw) as CodexAuthFile
    const tokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {}
    const access = typeof tokens.access_token === 'string' ? tokens.access_token : ''
    if (access.length === 0) {
      console.warn('[codex] auth.json has no tokens.access_token')
      return null
    }
    const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : null
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : ''
    const exp = jwtExp(access)
    // Refresh when within REFRESH_SKEW_S of expiry (or already past it)
    // and a refresh token is on file; otherwise use the token as-is.
    const stale = exp !== null && exp - dayjs().unix() <= REFRESH_SKEW_S && refreshToken.length > 0
    if (!stale) return { token: access, accountId }
    const fresh = await refreshCodexToken(auth, refreshToken)
    console.warn(fresh !== null ? '[codex] token refreshed ok' : '[codex] token refresh failed; using existing token')
    return { token: fresh !== null ? fresh : access, accountId }
  } catch (e) {
    console.warn(`[codex] auth.json unreadable: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

const codexWindowOf = (v: unknown): CodexUsageWindow | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.used_percent !== 'number') return null
  const resetAt = typeof o.reset_at === 'number' ? dayjs(o.reset_at * 1000).toISOString() : null
  return {
    usedPercent: o.used_percent,
    resetAt,
    windowSeconds: typeof o.limit_window_seconds === 'number' ? o.limit_window_seconds : null
  }
}

const requestCodexUsage = async (): Promise<CodexUsage | null> => {
  const auth = await codexAuth()
  if (!auth) {
    console.warn('[codex] no usable auth; skipping wham/usage')
    return null
  }
  try {
    const res = await fetch(CODEX_USAGE_URL, {
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': 'application/json',
        ...(auth.accountId ? { 'chatgpt-account-id': auth.accountId } : {})
      }
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[codex] wham/usage HTTP ${res.status} ${body.slice(0, 200)}`)
      return null
    }
    const j = (await res.json()) as Record<string, unknown>
    const rl = j.rate_limit
    const limits = rl && typeof rl === 'object' ? (rl as Record<string, unknown>) : {}
    return {
      planType: typeof j.plan_type === 'string' ? j.plan_type : null,
      primary: codexWindowOf(limits.primary_window),
      secondary: codexWindowOf(limits.secondary_window),
      capturedAt: dayjs().toISOString()
    }
  } catch (e) {
    console.warn(`[codex] wham/usage threw: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

const fetchCodexUsage = async (): Promise<CodexUsage | null> => {
  const fresh = codexStore.value && dayjs().valueOf() - codexStore.at < CLAUDE_TTL_MS
  if (fresh) return codexStore.value
  const next = await requestCodexUsage()
  if (next) {
    codexStore.value = next
    codexStore.at = dayjs().valueOf()
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
