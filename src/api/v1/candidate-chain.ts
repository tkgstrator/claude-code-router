/**
 * The ordered list of "provider,model" candidates one request may
 * attempt, in the order it should attempt them.
 *
 * This builds the list; `chain-failover.ts` walks it (and handles the
 * per-provider account rotation that happens inside a single entry).
 */

import type { Provider } from '@/schemas'
import type { LlmsContext } from '../../llms'
import { isModelExhausted } from '../../services/failover-state'
import type { RoutePlan } from './route-plan'

const providerNameOf = (modelString: string): string => modelString.split(',')[0]
const modelNameOf = (modelString: string): string => modelString.split(',').slice(1).join(',')

// Ordered list of "provider,model" candidates for this request: the
// resolved primary first, then the pre-computed fallback chain. Skips
// candidates currently known to be rate-limited (by model or by
// provider), but never returns empty — if every candidate is exhausted
// we still try them (the window may have reset since we marked it).
//
// One filter gate remains on the fallback list:
//
//   auth_mode gate: when the primary is a subscription provider,
//   fallbacks are constrained to other subscription providers — a 429
//   on the user's "free seat" must not silently roll onto an api_key
//   provider that costs per-token.
//
// The same-provider gate that used to sit here has been removed: quota
// exhaustion is now tracked per (provider, model), so a different
// model on the same provider (Fable → Opus on the same Anthropic
// account, whose 5h/weekly windows are per-model) is a legitimate
// fallback target.
export function buildFailoverChain(plan: RoutePlan, ctx: LlmsContext): string[] {
  const fallbacks = plan.fallbacks

  const providers = ctx.config.get<Provider[]>('providers', [])
  const authModeByName = new Map(providers.map((p) => [p.name, p.auth_mode]))
  const primaryName = providerNameOf(plan.primaryModel)
  const primaryAuth = authModeByName.get(primaryName)

  const seen = new Set<string>()
  const ordered = [plan.primaryModel, ...fallbacks].filter((m) => {
    if (seen.has(m)) return false
    seen.add(m)
    if (m === plan.primaryModel) return true
    // Peer entries auto-injected by the cross-provider expander skip the
    // auth_mode gate: the user opted into cross-auth-mode failover when
    // they enabled CROSS_PROVIDER_FALLBACK, so a subscription primary
    // may hop to an api_key peer of the same model. Explicit fallbacks
    // still respect the gate below.
    if (plan.peerTargets.has(m)) return true
    const name = providerNameOf(m)
    // Same-mode fallbacks only when primary auth_mode is known.
    // Unknown-auth providers (e.g. typo'd fallback entries) pass through
    // and surface their own "provider not found" warn downstream.
    const auth = authModeByName.get(name)
    if (primaryAuth !== undefined && auth !== undefined && auth !== primaryAuth) return false
    return true
  })

  const live = ordered.filter((m) => !isModelExhausted(providerNameOf(m), modelNameOf(m)))
  return live.length > 0 ? live : ordered
}
