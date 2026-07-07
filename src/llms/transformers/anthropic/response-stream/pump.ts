/**
 * Byte-stream pump for the Anthropic SSE writer.
 *
 * Reads the upstream OpenAI-shaped SSE stream, splits it into lines,
 * parses each `data:` line, and dispatches parsed chunks through
 * `handleChunk` (`dispatch.ts`) until the stream finishes or a
 * finish_reason closes it early.
 */

import type { Logger } from 'pino'
import { handleChunk } from './dispatch'
import { isStreamChunk, type StreamState } from './types'

export async function runStreamPump(
  openaiStream: ReadableStream<Uint8Array>,
  state: StreamState,
  logger: Logger | undefined,
  reqId: string | undefined
): Promise<void> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    reader = openaiStream.getReader()
    let buffer = ''

    for (;;) {
      if (state.isClosed) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += state.decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      const lastLine = lines.pop()
      buffer = lastLine === undefined ? '' : lastLine

      const shouldStop = processLines(lines, state, logger, reqId)
      if (shouldStop) break
    }
    // referenced to silence unused-var
    void state.totalChunks
    state.safeClose()
  } finally {
    if (reader) {
      try {
        reader.releaseLock()
      } catch (releaseError) {
        console.error(releaseError)
      }
    }
  }
}

function processOneLine(
  line: string,
  state: StreamState,
  logger: Logger | undefined,
  reqId: string | undefined
): { finished: boolean } {
  if (!line.startsWith('data:')) return { finished: false }
  const data = line.slice(5).trim()
  logger?.trace({ reqId, type: 'recieved data', data })
  if (data === '[DONE]') return { finished: false }

  try {
    const parsed: unknown = JSON.parse(data)
    if (!isStreamChunk(parsed)) return { finished: false }
    state.totalChunks++
    logger?.trace({ reqId, response: parsed, tppe: 'Original Response' })
    return { finished: handleChunk(parsed, state) }
  } catch (parseError) {
    const e = parseError instanceof Error ? parseError : new Error(String(parseError))
    logger?.error(`parseError: ${e.name} message: ${e.message} stack: ${e.stack} data: ${data}`)
    return { finished: false }
  }
}

function processLines(
  lines: string[],
  state: StreamState,
  logger: Logger | undefined,
  reqId: string | undefined
): boolean {
  for (const line of lines) {
    if (state.isClosed || state.hasFinished) return true
    const { finished } = processOneLine(line, state, logger, reqId)
    if (finished) return true
  }
  return false
}
