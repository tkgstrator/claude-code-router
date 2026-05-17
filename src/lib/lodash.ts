/**
 * Local re-implementation of lodash-es's `isPlainObject`, so we get the same
 * semantics without taking a dependency on lodash-es in this published package.
 *
 * Unlike lodash-es (which returns `boolean`), this is typed as a type guard so
 * call sites narrow to `Record<string, unknown>` and need no `as` assertion.
 *
 * Returns true only for objects whose constructor is `Object` (object literals,
 * `Object.create(null)`) — arrays, class instances, Error, Date, Map, etc. are
 * rejected, matching lodash-es behaviour exactly.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (Object.prototype.toString.call(value) !== '[object Object]') return false

  const proto = Object.getPrototypeOf(value)
  if (proto === null) return true

  const Ctor = Object.hasOwn(proto, 'constructor') && proto.constructor
  return (
    typeof Ctor === 'function' &&
    Ctor instanceof Ctor &&
    Function.prototype.toString.call(Ctor) === Function.prototype.toString.call(Object)
  )
}

/**
 * Recursively JSON.parse string values nested in an object/array tree (the
 * "nested JSON.parse" — not a lodash-es function; lodash-es has no JSON parser).
 * Strings that parse are walked again so doubly-stringified payloads unwrap;
 * strings that don't parse are kept as-is. Recursion terminates because a
 * non-JSON string eventually fails to parse.
 */
export function parseJsonDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return parseJsonDeep(JSON.parse(value))
    } catch {
      return value
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseJsonDeep(item))
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = parseJsonDeep(item)
    }
    return out
  }
  return value
}
