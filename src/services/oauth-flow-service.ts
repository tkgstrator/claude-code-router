/**
 * In-memory state store + helpers for the Web-UI-initiated OAuth flow.
 *
 * The standalone code-grant + PKCE pattern needs two server-side
 * round-trips (initiate → user-agent redirect → callback) joined by a
 * single-use `state` token. We hold the per-flow secrets here (the
 * PKCE code_verifier, the redirect_uri we built, and a creation
 * timestamp) keyed by `state`; the callback consumes the entry on
 * lookup so a replay attempt sees nothing.
 *
 * Storage is process-memory for the PoC — survives the request, not
 * the dev-server restart. Move to the DB if multiple instances or
 * longer-lived flows show up.
 */

import { createHash, randomBytes } from 'node:crypto'

const FLOW_TTL_MS = 10 * 60_000
const FLOW_GC_THRESHOLD = 100

export interface PendingOAuthFlow {
  codeVerifier: string
  redirectUri: string
  provider: string
  createdAt: number
}

const pendingFlows = new Map<string, PendingOAuthFlow>()

const gcExpiredFlows = (now: number): void => {
  if (pendingFlows.size < FLOW_GC_THRESHOLD) return
  for (const [state, flow] of pendingFlows) {
    if (now - flow.createdAt > FLOW_TTL_MS) pendingFlows.delete(state)
  }
}

export const generatePkcePair = (): { codeVerifier: string; codeChallenge: string } => {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

// 32 bytes (43 chars base64url) — matches the length the official
// `claude login` produces. Anthropic's platform code-paste page may
// reject the shorter 16-byte variant on Authorize.
export const generateState = (): string => randomBytes(32).toString('base64url')

export const storePendingFlow = (state: string, flow: PendingOAuthFlow): void => {
  pendingFlows.set(state, flow)
  gcExpiredFlows(Date.now())
}

/**
 * One-shot read: returns the pending flow and deletes it from the
 * store. Returns null on miss (unknown state) or on TTL expiry.
 */
export const consumePendingFlow = (state: string): PendingOAuthFlow | null => {
  const flow = pendingFlows.get(state)
  if (!flow) return null
  pendingFlows.delete(state)
  if (Date.now() - flow.createdAt > FLOW_TTL_MS) return null
  return flow
}
