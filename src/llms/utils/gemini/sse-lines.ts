/**
 * Byte-stream → line adapter for the Gemini SSE streaming branch.
 *
 * Generic plumbing (no Gemini-specific shapes) split out of
 * `response-streaming.ts` purely to keep that file under the line-count
 * budget.
 */

/**
 * Adapter that exposes a `ReadableStream<Uint8Array>` as an `AsyncIterable`.
 * Node 18 already implements the async-iterator protocol on its native
 * `ReadableStream`, but the TypeScript DOM lib definitions do not advertise
 * it — wrapping the reader manually keeps the conversion explicit and
 * lets us use `for await` without a type assertion.
 */
function asAsyncIterable(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const reader = body.getReader()
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          const { done, value } = await reader.read()
          if (done || value === undefined) {
            return { done: true, value: undefined }
          }
          return { done: false, value }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          reader.releaseLock()
          return { done: true, value: undefined }
        }
      }
    }
  }
}

/**
 * Async generator that yields complete newline-delimited lines from a
 * `Response.body` byte stream. Pulled out so the producer can avoid a
 * `while (true) { reader.read() }` loop in favour of `for await`.
 */
export async function* iterateLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const value of asAsyncIterable(body)) {
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    const remainder = lines.pop()
    buffer = typeof remainder === 'string' ? remainder : ''
    for (const line of lines) {
      yield line
    }
  }
  buffer += decoder.decode()
  if (buffer.length > 0) {
    yield buffer
  }
}
