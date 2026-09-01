/**
 * The single place a Codex access token is checked for freshness and
 * rotated.
 *
 * Three independent readers hold Codex credentials — the proxy hot path
 * (CodexOauthTransformer), the profile-sync job, and the usage poller —
 * and they used to disagree: two had their own near-expiry refresh with
 * separate in-flight maps, the third never refreshed at all. Because the
 * refresh_token rotates, two of them refreshing at once left one holding
 * a dead token. Everything now funnels through
 * `ensureFreshCodexAccessToken`, which serialises per subAccountId via
 * the shared lock in ../oauth/refresh-lock.
 *
 * Freshness is decided from the access token's own `exp` claim first
 * (chatmock's `_should_refresh_access_token`), which is what makes this
 * correct on rows written before `SubAccount.expiresAt` meant "access
 * token expiry" for Codex — those rows carry a subscription end date
 * months out, and any check that trusted the column concluded an
 * hour-long token was fine.
 */

import type { PrismaClient } from '../../generated/prisma/client'
import dayjs from '../../lib/dayjs'
import { logger } from '../../logger'
import type { CodexRefreshResponse } from '../../schemas/wire/oauth'
import { withRefreshLock } from '../oauth/refresh-lock'
import { updateSubAccountAccessToken } from '../subscription-account-sync/read'
import { codexAccessTokenExpiry } from './claims'
import { refreshCodexToken } from './oauth'

// Refresh this far ahead of the stated expiry so a long-running request
// started right at the threshold doesn't 401 mid-flight.
const REFRESH_LEEWAY_MS = 5 * 60 * 1000

// Last-resort staleness bound for a token that states no expiry
// anywhere. Codex access tokens live an hour; chatmock uses the same
// 55-minute mark against its `last_refresh` stamp.
const STALE_AFTER_MS = 55 * 60 * 1000

// Fallback lifetime when a rotated grant states neither an `exp` claim
// nor `expires_in`.
const DEFAULT_TTL_SEC = 3600

export interface CodexTokenState {
  accessToken: string
  /** `SubAccount.expiresAt`, consulted only when the token has no `exp`. */
  expiresAt?: Date | null
  /** `SubAccount.lastSyncedAt`, the final fallback. */
  lastSyncedAt?: Date | null
}

/**
 * Whether the held access token should be rotated before use.
 *
 * Sources, in order of authority — the first one that answers wins:
 *   1. the token's own `exp` claim
 *   2. the stored `expiresAt` column
 *   3. `lastSyncedAt` + 55 minutes
 * With none of the three available we cannot tell, and refusing to
 * refresh is the safe answer: the request either succeeds or 401s, and
 * the 401 path already asks the user to re-authenticate.
 */
export const codexTokenNeedsRefresh = (state: CodexTokenState): boolean => {
  if (state.accessToken.length === 0) return true
  const now = dayjs().valueOf()

  const tokenExpiry = codexAccessTokenExpiry(state.accessToken)
  if (tokenExpiry !== null) return tokenExpiry.valueOf() - now <= REFRESH_LEEWAY_MS

  const stored = state.expiresAt
  if (stored) return stored.valueOf() - now <= REFRESH_LEEWAY_MS

  const synced = state.lastSyncedAt
  if (synced) return now - synced.valueOf() >= STALE_AFTER_MS

  return false
}

// Expiry to persist for a freshly-rotated grant. The new token's own
// `exp` is preferred over the endpoint's `expires_in` so the column and
// the token can never disagree.
const rotatedExpiry = (rotated: CodexRefreshResponse): Date => {
  const fromClaims = codexAccessTokenExpiry(rotated.access_token)
  if (fromClaims !== null) return fromClaims
  const expiresIn = typeof rotated.expires_in === 'number' ? rotated.expires_in : DEFAULT_TTL_SEC
  return dayjs().add(expiresIn, 'second').toDate()
}

export interface EnsureFreshCodexInput extends CodexTokenState {
  subAccountId: string
  refreshToken: string | null
}

/**
 * Return a usable Codex access token for `subAccountId`, rotating it
 * first when it is at or near expiry and persisting the new grant.
 *
 * Never throws: a failed rotation logs and falls back to the token we
 * already held, leaving the caller's own 401 handling (which flips
 * authStatus to `invalid`) as the signal that re-authentication is
 * genuinely required.
 */
export const ensureFreshCodexAccessToken = async (
  input: EnsureFreshCodexInput,
  prisma?: PrismaClient
): Promise<string> => {
  if (!codexTokenNeedsRefresh(input)) return input.accessToken

  const refreshToken = input.refreshToken
  if (refreshToken === null || refreshToken.length === 0) return input.accessToken

  return withRefreshLock(input.subAccountId, async () => {
    try {
      const rotated = await refreshCodexToken({ refreshToken })
      await updateSubAccountAccessToken(
        input.subAccountId,
        {
          accessToken: rotated.access_token,
          refreshToken: rotated.refresh_token,
          idToken: rotated.id_token,
          expiresAt: rotatedExpiry(rotated)
        },
        prisma
      )
      return rotated.access_token
    } catch (err) {
      // Rotation races and prisma-write faults used to be swallowed
      // here, so the only visible symptom was users re-importing
      // auth.json on every expiry. Keep the fallback, but never the
      // silence.
      logger.warn(
        { subAccountId: input.subAccountId, err },
        '[codex-auth] token refresh failed, falling back to the existing access token'
      )
      return input.accessToken
    }
  })
}
