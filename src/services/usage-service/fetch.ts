/**
 * Live upstream usage polling (Claude /api/oauth/usage, Codex wham/usage)
 * plus the TTL-cached snapshot readers consumed by the API route and the
 * usage-history poller.
 */

import dayjs from '../../lib/dayjs'
import { logger } from '../../logger'
import {
  type ClaudeUsage,
  ClaudeUsageWireSchema,
  type CodexUsage,
  type CodexUsageWindowValue,
  CodexUsageWireSchema,
  type GetUsageInput,
  type GetUsageOutput,
  type UsageResponse
} from '../../schemas/usage.dto'
import { getSubAccountTokensForKind, type SubAccountTokenInfo } from '../subscription-account-sync-service'
import { claudeCache, codexCache, TTL_MS } from './cache'

const windowOf = (v: unknown): { utilization: number; resetsAt: string | null } | null => {
  if (v === null || typeof v !== 'object') return null
  if (!('utilization' in v) || typeof v.utilization !== 'number') return null
  const resetsAt = 'resets_at' in v && typeof v.resets_at === 'string' && v.resets_at.length > 0 ? v.resets_at : null
  return { utilization: v.utilization, resetsAt }
}

const codexWindowOf = (v: unknown): CodexUsageWindowValue | null => {
  if (v === null || typeof v !== 'object') return null
  if (!('used_percent' in v) || typeof v.used_percent !== 'number') return null
  const resetAt = 'reset_at' in v && typeof v.reset_at === 'number' ? dayjs(v.reset_at * 1000).toISOString() : null
  const windowSeconds =
    'limit_window_seconds' in v && typeof v.limit_window_seconds === 'number' ? v.limit_window_seconds : null
  return { usedPercent: v.used_percent, resetAt, windowSeconds }
}

const requestClaudeUsage = async (info: SubAccountTokenInfo): Promise<ClaudeUsage | null> => {
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        authorization: `Bearer ${info.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'content-type': 'application/json'
      }
    })
    if (!res.ok) return null
    const parsed = ClaudeUsageWireSchema.safeParse(await res.json())
    if (!parsed.success) return null
    const j = parsed.data
    const extra = j.extra_usage
    const extraUsageEnabled =
      typeof extra === 'object' && extra !== null && 'is_enabled' in extra && extra.is_enabled === true
    return {
      subAccountId: info.subAccountId,
      accountLabel: info.displayName,
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

const fetchClaudeUsage = async (): Promise<ClaudeUsage[]> => {
  const accounts = await getSubAccountTokensForKind('claude').catch(() => [])
  const results: ClaudeUsage[] = []
  for (const info of accounts) {
    const cached = claudeCache.get(info.subAccountId)
    if (cached && dayjs().valueOf() - cached.at < TTL_MS) {
      results.push(cached.value)
      continue
    }
    const next = await requestClaudeUsage(info)
    if (next) {
      claudeCache.set(info.subAccountId, { value: next, at: dayjs().valueOf() })
      results.push(next)
    } else if (cached) {
      results.push(cached.value)
    }
  }
  return results
}

const requestCodexUsage = async (info: SubAccountTokenInfo): Promise<CodexUsage | null> => {
  try {
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        authorization: `Bearer ${info.accessToken}`,
        'content-type': 'application/json',
        ...(info.accountId ? { 'chatgpt-account-id': info.accountId } : {})
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
      subAccountId: info.subAccountId,
      accountLabel: info.displayName,
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

const fetchCodexUsage = async (): Promise<CodexUsage[]> => {
  const accounts = await getSubAccountTokensForKind('codex').catch(() => [])
  const results: CodexUsage[] = []
  for (const info of accounts) {
    const cached = codexCache.get(info.subAccountId)
    if (cached && dayjs().valueOf() - cached.at < TTL_MS) {
      results.push(cached.value)
      continue
    }
    const next = await requestCodexUsage(info)
    if (next) {
      codexCache.set(info.subAccountId, { value: next, at: dayjs().valueOf() })
      results.push(next)
    } else if (cached) {
      results.push(cached.value)
    }
  }
  return results
}

export async function fetchUsageSnapshot(_input: GetUsageInput = {}): Promise<GetUsageOutput> {
  const [claude, codex] = await Promise.all([fetchClaudeUsage(), fetchCodexUsage()])
  return { usage: { claude, codex } }
}

export async function getUsage(): Promise<UsageResponse> {
  const { usage } = await fetchUsageSnapshot()
  return usage
}

// Per-account variant of the snapshot — used by the poller to write
// per-account rows into SubAccountUsage (history-aggregated UsageSnapshot
// loses the subAccountId, so we pair the cached value with its id
// directly here). Skips accounts whose cache is missing because the
// upstream fetch failed AND no prior value exists.
export async function fetchUsageSnapshotWithAccountIds(): Promise<{
  claude: Array<{ subAccountId: string; usage: ClaudeUsage }>
  codex: Array<{ subAccountId: string; usage: CodexUsage }>
}> {
  // Force a refresh by going through the public fetch path — this
  // ensures the cache is populated before we read it below.
  await fetchUsageSnapshot()
  const claudeAccts = await getSubAccountTokensForKind('claude').catch(() => [])
  const codexAccts = await getSubAccountTokensForKind('codex').catch(() => [])
  const claude: Array<{ subAccountId: string; usage: ClaudeUsage }> = []
  const codex: Array<{ subAccountId: string; usage: CodexUsage }> = []
  for (const a of claudeAccts) {
    const cached = claudeCache.get(a.subAccountId)
    if (cached) claude.push({ subAccountId: a.subAccountId, usage: cached.value })
  }
  for (const a of codexAccts) {
    const cached = codexCache.get(a.subAccountId)
    if (cached) codex.push({ subAccountId: a.subAccountId, usage: cached.value })
  }
  return { claude, codex }
}

// Returns the most relevant current usage percent for a given subAccountId
// without triggering a live fetch — reads the existing in-memory cache only.
// Returns 0 when no cached data exists (treat unknown = available).
export function getCachedUsagePct(subAccountId: string, kind: 'claude' | 'codex'): number {
  if (kind === 'claude') {
    const c = claudeCache.get(subAccountId)
    return c ? (c.value.fiveHour?.utilization ?? 0) : 0
  }
  const c = codexCache.get(subAccountId)
  return c ? (c.value.primary?.usedPercent ?? 0) : 0
}
