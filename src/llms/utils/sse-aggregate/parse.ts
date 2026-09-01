/**
 * The only thing the four aggregators share: SSE framing.
 *
 * Each aggregator understands one vendor's event vocabulary and nothing
 * else, so this is where the split bottoms out — everything above it is
 * per-wire-format and independent.
 */

// Split an SSE payload into event records. Each event may carry an
// `event:` label plus one or more `data:` lines. We only care about the
// JSON on the `data:` lines — the `type` field on the JSON payload is
// authoritative, so the `event:` label is redundant.
export function* parseSseEvents(raw: string): Generator<unknown> {
  for (const chunk of raw.split(/\r?\n\r?\n/)) {
    if (chunk.length === 0) continue
    const dataLines = chunk
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (dataLines.length === 0) continue
    const joined = dataLines.join('\n')
    if (joined === '' || joined === '[DONE]') continue
    try {
      yield JSON.parse(joined)
    } catch {
      // dropped: malformed event
    }
  }
}

export function isSseContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('text/event-stream') === true
}
