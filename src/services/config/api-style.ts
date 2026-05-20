/**
 * Per-provider and per-model request shape resolution. There is no
 * runtime fallback — every seeded provider gets a concrete `ApiStyle`
 * value written to the DB, and per-model overrides are explicit.
 */

import { ApiStyle } from '../../generated/prisma/client'

// Explicit per-provider request shape. No runtime fallback — every
// seeded provider gets a concrete value written to the DB.
export const apiStyleForVendor = (name: string): ApiStyle => {
  if (name === 'anthropic' || name.startsWith('claude-code')) return ApiStyle.anthropic
  if (name === 'google') return ApiStyle.gemini
  if (name === 'codex') return ApiStyle.openai_responses
  return ApiStyle.openai_chat
}

// Per-model override stored on Model.apiStyle. Codex-family models are
// Responses-only even when hosted under the regular (chat) openai
// provider, so they need an explicit endpoint stored on the row.
// Returns null when the model should inherit the provider's apiStyle.
export const modelApiStyleOverride = (modelName: string): ApiStyle | null =>
  /codex/i.test(modelName) ? ApiStyle.openai_responses : null
