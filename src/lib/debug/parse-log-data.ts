// Prefill the debug request form from a `?logData=` query param: a
// URI-encoded JSON blob describing a captured request. Different call
// sites (request history rows, error logs) don't all use the same field
// names, hence the several accepted variants below.

export interface ParsedLogData {
  url: string
  method: string
  headers: Record<string, unknown>
  body: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined
  const value = Reflect.get(source, key)
  return typeof value === 'string' ? value : undefined
}

// First non-empty candidate, else the last (always-defined) one — the
// explicit-ternary equivalent of `a || b || 'fallback'`.
function firstNonEmpty(...values: Array<string | undefined>): string {
  const found = values.find((v) => v !== undefined && v.length > 0)
  return found ? found : ''
}

// Headers arrive as a JSON string, a raw "Key: Value" per-line string, or
// an already-parsed object.
function resolveHeaders(rawHeaders: unknown): Record<string, unknown> {
  if (!rawHeaders) {
    return {}
  }
  if (typeof rawHeaders === 'string') {
    try {
      return JSON.parse(rawHeaders)
    } catch {
      return rawHeaders.split('\n').reduce<Record<string, string>>((headers, line) => {
        const [key, ...values] = line.split(':')
        if (key && values.length > 0) {
          headers[key.trim()] = values.join(':').trim()
        }
        return headers
      }, {})
    }
  }
  return isRecord(rawHeaders) ? rawHeaders : {}
}

// Body arrives as a JSON string, plain text, or an already-parsed object;
// non-JSON strings and non-object values are wrapped so the debug form
// always has a JSON object to display.
function resolveBody(bodyData: unknown): Record<string, unknown> {
  if (!bodyData) {
    return {}
  }
  if (typeof bodyData === 'string') {
    try {
      return JSON.parse(bodyData)
    } catch {
      const trimmed = bodyData.trim()
      return trimmed.startsWith('{') || trimmed.startsWith('[') ? { raw: bodyData } : { content: bodyData }
    }
  }
  return isRecord(bodyData) ? bodyData : { content: String(bodyData) }
}

export function parseLogData(raw: string): ParsedLogData {
  const parsedData: unknown = JSON.parse(decodeURIComponent(raw))

  const url = firstNonEmpty(
    readString(parsedData, 'url'),
    readString(parsedData, 'requestUrl'),
    readString(parsedData, 'endpoint')
  )
  const method = firstNonEmpty(
    readString(parsedData, 'method'),
    readString(parsedData, 'requestMethod'),
    'POST'
  ).toUpperCase()

  const headers = resolveHeaders(isRecord(parsedData) ? Reflect.get(parsedData, 'headers') : undefined)

  const bodyFromRoot = isRecord(parsedData) ? Reflect.get(parsedData, 'body') : undefined
  const request = isRecord(parsedData) ? Reflect.get(parsedData, 'request') : undefined
  const bodyFromRequest = isRecord(request) ? Reflect.get(request, 'body') : undefined
  const body = resolveBody(bodyFromRoot ? bodyFromRoot : bodyFromRequest)

  return { url, method, headers, body }
}
