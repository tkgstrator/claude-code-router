import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { composeUiConfig } from './configService'

export interface SubscriptionInfo {
  providerName: string
  plan: string | null
  rateLimitTier: string | null
  expiresAt: number | null
  scopes: string[] | null
}

interface CredentialFileShape {
  plan: string | null
  rateLimitTier: string | null
  expiresAt: number | null
  scopes: string[] | null
}

const readJson = async <T,>(path: string): Promise<T | null> => {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const readClaudeCredentials = async (): Promise<CredentialFileShape | null> => {
  const data = await readJson<{ claudeAiOauth?: Record<string, unknown> }>(
    join(homedir(), '.claude', '.credentials.json')
  )
  const oauth = data?.claudeAiOauth
  if (!oauth) return null
  return {
    plan: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null,
    rateLimitTier: typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : null,
    expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
    scopes: Array.isArray(oauth.scopes) ? (oauth.scopes as string[]) : null
  }
}

// Decode a JWT payload without verifying the signature — we only need
// the public claims and the file came from the user's own filesystem.
const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
  } catch {
    return null
  }
}

const readCodexCredentials = async (): Promise<CredentialFileShape | null> => {
  const data = await readJson<{ tokens?: { id_token?: string; access_token?: string }; OPENAI_API_KEY?: string | null }>(
    join(homedir(), '.codex', 'auth.json')
  )
  const idToken = data?.tokens?.id_token
  const claims = idToken ? decodeJwtPayload(idToken) : null
  const auth = (claims?.['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
  const activeUntil = typeof auth.chatgpt_subscription_active_until === 'string' ? auth.chatgpt_subscription_active_until : null
  return {
    plan: typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : null,
    rateLimitTier: null,
    expiresAt: activeUntil ? Date.parse(activeUntil) : null,
    scopes: null
  }
}

const credentialReaderForBaseUrl = (apiBaseUrl: string): (() => Promise<CredentialFileShape | null>) | null => {
  if (apiBaseUrl.includes('anthropic.com')) return readClaudeCredentials
  if (apiBaseUrl.includes('chatgpt.com') || apiBaseUrl.includes('openai.com/v1')) return readCodexCredentials
  return null
}

export const getSubscriptionsInfo = async (): Promise<SubscriptionInfo[]> => {
  const config = await composeUiConfig()
  const providers = Array.isArray(config?.Providers) ? config.Providers : []
  const subscriptions = providers.filter((p: { auth_mode?: string }) => p.auth_mode === 'subscription')
  const cache = new Map<string, CredentialFileShape | null>()
  const out: SubscriptionInfo[] = []
  for (const provider of subscriptions) {
    const apiBaseUrl = String((provider as { api_base_url: string }).api_base_url ?? '')
    const reader = credentialReaderForBaseUrl(apiBaseUrl)
    if (!cache.has(apiBaseUrl)) {
      cache.set(apiBaseUrl, reader ? await reader() : null)
    }
    const creds = cache.get(apiBaseUrl) ?? null
    out.push({
      providerName: String((provider as { name: string }).name ?? ''),
      plan: creds?.plan ?? null,
      rateLimitTier: creds?.rateLimitTier ?? null,
      expiresAt: creds?.expiresAt ?? null,
      scopes: creds?.scopes ?? null
    })
  }
  return out
}
