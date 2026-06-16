/**
 * Routes subscription requests to a specific SubAccount based on the
 * inbound session ID.
 *
 * Strategy:
 *   - Known session  → reuse the same account (prompt-cache efficiency)
 *   - Unknown session → pick the account with the MOST headroom on the
 *                       scarce weekly window (claude: 7d Opus, codex:
 *                       primary) and record the mapping for this session
 *
 * Balancing on the weekly window (not the 5h window) is the Phase 6 S4
 * change. The 5h window is soft and may burst, while the 7d windows are
 * the hard constraint we actually want to spread load across, so we pick
 * the account furthest behind its linear 7d drain target.
 *
 * The map is in-process only; it resets on server restart, which is fine
 * — sessions restart too, so cache continuity is already broken there.
 */

import dayjs from '../lib/dayjs'
import { getSubAccountTokensForKind, type SubAccountTokenInfo } from './subscription-account-sync-service'
import { type ClaudeWindowKey, type CodexWindowKey, getAccountHeadroom } from './usage-service'

// sessionId → subAccountId
const sessionMap = new Map<string, string>()

// The scarce weekly window each kind balances on. Claude spreads on the
// 7d Opus window (most precious, kept furthest from its drain target);
// codex typically runs a single account so primary keeps this simple.
const CLAUDE_BALANCE_WINDOW: ClaudeWindowKey = 'seven_day_opus'
const CODEX_BALANCE_WINDOW: CodexWindowKey = 'primary'

// A never-polled account (no cached data) or one whose drain target is
// not yet computable (no resetAt/target) reads as MAXIMUM headroom, so it
// stays a preferred candidate. This mirrors the legacy "unknown = 0% used
// = available" fallback, just expressed in headroom terms.
const MAX_HEADROOM = Number.POSITIVE_INFINITY

// Cache-only headroom on the kind's scarce weekly window. Larger means the
// account is further behind its linear drain target (more room to spend).
// Returns MAX_HEADROOM when the account has no cached data or no computable
// target, using explicit branches rather than a nullish fallback.
const balancingHeadroom = (subAccountId: string, kind: 'claude' | 'codex', now: number): number => {
  if (kind === 'claude') {
    const target = getAccountHeadroom(subAccountId, 'claude', CLAUDE_BALANCE_WINDOW, now)
    if (target === null) return MAX_HEADROOM
    if (target.headroom === null) return MAX_HEADROOM
    return target.headroom
  }
  const target = getAccountHeadroom(subAccountId, 'codex', CODEX_BALANCE_WINDOW, now)
  if (target === null) return MAX_HEADROOM
  if (target.headroom === null) return MAX_HEADROOM
  return target.headroom
}

export async function resolveAccountForSession(
  sessionId: string,
  kind: 'claude' | 'codex'
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

  // Pick the account with the MOST headroom on the scarce weekly window,
  // i.e. the one furthest behind its drain target. Never-polled accounts
  // read as MAX_HEADROOM and stay preferred. Deterministic stable reduce.
  const now = dayjs().valueOf()
  const picked = accounts.reduce((best, a) =>
    balancingHeadroom(a.subAccountId, kind, now) > balancingHeadroom(best.subAccountId, kind, now) ? a : best
  )
  sessionMap.set(sessionId, picked.subAccountId)
  return picked
}
