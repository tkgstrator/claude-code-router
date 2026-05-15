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
    models: [
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.3-codex',
      'gpt-5-mini',
      'o3',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4o',
      'gpt-4o-mini'
    ]
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

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPer1M: number
  /** USD per 1M output tokens */
  outputPer1M: number
}

/**
 * Base USD price per 1M tokens for the template models.
 *
 * Snapshot from a user-provided price list (2026-05-15) rather than a
 * runtime fetch — keeping it in-repo is consistent with dropping the
 * remote R2 dependency. Prices vary by context tier (e.g. GPT-5.4 at
 * 272k+ is more expensive); the base tier is used here. Treat as a
 * rough guide and refresh periodically. Models absent from the source
 * list (e.g. gpt-5.3-codex) have no entry and render as "—".
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-5.5': { inputPer1M: 5.0, outputPer1M: 30.0 },
  'gpt-5.5-pro': { inputPer1M: 30.0, outputPer1M: 180.0 },
  'gpt-5.4': { inputPer1M: 2.5, outputPer1M: 15.0 },
  'gpt-5.4-pro': { inputPer1M: 30.0, outputPer1M: 180.0 },
  'gpt-5.4-mini': { inputPer1M: 0.75, outputPer1M: 4.5 },
  'gpt-5.4-nano': { inputPer1M: 0.2, outputPer1M: 1.25 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2.0 },
  o3: { inputPer1M: 2.0, outputPer1M: 8.0 },
  'gpt-4.1': { inputPer1M: 2.0, outputPer1M: 8.0 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  // Anthropic
  'claude-opus-4-7': { inputPer1M: 5.0, outputPer1M: 25.0 },
  'claude-opus-4-6': { inputPer1M: 5.0, outputPer1M: 25.0 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-sonnet-4-5': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-haiku-4-5': { inputPer1M: 1.0, outputPer1M: 5.0 },
  // Google Gemini
  'gemini-3.1-pro-preview': { inputPer1M: 2.0, outputPer1M: 12.0 },
  'gemini-3-flash-preview': { inputPer1M: 0.5, outputPer1M: 3.0 },
  'gemini-3.1-flash-lite': { inputPer1M: 0.25, outputPer1M: 1.5 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.0 },
  'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.1, outputPer1M: 0.4 },
  // DeepSeek (chat/reasoner map to v4-flash non-thinking/thinking)
  'deepseek-v4-pro': { inputPer1M: 1.74, outputPer1M: 3.5 },
  'deepseek-v4-flash': { inputPer1M: 0.14, outputPer1M: 0.28 },
  'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
  'deepseek-reasoner': { inputPer1M: 0.14, outputPer1M: 0.28 }
}
