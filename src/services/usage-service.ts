import { z } from '@hono/zod-openapi'
import dayjs from '../lib/dayjs'
import { logger } from '../logger'
import {
  type ClaudeUsage,
  ClaudeUsageWireSchema,
  type CodexUsage,
  type CodexUsageWindowValue,
  CodexUsageWireSchema,
  type GetUsageInput,
  type GetUsageOutput,
  type UsageResponse
} from '../schemas/usage.dto'
import { getSubAccountTokensForKind, type SubAccountTokenInfo } from './subscription-account-sync-service'

export type {
  ClaudeUsage,
  ClaudeUsageWindow,
  CodexUsage,
  CodexUsageWindow,
  GetUsageInput,
  GetUsageOutput,
  UsageResponse
} from '../schemas/usage.dto'

const TTL_MS = 5 * 60_000

// Per-account cache keyed by subAccountId.
const claudeCache = new Map<string, { value: ClaudeUsage; at: number }>()
const codexCache = new Map<string, { value: CodexUsage; at: number }>()

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

// Utilization (0-100) at or above which the proactive router treats a
// subscription as "about to run out" and pre-empts to a fallback. A bit
// below 100 so we divert before the upstream starts returning 429s.
export const PROACTIVE_THRESHOLD_PCT = 95

export type UsageWindow = { pct: number; resetAt: number | null }

const claudeWindow = (u: ClaudeUsage): UsageWindow => ({
  pct: u.fiveHour ? u.fiveHour.utilization : 0,
  resetAt: u.fiveHour?.resetsAt ? dayjs(u.fiveHour.resetsAt).valueOf() : null
})

const codexWindow = (u: CodexUsage): UsageWindow => ({
  pct: u.primary ? u.primary.usedPercent : 0,
  resetAt: u.primary?.resetAt ? dayjs(u.primary.resetAt).valueOf() : null
})

export const headroomFrom = (windows: UsageWindow[]): { overLimit: boolean; resetAt: number | null } => {
  // Empty cache (never polled) reads as available — proactive only kicks
  // in once we actually have usage data.
  if (windows.length === 0) return { overLimit: false, resetAt: null }
  // session-account-router spreads load across accounts, so the kind only
  // counts as over-limit when EVERY cached account is at/over threshold.
  const overAll = windows.every((w) => w.pct >= PROACTIVE_THRESHOLD_PCT)
  if (!overAll) return { overLimit: false, resetAt: null }
  const resets = windows.map((w) => w.resetAt).filter((r): r is number => r !== null)
  const earliest = resets.length > 0 ? Math.min(...resets) : null
  return { overLimit: true, resetAt: earliest }
}

// Cache-only headroom for a subscription kind. overLimit is true only
// when every cached account for that kind is at/over PROACTIVE_THRESHOLD_PCT;
// resetAt is the earliest reset among them (used to size the failover
// exhaustion window). Reads the in-memory cache only — never fetches.
export function getKindHeadroom(kind: 'claude' | 'codex'): { overLimit: boolean; resetAt: number | null } {
  if (kind === 'claude') {
    return headroomFrom([...claudeCache.values()].map((e) => claudeWindow(e.value)))
  }
  return headroomFrom([...codexCache.values()].map((e) => codexWindow(e.value)))
}

// ---- Window-selectable headroom (Phase 6 S1) -----------------------
//
// The existing claudeWindow/codexWindow only look at the 5h / primary
// window. The router needs to guard the weekly windows (7d, 7d Opus)
// while letting the 5h window burst, so the helpers below let callers
// pick a specific window and compute a linear drain target against it.

// Window keys as zod enums so a runtime value can be narrowed to the
// right key set via safeParse — no type assertions on the union.
const ClaudeWindowKeySchema = z.enum(['five_hour', 'seven_day', 'seven_day_sonnet', 'seven_day_opus'])
const CodexWindowKeySchema = z.enum(['primary', 'secondary'])

export type ClaudeWindowKey = z.infer<typeof ClaudeWindowKeySchema>
export type CodexWindowKey = z.infer<typeof CodexWindowKeySchema>

// pct is 0-100; resetAt is epoch ms (null when the upstream omitted it).
export type WindowUsage = { pct: number; resetAt: number | null }

// Nominal window lengths in ms. The 5h window is exactly 5 hours; the
// weekly windows (overall 7d, 7d Sonnet, 7d Opus) are each 7 days. Codex
// windows carry their own length on the wire (windowSeconds), so there is
// no fixed constant for them — see codexWindowLengthMs below.
const FIVE_HOUR_WINDOW_MS = 5 * 3_600_000
const SEVEN_DAY_WINDOW_MS = 7 * 86_400_000

// Nominal window length for a Claude window key.
const claudeWindowLengthMs = (window: ClaudeWindowKey): number =>
  window === 'five_hour' ? FIVE_HOUR_WINDOW_MS : SEVEN_DAY_WINDOW_MS

// Codex windows report their own length on the wire as windowSeconds.
// Convert to ms; null/non-positive lengths read as unknown.
const codexWindowLengthMs = (windowSeconds: number | null): number | null =>
  windowSeconds !== null && windowSeconds > 0 ? windowSeconds * 1000 : null

// windowSeconds off a possibly-missing Codex window value, without a
// nullish fallback (branch explicitly so a null window reads as unknown).
const codexWindowSeconds = (value: CodexUsageWindowValue | null): number | null =>
  value === null ? null : value.windowSeconds

const isoToEpoch = (iso: string | null): number | null => (iso !== null && iso.length > 0 ? dayjs(iso).valueOf() : null)

// Pull one window's {pct, resetAt} out of a cached Claude snapshot.
const claudeWindowUsage = (u: ClaudeUsage, window: ClaudeWindowKey): WindowUsage => {
  const value =
    window === 'five_hour'
      ? u.fiveHour
      : window === 'seven_day'
        ? u.sevenDay
        : window === 'seven_day_sonnet'
          ? u.sevenDaySonnet
          : u.sevenDayOpus
  return { pct: value ? value.utilization : 0, resetAt: value ? isoToEpoch(value.resetsAt) : null }
}

// Pull one window's {pct, resetAt} out of a cached Codex snapshot.
const codexWindowUsage = (u: CodexUsage, window: CodexWindowKey): WindowUsage => {
  const value = window === 'primary' ? u.primary : u.secondary
  return { pct: value ? value.usedPercent : 0, resetAt: value ? isoToEpoch(value.resetAt) : null }
}

// Read one window's usage for one account from the in-memory cache only
// (no fetch). Returns null when there is no cached data for that account.
export function getAccountWindow(subAccountId: string, kind: 'claude', window: ClaudeWindowKey): WindowUsage | null
export function getAccountWindow(subAccountId: string, kind: 'codex', window: CodexWindowKey): WindowUsage | null
export function getAccountWindow(
  subAccountId: string,
  kind: 'claude' | 'codex',
  window: ClaudeWindowKey | CodexWindowKey
): WindowUsage | null {
  if (kind === 'claude') {
    const c = claudeCache.get(subAccountId)
    if (!c) return null
    // Narrow the union to the Claude key set via a safeParse so we never
    // assert the window type — a mismatched key reads as no data.
    const parsed = ClaudeWindowKeySchema.safeParse(window)
    if (!parsed.success) return null
    return claudeWindowUsage(c.value, parsed.data)
  }
  const c = codexCache.get(subAccountId)
  if (!c) return null
  const parsed = CodexWindowKeySchema.safeParse(window)
  if (!parsed.success) return null
  return codexWindowUsage(c.value, parsed.data)
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

// Linear drain target for a single window. targetPct is where usage
// "should" be if it drained evenly across the window; headroom is how
// far behind that target we are (>0 = room to spend, <0 = running hot).
export type DrainTarget = {
  pct: number
  resetAt: number | null
  targetPct: number | null
  headroom: number | null
  overTarget: boolean
}

// Pure: compute the linear drain target. The clock is injected via `now`
// so this stays unit-testable. windowLengthMs is the nominal window
// length; when it or resetAt is unknown the target is null and the
// window never counts as over target. marginPct widens the over-target
// threshold (default 0).
export function drainTarget(
  usage: WindowUsage,
  windowLengthMs: number | null,
  now: number,
  marginPct = 0
): DrainTarget {
  const { pct, resetAt } = usage
  if (resetAt === null || windowLengthMs === null || windowLengthMs <= 0) {
    return { pct, resetAt, targetPct: null, headroom: null, overTarget: false }
  }
  // The window opened at resetAt - windowLengthMs; elapsedFraction is how
  // far through that window `now` sits, clamped to [0, 1].
  const windowStart = resetAt - windowLengthMs
  const elapsedFraction = clamp01((now - windowStart) / windowLengthMs)
  const targetPct = elapsedFraction * 100
  const headroom = targetPct - pct
  const overTarget = pct > targetPct + marginPct
  return { pct, resetAt, targetPct, headroom, overTarget }
}

// Convenience: read an account's window from cache AND compute its drain
// target. Picks windowLengthMs from the window key (codex uses the cached
// windowSeconds). Returns null when the account has no cached data.
export function getAccountHeadroom(
  subAccountId: string,
  kind: 'claude',
  window: ClaudeWindowKey,
  now: number,
  marginPct?: number
): DrainTarget | null
export function getAccountHeadroom(
  subAccountId: string,
  kind: 'codex',
  window: CodexWindowKey,
  now: number,
  marginPct?: number
): DrainTarget | null
export function getAccountHeadroom(
  subAccountId: string,
  kind: 'claude' | 'codex',
  window: ClaudeWindowKey | CodexWindowKey,
  now: number,
  marginPct = 0
): DrainTarget | null {
  if (kind === 'claude') {
    const parsed = ClaudeWindowKeySchema.safeParse(window)
    if (!parsed.success) return null
    const usage = getAccountWindow(subAccountId, 'claude', parsed.data)
    if (!usage) return null
    return drainTarget(usage, claudeWindowLengthMs(parsed.data), now, marginPct)
  }
  const parsed = CodexWindowKeySchema.safeParse(window)
  if (!parsed.success) return null
  const usage = getAccountWindow(subAccountId, 'codex', parsed.data)
  if (!usage) return null
  // Codex window length lives on the cached snapshot, not in a constant.
  const cached = codexCache.get(subAccountId)
  if (!cached) return null
  const value = parsed.data === 'primary' ? cached.value.primary : cached.value.secondary
  return drainTarget(usage, codexWindowLengthMs(codexWindowSeconds(value)), now, marginPct)
}

// Aggregate a kind's drain targets the same way headroomFrom spreads
// load across accounts: over only when EVERY account is over its drain
// target for this window; resetAt is the earliest among them. An empty
// list reads as { overTarget: false, resetAt: null }.
const aggregateWindowHeadroom = (targets: DrainTarget[]): { overTarget: boolean; resetAt: number | null } => {
  if (targets.length === 0) return { overTarget: false, resetAt: null }
  const overAll = targets.every((t) => t.overTarget)
  const resets = targets.map((t) => t.resetAt).filter((r): r is number => r !== null)
  const earliest = resets.length > 0 ? Math.min(...resets) : null
  if (!overAll) return { overTarget: false, resetAt: earliest }
  return { overTarget: true, resetAt: earliest }
}

// Kind-level aggregate for the failover path, for a SPECIFIC window.
// Reads the in-memory cache only — never fetches.
export function getKindWindowHeadroom(
  kind: 'claude',
  window: ClaudeWindowKey,
  now: number,
  marginPct?: number
): { overTarget: boolean; resetAt: number | null }
export function getKindWindowHeadroom(
  kind: 'codex',
  window: CodexWindowKey,
  now: number,
  marginPct?: number
): { overTarget: boolean; resetAt: number | null }
export function getKindWindowHeadroom(
  kind: 'claude' | 'codex',
  window: ClaudeWindowKey | CodexWindowKey,
  now: number,
  marginPct = 0
): { overTarget: boolean; resetAt: number | null } {
  if (kind === 'claude') {
    const parsed = ClaudeWindowKeySchema.safeParse(window)
    if (!parsed.success) return { overTarget: false, resetAt: null }
    const targets = [...claudeCache.values()].map((e) =>
      drainTarget(claudeWindowUsage(e.value, parsed.data), claudeWindowLengthMs(parsed.data), now, marginPct)
    )
    return aggregateWindowHeadroom(targets)
  }
  const parsed = CodexWindowKeySchema.safeParse(window)
  if (!parsed.success) return { overTarget: false, resetAt: null }
  const targets = [...codexCache.values()].map((e) => {
    const value = parsed.data === 'primary' ? e.value.primary : e.value.secondary
    return drainTarget(
      codexWindowUsage(e.value, parsed.data),
      codexWindowLengthMs(codexWindowSeconds(value)),
      now,
      marginPct
    )
  })
  return aggregateWindowHeadroom(targets)
}

// ---- Test seam (Phase 6 S1) ----------------------------------------
//
// The per-account caches are module-private and are normally only filled
// by the live fetch path. These helpers let unit tests seed and clear the
// cache so the window-selectable headroom functions can be covered without
// hitting the network. Not part of the routing API — test-only.
export function __seedClaudeCacheForTest(subAccountId: string, value: ClaudeUsage, at: number): void {
  claudeCache.set(subAccountId, { value, at })
}

export function __seedCodexCacheForTest(subAccountId: string, value: CodexUsage, at: number): void {
  codexCache.set(subAccountId, { value, at })
}

export function __clearUsageCachesForTest(): void {
  claudeCache.clear()
  codexCache.clear()
}
