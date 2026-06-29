/**
 * Routes subscription requests to a specific SubAccount based on the
 * inbound session ID.
 *
 * Strategy:
 *   - Known session  → reuse the same account (prompt-cache efficiency)
 *   - Unknown session → pick the account with the HIGHEST required burn
 *                       rate on the scarce weekly window (claude: 7d
 *                       Opus, codex: primary) and record the mapping for
 *                       this session
 *
 * "Required burn rate" = pctRemaining / timeRemainingMs on the balancing
 * window (both terms on the same percent-per-millisecond scale): how
 * fast this account would need to spend to consume its full
 * quota by the next reset. Picking the maximum means we route to the
 * account at greatest risk of leaving quota unspent at reset — i.e. we
 * drain near-reset accounts that still have headroom first, and skip
 * already-burnt-out ones (pctRemaining ≤ 0 → -∞ score). This unifies the
 * old "furthest behind linear drain" intuition with the user-asked
 * "prefer the side whose reset is closer" — reset proximity is the
 * timeRemaining term in the denominator, headroom is the numerator.
 *
 * Balancing on the weekly window (not the 5h window) is the Phase 6 S4
 * choice. The 5h window is soft and may burst, while the 7d windows are
 * the hard constraint we actually want to fully consume by reset.
 *
 * The map is in-process only; it resets on server restart, which is fine
 * — sessions restart too, so cache continuity is already broken there.
 */

import dayjs from '../lib/dayjs'
import { isAccountExhausted } from './failover-state'
import { getSubAccountTokensForKind, type SubAccountTokenInfo } from './subscription-account-sync-service'
import { type ClaudeWindowKey, type CodexWindowKey, getAccountWindow, PROACTIVE_THRESHOLD_PCT } from './usage-service'

// sessionId → subAccountId
const sessionMap = new Map<string, string>()

// The scarce weekly window each kind balances on. Claude spreads on the
// 7d Opus window (most precious, kept furthest from its drain target);
// codex typically runs a single account so primary keeps this simple.
const CLAUDE_BALANCE_WINDOW: ClaudeWindowKey = 'seven_day_opus'
const CODEX_BALANCE_WINDOW: CodexWindowKey = 'primary'

// The SHORT (burst) window we additionally consult per account so the
// picker avoids an account that is about to 429. The weekly balancing
// window above is the optimisation target ("don't leave quota unspent");
// the burst window is the immediate-correctness gate ("don't pick an
// account that just hit its 5-hour ceiling"). Without this the picker
// happily routes to a 5h-exhausted account and the upstream returns 429
// even though peer accounts still had capacity.
const CLAUDE_BURST_WINDOW: ClaudeWindowKey = 'five_hour'
const CODEX_BURST_WINDOW: CodexWindowKey = 'primary'

// A never-polled account (no cached data), one whose balancing window
// has no resetAt, or one whose reset has already passed (cache is stale
// across a reset) all read as MAXIMUM priority so they stay preferred.
// This mirrors the legacy "unknown = available" fallback under the new
// burn-rate metric.
const MAX_PRIORITY = Number.POSITIVE_INFINITY

// Read one window for one account from the cache, dispatching on kind
// to the correct typed overload. Centralises the claude/codex branch so
// callers stay focused on what they want to compute rather than how to
// route the right window key into the right cache.
const windowFor = (
  subAccountId: string,
  kind: 'claude' | 'codex',
  claudeKey: ClaudeWindowKey,
  codexKey: CodexWindowKey
) =>
  kind === 'claude'
    ? getAccountWindow(subAccountId, 'claude', claudeKey)
    : getAccountWindow(subAccountId, 'codex', codexKey)

// Whether the kind's burst (short) window cache shows this account is
// saturated. Used as a proactive demote: an account currently at/over
// PROACTIVE_THRESHOLD_PCT on its 5h / primary window is about to 429,
// so prefer a peer account if one exists. Returns false on missing /
// never-polled cache so a stale cache never blocks routing — the
// reactive 429 path will catch what the cache missed.
const burstWindowSaturated = (subAccountId: string, kind: 'claude' | 'codex'): boolean => {
  const window = windowFor(subAccountId, kind, CLAUDE_BURST_WINDOW, CODEX_BURST_WINDOW)
  if (window === null) return false
  return window.pct >= PROACTIVE_THRESHOLD_PCT
}

// Cache-only required burn rate on the kind's scarce weekly window:
// pctRemaining / timeRemainingMs. Larger means the account has more
// unspent quota relative to the time it has left, so it's at greater
// risk of leaving quota on the table at reset — prefer it. Branches are
// explicit rather than nullish-coalesced so each "unknown" path is named.
//
// Burst-window saturation short-circuits to -Infinity so the scorer
// treats a 5h-saturated account the same way it treats a fully-drained
// weekly account: only picked if every other candidate is also -Infinity
// (and even then, the caller still returns something so the request
// flows and the reactive 429 path can take over).
const balancingScore = (subAccountId: string, kind: 'claude' | 'codex', now: number): number => {
  if (burstWindowSaturated(subAccountId, kind)) return Number.NEGATIVE_INFINITY
  const window = windowFor(subAccountId, kind, CLAUDE_BALANCE_WINDOW, CODEX_BALANCE_WINDOW)
  if (window === null) return MAX_PRIORITY
  if (window.resetAt === null) return MAX_PRIORITY
  const timeRemainingMs = window.resetAt - now
  if (timeRemainingMs <= 0) return MAX_PRIORITY
  const pctRemaining = 100 - window.pct
  if (pctRemaining <= 0) return Number.NEGATIVE_INFINITY
  return pctRemaining / timeRemainingMs
}

// `now` is injectable so unit tests can pin the clock against seeded
// resetAt values without touching real time. Production callers omit
// it and get the actual wall clock.
export async function resolveAccountForSession(
  sessionId: string,
  kind: 'claude' | 'codex',
  now: number = dayjs().valueOf()
): Promise<SubAccountTokenInfo | null> {
  const all = await getSubAccountTokensForKind(kind)
  if (all.length === 0) return null

  // Reactive 429s set an exhaustion mark on the specific subAccountId.
  // Filter those out so a freshly-limited account isn't re-picked while
  // its window is still cooling. If every account is currently marked,
  // fall back to the full list — returning null would 401 the client,
  // which is strictly worse than letting the request go out and 429
  // again (the mark auto-expires on read once the cooldown elapses).
  const usable = all.filter((a) => !isAccountExhausted(a.subAccountId))
  const accounts = usable.length > 0 ? usable : all

  if (accounts.length === 1) return accounts[0]

  const cached = sessionMap.get(sessionId)
  if (cached) {
    const found = accounts.find((a) => a.subAccountId === cached)
    if (found) return found
    // Previously-chosen account is no longer in the candidate set (either
    // disabled, or filtered out because it is currently exhausted).
    // Repick — and drop the sticky so a future request doesn't latch
    // back onto the dead choice on a stale read.
    sessionMap.delete(sessionId)
  }

  // Pick the account with the HIGHEST required burn rate on the scarce
  // weekly window — i.e. the one most at risk of leaving quota unspent
  // by its next reset. Never-polled / stale-reset accounts read as
  // MAX_PRIORITY and stay preferred. Score each account once up front so
  // the reduce comparison stays O(1) per step and can't see a different
  // cache snapshot for the same account across iterations.
  const scored = accounts.map((a) => ({ account: a, score: balancingScore(a.subAccountId, kind, now) }))
  const picked = scored.reduce((best, candidate) => (candidate.score > best.score ? candidate : best)).account
  sessionMap.set(sessionId, picked.subAccountId)
  return picked
}

// Read-only lookup of which account the sticky map currently routes this
// session to. The reactive 429 path uses this to learn the subAccountId
// that just failed (the pipeline picked it deep inside the OAuth
// transformer; there is no other handle on the way back up). Returns
// null when no sticky mapping exists.
export function getActiveAccountForSession(sessionId: string): string | null {
  const cached = sessionMap.get(sessionId)
  return cached !== undefined ? cached : null
}

// Drop the sticky mapping for a session if (and only if) it still points
// at the named account. Called by the reactive 429 path after marking
// the account exhausted so the next retry repicks instead of latching
// back onto the just-failed account. The conditional delete prevents
// racing with a concurrent re-pick that may have already moved the
// sticky onto a different account.
export function releaseAccountForSession(sessionId: string, subAccountId: string): void {
  if (sessionMap.get(sessionId) === subAccountId) sessionMap.delete(sessionId)
}
