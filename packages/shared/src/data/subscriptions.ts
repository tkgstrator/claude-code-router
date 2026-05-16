// Subscription provider presets. Shared between the server (which
// seeds these as Provider rows with authMode=subscription) and the UI
// (which uses the vendor / cli / credentialsPath fields for hints in
// the Add Subscription dialog and to look up plan info).

export interface SubscriptionPreset {
  /** Provider.name in the DB and the Router key. */
  id: string
  /** Display label in the Add Subscription picker. */
  label: string
  /** Hint shown in the picker. */
  description: string
  /** Provider.apiBaseUrl in the DB. */
  apiBaseUrl: string
  /** Master list of models the subscription exposes. */
  availableModels: string[]
  /** Subset that ships as enabled when a fresh provider is created. */
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
    availableModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'],
    defaultEnabledModels: ['gpt-5.5', 'gpt-5.3-codex'],
    vendor: 'OpenAI',
    cli: 'Codex',
    credentialsPath: '~/.codex/auth.json'
  }
]
