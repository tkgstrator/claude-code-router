/**
 * Typed JSONB narrowing helpers for `Provider.transformer`.
 *
 * `Provider.transformer` is JSONB — Prisma types it as `JsonValue`, the
 * schema types it as `Record<string, unknown> | undefined`. Both forms
 * narrow through one of these guards, so the rest of the config code
 * never has to reach for type assertions.
 */

export const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// Model names in a provider transformer's `_disabledModels` list.
export const disabledSet = (transformer: unknown): Set<string> => {
  if (!isJsonObject(transformer)) return new Set()
  const raw = transformer._disabledModels
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((v): v is string => typeof v === 'string'))
}
