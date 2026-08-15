/**
 * Cross-provider peer expansion for the failover chain.
 *
 * When the operator enables `CROSS_PROVIDER_FALLBACK`, `expandChainWithPeers`
 * walks the pre-resolved chain (primary + explicit fallbacks) and, after
 * each entry, injects any peer entries with the SAME model name on OTHER
 * OpenAI-family providers (apiStyle openai_chat / openai_responses). Peers
 * already present in the explicit chain are skipped so the operator's
 * hand-picked order wins over the auto-injected one. Peers are ordered by
 * the quota-aware scheduler's published healthiness score (highest first)
 * so a 429 hops to the healthiest available substitute.
 *
 * Only OpenAI-family providers are considered because the user opted in
 * to that scope: Anthropic and Gemini wire formats aren't guaranteed to
 * carry the same model names as their OpenAI-shape peers, and the
 * transformer chain would need per-vendor knowledge the expander doesn't
 * have. Same-provider entries are also never treated as peers — that
 * lane is the existing intra-provider model failover.
 */

import type { ConfigProvider } from './types'

// Fallback score for a peer the scheduler has never rated: a middling
// 0.5 so it interleaves with average scored candidates rather than being
// pushed to either extreme. Named so the ??-alternative reads.
const NEUTRAL_HEALTHINESS = 0.5

const OPENAI_FAMILY_STYLES = new Set<'openai_chat' | 'openai_responses' | 'anthropic' | 'gemini'>([
  'openai_chat',
  'openai_responses'
])

// Resolve the effective apiStyle for a `(provider, model)` pair. The
// per-model override on `modelApiStyles` wins over the provider-level
// default so a codex-family model on an api_key `openai` provider is
// still recognised as openai_responses.
export function effectiveApiStyle(
  providerName: string,
  modelName: string,
  providers: readonly ConfigProvider[]
): 'openai_chat' | 'openai_responses' | 'anthropic' | 'gemini' | undefined {
  const provider = providers.find((p) => p.name === providerName)
  if (!provider) return undefined
  const perModel = provider.modelApiStyles?.[modelName]
  if (perModel !== undefined) return perModel
  return provider.api_style
}

// Whether a `(provider, model)` pair is OpenAI-family — the only scope
// the peer expander is authorised to substitute across.
function isOpenAiFamily(providerName: string, modelName: string, providers: readonly ConfigProvider[]): boolean {
  const style = effectiveApiStyle(providerName, modelName, providers)
  return style !== undefined && OPENAI_FAMILY_STYLES.has(style)
}

// Signature the scheduler snapshot satisfies (`snapshot.weights.get(target)?.healthiness`).
// Kept as a function type so tests can inject a plain Map lookup without
// pulling in the whole RoutingSnapshot type.
export type HealthinessLookup = (target: string) => number | undefined

// Sort peers by healthiness descending. Entries with no snapshot score
// (scheduler cold-start / mode = scenario / brand-new candidate) collapse
// to the neutral score so they interleave with "average" candidates
// instead of being pushed to the bottom or the top — probing them is
// still safe (the existing 429 walker skips them again on the next call).
function sortPeersByHealth(peers: readonly string[], lookup: HealthinessLookup): string[] {
  const scoreOf = (target: string): number => {
    const raw = lookup(target)
    return raw === undefined ? NEUTRAL_HEALTHINESS : raw
  }
  const scored = peers.map((target) => ({ target, score: scoreOf(target) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.target)
}

// Split a "provider,model" chain entry into its two parts. Returns null
// when the entry is malformed (no comma / empty model), so the walker
// can pass the entry through untouched instead of trying to expand it.
function parseChainEntry(entry: string): { providerName: string; modelName: string } | null {
  const [providerName, ...rest] = entry.split(',')
  const modelName = rest.join(',')
  if (!providerName || modelName.length === 0) return null
  return { providerName, modelName }
}

// Peer candidates for a `(providerName, modelName)` entry: every OTHER
// OpenAI-family provider that also lists the model, deduplicated
// against `seen` so we never inject a target the walker has already
// emitted (either as an explicit chain entry or as an earlier peer).
function collectPeerCandidates(
  providerName: string,
  modelName: string,
  providers: readonly ConfigProvider[],
  seen: ReadonlySet<string>
): string[] {
  const peers: string[] = []
  for (const peerProvider of providers) {
    if (peerProvider.name === providerName) continue
    const peerModels = peerProvider.models
    if (peerModels === undefined || !peerModels.includes(modelName)) continue
    if (!isOpenAiFamily(peerProvider.name, modelName, providers)) continue
    const peerTarget = `${peerProvider.name},${modelName}`
    if (seen.has(peerTarget)) continue
    peers.push(peerTarget)
  }
  return peers
}

export interface ExpandedChain {
  // Full ordered chain: [primary, ...explicitFallbacks-and-peers-interleaved].
  chain: readonly string[]
  // Targets injected by this expander (subset of `chain`). buildFailoverChain
  // uses this to bypass the auth_mode gate on peer-injected entries so a
  // subscription primary can hop to an api_key peer (user's explicit
  // opt-in via CROSS_PROVIDER_FALLBACK).
  peerTargets: ReadonlySet<string>
}

/**
 * Walk `[primary, ...explicitFallbacks]` and inject cross-provider peers
 * after each entry. Peers are:
 *   - `(otherProvider, sameModelName)` pairs
 *   - Restricted to OpenAI-family providers
 *   - Skipped when the peer is already in the explicit chain (dedup vs
 *     the union of explicit entries + peers already appended in earlier
 *     positions)
 *   - Ordered by `healthiness(peerTarget)` descending
 *
 * When `enabled === false` returns the explicit chain unchanged (no
 * allocations, no lookups). Pure — takes `providers` and the healthiness
 * lookup as inputs so unit tests can exercise every branch without a
 * running scheduler.
 */
export function expandChainWithPeers(
  primary: string,
  explicitFallbacks: readonly string[],
  providers: readonly ConfigProvider[],
  healthinessLookup: HealthinessLookup,
  enabled: boolean
): ExpandedChain {
  const explicitChain = [primary, ...explicitFallbacks]
  if (!enabled) return { chain: explicitChain, peerTargets: new Set() }

  const seen = new Set(explicitChain)
  const peerTargets = new Set<string>()
  const expanded: string[] = []

  for (const entry of explicitChain) {
    expanded.push(entry)
    const parts = parseChainEntry(entry)
    if (parts === null) continue
    // Only expand OpenAI-family entries — an Anthropic primary should not
    // pull in an OpenAI-family peer even if a model with the same name
    // exists there, since the wire formats differ.
    if (!isOpenAiFamily(parts.providerName, parts.modelName, providers)) continue

    const peers = collectPeerCandidates(parts.providerName, parts.modelName, providers, seen)
    if (peers.length === 0) continue

    for (const peer of sortPeersByHealth(peers, healthinessLookup)) {
      seen.add(peer)
      peerTargets.add(peer)
      expanded.push(peer)
    }
  }

  return { chain: expanded, peerTargets }
}
