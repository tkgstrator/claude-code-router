import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import JSON5 from 'json5'
import { type ConfigEnvelope, ConfigEnvelopeSchema } from '@/schemas'
import { ENVELOPE_ENV_KEYS } from '@/shared'
import { CONFIG_FILE, HOME_DIR, PLUGINS_DIR } from '@/shared/constants'
import { SEED_PERSONAS } from '@/shared/data'
import { logger } from '../../logger'

// Function to interpolate environment variables in config values
const interpolateEnvVars = (obj: any): any => {
  if (typeof obj === 'string') {
    // Replace $VAR_NAME or ${VAR_NAME} with environment variable values
    return obj.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (match, braced, unbraced) => {
      const varName = braced || unbraced
      return process.env[varName] || match // Keep original if env var doesn't exist
    })
  } else if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars)
  } else if (obj !== null && typeof obj === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value)
    }
    return result
  }
  return obj
}

const ensureDir = async (dir_path: string) => {
  try {
    await fs.access(dir_path)
  } catch {
    await fs.mkdir(dir_path, { recursive: true })
  }
}

export const initDir = async () => {
  await ensureDir(HOME_DIR)
  await ensureDir(PLUGINS_DIR)
  await ensureDir(path.join(HOME_DIR, 'logs'))
}

const createReadline = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
}

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = createReadline()
    rl.question(query, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

const confirm = async (query: string): Promise<boolean> => {
  const answer = await question(query)
  return answer.toLowerCase() !== 'n'
}

const generateApiKey = () => crypto.randomBytes(32).toString('hex')

const createDefaultConfig = async (): Promise<ConfigEnvelope> => {
  await initDir()
  const raw = {
    PORT: 3456,
    APIKEY: generateApiKey(),
    Providers: [],
    Router: {},
    // Ship a few ready-made personas in the default config so a fresh
    // install has something to pick on the Router page out of the box.
    Personas: SEED_PERSONAS
  }
  await writeConfigFile(raw)
  logger.info({ path: CONFIG_FILE }, 'Created default configuration file')
  // Parse through the schema so callers receive a fully-defaulted
  // ConfigEnvelope (HOST, LOG, LOG_LEVEL, PROXY_URL, …) instead of just
  // the four scalars we persist on first run.
  return ConfigEnvelopeSchema.parse(raw)
}

export const readConfigFile = async (): Promise<ConfigEnvelope> => {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON5.parse(raw)
    } catch (parseError) {
      logger.error({ path: CONFIG_FILE, err: parseError }, 'Failed to parse config file')
      await fs.unlink(CONFIG_FILE)
      return createDefaultConfig()
    }

    const result = ConfigEnvelopeSchema.safeParse(parsed)
    if (!result.success) {
      logger.error({ err: result.error }, 'Config file failed schema validation')
      await fs.unlink(CONFIG_FILE)
      return createDefaultConfig()
    }

    // Return the schema-parsed envelope (defaults applied, API_TIMEOUT_MS
    // coerced, …). Callers — and `initConfig` in particular — can rely on
    // typed values without re-parsing.
    return interpolateEnvVars(result.data)
  } catch (readError: any) {
    if (readError.code === 'ENOENT') {
      try {
        return await createDefaultConfig()
      } catch (error: any) {
        logger.fatal({ err: error }, 'Failed to create default configuration')
        process.exit(1)
      }
    } else {
      logger.fatal({ path: CONFIG_FILE, err: readError }, 'Failed to read config file')
      process.exit(1)
    }
    // Unreachable: every branch above either returns or process.exit's.
    throw readError
  }
}

export const writeConfigFile = async (config: any) => {
  await ensureDir(HOME_DIR)
  const configWithComment = `${JSON.stringify(config, null, 2)}`
  await fs.writeFile(CONFIG_FILE, configWithComment)
}

/**
 * Mirror the envelope's scalar keys onto process.env so downstream
 * consumers that still read `process.env.PORT` etc. keep working.
 *
 * The legacy implementation did `Object.assign(process.env, config)` —
 * fine for strings but it stringified nested Providers/Router objects
 * to `[object Object]` (and we no longer want those on disk anyway).
 * Whitelisting the keys here lets us tighten the contract without
 * breaking any caller that legitimately reads e.g. process.env.PROXY_URL.
 */
export const applyEnvelopeToEnv = (config: Record<string, unknown>) => {
  for (const key of ENVELOPE_ENV_KEYS) {
    const value = config[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') process.env[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') process.env[key] = String(value)
    // Anything else (object/array) is silently skipped — those keys
    // don't belong on process.env in the first place.
  }
}

export const initConfig = async (): Promise<ConfigEnvelope> => {
  const envelope = await readConfigFile()
  applyEnvelopeToEnv(envelope)
  return envelope
}
