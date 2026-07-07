/**
 * Proactive failover: weekly-usage guard + capability gate.
 *
 * Before sending, `applyProactiveFailover` walks [primary, ...fallbacks]
 * for the scenario and returns the first candidate whose provider has
 * headroom AND whose model can hold the request.
 */

import type { Logger } from 'pino'
import type { Router, ScenarioType } from '@/schemas'
import dayjs from '../../lib/dayjs'
import { isProviderExhausted, markProviderExhausted } from '../../services/failover-state'
import { getKindWindowHeadroom } from '../../services/usage-service'
import type { ConfigStore } from '../registry/config'
import type { ConfigProvider } from './types'

// Fallback over-target margin (percentage points) when the Router config
// does not specify weeklyDrainMarginPct (e.g. when candidateUsable is
// called from a unit test that does not stand up a ConfigStore). The
// runtime value is read from Router.weeklyDrainMarginPct (Phase 6 S5).
export const WEEKLY_DRAIN_MARGIN_PCT_DEFAULT = 0

// Provider shape the kind sniffer needs. Re-exported with the helper so
// callers in the route layer can build the same minimal ConfigProvider
// view from the live ConfigStore without depending on the full schema.
export type SubscriptionKindProvider = ConfigProvider

// Map a provider name to the subscription usage "kind" whose limit we can
// pre-empt, or null for api_key / non-subscription providers (they have
// no usage ceiling to read; their limits are handled reactively on 429).
// Mirrors the apiBaseUrl matching in subscription-account-sync-service.
// Exported so the reactive 429 path in the v1 route can use the same
// classification when rotating accounts within a subscription provider.
export function subscriptionKindOf(providerName: string, providers: ConfigProvider[]): 'claude' | 'codex' | null {
  const p = providers.find((x) => x.name === providerName)
  if (p?.auth_mode !== 'subscription') return null
  const url = typeof p.api_base_url === 'string' ? p.api_base_url : ''
  if (url.includes('anthropic.com')) return 'claude'
  if (url.includes('chatgpt.com') || url.includes('openai.com/v1')) return 'codex'
  return null
}

// Whether a subscription kind is over its weekly drain guard right now,
// reading the in-memory usage cache only (never fetches). The 5h /
// Codex-primary windows are SOFT (allowed to burst) and never trigger
// failover; only the weekly windows are HARD.
//
//   - claude: over when EITHER the 7d-Opus OR the overall 7d window is
//     over its linear drain target (7d-Opus protects the scarce Opus
//     quota; overall 7d protects Sonnet-heavy traffic).
//   - codex: over when the secondary (weekly-equivalent) window is over
//     target. The primary (short) window may burst. When secondary data
//     is absent the target is null and overTarget is false, so codex
//     stays usable — that is the intended conservative default.
//
// `marginPct` is the configured drain-target margin (Router.weeklyDrain-
// MarginPct). 0 means the guard trips exactly at the linear drain
// target; a positive value lets usage run that many points hot. resetAt
// is the earliest weekly reset among the over-target windows, so the
// failover exhaustion mark expires when the guarded window resets.
function weeklyGuard(
  kind: 'claude' | 'codex',
  now: number,
  marginPct: number
): { overLimit: boolean; resetAt: number | null } {
  if (kind === 'claude') {
    const opus = getKindWindowHeadroom('claude', 'seven_day_opus', now, marginPct)
    const overall = getKindWindowHeadroom('claude', 'seven_day', now, marginPct)
    const overLimit = opus.overTarget || overall.overTarget
    if (!overLimit) return { overLimit: false, resetAt: null }
    // Earliest reset among the windows that actually tripped the guard.
    const resets = [opus.overTarget ? opus.resetAt : null, overall.overTarget ? overall.resetAt : null].filter(
      (r): r is number => r !== null
    )
    return { overLimit: true, resetAt: resets.length > 0 ? Math.min(...resets) : null }
  }
  const secondary = getKindWindowHeadroom('codex', 'secondary', now, marginPct)
  if (!secondary.overTarget) return { overLimit: false, resetAt: null }
  return { overLimit: true, resetAt: secondary.resetAt }
}

// Whether a single chain candidate is usable right now. A subscription
// provider that is already exhausted, or whose cached weekly usage is
// over its linear drain target, is not usable — and an over-target one is
// marked exhausted here so the reactive path and later requests agree
// until its weekly window resets. The 5h / primary windows are allowed to
// burst and never trigger failover. Non-subscription providers are always
// usable (no usage ceiling to read; their limits are handled reactively
// on 429).
//
// `marginPct` defaults to 0 so tests / call sites without a Router
// config behave like the pre-S5 hardcoded constant. The runtime caller
// (applyProactiveFailover) reads the value from Router.weekly-
// DrainMarginPct (Phase 6 S5) so the policy is tunable without code.
//
// Exported for unit tests so the weekly-window guard can be driven with a
// seeded usage cache without standing up the full pipeline.
export function candidateUsable(
  providerName: string,
  providers: ConfigProvider[],
  marginPct: number = WEEKLY_DRAIN_MARGIN_PCT_DEFAULT
): boolean {
  if (isProviderExhausted(providerName)) return false
  const kind = subscriptionKindOf(providerName, providers)
  if (kind === null) return true
  const guard = weeklyGuard(kind, dayjs().valueOf(), marginPct)
  if (!guard.overLimit) return true
  markProviderExhausted(providerName, guard.resetAt !== null ? guard.resetAt : undefined)
  return false
}

// Capability gate: whether a "provider,model" candidate's model can hold
// a request of `tokenCount` tokens. When the provider declares a context
// window for that model AND the request exceeds it, the candidate is
// rejected (failover must never land on a model that cannot fit the
// request). When the model has no declared window the gate allows it —
// unknown window = allow, which is the conservative default that keeps
// pre-capability-gate behaviour intact.
function candidateFitsContext(candidate: string, tokenCount: number, providers: ConfigProvider[]): boolean {
  const [providerName, modelName] = candidate.split(',')
  if (!providerName || !modelName) return true
  const provider = providers.find((x) => x.name === providerName)
  const windows = provider?.modelContextWindows
  if (!windows) return true
  const limit = windows[modelName]
  if (typeof limit !== 'number') return true
  return tokenCount <= limit
}

/**
 * Proactive failover: before sending, walk [primary, ...fallbacks] for
 * the scenario and return the first candidate whose provider has
 * headroom AND whose model can hold the request. When every candidate
 * looks limited (or cannot fit) we keep the primary and let the upstream
 * / reactive 429 path take over.
 *
 * Exported for unit tests so the weekly-window guard and capability gate
 * can be exercised directly with a seeded usage cache and ConfigStore.
 */
export function applyProactiveFailover(
  primaryModel: string,
  scenarioType: ScenarioType,
  tokenCount: number,
  config: ConfigStore,
  log: Logger
): string {
  const fullRouter = config.get<Router>('Router')
  const configured = fullRouter?.fallbacks?.[scenarioType]
  if (!Array.isArray(configured) || configured.length === 0) return primaryModel

  // Phase 6 S5: read the drain-target margin from Router config so the
  // policy is tunable without redeploying. Falls back to the historical
  // 0 when the field is absent (unconfigured = no extra headroom).
  const marginPct =
    typeof fullRouter?.weeklyDrainMarginPct === 'number'
      ? fullRouter.weeklyDrainMarginPct
      : WEEKLY_DRAIN_MARGIN_PCT_DEFAULT
  const providers = config.get<ConfigProvider[]>('providers', [])

  // S6 observability: record each candidate the walker considered and
  // why it was rejected so the debug log captures the full chain
  // decision (not just the winning hop). Emitted only when the primary
  // is dropped — keeping the primary is the common path and would spam
  // the log otherwise.
  const trace: { candidate: string; reason: 'kept' | 'malformed' | 'rate-limited' | 'capability' }[] = []
  for (const candidate of [primaryModel, ...configured]) {
    const providerName = candidate.split(',')[0]
    if (!providerName) {
      trace.push({ candidate, reason: 'malformed' })
      continue
    }
    if (!candidateUsable(providerName, providers, marginPct)) {
      trace.push({ candidate, reason: 'rate-limited' })
      continue
    }
    // Capability gate: never fail over onto a model that cannot fit the
    // request — its window would 400 upstream. The primary is gated too
    // so a too-small primary is skipped in favour of a fitting fallback.
    if (!candidateFitsContext(candidate, tokenCount, providers)) {
      trace.push({ candidate, reason: 'capability' })
      continue
    }
    trace.push({ candidate, reason: 'kept' })
    if (candidate !== primaryModel) {
      log.info(
        { from: primaryModel, to: candidate, scenario: scenarioType, marginPct, tokenCount, trace },
        'proactive failover: primary near rate limit'
      )
    }
    return candidate
  }

  // Every candidate (primary + fallbacks) was rejected. Keep the
  // primary and let the upstream / reactive 429 path take over, but
  // surface the dead chain so the operator can see what was tried.
  log.warn(
    { primary: primaryModel, scenario: scenarioType, marginPct, tokenCount, trace },
    'proactive failover: all candidates rejected, keeping primary'
  )
  return primaryModel
}
