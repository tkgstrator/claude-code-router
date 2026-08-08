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
export const accessLog: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now()
  const reqId = randomUUID()
  await next()
  const durationMs = Date.now() - startedAt
  const status = c.res.status
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  logger[level](
    { reqId, method: c.req.method, path: c.req.path, status, durationMs },
    `${c.req.method} ${c.req.path} ${status} ${durationMs}ms`
  )
}
