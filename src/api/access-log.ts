import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { logger } from '../logger'

// HTTP access logger for /api/* and /v1/*. Without it, only exceptions
// reach pino — routes that return an error status via `c.json(x, 4xx)`
// (e.g. /api/models/test's 400/404/502) never leave a trace, which
// makes post-hoc debugging effectively impossible. Records method,
// path, status, and durationMs on every request; picks the log level
// from the status class so 4xx/5xx are visible at warn/error even when
// info is silenced.
// Header the client can quote back to us for log correlation. Honours a
// caller-supplied `x-request-id` when present (idempotent probes / tests
// pin a value); otherwise mints a fresh uuid so every response carries
// one. Reflecting it on the outgoing response is what lets the reporter
// (or an operator on-call) grep pino logs by the id the client saw.
const REQUEST_ID_HEADER = 'x-request-id'

export const accessLog: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now()
  const inbound = c.req.header(REQUEST_ID_HEADER)
  const reqId = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID()
  // Set BEFORE next() so downstream handlers can override via c.header
  // if they want a more meaningful value, but the default always lands.
  c.header(REQUEST_ID_HEADER, reqId)
  await next()
  const durationMs = Date.now() - startedAt
  const status = c.res.status
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  logger[level](
    { reqId, method: c.req.method, path: c.req.path, status, durationMs },
    `${c.req.method} ${c.req.path} ${status} ${durationMs}ms`
  )
}
