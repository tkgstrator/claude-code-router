/**
 * Cache-only, single-window headroom check (5h / primary window) used
 * by the proactive router to decide whether a subscription kind is
 * "about to run out". See window-headroom.ts for the window-selectable
 * (weekly-aware) variant.
 */

import dayjs from '../../lib/dayjs'
import type { ClaudeUsage, CodexUsage } from '../../schemas/api/usage'
import { claudeCache, codexCache } from './cache'

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
