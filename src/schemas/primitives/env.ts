/**
 * Process-env parsing. A primitive because LogLevelSchema is shared by
 * the disk envelope (domain/config.ts) and the logger's own boot-time
 * validation, and neither can own it without the other importing down
 * from a layer it does not belong to.
 */

import { z } from '@hono/zod-openapi'

// Log level enum shared by the disk envelope schema (config.dto) and the
// logger's runtime env validation (src/logger.ts).
export const LogLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
export type LogLevel = z.infer<typeof LogLevelSchema>

// Env-var "true"/"false" coercion used by the logger. Trimmed,
// lowercased, falls back to the supplied default on any other value.
export const LoggerEnvBoolSchema = (fallback: 'true' | 'false') =>
  z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(['true', 'false']))
    .catch(fallback)
    .transform((value) => value === 'true')

// Combined schema applied to process.env at logger init. LOG controls
// whether log lines are appended to the file sink; LOG_LEVEL controls
// pino's level gate. LOG_MAX_MB is the size cap that triggers file
// rotation (see src/logger.ts). All have permissive .catch() fallbacks
// so an invalid env never breaks the logger.
export const LoggerEnvSchema = z.object({
  LOG: LoggerEnvBoolSchema('true'),
  LOG_LEVEL: LogLevelSchema.catch('info'),
  LOG_MAX_MB: z
    .string()
    .transform((v) => Number(v))
    .pipe(z.number().positive().finite())
    .catch(10)
})
