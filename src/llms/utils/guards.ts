/**
 * Runtime type guards shared across transformer modules.
 *
 * Consolidates the four copy-pasted `isObject` implementations that
 * previously lived next to their callers. The array-excluding form is
 * canonical here — arrays are `typeof === 'object'`, so a naive
 * `typeof x === 'object' && x !== null` guard lets them slip through
 * property lookups that assume a plain record shape.
 */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
