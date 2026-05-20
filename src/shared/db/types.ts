/**
 * Plain-data constants and type re-exports for the Postgres-backed config
 * store. Zod schemas have been relocated to `src/schemas/*.dto.ts` — see
 * `@/schemas/router.dto` (ScenarioKeySchema), `@/schemas/env.dto`
 * (LogLevelSchema), and `@/schemas/config.dto` (ConfigEnvelopeSchema).
 *
 * - `SCENARIO_KEYS` mirrors the Prisma `ScenarioKey` enum and the legacy
 *   `Router.*` keys; its iteration order is the order used by the
 *   JSON-to-DB migration when seeding RouterSlot rows.
 * - `ENVELOPE_ENV_KEYS` is the whitelist of envelope scalars that may be
 *   mirrored onto `process.env` at boot.
 * - `DB_OWNED_CONFIG_KEYS` lists the keys PR #1 moves out of config.json
 *   into the database; `migrateFromJson` strips them after a successful
 *   seed.
 */

import type { ConfigEnvelope, ScenarioKey } from '@/schemas'

// Re-export the relocated types so legacy `from '@/shared/db/types'`
// imports keep working without churn.
export type { ConfigEnvelope, ScenarioKey }

// --- Scenario key -----------------------------------------------------------

// Order matters: this is the iteration order used by the JSON-to-DB
// migration when seeding RouterSlot rows.
export const SCENARIO_KEYS = ['default', 'background', 'think', 'longContext', 'webSearch', 'image'] as const

// --- Config envelope --------------------------------------------------------

// Scalar envelope keys that may be mirrored onto process.env at boot.
// Object/array fields (StatusLine, transformers, plugins, Plugins) are
// envelope-resident but never copied onto process.env, so they live in
// the schema (config.dto.ts) but not in this list.
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

// Keys that PR #1 moves out of config.json into the database. Used by
// migrateFromJson to strip them after a successful seed.
export const DB_OWNED_CONFIG_KEYS = ['Providers', 'providers', 'Router'] as const
export type DbOwnedConfigKey = (typeof DB_OWNED_CONFIG_KEYS)[number]
