/**
 * Build the in-memory DiscoveredAccount shape from an OAuth token
 * exchange (Claude profile fetch / Codex id_token claims), plus the
 * identity + "which account is active" helpers used by the persist
 * layer.
 */

import type { SubAccount } from '../../generated/prisma/client'
import dayjs from '../../lib/dayjs'
import { logger } from '../../logger'
import type { DiscoveredAccount } from '../../schemas/subscription.dto'
import { fetchClaudeProfile } from '../claude-profile-service'
import { claimsAuthSection, decodeJwtPayload, encryptString, firstString, stringOrNull } from './crypto'
import { claudeMonthlyPrice, codexMonthlyPrice } from './pricing'

// Identity key used to match a discovered account against an existing
// SubAccount row. Stable across the synthetic sourcePath churn we used
// to see when an OAuth login re-issued a path-bearing identifier.
type StableIdentity = string

export const stableIdentityFor = (
  a: Pick<DiscoveredAccount | SubAccount, 'userId' | 'accountId' | 'sourcePath'>
): StableIdentity => a.userId ?? a.accountId ?? `path:${a.sourcePath}`

export const pickActive = (current: SubAccount | null, accounts: DiscoveredAccount[]): DiscoveredAccount | null => {
  if (accounts.length === 0) return null
  if (current) {
    const match = accounts.find((a) => a.sourcePath === current.sourcePath)
    if (match) return match
  }
  const now = dayjs().valueOf()
  const fresh = accounts.find((a) => a.expiresAt === null || a.expiresAt.valueOf() > now)
  return fresh ? fresh : accounts[0]
}

export const buildAccountPayload = (providerName: string, account: DiscoveredAccount, key: Buffer) => ({
  label: `${providerName}:${account.label}`,
  userName: account.userName,
  userEmail: account.userEmail,
  userId: account.userId,
  accountId: account.accountId,
  plan: account.plan,
  rateLimitTier: account.rateLimitTier,
  monthlyPriceUsd: account.monthlyPriceUsd,
  expiresAt: account.expiresAt,
  scopes: account.scopes,
  accessTokenEnc: encryptString(account.accessToken, key),
  refreshTokenEnc: encryptString(account.refreshToken, key),
  idTokenEnc: encryptString(account.idToken, key),
  lastSyncedAt: dayjs().toDate()
})

// Build the in-memory shape we used to read from ~/.claude/.credentials.json,
// but sourced from the OAuth exchange + /api/oauth/profile.
export const buildClaudeDiscoveredAccount = async (tokens: {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  scopes: string[]
}): Promise<DiscoveredAccount | null> => {
  const profile = await fetchClaudeProfile(tokens.accessToken, { logger })
  const userId = firstString(profile?.account.uuid)
  if (!userId) {
    logger.warn('[subaccount] claude oauth: profile did not return account.uuid; cannot derive stable identity')
    return null
  }
  const expiresAt = tokens.expiresAt !== null ? dayjs(tokens.expiresAt).toDate() : null
  return {
    sourcePath: `oauth:claude:${userId}`,
    label: 'web-oauth',
    userName: firstString(profile?.account.full_name, profile?.account.display_name),
    userEmail: firstString(profile?.account.email),
    userId,
    accountId: null,
    plan: firstString(profile?.organization?.organization_type),
    rateLimitTier: firstString(profile?.organization?.rate_limit_tier),
    monthlyPriceUsd: claudeMonthlyPrice(profile?.account ?? null, profile?.organization?.rate_limit_tier),
    expiresAt,
    scopes: tokens.scopes,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: null
  }
}

export const buildCodexDiscoveredAccount = (tokens: {
  accessToken: string
  refreshToken: string
  idToken: string
}): DiscoveredAccount | null => {
  const claims = decodeJwtPayload(tokens.idToken)
  if (!claims) {
    logger.warn('[subaccount] codex oauth: id_token claims could not be decoded')
    return null
  }
  const auth = claimsAuthSection(claims)
  const accountId = firstString(auth.chatgpt_account_id)
  const userId = firstString(claims.sub)
  if (!accountId && !userId) {
    logger.warn('[subaccount] codex oauth: id_token carried neither chatgpt_account_id nor sub')
    return null
  }
  const stable = accountId ?? userId
  const activeUntil = stringOrNull(auth.chatgpt_subscription_active_until)
  return {
    sourcePath: `oauth:codex:${stable}`,
    label: 'web-oauth',
    userName: stringOrNull(claims.name),
    userEmail: stringOrNull(claims.email),
    userId,
    accountId,
    plan: stringOrNull(auth.chatgpt_plan_type),
    rateLimitTier: null,
    monthlyPriceUsd: codexMonthlyPrice(stringOrNull(auth.chatgpt_plan_type)),
    expiresAt: activeUntil !== null ? dayjs(activeUntil).toDate() : null,
    scopes: [],
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken
  }
}
