/**
 * Session-hash bucketing for the ROUTER_ROLLOUT_PCT gate (Phase 2e).
 *
 * A given session ID always lands in the same bucket, so a session
 * bucketed into the non-scenario mode stays there for its whole
 * lifetime. FNV-1a is chosen because it's tiny, dependency-free, and
 * fully deterministic (crypto hashes would work but are overkill).
 */

const FNV_OFFSET_32 = 0x811c_9dc5
const FNV_PRIME_32 = 0x0100_0193

// FNV-1a 32-bit. Bit ops in JS are 32-bit signed, so `>>> 0` at the end
// coerces the result to an unsigned int.
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_32
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME_32)
  }
  return hash >>> 0
}

// `true` when the session should be routed through the non-scenario
// mode. When `sessionId` is missing (e.g. a client that doesn't send
// x-claude-code-session-id), we deterministically bucket on the empty
// string — same session-less client → same bucket, no per-request
// flapping.
export function isSessionInRollout(sessionId: string | null | undefined, rolloutPct: number): boolean {
  if (rolloutPct >= 100) return true
  if (rolloutPct <= 0) return false
  const id = sessionId ?? ''
  const bucket = fnv1a32(id) % 100
  return bucket < rolloutPct
}
