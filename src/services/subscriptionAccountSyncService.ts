import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { getPrismaClient } from '../db/client'
import { AuthMode, type PrismaClient, type SubAccount } from '../generated/prisma/client'

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

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

const parseCredentialPaths = (raw: string | undefined, fallback: string): string[] => {
  if (!raw) return [fallback]
  const paths = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  return paths.length > 0 ? paths : [fallback]
}

const credentialPathsFromDir = async (dir: string | undefined): Promise<string[]> => {
  if (!dir || dir.trim().length === 0) return []
  try {
    const names = await readdir(dir)
    return names
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
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

const readClaudeAccount = async (path: string): Promise<DiscoveredAccount | null> => {
  const data = await readJson<{ claudeAiOauth?: Record<string, unknown> }>(path)
  const oauth = data?.claudeAiOauth
  if (!oauth) return null
  return {
    sourcePath: path,
    label: basename(path),
    userName: asStringOrNull((data as { user?: { name?: unknown } })?.user?.name),
    userEmail: asStringOrNull(
      (data as { user?: { email?: unknown }; email?: unknown })?.user?.email ?? (data as { email?: unknown })?.email
    ),
    userId: asStringOrNull(
      (data as { user?: { id?: unknown }; organizationUuid?: unknown })?.user?.id ??
        (data as { organizationUuid?: unknown })?.organizationUuid
    ),
    accountId: null,
    plan: asStringOrNull(oauth.subscriptionType),
    rateLimitTier: asStringOrNull(oauth.rateLimitTier),
    expiresAt: typeof oauth.expiresAt === 'number' ? new Date(oauth.expiresAt) : null,
    scopes: Array.isArray(oauth.scopes) ? (oauth.scopes as string[]) : null,
    accessToken: asStringOrNull(oauth.accessToken),
    refreshToken: asStringOrNull(oauth.refreshToken),
    idToken: null
  }
}

const readCodexAccount = async (path: string): Promise<DiscoveredAccount | null> => {
  const data = await readJson<{ tokens?: Record<string, unknown> }>(path)
  const tokens = data?.tokens ?? {}
  const idToken = asStringOrNull(tokens.id_token)
  const claims = idToken ? decodeJwtPayload(idToken) : null
  const auth = (claims?.['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
  const activeUntil = asStringOrNull(auth.chatgpt_subscription_active_until)
  return {
    sourcePath: path,
    label: basename(path),
    userName: asStringOrNull(claims?.name),
    userEmail: asStringOrNull(claims?.email),
    userId: asStringOrNull(claims?.sub) ?? asStringOrNull(tokens.user_id),
    accountId: asStringOrNull(tokens.account_id) ?? asStringOrNull(auth.chatgpt_account_id),
    plan: asStringOrNull(auth.chatgpt_plan_type),
    rateLimitTier: null,
    expiresAt: activeUntil ? new Date(activeUntil) : null,
    scopes: null,
    accessToken: asStringOrNull(tokens.access_token),
    refreshToken: asStringOrNull(tokens.refresh_token),
    idToken
  }
}

const discoverAccountsForBaseUrl = async (apiBaseUrl: string): Promise<DiscoveredAccount[]> => {
  if (apiBaseUrl.includes('anthropic.com')) {
    const fallback = join(homedir(), '.claude', '.credentials.json')
    const fromDir = await credentialPathsFromDir(process.env.CCR_CLAUDE_CREDENTIALS_DIR)
    const paths =
      fromDir.length > 0 ? fromDir : parseCredentialPaths(process.env.CCR_CLAUDE_CREDENTIALS_FILES, fallback)
    const out: DiscoveredAccount[] = []
    for (const path of paths) {
      const account = await readClaudeAccount(path)
      if (account) out.push(account)
    }
    return out
  }
  if (apiBaseUrl.includes('chatgpt.com') || apiBaseUrl.includes('openai.com/v1')) {
    const fallback = join(homedir(), '.codex', 'auth.json')
    const fromDir = await credentialPathsFromDir(process.env.CCR_CODEX_AUTH_DIR)
    const paths = fromDir.length > 0 ? fromDir : parseCredentialPaths(process.env.CCR_CODEX_AUTH_FILES, fallback)
    const out: DiscoveredAccount[] = []
    for (const path of paths) {
      const account = await readCodexAccount(path)
      if (account) out.push(account)
    }
    return out
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
