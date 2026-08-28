/**
 * Monthly USD prices for known subscription plan identifiers.
 * Claude: derived from has_claude_max / has_claude_pro booleans combined
 * with rate_limit_tier to distinguish Max 5x ($100) from Max 20x ($200).
 * rate_limit_tier "default_claude_max_20x" identifies the $200 tier.
 * Codex: derived from chatgpt_plan_type in the id_token JWT claims.
 * Values reflect publicly-listed individual plan prices; team/enterprise
 * plans are per-seat and left null since total cost isn't inferrable.
 */

const CODEX_PLAN_PRICES: Record<string, number> = {
  plus: 20,
  pro: 200
}

export const claudeMonthlyPrice = (
  profile: { has_claude_max?: boolean; has_claude_pro?: boolean } | null,
  rateLimitTier?: string | null
): number | null => {
  if (!profile) return null
  if (profile.has_claude_max) {
    return rateLimitTier?.includes('20x') ? 200 : 100
  }
  if (profile.has_claude_pro) return 20
  return null
}

export const codexMonthlyPrice = (planType: string | null): number | null => {
  if (!planType) return null
  return CODEX_PLAN_PRICES[planType.toLowerCase()] ?? null
}

// Capacity multiplier for cross-account budget aggregation.
// Claude quotas scale as Pro:Max:Max20 = 1:5:20; the router weights each
// account's remaining-budget ratio by this factor when averaging so a
// large account's headroom counts proportionally more than a small one's.
// rateLimitTier is the definitive signal — the "20x" fragment appears
// exclusively on Max 20x organizations. The plan string ("pro" comes from
// Anthropic's organization_type, Codex uses "plus"/"pro") disambiguates
// the remaining tiers. Codex ratios aren't publicly enumerated, so both
// its tiers fall through to the default 1 — a Codex operator with mixed
// accounts gets a plain average, which is still strictly better than
// the previous "single account wins" behaviour.
export const planCapacityWeight = (plan: string | null, rateLimitTier: string | null): number => {
  if (rateLimitTier?.toLowerCase().includes('20x')) return 20
  if (plan?.toLowerCase().includes('max')) return 5
  return 1
}
