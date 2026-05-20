import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { getPrismaClient } from '../db/client'
import { AuthMode, type PrismaClient, type SubAccount } from '../generated/prisma/client'
import dayjs from '../lib/dayjs'
import { logger } from '../logger'
import {
  ClaudeAccountEntrySchema,
  CodexAuthEntrySchema,
  CredentialFileShapeSchema,
  type DiscoveredAccount
} from '../schemas/subscription.dto'

// Narrow ENOENT (file simply absent) so the sync stays silent for
// not-yet-registered vendors and only surfaces real IO failures.
const isFileNotFound = (e: unknown): boolean => e instanceof Error && 'code' in e && e.code === 'ENOENT'

// `firstString(...candidates)` is the project's `??`-free idiom for
// "first non-empty string, else null" — used wherever the old code
// chained `a ?? b ?? null`. Each candidate is checked with the same
// typeof-string-and-non-empty guard so empty strings never leak.
const firstString = (...vs: Array<unknown>): string | null => {
  for (const v of vs) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

const stringOrNull = (v: unknown): string | null => firstString(v)

// Read + JSON.parse + shape-validate the credential file. Each
// failure mode (ENOENT, parse error, wrong top-level shape) returns
// the same empty-entries shape so callers don't branch on error
// kinds. ENOENT stays silent; real errors are warn-logged.
const safeReadText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf-8')
  } catch (e) {
    if (!isFileNotFound(e)) logger.warn({ path, err: e }, '[subaccount] credential file unreadable')
    return null
  }
}

const safeParseJson = (path: string, raw: string): unknown | null => {
  try {
    return JSON.parse(raw)
  } catch (e) {
    logger.warn({ path, err: e }, '[subaccount] credential file is not valid JSON')
    return null
  }
}

const readJsonEntries = async (path: string): Promise<{ entries: unknown[]; isArray: boolean }> => {
  const raw = await safeReadText(path)
  if (raw === null) return { entries: [], isArray: false }
  const json = safeParseJson(path, raw)
  if (json === null) return { entries: [], isArray: false }
  const parsed = CredentialFileShapeSchema.safeParse(json)
  if (!parsed.success) {
    logger.warn(
      { path, error: parsed.error.format() },
      '[subaccount] credential file must be an object or array of objects'
    )
    return { entries: [], isArray: false }
  }
  if (Array.isArray(parsed.data)) return { entries: parsed.data, isArray: true }
  return { entries: [parsed.data], isArray: false }
}

// SubAccount rows are upsert-keyed on (providerId, sourcePath), so
// multiple accounts sharing one physical file need disambiguating
// suffixes. Single-object files keep the bare path (no churn against
// existing rows); array entries get `<path>#<stableId|i<index>>`.
const entrySourcePath = (path: string, isArray: boolean, stableId: string | null, index: number): string => {
  if (!isArray) return path
  return `${path}#${stableId !== null ? stableId : `i${index}`}`
}

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

// Codex stuffs the subscription metadata into a custom JWT claim
// keyed by the OpenAI auth URL. We don't know its shape statically;
// narrow via a structural type guard at the boundary instead of
// `as`-casting.
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

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

const readClaudeAccounts = (path: string, entries: unknown[], isArray: boolean): DiscoveredAccount[] => {
  const out: DiscoveredAccount[] = []
  entries.forEach((entry, i) => {
    const parsed = ClaudeAccountEntrySchema.safeParse(entry)
    if (!parsed.success) {
      logger.warn({ path, index: i, error: parsed.error.format() }, '[subaccount] claude entry rejected by schema')
      return
    }
    const data = parsed.data
    const oauth = data.claudeAiOauth
    const userId = firstString(data.user?.id, data.organizationUuid)
    out.push({
      sourcePath: entrySourcePath(path, isArray, userId, i),
      label: basename(path),
      userName: firstString(data.user?.name),
      userEmail: firstString(data.user?.email, data.email),
      userId,
      accountId: null,
      plan: firstString(oauth.subscriptionType),
      rateLimitTier: firstString(oauth.rateLimitTier),
      expiresAt: typeof oauth.expiresAt === 'number' ? dayjs(oauth.expiresAt).toDate() : null,
      scopes: oauth.scopes,
      accessToken: firstString(oauth.accessToken),
      refreshToken: firstString(oauth.refreshToken),
      idToken: null
    })
  })
  return out
}

const readCodexAccounts = (path: string, entries: unknown[], isArray: boolean): DiscoveredAccount[] => {
  const out: DiscoveredAccount[] = []
  entries.forEach((entry, i) => {
    const parsed = CodexAuthEntrySchema.safeParse(entry)
    if (!parsed.success) {
      logger.warn({ path, index: i, error: parsed.error.format() }, '[subaccount] codex entry rejected by schema')
      return
    }
    const { tokens } = parsed.data
    const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null
    const auth = claimsAuthSection(claims)
    const activeUntil = stringOrNull(auth.chatgpt_subscription_active_until)
    const accountId = firstString(tokens.account_id, auth.chatgpt_account_id)
    out.push({
      sourcePath: entrySourcePath(path, isArray, accountId, i),
      label: basename(path),
      userName: stringOrNull(claims?.name),
      userEmail: stringOrNull(claims?.email),
      userId: firstString(claims?.sub, tokens.user_id),
      accountId,
      plan: stringOrNull(auth.chatgpt_plan_type),
      rateLimitTier: null,
      expiresAt: activeUntil !== null ? dayjs(activeUntil).toDate() : null,
      scopes: [],
      accessToken: firstString(tokens.access_token),
      refreshToken: firstString(tokens.refresh_token),
      idToken: firstString(tokens.id_token)
    })
  })
  return out
}

const discoverAccountsForBaseUrl = async (apiBaseUrl: string): Promise<DiscoveredAccount[]> => {
  if (apiBaseUrl.includes('anthropic.com')) {
    const dirEnv = process.env.CCR_CLAUDE_CREDENTIALS_DIR
    const dir = typeof dirEnv === 'string' ? dirEnv.trim() : ''
    const path = dir.length > 0 ? join(dir, '.credentials.json') : join(homedir(), '.claude', '.credentials.json')
    const { entries, isArray } = await readJsonEntries(path)
    return readClaudeAccounts(path, entries, isArray)
  }
  if (apiBaseUrl.includes('chatgpt.com') || apiBaseUrl.includes('openai.com/v1')) {
    const dirEnv = process.env.CCR_CODEX_AUTH_DIR
    const dir = typeof dirEnv === 'string' ? dirEnv.trim() : ''
    const path = dir.length > 0 ? join(dir, 'auth.json') : join(homedir(), '.codex', 'auth.json')
    const { entries, isArray } = await readJsonEntries(path)
    return readCodexAccounts(path, entries, isArray)
  }
  return []
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

// Upsert one discovered account into the DB. Extracted from
// syncSubAccountsToDb to keep that orchestrator under the cognitive
// complexity threshold and to share the create/update payload via
// a single object (no duplicated field lists).
const upsertDiscoveredAccount = async (
  prisma: PrismaClient,
  providerId: string,
  providerName: string,
  account: DiscoveredAccount,
  key: Buffer
): Promise<void> => {
  const payload = {
    label: `${providerName}:${account.label}`,
    userName: account.userName,
    userEmail: account.userEmail,
    userId: account.userId,
    accountId: account.accountId,
    plan: account.plan,
    rateLimitTier: account.rateLimitTier,
    expiresAt: account.expiresAt,
    scopes: account.scopes,
    accessTokenEnc: encryptString(account.accessToken, key),
    refreshTokenEnc: encryptString(account.refreshToken, key),
    idTokenEnc: encryptString(account.idToken, key),
    lastSyncedAt: dayjs().toDate()
  }
  await prisma.subAccount.upsert({
    where: { providerId_sourcePath: { providerId, sourcePath: account.sourcePath } },
    create: { providerId, sourcePath: account.sourcePath, ...payload },
    update: payload
  })
}

// Resolve which SubAccount row should be the provider's active one
// after a sync pass. Only enabled accounts are candidates; a
// disabled current-active is dropped so pickActive selects a fresh
// one from the enabled pool.
const resolveNextActiveId = (
  refreshed: { subscriptionAccounts: SubAccount[]; activeSubscriptionAccount: SubAccount | null },
  discovered: DiscoveredAccount[]
): string | null => {
  const enabledPaths = new Set(refreshed.subscriptionAccounts.filter((a) => a.enabled).map((a) => a.sourcePath))
  const enabledDiscovered = discovered.filter((a) => enabledPaths.has(a.sourcePath))
  const currentActive = refreshed.activeSubscriptionAccount
  const currentForPick = currentActive && enabledPaths.has(currentActive.sourcePath) ? currentActive : null
  const nextActive = pickActive(currentForPick, enabledDiscovered)
  if (nextActive === null) return null
  const row = refreshed.subscriptionAccounts.find((a) => a.sourcePath === nextActive.sourcePath)
  return row ? row.id : null
}

// Single provider's sync pass: prune deleted, upsert discovered,
// recompute active. Kept as its own async function so the top-level
// loop is a thin orchestrator that stays within the complexity
// budget.
const syncProvider = async (
  prisma: PrismaClient,
  provider: {
    id: string
    name: string
    apiBaseUrl: string
    subscriptionAccounts: SubAccount[]
    activeSubscriptionAccount: SubAccount | null
  },
  key: Buffer
): Promise<void> => {
  const discovered = await discoverAccountsForBaseUrl(provider.apiBaseUrl)
  const discoveredByPath = new Map(discovered.map((a) => [a.sourcePath, a]))

  for (const existing of provider.subscriptionAccounts) {
    if (!discoveredByPath.has(existing.sourcePath)) {
      await prisma.subAccount.delete({ where: { id: existing.id } })
    }
  }

  for (const account of discovered) {
    await upsertDiscoveredAccount(prisma, provider.id, provider.name, account, key)
  }

  const refreshed = await prisma.provider.findUnique({
    where: { id: provider.id },
    include: { activeSubscriptionAccount: true, subscriptionAccounts: true }
  })
  if (!refreshed) return
  const activeId = resolveNextActiveId(refreshed, discovered)
  await prisma.provider.update({
    where: { id: provider.id },
    data: { activeSubscriptionAccountId: activeId }
  })
}

export async function syncSubAccountsToDb(prisma: PrismaClient = getPrismaClient()): Promise<void> {
  const key = encryptionKey()
  const providers = await prisma.provider.findMany({
    where: { authMode: AuthMode.subscription },
    include: { activeSubscriptionAccount: true, subscriptionAccounts: true }
  })
  for (const provider of providers) {
    await syncProvider(prisma, provider, key)
  }
}

export async function getActiveSubAccountAuth(
  providerName: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<{
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accountId: string | null
} | null> {
  const provider = await prisma.provider.findUnique({
    where: { name: providerName },
    include: { activeSubscriptionAccount: true }
  })
  const active = provider?.activeSubscriptionAccount
  if (!active) return null
  const key = encryptionKey()
  return {
    accessToken: decryptString(active.accessTokenEnc, key),
    refreshToken: decryptString(active.refreshTokenEnc, key),
    idToken: decryptString(active.idTokenEnc, key),
    accountId: active.accountId
  }
}
