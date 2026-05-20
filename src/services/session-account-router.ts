/**
 * Routes subscription requests to a specific SubAccount based on the
 * inbound session ID.
 *
 * Strategy:
 *   - Known session  → reuse the same account (prompt-cache efficiency)
 *   - Unknown session → pick the account with the lowest current usage %
 *                       and record the mapping for this session
 *
 * The map is in-process only; it resets on server restart, which is fine
 * — sessions restart too, so cache continuity is already broken there.
 */

import { getSubAccountTokensForKind, type SubAccountTokenInfo } from './subscription-account-sync-service'
import { getCachedUsagePct } from './usage-service'

// sessionId → subAccountId
const sessionMap = new Map<string, string>()

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

  // Pick the account with the most headroom (lowest usage %).
  // Accounts with no cached data are treated as 0% used.
  const picked = accounts.reduce((best, a) =>
    getCachedUsagePct(a.subAccountId, kind) < getCachedUsagePct(best.subAccountId, kind) ? a : best
  )
  sessionMap.set(sessionId, picked.subAccountId)
  return picked
}
