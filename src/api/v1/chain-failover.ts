/**
 * Fallback-chain walker with per-provider account rotation.
 *
 * For each model in the chain, `attemptChainEntry` runs the request
 * through the pipeline. On a 429:
 *   - If the failed call landed on a subscription provider AND we can
 *     identify the specific sub-account it used (via the sticky session
 *     map), `tryRotateAccount` marks just that account exhausted, drops
 *     the sticky, and re-runs the same chain entry — letting the
 *     session-account router pick a peer account on the next iteration.
 *   - Once the kind has no usable accounts left (or the failure wasn't
 *     subscription-related), the whole provider is marked exhausted and
 *     the walker advances to the next chain entry.
 *
 * Extracted from route.ts so the HTTP handler stays compact and the
 * cognitive-complexity budget isn't blown by the rotation logic.
 */

import type { Context } from 'hono'
import { type LlmsContext, subscriptionKindOf } from '../../llms'
import { isAccountExhausted, markAccountExhausted, markProviderExhausted } from '../../services/failover-state'
import { getActiveAccountForSession, releaseAccountForSession } from '../../services/session-account-router'
import {
  type AccountUsageMap,
  CLAUDE_METRICS,
  CODEX_METRICS,
  getPerAccountUsage,
  type Metric
} from '../../services/subaccount-usage-store'
import { getSubAccountTokensForKind } from '../../services/subscription-account-sync-service'
import { type ResolvedInvocation, type RoutePlan, resolveInvocationForModel } from './invocation'
import { forwardUpstreamError, isRateLimited } from './upstream-error'

// Hard cap on account rotations within a single chain entry. Each rotate
// already requires an inbound 429 + an account-exhaustion mark, so a
// healthy subscription with N accounts will at worst rotate N-1 times.
// The cap exists purely to bound the loop when something goes wrong
// (mark didn't take, accounts vanished mid-flight) — not a tuning knob.
const MAX_ACCOUNT_ROTATIONS = 10

// Provider view the kind sniffer needs; aliased from scenario-router's
// public ConfigProvider so the route layer builds the same minimal shape
// it would have built inline.
export type SubscriptionKindProvider = Parameters<typeof subscriptionKindOf>[1][number]

// Read the inbound session header the same way the OAuth transformer
// does so the reactive 429 path can look up which subAccountId the
// pipeline picked. Returns null when the client omitted it (request
// flows on the provider-level overlay path and there is no sticky
// mapping to invalidate).
export function sessionIdFrom(headers: Record<string, string>): string | null {
  const v = headers['x-claude-code-session-id']
  return typeof v === 'string' && v.length > 0 ? v : null
}

// Constant-for-the-request data the chain walker and its helpers all
// need. Bundled so the inner functions take one ChainCtx arg instead of
// re-listing the same six fields each.
export type ChainCtx = {
  c: Context
  ctx: LlmsContext
  plan: RoutePlan
  providers: SubscriptionKindProvider[]
  sessionId: string | null
  attempt: (inv: ResolvedInvocation) => Promise<Response>
  errorResponse: (c: Context, err: unknown) => Response
}

// Outcome of trying one fallback chain entry. `done` means surface this
// response immediately (success / forwardable non-rate-limit error /
// pipeline error). `next` means advance to the next chain entry; when
// the failure carried a forwardable rate-limit body, it's attached so
// the outer walker can return it after the whole chain is exhausted.
export type ChainEntryOutcome = { kind: 'done'; response: Response } | { kind: 'next'; forwarded: Response | null }

// Run one chain entry — including any account-level rotations within
// the same subscription provider — and report whether to return now or
// advance.
export async function attemptChainEntry(chain: ChainCtx, model: string): Promise<ChainEntryOutcome> {
  const { c, ctx, plan, attempt, errorResponse } = chain

  // Per-chain-entry account rotation state. A subscription provider can
  // carry multiple sub-accounts; a 5h rate-limit on one of them must
  // not knock out the whole provider while a peer account still has
  // capacity. `triedAccounts` guards against looping when an exhaustion
  // mark somehow doesn't take. The for-loop runs the initial attempt
  // plus at most MAX_ACCOUNT_ROTATIONS rotations.
  const triedAccounts = new Set<string>()
  let lastForwarded: Response | null = null

  for (let rotation = 0; rotation <= MAX_ACCOUNT_ROTATIONS; rotation++) {
    const inv = resolveInvocationForModel(plan, model, ctx)
    if (inv === null) return { kind: 'next', forwarded: lastForwarded }

    let err: unknown
    try {
      return { kind: 'done', response: await attempt(inv) }
    } catch (caught) {
      err = caught
    }

    const forwarded = forwardUpstreamError(err)
    if (!forwarded) {
      ctx.log.error({ err }, 'pipeline error')
      return { kind: 'done', response: errorResponse(c, err) }
    }

    // Non-rate-limit upstream errors (auth, bad request, ...) surface
    // verbatim — re-routing those would hide real problems.
    if (!isRateLimited(err)) return { kind: 'done', response: forwarded }

    lastForwarded = forwarded
    if (await tryRotateAccount(chain, inv, triedAccounts)) continue

    // Provider has no rotatable accounts left (or this isn't a
    // subscription provider): mark the provider exhausted and move on.
    markProviderExhausted(inv.provider.name)
    ctx.log.warn(
      { provider: inv.provider.name, model: inv.request.model, scenario: plan.scenarioType },
      'rate limited; failing over to next fallback model'
    )
    return { kind: 'next', forwarded: lastForwarded }
  }

  // Rotation cap tripped (defensive — only reachable if exhaustion marks
  // somehow stop deduplicating). Treat as provider-exhausted.
  return { kind: 'next', forwarded: lastForwarded }
}

// Always-binding windows per kind (mirrors session-account-router's
// HARD_LIMIT_METRICS — when a 429 fires, one of these windows is what
// the upstream is enforcing). Used to extract the earliest reset time
// from the DB row so the exhaustion mark naturally clears when the
// upstream window actually rolls.
const HARD_LIMIT_METRICS: Record<'claude' | 'codex', Metric[]> = {
  claude: [CLAUDE_METRICS.five_hour, CLAUDE_METRICS.seven_day, CLAUDE_METRICS.seven_day_opus],
  codex: [CODEX_METRICS.primary]
}

// Pick the earliest future resetAt from the windows known to be near or
// at limit. The 429 we just observed means at least one of them is
// pinned — that window's resetAt is when the account becomes usable
// again. Returns undefined when no eligible window has a future resetAt
// (DB row missing / stale across reset / upstream omitted), in which
// case the caller falls back to the default 5-min cooldown.
const earliestResetUntil = (usage: AccountUsageMap, kind: 'claude' | 'codex', now: number): number | undefined => {
  let earliest: number | undefined
  for (const metric of HARD_LIMIT_METRICS[kind]) {
    const w = usage.get(metric)
    if (!w || w.resetAt === null) continue
    const t = w.resetAt.valueOf()
    if (t <= now) continue
    // Only the windows likely responsible for the 429 — at or near limit.
    if (w.percent < 90) continue
    if (earliest === undefined || t < earliest) earliest = t
  }
  return earliest
}

// One rotation step: when the failed invocation landed on a subscription
// provider and we know which sub-account it used, mark that account
// exhausted, drop the session sticky, and check whether the kind still
// has a usable peer. Returns true when the caller should retry the same
// chain entry, false when there's nothing to rotate to.
async function tryRotateAccount(
  chain: ChainCtx,
  inv: ResolvedInvocation,
  triedAccounts: Set<string>
): Promise<boolean> {
  const { ctx, plan, providers, sessionId } = chain
  const kind = subscriptionKindOf(inv.provider.name, providers)
  if (kind === null || sessionId === null) return false

  const failedAcct = getActiveAccountForSession(sessionId)
  if (failedAcct === null || triedAccounts.has(failedAcct)) return false

  triedAccounts.add(failedAcct)
  // Pull the failed account's DB usage row so the exhaustion mark uses
  // the actual upstream resetAt (e.g. 47 minutes) rather than the
  // 5-minute default. This guarantees we don't re-probe the account
  // until its window genuinely rolls.
  const usageByAcct = await getPerAccountUsage([failedAcct])
  const usage = usageByAcct.get(failedAcct)
  const until = usage !== undefined ? earliestResetUntil(usage, kind, Date.now()) : undefined
  markAccountExhausted(failedAcct, until)
  releaseAccountForSession(sessionId, failedAcct)

  // Scope to `kind` (not the exact provider) because that mirrors what
  // the session-account router itself selects from.
  const tokens = await getSubAccountTokensForKind(kind)
  const anyUsable = tokens.some((t) => !isAccountExhausted(t.subAccountId))
  if (!anyUsable) return false

  ctx.log.warn(
    {
      provider: inv.provider.name,
      model: inv.request.model,
      scenario: plan.scenarioType,
      subAccountId: failedAcct,
      rotation: triedAccounts.size,
      exhaustedUntil: until ?? null
    },
    'rate limited on subscription account; rotating to peer account on same provider'
  )
  return true
}
