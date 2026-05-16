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

const readCodexCredentials = async (): Promise<CredentialFileShape | null> => {
  // Codex CLI credential shape: best-effort guess. Update once the real
  // file lands on disk so we can confirm the field names.
  const data = await readJson<Record<string, unknown>>(join(homedir(), '.codex', 'auth.json'))
  if (!data) return null
  const tokens = (data.tokens ?? data) as Record<string, unknown>
  return {
    plan: typeof tokens.plan === 'string' ? tokens.plan : null,
    rateLimitTier: typeof tokens.rateLimitTier === 'string' ? tokens.rateLimitTier : null,
    expiresAt: typeof tokens.expiresAt === 'number' ? tokens.expiresAt : null,
    scopes: Array.isArray(tokens.scopes) ? (tokens.scopes as string[]) : null
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
