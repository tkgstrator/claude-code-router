/**
 * Schemas for the Postgres-backed config store.
 *
 * - `ScenarioKey` mirrors the Prisma enum and the legacy `Router.*` keys
 *   so the migration, configService, and UI all speak the same vocabulary.
 * - `ConfigEnvelopeSchema` whitelists what is allowed to stay on disk in
 *   ~/.claude-code-router/config.json once Providers / Router have been
 *   moved into the DB.
 */

import { z } from 'zod'
import { JsonValueSchema, TransformerConfigSchema } from '../preset/types'

// --- Scenario key -----------------------------------------------------------

// Order matters: this is the iteration order used by the JSON-to-DB
// migration when seeding RouterSlot rows.
export const SCENARIO_KEYS = ['default', 'background', 'think', 'longContext', 'webSearch', 'image'] as const

export const ScenarioKeySchema = z.enum(SCENARIO_KEYS)
export type ScenarioKey = z.infer<typeof ScenarioKeySchema>

// --- Config envelope --------------------------------------------------------

// Scalar envelope keys that may be mirrored onto process.env at boot.
// Object/array fields (StatusLine, transformers, plugins, Plugins) are
// envelope-resident but never copied onto process.env, so they live in
// the schema below but not in this list.
export const ENVELOPE_ENV_KEYS = [
  'HOST',
  'PORT',
  'APIKEY',
  'LOG',
  'LOG_LEVEL',
  'PROXY_URL',
  'API_TIMEOUT_MS',
  'CLAUDE_PATH',
  'NON_INTERACTIVE_MODE'
] as const
export type EnvelopeEnvKey = (typeof ENVELOPE_ENV_KEYS)[number]

const LogLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])

export const ConfigEnvelopeSchema = z
  .object({
    HOST: z.string().default(''),
    PORT: z.number().int().positive().optional(),
    APIKEY: z.string().nonempty().optional(),
    LOG: z.boolean().optional(),
    LOG_LEVEL: LogLevelSchema.optional(),
    PROXY_URL: z.string().default(''),
    API_TIMEOUT_MS: z.coerce.number().int().nonnegative().optional(),
    CLAUDE_PATH: z.string().default(''),
    NON_INTERACTIVE_MODE: z.boolean().optional(),

    // Object-shaped envelope members that stay on disk for PR #1.
    StatusLine: JsonValueSchema.optional(),
    transformers: z.array(TransformerConfigSchema).optional(),
    plugins: z.array(JsonValueSchema).optional(),
    Plugins: z.array(JsonValueSchema).optional()
  })
  // Any other keys we don't know about — keep them, don't drop them.
  .catchall(JsonValueSchema)
export type ConfigEnvelope = z.infer<typeof ConfigEnvelopeSchema>

// Keys that PR #1 moves out of config.json into the database. Used by
// migrateFromJson to strip them after a successful seed.
export const DB_OWNED_CONFIG_KEYS = ['Providers', 'providers', 'Router'] as const
export type DbOwnedConfigKey = (typeof DB_OWNED_CONFIG_KEYS)[number]
