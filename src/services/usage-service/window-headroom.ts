/**
 * Window-selectable headroom (Phase 6 S1).
 *
 * headroom.ts only looks at the 5h / primary window. The router needs
 * to guard the weekly windows (7d, 7d Opus) while letting the 5h window
 * burst, so the helpers here let callers pick a specific window and
 * compute a linear drain target against it.
 */

import { z } from '@hono/zod-openapi'
import dayjs from '../../lib/dayjs'
import type { ClaudeUsage, CodexUsage, CodexUsageWindowValue } from '../../schemas/api/usage'
import { claudeCache, codexCache } from './cache'

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
