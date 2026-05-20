import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import dayjs from '../lib/dayjs'
import { logger } from '../lib/logger'
import {
  ClaudeCredentialsSchema,
  type ClaudeUsage,
  type ClaudeUsageWindowValue,
  ClaudeUsageWireSchema,
  type CodexAuthFile,
  CodexAuthFileSchema,
  type CodexCliTokens,
  CodexTokenRefreshResponseSchema,
  type CodexUsage,
  type CodexUsageWindowValue,
  CodexUsageWireSchema,
  type GetUsageInput,
  type GetUsageOutput,
  JwtPayloadSchema,
  type UsageResponse
} from '../schemas/usage.dto'

// Re-export the types that external consumers historically pulled from
// this module so existing imports keep working without a churned diff.
export type {
  ClaudeUsage,
  ClaudeUsageWindow,
  CodexUsage,
  CodexUsageWindow,
  GetUsageInput,
  GetUsageOutput,
  UsageResponse
} from '../schemas/usage.dto'

const claudeToken = async (): Promise<string | null> => {
  try {
    const raw = await readFile(join(homedir(), '.claude', '.credentials.json'), 'utf-8')
    const parsed = ClaudeCredentialsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    const tok = parsed.data.claudeAiOauth?.accessToken
    return typeof tok === 'string' && tok.length > 0 ? tok : null
  } catch {
    return null
  }
}

const windowOf = (v: unknown): ClaudeUsageWindowValue | null => {
  if (v === null || typeof v !== 'object') return null
  if (!('utilization' in v) || typeof v.utilization !== 'number') return null
  const resetsAt = 'resets_at' in v && typeof v.resets_at === 'string' && v.resets_at.length > 0 ? v.resets_at : null
  return { utilization: v.utilization, resetsAt }
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
const claudeStore: { value: ClaudeUsage; at: number } = { value: null, at: 0 }

const requestClaudeUsage = async (): Promise<ClaudeUsage> => {
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
    const raw = await res.json()
    const parsed = ClaudeUsageWireSchema.safeParse(raw)
    if (!parsed.success) return null
    const j = parsed.data
    const extra = j.extra_usage
    const extraUsageEnabled =
      typeof extra === 'object' && extra !== null && 'is_enabled' in extra && extra.is_enabled === true
    return {
      fiveHour: windowOf(j.five_hour),
      sevenDay: windowOf(j.seven_day),
      sevenDaySonnet: windowOf(j.seven_day_sonnet),
      sevenDayOpus: windowOf(j.seven_day_opus),
      extraUsageEnabled,
      capturedAt: dayjs().toISOString()
    }
  } catch {
    return null
  }
}

const fetchClaudeUsage = async (): Promise<ClaudeUsage> => {
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
const codexStore: { value: CodexUsage; at: number } = { value: null, at: 0 }

// Public OAuth values baked into the OSS Codex CLI (openai/codex). CCR
// only ever read auth.json before; mirror the CLI and refresh the
// access token when it is close to expiry so the capture job keeps
// flowing instead of silently dropping codex once the token lapses.
const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json')
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_SKEW_S = 30 * 60

// `exp` (epoch seconds) out of a JWT access token, or null if the
// token isn't a decodable JWT.
const jwtExp = (jwt: string): number | null => {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const parsed = JwtPayloadSchema.safeParse(JSON.parse(json))
    if (!parsed.success) return null
    return typeof parsed.data.exp === 'number' ? parsed.data.exp : null
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
      logger.warn({ status: res.status, body: body.slice(0, 200) }, '[codex] token refresh failed')
      return null
    }
    const parsed = CodexTokenRefreshResponseSchema.safeParse(await res.json())
    if (!parsed.success) {
      logger.warn('[codex] token refresh: response did not match expected shape')
      return null
    }
    const j = parsed.data
    if (typeof j.access_token !== 'string' || j.access_token.length === 0) {
      logger.warn('[codex] token refresh: response had no access_token')
      return null
    }
    const prev: CodexCliTokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {}
    const tokens: CodexCliTokens = {
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
    logger.warn({ err: e }, '[codex] token refresh threw')
    return null
  }
}

// Node fs throws ENOENT when the file is simply absent; that means the
// operator has not logged in with the Codex CLI yet, which is a normal
// "not registered" state rather than an error. Narrowed without an
// `as` assertion (the biome plugin forbids those).
const isFileNotFound = (e: unknown): boolean => e instanceof Error && 'code' in e && e.code === 'ENOENT'

const codexAuth = async (): Promise<{ token: string; accountId: string | null } | null> => {
  try {
    const raw = await readFile(CODEX_AUTH_PATH, 'utf-8')
    const parsed = CodexAuthFileSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logger.warn('[codex] auth.json did not match expected shape')
      return null
    }
    const auth = parsed.data
    const tokens: CodexCliTokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {}
    const access = typeof tokens.access_token === 'string' ? tokens.access_token : ''
    if (access.length === 0) {
      logger.warn('[codex] auth.json has no tokens.access_token')
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
    if (fresh !== null) logger.info('[codex] token refreshed ok')
    else logger.warn('[codex] token refresh failed; using existing token')
    return { token: fresh !== null ? fresh : access, accountId }
  } catch (e) {
    // Not-yet-registered (no auth.json) is normal and must not warn on
    // every poll; only real read/parse failures are worth surfacing.
    if (!isFileNotFound(e)) {
      logger.warn({ err: e }, '[codex] auth.json unreadable')
    }
    return null
  }
}

const codexWindowOf = (v: unknown): CodexUsageWindowValue | null => {
  if (v === null || typeof v !== 'object') return null
  if (!('used_percent' in v) || typeof v.used_percent !== 'number') return null
  const resetAt = 'reset_at' in v && typeof v.reset_at === 'number' ? dayjs(v.reset_at * 1000).toISOString() : null
  const windowSeconds =
    'limit_window_seconds' in v && typeof v.limit_window_seconds === 'number' ? v.limit_window_seconds : null
  return {
    usedPercent: v.used_percent,
    resetAt,
    windowSeconds
  }
}

const requestCodexUsage = async (): Promise<CodexUsage> => {
  const auth = await codexAuth()
  if (!auth) {
    // codexAuth() already logged anything worth logging; an absent or
    // not-yet-registered subscription stays silent here.
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
      logger.warn({ status: res.status, body: body.slice(0, 200) }, '[codex] wham/usage non-OK')
      return null
    }
    const parsed = CodexUsageWireSchema.safeParse(await res.json())
    if (!parsed.success) {
      logger.warn('[codex] wham/usage response did not match expected shape')
      return null
    }
    const j = parsed.data
    const rl = j.rate_limit
    const primaryWindow =
      rl !== null && typeof rl === 'object' && 'primary_window' in rl ? rl.primary_window : undefined
    const secondaryWindow =
      rl !== null && typeof rl === 'object' && 'secondary_window' in rl ? rl.secondary_window : undefined
    return {
      planType: typeof j.plan_type === 'string' && j.plan_type.length > 0 ? j.plan_type : null,
      primary: codexWindowOf(primaryWindow),
      secondary: codexWindowOf(secondaryWindow),
      capturedAt: dayjs().toISOString()
    }
  } catch (e) {
    logger.warn({ err: e }, '[codex] wham/usage threw')
    return null
  }
}

const fetchCodexUsage = async (): Promise<CodexUsage> => {
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
export async function fetchUsageSnapshot(_input: GetUsageInput = {}): Promise<GetUsageOutput> {
  const [claude, codex] = await Promise.all([fetchClaudeUsage(), fetchCodexUsage()])
  return { usage: { claude, codex } }
}

// Backward-compatible facade used by existing callers.
export async function getUsage(): Promise<UsageResponse> {
  const { usage } = await fetchUsageSnapshot()
  return usage
}
