/**
 * Read path for the proxy: decrypt and hand back active SubAccount
 * tokens, plus the refresh-result writeback used after a token rotation.
 */

import { getPrismaClient } from '../../db/client'
import { AuthMode, type PrismaClient } from '../../generated/prisma/client'
import dayjs from '../../lib/dayjs'
import { decryptString, encryptionKey, encryptString } from './crypto'

export interface ActiveSubAccountAuth {
  subAccountId: string
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accountId: string | null
  expiresAt: Date | null
}

// Read path for the proxy: decrypt and return the active SubAccount's
// tokens for `providerName`. Returns null if no active account is bound
// or decryption fails. The subAccountId is needed so the caller can
// hand it back to updateSubAccountAccessToken after a refresh.
export async function getActiveSubAccountAuth(
  providerName: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<ActiveSubAccountAuth | null> {
  const provider = await prisma.provider.findUnique({
    where: { name: providerName },
    include: { activeSubscriptionAccount: true }
  })
  const active = provider?.activeSubscriptionAccount
  if (!active) return null
  const key = encryptionKey()
  return {
    subAccountId: active.id,
    accessToken: decryptString(active.accessTokenEnc, key),
    refreshToken: decryptString(active.refreshTokenEnc, key),
    idToken: decryptString(active.idTokenEnc, key),
    accountId: active.accountId,
    expiresAt: active.expiresAt
  }
}

// Refresh-result writeback: encrypt + persist a freshly-rotated token
// pair onto the named SubAccount. Used by transformer refresh code paths
// to keep the DB the single source of truth after a token grant rotation.
export async function updateSubAccountAccessToken(
  subAccountId: string,
  next: {
    accessToken: string
    refreshToken?: string | null
    expiresAt?: Date | null
  },
  prisma: PrismaClient = getPrismaClient()
): Promise<void> {
  const key = encryptionKey()
  const data: Record<string, unknown> = {
    accessTokenEnc: encryptString(next.accessToken, key),
    lastSyncedAt: dayjs().toDate()
  }
  if (typeof next.refreshToken === 'string' && next.refreshToken.length > 0) {
    data.refreshTokenEnc = encryptString(next.refreshToken, key)
  }
  if (next.expiresAt !== undefined) {
    data.expiresAt = next.expiresAt
  }
  await prisma.subAccount.update({ where: { id: subAccountId }, data })
}

export interface SubAccountTokenInfo {
  subAccountId: string
  displayName: string
  accessToken: string
  refreshToken: string | null
  accountId: string | null
  expiresAt: Date | null
}

// Return decrypted tokens for all enabled SubAccounts of the given
// vendor kind. Used by usage-service to poll per-account usage APIs
// without going through the proxy hot path.
export async function getSubAccountTokensForKind(
  kind: 'claude' | 'codex',
  prisma: PrismaClient = getPrismaClient()
): Promise<SubAccountTokenInfo[]> {
  const all = await prisma.provider.findMany({
    where: { authMode: AuthMode.subscription },
    include: { subscriptionAccounts: { where: { enabled: true } } }
  })
  const matched = all.filter((p) => {
    if (kind === 'claude') return p.apiBaseUrl.includes('anthropic.com')
    return p.apiBaseUrl.includes('chatgpt.com') || p.apiBaseUrl.includes('openai.com/v1')
  })
  const key = encryptionKey()
  const out: SubAccountTokenInfo[] = []
  for (const provider of matched) {
    for (const account of provider.subscriptionAccounts) {
      const accessToken = decryptString(account.accessTokenEnc, key)
      if (!accessToken) continue
      out.push({
        subAccountId: account.id,
        displayName: account.userName ?? account.userEmail ?? account.userId ?? 'Account',
        accessToken,
        refreshToken: decryptString(account.refreshTokenEnc, key),
        accountId: account.accountId,
        expiresAt: account.expiresAt
      })
    }
  }
  return out
}
