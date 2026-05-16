/**
 * Vendor-declared deprecated model ids.
 *
 * llm-prices.json (which we ship as a seed and refetch from upstream)
 * doesn't carry deprecation status, so we maintain it locally. Anything
 * listed here gets `Model.deprecated = true` when it first lands in the
 * DB (seed, model sync, or UI save), and the UI surfaces a badge so the
 * user knows to migrate off it.
 *
 * Source: https://developers.openai.com/api/docs/models/all
 * (cross-referenced 2026-05-16). Extend with other vendors as their
 * docs surface deprecation states.
 */

export const DEPRECATED_MODELS: ReadonlySet<string> = new Set([
  // openai — chat / completion
  'chatgpt-4o-latest',
  'gpt-3.5-turbo',
  'gpt-4-turbo',
  'gpt-4-turbo-preview',
  'gpt-4.1-nano',
  'gpt-4.5',
  'gpt-4.5-preview',
  'gpt-5-chat-latest',
  'gpt-5.1-chat-latest',
  // openai — reasoning / o-series
  'o1',
  'o1-mini',
  'o1-preview',
  'o1-pro',
  'o3-mini',
  'o4-mini',
  // openai — research
  'o3-deep-research',
  'o4-mini-deep-research',
  // openai — codex
  'codex-mini-latest',
  'gpt-5-codex',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2-codex',
  // openai — audio / realtime
  'gpt-4o-audio-preview',
  'gpt-4o-mini-audio-preview',
  'gpt-4o-mini-realtime-preview',
  'gpt-4o-mini-search-preview',
  'gpt-4o-search-preview',
  // openai — image / video
  'dall-e-2',
  'dall-e-3',
  'gpt-image-1',
  'sora-2',
  'sora-2-pro',
  // openai — misc legacy
  'babbage-002',
  'computer-use-preview',
  'davinci-002',
  'text-moderation-latest',
  'text-moderation-stable'
])

export const isDeprecatedModel = (modelName: string): boolean => DEPRECATED_MODELS.has(modelName)
