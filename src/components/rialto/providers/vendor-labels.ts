/**
 * Presentation names and ordering for catalog vendors.
 *
 * The catalog cannot supply either. `catalog-service.ts` seeds every
 * api_key vendor with `displayName: name`, so the wire carries the raw
 * slug (`moonshot-ai`, `xai`), and it returns entries sorted
 * `name.localeCompare(name)`, which buries the subscription seats among
 * the api_key vendors alphabetically. The mocks specify both the names and
 * the order, so this table records a design decision rather than inventing
 * one. Vendors the mocks do not name fall back to the catalog's own values.
 */
import type { CatalogEntry } from './types'

/**
 * Rail order. Subscription seats lead: they are the differentiated thing
 * Rialto offers, and an operator adding one should not have to scroll past
 * seven pay-as-you-go vendors to find it.
 */
const VENDOR_ORDER = [
  'claude-code',
  'codex',
  'gemini-cli',
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'groq',
  'openrouter',
  'custom'
]

const VENDOR_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  custom: 'Custom',
  minimax: 'MiniMax',
  mistral: 'Mistral AI',
  'moonshot-ai': 'Moonshot AI',
  qwen: 'Qwen',
  xai: 'xAI'
}

/**
 * Brand shown on the provider rail's second line. Distinct from the label
 * because a vendor's product name and its brand differ — Google's API-key
 * offering is "Google AI", but the company behind the row is "Google".
 */
const VENDOR_BRAND: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  'moonshot-ai': 'Moonshot',
  qwen: 'Qwen',
  xai: 'xAI'
}

const VENDOR_HINT: Record<string, string> = {
  'claude-code': 'Pro / Max via Claude CLI OAuth',
  codex: 'ChatGPT plan via Codex CLI OAuth',
  'gemini-cli': 'AI Pro / Ultra via Gemini CLI OAuth',
  anthropic: 'Pay-as-you-go API key',
  openai: 'Pay-as-you-go API key',
  google: 'AI Studio API key',
  deepseek: 'Pay-as-you-go API key',
  groq: 'OpenAI-compatible',
  openrouter: 'OpenAI-compatible aggregator',
  custom: 'Any OpenAI / Anthropic / Gemini-shaped endpoint'
}

/** Trust `displayName` only when the catalog gave it a value of its own. */
const catalogLabel = (name: string, displayName: string): string => (displayName === name ? name : displayName)

export function vendorLabel(name: string, displayName: string): string {
  const named = VENDOR_LABEL[name]
  return named === undefined ? catalogLabel(name, displayName) : named
}

export function vendorBrand(name: string, vendor: string): string {
  const named = VENDOR_BRAND[name]
  if (named !== undefined) return named
  // Subscription presets already carry a real brand ('Anthropic'); api_key
  // seeds set vendor to the slug, which is no better than the name.
  return catalogLabel(name, vendor)
}

export function vendorHint(entry: CatalogEntry): string {
  const named = VENDOR_HINT[entry.name]
  if (named !== undefined) return named
  if (entry.authMode !== 'subscription') return 'Pay-as-you-go API key'
  return entry.cli === null ? 'Subscription via browser OAuth' : `Subscription via ${entry.cli} OAuth`
}

const groupOf = (entry: CatalogEntry): number => (entry.authMode === 'subscription' ? 0 : 1)

const rankOf = (entry: CatalogEntry): number => {
  const i = VENDOR_ORDER.indexOf(entry.name)
  return i === -1 ? VENDOR_ORDER.length : i
}

/**
 * Subscription seats first, then the order the mock lays out, then
 * anything the mock does not name — alphabetically by its display label,
 * not by its slug, so `moonshot-ai` sorts under M.
 */
export function sortVendors(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) => {
    const byGroup = groupOf(a) - groupOf(b)
    if (byGroup !== 0) return byGroup
    const byRank = rankOf(a) - rankOf(b)
    if (byRank !== 0) return byRank
    return vendorLabel(a.name, a.displayName).localeCompare(vendorLabel(b.name, b.displayName))
  })
}
