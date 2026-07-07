/**
 * SSE stream for new-log notifications. EventSource doesn't support
 * custom headers, so the API key is accepted as the `apikey` query
 * param in addition to the standard x-api-key header.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { requestLogsRoute } from './app'
import { type RequestLogEvent, requestLogEmitter } from './events'

const digest = (s: string) => createHash('sha256').update(s).digest()

requestLogsRoute.get('/api/request-logs/events', (c) => {
  const expected = (process.env.APIKEY ?? '').trim()
  const provided = (c.req.query('apikey') ?? c.req.header('x-api-key') ?? '').trim()
  const ok = expected.length > 0 && provided.length > 0 && timingSafeEqual(digest(provided), digest(expected))
  if (!ok) {
    return c.json(
      { type: 'error', error: { type: 'authentication_error', message: 'Invalid or missing API key' } },
      401
    )
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: RequestLogEvent) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
      }
      requestLogEmitter.on('new_log', send)
      // Heartbeat every 30 s to keep the connection alive through proxies.
      const hb = setInterval(() => controller.enqueue(': heartbeat\n\n'), 30_000)
      c.req.raw.signal.addEventListener('abort', () => {
        requestLogEmitter.off('new_log', send)
        clearInterval(hb)
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
})
