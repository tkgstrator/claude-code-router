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
 * "Required burn rate" = pctRemaining / timeRemaining on the balancing
 * window: how fast this account would need to spend to consume its full
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
import { getSubAccountTokensForKind, type SubAccountTokenInfo } from './subscription-account-sync-service'
import { type ClaudeWindowKey, type CodexWindowKey, getAccountWindow } from './usage-service'

// sessionId → subAccountId
const sessionMap = new Map<string, string>()

// The scarce weekly window each kind balances on. Claude spreads on the
// 7d Opus window (most precious, kept furthest from its drain target);
// codex typically runs a single account so primary keeps this simple.
const CLAUDE_BALANCE_WINDOW: ClaudeWindowKey = 'seven_day_opus'
const CODEX_BALANCE_WINDOW: CodexWindowKey = 'primary'

// A never-polled account (no cached data), one whose balancing window
// has no resetAt, or one whose reset has already passed (cache is stale
// across a reset) all read as MAXIMUM priority so they stay preferred.
// This mirrors the legacy "unknown = available" fallback under the new
// burn-rate metric.
const MAX_PRIORITY = Number.POSITIVE_INFINITY

// Cache-only required burn rate on the kind's scarce weekly window:
// pctRemaining / timeRemainingMs. Larger means the account has more
// unspent quota relative to the time it has left, so it's at greater
// risk of leaving quota on the table at reset — prefer it. Branches are
// explicit rather than nullish-coalesced so each "unknown" path is named.
const balancingScore = (subAccountId: string, kind: 'claude' | 'codex', now: number): number => {
  const window =
    kind === 'claude'
      ? getAccountWindow(subAccountId, 'claude', CLAUDE_BALANCE_WINDOW)
      : getAccountWindow(subAccountId, 'codex', CODEX_BALANCE_WINDOW)
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
  const accounts = await getSubAccountTokensForKind(kind)
  if (accounts.length === 0) return null
  if (accounts.length === 1) return accounts[0]

  const cached = sessionMap.get(sessionId)
  if (cached) {
    const found = accounts.find((a) => a.subAccountId === cached)
    if (found) return found
    // Previously-chosen account is no longer enabled — fall through to repick.
    sessionMap.delete(sessionId)
  }

  // Pick the account with the HIGHEST required burn rate on the scarce
  // weekly window — i.e. the one most at risk of leaving quota unspent
  // by its next reset. Never-polled / stale-reset accounts read as
  // MAX_PRIORITY and stay preferred. Deterministic stable reduce.
  const picked = accounts.reduce((best, a) =>
    balancingScore(a.subAccountId, kind, now) > balancingScore(best.subAccountId, kind, now) ? a : best
  )
  sessionMap.set(sessionId, picked.subAccountId)
  return picked
}
