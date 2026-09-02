import type { Provider } from '@/types'

// Pure state-transition helper behind the Providers screen's model
// switches. Takes the in-progress `Provider` draft and returns the next
// draft, so the screen's handlers stay thin wrappers around setState.
//
// This module used to carry the whole provider edit dialog: field edits,
// model add/remove, and the transformer picker / options editors. The
// dialog went with the Phase 5 UI rebuild and the transformer chain is no
// longer configurable at all (`shared/transformer-chain.ts` derives it),
// so only the model toggle is left.

export function setModelDisabled(provider: Provider, model: string, disabled: boolean): Provider {
  const updatedProvider = { ...provider }
  const transformer: Record<string, unknown> = { ...(updatedProvider.transformer ? updatedProvider.transformer : {}) }
  const raw = transformer._disabledModels
  const current = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : []
  const next = (() => {
    if (disabled) {
      return current.includes(model) ? current : [...current, model]
    }
    return current.filter((m) => m !== model)
  })()
  if (next.length === 0) {
    delete transformer._disabledModels
  } else {
    transformer._disabledModels = next
  }
  updatedProvider.transformer = transformer
  return updatedProvider
}
