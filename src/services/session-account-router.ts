/**
 * Routes subscription requests to a specific SubAccount based on the
 * inbound session ID.
 *
 * Decision pipeline (in order):
 *   1. Drop accounts the in-process exhaustion map has marked as
 *      reactively-failed (a recent 429 against that subAccountId).
 *   2. Drop accounts whose DB-recorded rate-limit state shows ANY
 *      always-binding window at or above 100% with `resetAt` still in
 *      the future. For claude that is the overall 7d window, the 7d
 *      Opus window, and the 5h window; for codex it is the primary
 *      window. Any of those at 100% guarantees an upstream 429, so we
 *      pre-empt to a peer account.
 *   3. From the surviving candidates, reuse the sticky-session mapping
 *      if it still points at one of them (prompt-cache continuity).
 *   4. Otherwise pick the account with the HIGHEST required burn rate
 *      on the scarce weekly window (claude: 7d Opus, codex: primary):
 *      pctRemaining / timeRemainingMs. Larger means more unspent quota
 *      relative to time until reset → most at risk of leaving quota on
 *      the table, so drain it first.
 *
 * If every account is filtered out by steps 1-2, the picker falls back
 * to the full list and returns the least-bad candidate so the request
 * still flows — returning null here would 401 the client, which is
 * strictly worse than letting the request go out and 429.
 *
 * The SubAccountUsage table the picker reads is upserted every 5 min by
 * the BullMQ usage-capture job (`recordPerAccountUsage`), so the DB is
 * the durable source of truth across server restarts and multiple
 * instances. The in-process sticky-session map is best-effort only and
 * is allowed to reset on restart.
 */

import dayjs from '../lib/dayjs'
import { isAccountExhausted } from './failover-state'
import {
  type AccountUsageMap,
  CLAUDE_METRICS,
  CODEX_METRICS,
  getPerAccountUsage,
  type Metric
} from './subaccount-usage-store'
import { getSubAccountTokensForKind, type SubAccountTokenInfo } from './subscription-account-sync-service'

// sessionId → subAccountId
const sessionMap = new Map<string, string>()

// Always-binding hard-limit windows per kind. Any of these at 100% with
// resetAt still in the future guarantees an upstream 429, so the picker
// must skip the account. Mirrors the constraints upstream actually
// enforces: claude charges the overall 7d, the 7d Opus tier, and the
// 5h rolling window simultaneously; codex enforces the primary window.
const HARD_LIMIT_METRICS: Record<'claude' | 'codex', Metric[]> = {
  claude: [CLAUDE_METRICS.five_hour, CLAUDE_METRICS.seven_day, CLAUDE_METRICS.seven_day_opus],
  codex: [CODEX_METRICS.primary]
}

// The scarce weekly window each kind balances on once hard limits are
// out of the way. Claude spreads on the 7d Opus window (most precious);
// codex uses primary because that is the only window with a stable
// resetAt the wire reliably returns.
const BALANCE_METRIC: Record<'claude' | 'codex', Metric> = {
  claude: CLAUDE_METRICS.seven_day_opus,
  codex: CODEX_METRICS.primary
}

// A never-polled account (no DB row yet), one whose balancing window
// has no resetAt, or one whose reset has already passed (DB row is
// stale across a reset) all read as MAXIMUM priority so they stay
// preferred. Mirrors the legacy "unknown = available" fallback.
const MAX_PRIORITY = Number.POSITIVE_INFINITY

// Whether the account has at least one always-binding window pinned at
// 100% with resetAt still in the future. The "future resetAt" guard is
// what makes a stale DB row self-heal: once the reset passes, the cache
// no longer blocks the account even before the next poller cycle
// rewrites it.
const accountHasHardLimitHit = (usage: AccountUsageMap, kind: 'claude' | 'codex', now: number): boolean => {
  for (const metric of HARD_LIMIT_METRICS[kind]) {
    const w = usage.get(metric)
    if (!w) continue
    if (w.percent < 100) continue
    if (w.resetAt !== null && w.resetAt.valueOf() <= now) continue
    return true
  }
  return false
}

// Cache-only required burn rate on the kind's scarce weekly window:
// pctRemaining / timeRemainingMs. Larger means the account has more
// unspent quota relative to the time it has left, so it's at greater
// risk of leaving quota on the table at reset — prefer it. Branches are
// explicit rather than nullish-coalesced so each "unknown" path is named.
const balancingScore = (usage: AccountUsageMap, kind: 'claude' | 'codex', now: number): number => {
  const w = usage.get(BALANCE_METRIC[kind])
  if (!w) return MAX_PRIORITY
  if (w.resetAt === null) return MAX_PRIORITY
  const timeRemainingMs = w.resetAt.valueOf() - now
  if (timeRemainingMs <= 0) return MAX_PRIORITY
  const pctRemaining = 100 - w.percent
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

  // Batch-read the per-account DB state up front so each account's
  // hard-limit check + balancing score consults a coherent snapshot
  // rather than re-querying the DB per account.
  const usageByAcct = await getPerAccountUsage(all.map((a) => a.subAccountId))

  // Drop accounts the reactive 429 path has marked exhausted. The mark
  // auto-evicts past its `until` deadline, so a once-failed account
  // returns to the candidate set automatically when its window resets.
  const notExhausted = all.filter((a) => !isAccountExhausted(a.subAccountId))

  // Drop accounts the DB says have a hard limit hit and a future
  // resetAt — those would 429 if we picked them.
  const usable = notExhausted.filter((a) => {
    const u = usageByAcct.get(a.subAccountId)
    return u !== undefined ? !accountHasHardLimitHit(u, kind, now) : true
  })

  // If both filters dropped every candidate, fall back to the full list
  // so the request still flows (the reactive 429 path will catch the
  // miss). Returning null here would 401 the client, which is strictly
  // worse than letting the request go out.
  const accounts = usable.length > 0 ? usable : notExhausted.length > 0 ? notExhausted : all

  if (accounts.length === 1) return accounts[0]

  const cached = sessionMap.get(sessionId)
  if (cached) {
    const found = accounts.find((a) => a.subAccountId === cached)
    if (found) return found
    // Previously-chosen account is no longer in the candidate set (either
    // disabled, reactively-exhausted, or DB-marked hard-limit). Repick —
    // and drop the sticky so a future request doesn't latch back onto the
    // dead choice on a stale read.
    sessionMap.delete(sessionId)
  }

  // Pick the account with the HIGHEST required burn rate on the scarce
  // weekly window. Score once up front so the reduce comparison stays
  // O(1) per step and can't see a different snapshot per iteration.
  const scored = accounts.map((a) => {
    const usage = usageByAcct.get(a.subAccountId)
    const score = usage !== undefined ? balancingScore(usage, kind, now) : MAX_PRIORITY
    return { account: a, score }
  })
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
