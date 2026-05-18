/**
 * Shared pino logger. Verbosity is controlled solely by LOG_LEVEL; file output
 * by LOG. No content-based filtering — a plain configured pino instance.
 *
 * Consumed by the vendored llms pipeline (src/llms) as `fastifyShim.log` /
 * `ctx.log` (see llmsContext.ts); `logger.child({ reqId })` in
 * sendRequestToProvider groups one request's lines for the UI LogViewer.
 * For Hono-side request logging, pino's official pattern is
 * `@hono/structured-logger` + `logger.child({ requestId })` (docs/web.md#hono).
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { HOME_DIR } from '@ccr/shared'
import pino from 'pino'
import pinoPretty from 'pino-pretty'
import { z } from 'zod'
import dayjs from '@/lib/dayjs'

const LOG_DIR = path.join(HOME_DIR, 'logs')

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

const envBool = (fallback: 'true' | 'false') =>
  z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(['true', 'false']))
    .catch(fallback)
    .transform((value) => value === 'true')

const env = z
  .object({
    LOG: envBool('true'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).catch('info')
  })
  .parse(process.env)

const SIMPLE_REDACT_KEYS = [
  'authorization',
  'Authorization',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'token',
  'secret',
  'password',
  'cookie',
  'Cookie'
]

const REDACT_PATHS = [
  ...SIMPLE_REDACT_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`, `*.*.*.*.${key}`]),
  'headers["x-api-key"]',
  'headers["set-cookie"]',
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'req.headers["x-api-key"]',
  'req.headers["set-cookie"]',
  'data.headers.authorization',
  'data.headers.Authorization',
  'data.headers.cookie',
  'data.headers.Cookie',
  'data.headers["x-api-key"]',
  'data.headers["set-cookie"]'
]

try {
  mkdirSync(LOG_DIR, { recursive: true })
} catch {
  /* logging must never throw */
}

const fileStream = {
  write(line: string): void {
    if (!env.LOG) return
    try {
      appendFileSync(path.join(LOG_DIR, `ccr-${dayjs().format('YYYY-MM-DD')}.log`), line)
    } catch {
      /* logging must never throw */
    }
  }
}

// File stays raw JSON (LogViewer / logs API parse each line as JSON). Console
// is prettified only. `time` is epoch ms from our timestamp hook; translateTime
// renders it readably and `timestamp` (the redundant ISO field) is dropped.
const consoleStream = pinoPretty({
  colorize: true,
  translateTime: 'SYS:standard',
  ignore: 'timestamp'
})

// Plain combined stream instead of pino.multistream: multistream fixes its
// internal minLevel at construction time, so logger.level changes made after
// creation (e.g. syncLevelFromEnv) are silently ignored. A plain write()
// shim delegates entirely to pino's own level gate, which IS updated by
// logger.level assignments.
const combinedStream = {
  write(line: string): void {
    fileStream.write(line)
    consoleStream.write(line)
  }
}

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: null,
    messageKey: 'msg',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label })
    },
    timestamp: () => {
      const now = dayjs()
      return `,"time":${now.valueOf()},"timestamp":"${now.toISOString()}"`
    }
  },
  combinedStream
)

// Called by bootstrapServer() after initConfig() applies the config.json
// envelope to process.env — the logger is initialized at import time before
// the envelope is loaded, so the level must be re-applied once it is known.
export const syncLevelFromEnv = () => {
  const raw = process.env.LOG_LEVEL ?? ''
  const valid = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']
  if (valid.includes(raw)) logger.level = raw
  logger.info({ LOG_LEVEL: logger.level, LOG: env.LOG }, 'log config applied')
}

export { LOG_DIR }
