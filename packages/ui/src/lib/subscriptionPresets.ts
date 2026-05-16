import type { Provider } from '@/types'

export interface SubscriptionPreset {
  id: string
  label: string
  description: string
  apiBaseUrl: string
  availableModels: string[]
  defaultEnabledModels: string[]
  /** Vendor brand surfaced in the subscription hint (e.g. Anthropic, OpenAI). */
  vendor: string
  /** CLI name that mints the OAuth token (e.g. Claude, Codex). */
  cli: string
  /** Path where the server picks up the OAuth credentials at request time. */
  credentialsPath: string
}

export const SUBSCRIPTION_PRESETS: SubscriptionPreset[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Claude Pro / Max subscription via Claude CLI OAuth',
    apiBaseUrl: 'https://api.anthropic.com/v1/messages',
    availableModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    defaultEnabledModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    vendor: 'Anthropic',
    cli: 'Claude',
    credentialsPath: '~/.claude/.credentials.json'
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'ChatGPT subscription via Codex CLI OAuth',
    apiBaseUrl: 'https://chatgpt.com/backend-api/codex',
    availableModels: ['gpt-5-codex'],
    defaultEnabledModels: ['gpt-5-codex'],
    vendor: 'OpenAI',
    cli: 'Codex',
    credentialsPath: '~/.codex/auth.json'
  }
]

export const findSubscriptionPreset = (provider: { api_base_url: string }): SubscriptionPreset | undefined =>
  SUBSCRIPTION_PRESETS.find((p) => p.apiBaseUrl === provider.api_base_url)

export const buildSubscriptionProvider = (preset: SubscriptionPreset, name: string): Provider => ({
  name,
  api_base_url: preset.apiBaseUrl,
  api_key: '',
  auth_mode: 'subscription',
  models: [...preset.defaultEnabledModels]
})
