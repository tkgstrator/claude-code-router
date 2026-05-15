import type { Provider } from '@/types'

/**
 * Built-in provider templates.
 *
 * Replaces the former remote fetch of a musistudio-managed Cloudflare R2
 * bucket (pub-*.r2.dev/providers.json) which shipped dozens of unused
 * third-party aggregator entries and was an uncontrolled external
 * dependency for this fork.
 *
 * Model lists are taken from each vendor's official documentation
 * (captured 2026-05-15). Newest models are listed first; legacy but
 * still-served models are kept so existing configs keep working.
 */
export const PROVIDER_TEMPLATES: Provider[] = [
  {
    name: 'openai',
    api_base_url: 'https://api.openai.com/v1/chat/completions',
    api_key: '',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-4o', 'gpt-4o-mini']
  },
  {
    name: 'anthropic',
    api_base_url: 'https://api.anthropic.com/v1/messages',
    api_key: '',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-sonnet-4-5']
  },
  {
    name: 'gemini',
    api_base_url: 'https://generativelanguage.googleapis.com/v1beta/models/',
    api_key: '',
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
    ],
    transformer: { use: ['gemini'] }
  },
  {
    name: 'deepseek',
    api_base_url: 'https://api.deepseek.com/chat/completions',
    api_key: '',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
    transformer: { use: ['deepseek'] }
  }
]
