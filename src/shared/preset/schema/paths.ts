/**
 * Field-path parsing and by-path assignment (supports arrays and
 * nesting), e.g. `Providers[0].name`.
 */

/**
 * Parse field path (supports arrays and nesting)
 * Example: Providers[0].name => ['Providers', '0', 'name']
 */
export function parseFieldPath(path: string): string[] {
  const regex = /(\w+)|\[(\d+)\]/g
  const parts: string[] = []
  let match: RegExpExecArray | null = regex.exec(path)

  while (match !== null) {
    parts.push(match[1] || match[2])
    match = regex.exec(path)
  }

  return parts
}

/**
 * Set value in object by field path
 */
export function setValueByPath(obj: any, path: string, value: any): void {
  const parts = parseFieldPath(path)
  const lastKey = parts.pop()!
  let current = obj

  for (const part of parts) {
    if (!(part in current)) {
      // Determine if it's an array or object
      const nextPart = parts[parts.indexOf(part) + 1]
      if (nextPart && /^\d+$/.test(nextPart)) {
        current[part] = []
      } else {
        current[part] = {}
      }
    }
    current = current[part]
  }

  current[lastKey] = value
}
