/**
 * Anthropic OAuth profile fetcher.
 *
 * `~/.claude/.credentials.json` only persists the OAuth tokens + the
 * subscription metadata that fits in the file (plan, rateLimitTier).
 * The user-facing identity (uuid, email, display name) lives behind the
 * OAuth-gated `/api/oauth/profile` endpoint instead. This helper pulls
 * that block so the SubAccount row + the UI can show "Logged in as
 * foo@bar.com" without depending on whichever optional `user` field
 * the CLI happened to write.
 *
 * Designed for the sync path: never throws. A network blip, an expired
 * token, or a schema drift on Anthropic's side all degrade to "no
 * profile data this pass" — the rest of the sync proceeds with whatever
 * the credentials file already supplied.
 */

import type { Logger } from 'pino'
import { type ClaudeOAuthProfile, ClaudeOAuthProfileSchema } from '@/schemas/wire/oauth'

const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'

export interface FetchClaudeProfileOptions {
  logger?: Logger
  /** Override for tests; defaults to `fetch`. */
  fetcher?: typeof fetch
  /**
   * Observe the HTTP status of the profile request (null on a network
   * throw). Lets the auth-health probe tell a definitive auth rejection
   * (401/403) apart from a transient blip that shouldn't flip an account
   * to "needs re-authentication".
   */
  onStatus?: (status: number | null) => void
}

export async function fetchClaudeProfile(
  accessToken: string,
  { logger, fetcher = fetch, onStatus }: FetchClaudeProfileOptions = {}
): Promise<ClaudeOAuthProfile | null> {
  let res: Response
  try {
    res = await fetcher(PROFILE_URL, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        accept: 'application/json'
      }
    })
  } catch (err) {
    logger?.warn({ err }, '[claude-profile] fetch threw')
    onStatus?.(null)
    return null
  }

  onStatus?.(res.status)
  if (!res.ok) {
    logger?.warn({ status: res.status }, '[claude-profile] non-200 response')
    return null
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch (err) {
    logger?.warn({ err }, '[claude-profile] response body was not JSON')
    return null
  }

  const parsed = ClaudeOAuthProfileSchema.safeParse(raw)
  if (!parsed.success) {
    logger?.warn(
      { issues: parsed.error.issues },
      '[claude-profile] response did not match expected schema — anthropic may have changed the wire shape'
    )
    return null
  }
  return parsed.data
}
