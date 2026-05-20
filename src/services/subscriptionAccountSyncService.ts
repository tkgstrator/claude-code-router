import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { getPrismaClient } from '../db/client'
import { AuthMode, type PrismaClient, type SubAccount } from '../generated/prisma/client'
import { logger } from '../lib/logger'

// File-level validators for vendor credential files. We're lenient
// about unknown keys (vendors add fields over time) but strict about
// the discriminating shape — Codex must carry tokens with at least
// one of access_token / id_token, and Claude must carry the
// claudeAiOauth block. An entry that fails validation is skipped
// (with a warn log) instead of taking down the whole sync.
const CodexTokensSchema = z
  .object({
    access_token: z.string().min(1).optional(),
    refresh_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
    account_id: z.string().min(1).optional(),
    user_id: z.string().min(1).optional()
  })
  .refine((t) => Boolean(t.access_token) || Boolean(t.id_token), {
    message: 'tokens must include access_token or id_token'
  })

const CodexAuthEntrySchema = z.object({ tokens: CodexTokensSchema })

const ClaudeOAuthSchema = z.object({
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().optional(),
  scopes: z.array(z.string()).optional(),
  subscriptionType: z.string().optional(),
  rateLimitTier: z.string().optional()
})

const ClaudeAccountEntrySchema = z.object({
  claudeAiOauth: ClaudeOAuthSchema,
  user: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      id: z.string().optional()
    })
    .optional(),
  email: z.string().optional(),
  organizationUuid: z.string().optional()
})

type DiscoveredAccount = {
  sourcePath: string
  label: string
  userName: string | null
  userEmail: string | null
  userId: string | null
  accountId: string | null
  plan: string | null
  rateLimitTier: string | null
  expiresAt: Date | null
  scopes: string[] | null
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
}

// Each vendor file is read as either a single account object or an
// array of them. Array form is how operators express multiple accounts
// in one file; single-object form is the original Codex / Claude CLI
// layout and stays as-is for backward compatibility. `isArray` is
// returned so callers can keep single-object sourcePaths bare while
// suffixing array entries to disambiguate them inside the DB upsert
// key.
const CredentialFileShapeSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())])

const isFileNotFound = (e: unknown): boolean => e instanceof Error && 'code' in e && e.code === 'ENOENT'

const readJsonEntries = async (path: string): Promise<{ entries: unknown[]; isArray: boolean }> => {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (e) {
    // A missing file is normal — the operator hasn't logged in with
    // the vendor CLI yet — and must not warn on every sync. Real read
    // errors (permission, IO) are still worth surfacing.
    if (!isFileNotFound(e)) logger.warn({ path, err: e }, '[subaccount] credential file unreadable')
    return { entries: [], isArray: false }
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    logger.warn({ path, err: e }, '[subaccount] credential file is not valid JSON')
    return { entries: [], isArray: false }
  }
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
  return `${path}#${stableId ?? `i${index}`}`
}

const asStringOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

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

const encryptionKey = (): Buffer => {
  const raw = (process.env.CCR_ACCOUNT_ENCRYPTION_KEY ?? '').trim()
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
    const userId = data.user?.id ?? data.organizationUuid ?? null
    out.push({
      sourcePath: entrySourcePath(path, isArray, userId, i),
      label: basename(path),
      userName: data.user?.name ?? null,
      userEmail: data.user?.email ?? data.email ?? null,
      userId,
      accountId: null,
      plan: oauth.subscriptionType ?? null,
      rateLimitTier: oauth.rateLimitTier ?? null,
      expiresAt: typeof oauth.expiresAt === 'number' ? new Date(oauth.expiresAt) : null,
      scopes: oauth.scopes ?? null,
      accessToken: oauth.accessToken ?? null,
      refreshToken: oauth.refreshToken ?? null,
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
    const auth = (claims?.['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
    const activeUntil = asStringOrNull(auth.chatgpt_subscription_active_until)
    const accountId = tokens.account_id ?? asStringOrNull(auth.chatgpt_account_id)
    out.push({
      sourcePath: entrySourcePath(path, isArray, accountId, i),
      label: basename(path),
      userName: asStringOrNull(claims?.name),
      userEmail: asStringOrNull(claims?.email),
      userId: asStringOrNull(claims?.sub) ?? tokens.user_id ?? null,
      accountId,
      plan: asStringOrNull(auth.chatgpt_plan_type),
      rateLimitTier: null,
      expiresAt: activeUntil ? new Date(activeUntil) : null,
      scopes: null,
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      idToken: tokens.id_token ?? null
    })
  })
  return out
}

const discoverAccountsForBaseUrl = async (apiBaseUrl: string): Promise<DiscoveredAccount[]> => {
  if (apiBaseUrl.includes('anthropic.com')) {
    const dir = process.env.CCR_CLAUDE_CREDENTIALS_DIR?.trim()
    const path =
      dir && dir.length > 0 ? join(dir, '.credentials.json') : join(homedir(), '.claude', '.credentials.json')
    const { entries, isArray } = await readJsonEntries(path)
    return readClaudeAccounts(path, entries, isArray)
  }
  if (apiBaseUrl.includes('chatgpt.com') || apiBaseUrl.includes('openai.com/v1')) {
    const dir = process.env.CCR_CODEX_AUTH_DIR?.trim()
    const path = dir && dir.length > 0 ? join(dir, 'auth.json') : join(homedir(), '.codex', 'auth.json')
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
  const now = Date.now()
  return accounts.find((a) => a.expiresAt === null || a.expiresAt.valueOf() > now) ?? accounts[0]
}

export async function syncSubAccountsToDb(prisma: PrismaClient = getPrismaClient()): Promise<void> {
  const key = encryptionKey()
  const providers = await prisma.provider.findMany({
    where: { authMode: AuthMode.subscription },
    include: { activeSubscriptionAccount: true, subscriptionAccounts: true }
  })
  for (const provider of providers) {
    const discovered = await discoverAccountsForBaseUrl(provider.apiBaseUrl)
    const discoveredByPath = new Map(discovered.map((a) => [a.sourcePath, a]))

    for (const existing of provider.subscriptionAccounts) {
      if (!discoveredByPath.has(existing.sourcePath)) {
        await prisma.subAccount.delete({ where: { id: existing.id } })
      }
    }

    for (const account of discovered) {
      await prisma.subAccount.upsert({
        where: { providerId_sourcePath: { providerId: provider.id, sourcePath: account.sourcePath } },
        create: {
          providerId: provider.id,
          sourcePath: account.sourcePath,
          label: `${provider.name}:${account.label}`,
          userName: account.userName,
          userEmail: account.userEmail,
          userId: account.userId,
          accountId: account.accountId,
          plan: account.plan,
          rateLimitTier: account.rateLimitTier,
          expiresAt: account.expiresAt,
          scopes: account.scopes as unknown as undefined,
          accessTokenEnc: encryptString(account.accessToken, key),
          refreshTokenEnc: encryptString(account.refreshToken, key),
          idTokenEnc: encryptString(account.idToken, key),
          lastSyncedAt: new Date()
        },
        update: {
          label: `${provider.name}:${account.label}`,
          userName: account.userName,
          userEmail: account.userEmail,
          userId: account.userId,
          accountId: account.accountId,
          plan: account.plan,
          rateLimitTier: account.rateLimitTier,
          expiresAt: account.expiresAt,
          scopes: account.scopes as unknown as undefined,
          accessTokenEnc: encryptString(account.accessToken, key),
          refreshTokenEnc: encryptString(account.refreshToken, key),
          idTokenEnc: encryptString(account.idToken, key),
          lastSyncedAt: new Date()
        }
      })
    }

    const refreshed = await prisma.provider.findUnique({
      where: { id: provider.id },
      include: { activeSubscriptionAccount: true, subscriptionAccounts: true }
    })
    if (!refreshed) continue
    // Only enabled accounts are candidates for the active slot. A
    // disabled current-active is dropped so pickActive selects a fresh
    // one from the enabled pool.
    const enabledPaths = new Set(refreshed.subscriptionAccounts.filter((a) => a.enabled).map((a) => a.sourcePath))
    const enabledDiscovered = discovered.filter((a) => enabledPaths.has(a.sourcePath))
    const currentForPick =
      refreshed.activeSubscriptionAccount && enabledPaths.has(refreshed.activeSubscriptionAccount.sourcePath)
        ? refreshed.activeSubscriptionAccount
        : null
    const nextActive = pickActive(currentForPick, enabledDiscovered)
    const activeId =
      nextActive === null
        ? null
        : (refreshed.subscriptionAccounts.find((a) => a.sourcePath === nextActive.sourcePath)?.id ?? null)
    await prisma.provider.update({
      where: { id: provider.id },
      data: { activeSubscriptionAccountId: activeId }
    })
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
