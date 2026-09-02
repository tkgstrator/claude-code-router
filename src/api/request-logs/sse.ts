/**
 * SSE stream for new-log notifications.
 *
 * EventSource cannot set custom headers, which is why `adminAuth`
 * accepts the credential as an `apikey` query parameter on this one
 * path. Authentication happens there, not here.
 */

import { requestLogsRoute } from './app'
import { type RequestLogEvent, requestLogEmitter } from './events'

// Authentication is `adminAuth` on /api/*, which already permits the
// `apikey` query parameter on exactly this path — EventSource cannot set
// headers, which is why that exception exists. This handler used to
// re-check the envelope key inline, and that copy knew nothing about the
// local exemption or Cloudflare Access: on a machine where every other
// /api call succeeded, live updates alone returned 401.
requestLogsRoute.get('/api/request-logs/events', (c) => {
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
