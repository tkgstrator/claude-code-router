/**
 * Subscription-account persistence — DB only.
 *
 * SubAccount rows are created and updated exclusively through the
 * web-UI OAuth flow:
 *   - claude: recordClaudeOAuthAccount({ accessToken, refreshToken,
 *     expiresAt, scopes }) — pulls the user's profile via
 *     fetchClaudeProfile and writes an encrypted row.
 *   - codex:  recordCodexOAuthAccount({ accessToken, refreshToken,
 *     idToken }) — decodes id_token claims for identity + plan info
 *     and writes an encrypted row.
 *
 * Tokens are AES-256-GCM-encrypted with the key derived from
 * `CCR_ACCOUNT_ENCRYPTION_KEY` (hex / base64 / passphrase, in that
 * preference order). Plain tokens never land on disk and never leave
 * memory after the upsert returns.
 *
 * getActiveSubAccountAuth(providerName) is the read path: decrypts and
 * returns the active SubAccount's tokens for use by the proxy.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getPrismaClient } from '../db/client'
import { AuthMode, type PrismaClient, type SubAccount } from '../generated/prisma/client'
import dayjs from '../lib/dayjs'
import { logger } from '../logger'
import { OauthRefreshResponseSchema } from '../schemas/llm-oauth.dto'
import type { DiscoveredAccount } from '../schemas/subscription.dto'
import { fetchClaudeProfile } from './claude-profile-service'

// `firstString(...candidates)` is the project's `??`-free idiom for
// "first non-empty string, else null".
const firstString = (...vs: Array<unknown>): string | null => {
  for (const v of vs) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

const stringOrNull = (v: unknown): string | null => firstString(v)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const padded = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
  } catch {
    return null
  }
}

const claimsAuthSection = (claims: Record<string, unknown> | null): Record<string, unknown> => {
  if (claims === null) return {}
  const raw = claims['https://api.openai.com/auth']
  if (isRecord(raw)) return raw
  return {}
}

const encryptionKey = (): Buffer => {
  const envValue = process.env.CCR_ACCOUNT_ENCRYPTION_KEY
  const raw = typeof envValue === 'string' ? envValue.trim() : ''
  if (!raw) {
    throw new Error('CCR_ACCOUNT_ENCRYPTION_KEY is required for SubAccount token encryption')
  }
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  try {
    const b = Buffer.from(raw, 'base64')
    if (b.length === 32) return b
  } catch {
    // ignore
  }
  return createHash('sha256').update(raw).digest()
}

const encryptString = (plain: string | null, key: Buffer): string | null => {
  if (!plain) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

export const decryptString = (enc: string | null, key: Buffer): string | null => {
  if (!enc) return null
  const parts = enc.split('.')
  if (parts.length !== 3) return null
  try {
    const iv = Buffer.from(parts[0], 'base64')
    const tag = Buffer.from(parts[1], 'base64')
    const body = Buffer.from(parts[2], 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

const pickActive = (current: SubAccount | null, accounts: DiscoveredAccount[]): DiscoveredAccount | null => {
  if (accounts.length === 0) return null
  if (current) {
    const match = accounts.find((a) => a.sourcePath === current.sourcePath)
    if (match) return match
  }
  const now = dayjs().valueOf()
  const fresh = accounts.find((a) => a.expiresAt === null || a.expiresAt.valueOf() > now)
  return fresh ? fresh : accounts[0]
}

// Identity key used to match a discovered account against an existing
// SubAccount row. Stable across the synthetic sourcePath churn we used
// to see when an OAuth login re-issued a path-bearing identifier.
type StableIdentity = string

const stableIdentityFor = (
  a: Pick<DiscoveredAccount | SubAccount, 'userId' | 'accountId' | 'sourcePath'>
): StableIdentity => a.userId ?? a.accountId ?? `path:${a.sourcePath}`

// Monthly USD prices for known subscription plan identifiers.
// Claude: derived from has_claude_max / has_claude_pro booleans combined
// with rate_limit_tier to distinguish Max 5x ($100) from Max 20x ($200).
// rate_limit_tier "default_claude_max_20x" identifies the $200 tier.
// Codex: derived from chatgpt_plan_type in the id_token JWT claims.
// Values reflect publicly-listed individual plan prices; team/enterprise
// plans are per-seat and left null since total cost isn't inferrable.
const CODEX_PLAN_PRICES: Record<string, number> = {
  plus: 20,
  pro: 200
}

const claudeMonthlyPrice = (
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

const codexMonthlyPrice = (planType: string | null): number | null => {
  if (!planType) return null
  return CODEX_PLAN_PRICES[planType.toLowerCase()] ?? null
}

const buildAccountPayload = (providerName: string, account: DiscoveredAccount, key: Buffer) => ({
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

const upsertAccount = async (
  prisma: PrismaClient,
  providerId: string,
  providerName: string,
  account: DiscoveredAccount,
  key: Buffer
): Promise<SubAccount> => {
  const existingRows = await prisma.subAccount.findMany({ where: { providerId } })
  const byIdentity = new Map(existingRows.map((a) => [stableIdentityFor(a), a]))
  const payload = buildAccountPayload(providerName, account, key)
  const existing = byIdentity.get(stableIdentityFor(account))
  if (existing) {
    return prisma.subAccount.update({
      where: { id: existing.id },
      data: { ...payload, sourcePath: account.sourcePath }
    })
  }
  return prisma.subAccount.create({
    data: { providerId, sourcePath: account.sourcePath, ...payload }
  })
}

// Set `activeSubscriptionAccountId` to the row we just upserted, unless
// the user has explicitly bound a (still-enabled) account already. The
// freshly-authed account is the most-recently-touched signal we have,
// and treating it as the new default mirrors what users expect after a
// successful Connect.
const ensureActiveAccount = async (prisma: PrismaClient, providerId: string, upsertedId: string): Promise<void> => {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    include: { activeSubscriptionAccount: true }
  })
  if (!provider) return
  const current = provider.activeSubscriptionAccount
  if (current && current.enabled) return
  await prisma.provider.update({
    where: { id: providerId },
    data: { activeSubscriptionAccountId: upsertedId }
  })
}

// Boot-time self-heal: pick up subscription providers whose active
// account is null (or points at a now-disabled row) and promote the
// oldest still-enabled account into the slot. Recovers DB state left
// over from the pre-fix toggle code path, which used to null the
// binding without choosing a successor.
export async function reconcileActiveSubAccounts(prisma: PrismaClient = getPrismaClient()): Promise<void> {
  const providers = await prisma.provider.findMany({
    where: { authMode: AuthMode.subscription },
    include: {
      activeSubscriptionAccount: true,
      subscriptionAccounts: { where: { enabled: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }
    }
  })
  for (const p of providers) {
    if (p.activeSubscriptionAccount?.enabled) continue
    const next = p.subscriptionAccounts[0]
    const nextId = next ? next.id : null
    // Already in the right shape: binding is null and there is no
    // candidate to promote — nothing to write.
    if (nextId === null && p.activeSubscriptionAccountId === null) continue
    await prisma.provider.update({
      where: { id: p.id },
      data: { activeSubscriptionAccountId: nextId }
    })
    if (nextId === null) {
      logger.info({ provider: p.name }, '[subaccount] reconcile: cleared stale active binding (no enabled candidate)')
    } else {
      logger.info(
        { provider: p.name, subAccountId: nextId },
        '[subaccount] reconcile: promoted enabled subaccount into orphaned active slot'
      )
    }
  }
}

const providersForKind = async (
  prisma: PrismaClient,
  kind: 'claude' | 'codex'
): Promise<{ id: string; name: string }[]> => {
  const all = await prisma.provider.findMany({
    where: { authMode: AuthMode.subscription },
    select: { id: true, name: true, apiBaseUrl: true }
  })
  return all.filter((p) => {
    if (kind === 'claude') return p.apiBaseUrl.includes('anthropic.com')
    return p.apiBaseUrl.includes('chatgpt.com') || p.apiBaseUrl.includes('openai.com/v1')
  })
}

// Build the in-memory shape we used to read from ~/.claude/.credentials.json,
// but sourced from the OAuth exchange + /api/oauth/profile.
const buildClaudeDiscoveredAccount = async (tokens: {
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

const buildCodexDiscoveredAccount = (tokens: {
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

const recordOAuthAccount = async (
  kind: 'claude' | 'codex',
  account: DiscoveredAccount,
  prisma: PrismaClient
): Promise<void> => {
  const key = encryptionKey()
  const providers = await providersForKind(prisma, kind)
  if (providers.length === 0) {
    logger.warn({ kind }, '[subaccount] no subscription provider matched; skipping upsert')
    return
  }
  for (const p of providers) {
    const row = await upsertAccount(prisma, p.id, p.name, account, key)
    await ensureActiveAccount(prisma, p.id, row.id)
  }
}

export const recordClaudeOAuthAccount = async (
  tokens: {
    accessToken: string
    refreshToken: string
    expiresAt: number | null
    scopes: string[]
  },
  prisma: PrismaClient = getPrismaClient()
): Promise<void> => {
  const account = await buildClaudeDiscoveredAccount(tokens)
  if (!account) return
  await recordOAuthAccount('claude', account, prisma)
}

export const recordCodexOAuthAccount = async (
  tokens: {
    accessToken: string
    refreshToken: string
    idToken: string
  },
  prisma: PrismaClient = getPrismaClient()
): Promise<void> => {
  const account = buildCodexDiscoveredAccount(tokens)
  if (!account) return
  await recordOAuthAccount('codex', account, prisma)
}

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

const CLAUDE_REFRESH_URL = 'https://platform.claude.com/v1/oauth/token'
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REFRESH_LEEWAY_MS = 5 * 60 * 1000

// Refresh the access token if it is expired or near expiry, persist the
// new grant to the DB, and return the usable token. Falls back to the
// original token on any error so callers always get something to try.
const ensureFreshClaudeToken = async (
  subAccountId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  key: Buffer,
  prisma: PrismaClient
): Promise<string> => {
  const needsRefresh = expiresAt === null || expiresAt.valueOf() - Date.now() <= REFRESH_LEEWAY_MS
  if (!needsRefresh || !refreshToken) return accessToken
  try {
    const res = await fetch(CLAUDE_REFRESH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID
      })
    })
    if (!res.ok) return accessToken
    const parsed = OauthRefreshResponseSchema.safeParse(await res.json())
    if (!parsed.success) return accessToken
    const { access_token, refresh_token, expires_in } = parsed.data
    const newExpiresAt = expires_in !== undefined ? new Date(Date.now() + expires_in * 1000) : null
    const newAccessEnc = encryptString(access_token, key)
    const newRefreshEnc = refresh_token ? encryptString(refresh_token, key) : undefined
    await prisma.subAccount.update({
      where: { id: subAccountId },
      data: {
        accessTokenEnc: newAccessEnc,
        ...(newRefreshEnc !== undefined ? { refreshTokenEnc: newRefreshEnc } : {}),
        expiresAt: newExpiresAt
      }
    })
    return access_token
  } catch {
    return accessToken
  }
}

// Re-fetch profile data for all SubAccounts and update the DB in-place.
// Claude: refreshes token first, then pulls /api/oauth/profile for name/plan/tier.
// Codex: calls wham/usage which returns the live plan_type; updates plan +
// monthlyPriceUsd in-place. The id_token JWT baked in at OAuth time is a
// static snapshot — wham/usage is the authoritative live source.
// Returns a count of rows updated / failed.
export async function syncSubAccountProfiles(
  prisma: PrismaClient = getPrismaClient()
): Promise<{ updated: number; failed: number }> {
  const key = encryptionKey()
  const claudeProviders = await providersForKind(prisma, 'claude')
  let updated = 0
  let failed = 0

  for (const p of claudeProviders) {
    const accounts = await prisma.subAccount.findMany({ where: { providerId: p.id } })
    for (const account of accounts) {
      const rawAccessToken = decryptString(account.accessTokenEnc, key)
      if (!rawAccessToken) continue
      const refreshToken = decryptString(account.refreshTokenEnc, key)
      const accessToken = await ensureFreshClaudeToken(
        account.id,
        rawAccessToken,
        refreshToken,
        account.expiresAt,
        key,
        prisma
      )
      const profile = await fetchClaudeProfile(accessToken, { logger })
      if (!profile) {
        failed++
        continue
      }
      await prisma.subAccount.update({
        where: { id: account.id },
        data: {
          userName: firstString(profile.account.full_name, profile.account.display_name),
          userEmail: firstString(profile.account.email),
          plan: firstString(profile.organization?.organization_type),
          rateLimitTier: firstString(profile.organization?.rate_limit_tier),
          monthlyPriceUsd: claudeMonthlyPrice(profile.account, profile.organization?.rate_limit_tier),
          lastSyncedAt: dayjs().toDate()
        }
      })
      updated++
    }
  }

  // Codex: call wham/usage for each account to get the live plan_type.
  const codexProviders = await providersForKind(prisma, 'codex')
  for (const p of codexProviders) {
    const accounts = await prisma.subAccount.findMany({ where: { providerId: p.id } })
    for (const account of accounts) {
      const accessToken = decryptString(account.accessTokenEnc, key)
      if (!accessToken) continue
      try {
        const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            ...(account.accountId ? { 'chatgpt-account-id': account.accountId } : {})
          }
        })
        if (!res.ok) {
          logger.warn({ status: res.status }, '[subaccount] codex wham/usage non-OK')
          failed++
          continue
        }
        const raw = (await res.json()) as Record<string, unknown>
        const planType = typeof raw.plan_type === 'string' && raw.plan_type.length > 0 ? raw.plan_type : null
        await prisma.subAccount.update({
          where: { id: account.id },
          data: {
            plan: planType ?? account.plan,
            monthlyPriceUsd: planType !== null ? codexMonthlyPrice(planType) : account.monthlyPriceUsd,
            lastSyncedAt: dayjs().toDate()
          }
        })
        updated++
      } catch (err) {
        logger.warn({ err }, '[subaccount] codex wham/usage threw')
        failed++
      }
    }
  }

  return { updated, failed }
}

// pickActive is unused outside this file now, but keep it exported for
// future per-test seeding; intentionally empty body otherwise.
export { pickActive }
