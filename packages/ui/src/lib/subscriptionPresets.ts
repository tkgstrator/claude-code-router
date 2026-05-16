import type { Provider } from '@/types'

export interface SubscriptionPreset {
  id: string
  label: string
  description: string
  provider: Provider
}

export const SUBSCRIPTION_PRESETS: SubscriptionPreset[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Claude Pro / Max subscription via Claude CLI OAuth',
    provider: {
      name: 'claude-code',
      api_base_url: 'https://api.anthropic.com/v1/messages',
      api_key: '',
      auth_mode: 'subscription',
      models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']
    }
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'ChatGPT subscription via Codex CLI OAuth',
    provider: {
      name: 'codex',
      api_base_url: 'https://chatgpt.com/backend-api/codex',
      api_key: '',
      auth_mode: 'subscription',
      models: ['gpt-5-codex']
    }
  }
]
