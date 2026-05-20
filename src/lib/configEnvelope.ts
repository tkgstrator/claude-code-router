import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import JSON5 from 'json5'
import { ConfigEnvelopeSchema } from '@/schemas'
import { ENVELOPE_ENV_KEYS } from '@/shared'
import { CONFIG_FILE, HOME_DIR, PLUGINS_DIR } from '@/shared/constants'
import dayjs from './dayjs'
import { logger } from './logger'

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

const createDefaultConfig = async () => {
  await initDir()
  const config = {
    PORT: 3456,
    APIKEY: generateApiKey(),
    Providers: [],
    Router: {}
  }
  await writeConfigFile(config)
  logger.info({ path: CONFIG_FILE }, 'Created default configuration file')
  return config
}

export const readConfigFile = async () => {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8')
    let parsed: any
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

    return interpolateEnvVars(parsed)
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
  }
}

export const writeConfigFile = async (config: any) => {
  await ensureDir(HOME_DIR)
  const configWithComment = `${JSON.stringify(config, null, 2)}`
  await fs.writeFile(CONFIG_FILE, configWithComment)
}

export const backupConfigFile = async (): Promise<string | null> => {
  try {
    const exists = await fs
      .access(CONFIG_FILE)
      .then(() => true)
      .catch(() => false)
    if (!exists) return null
    const timestamp = dayjs().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${CONFIG_FILE}.${timestamp}.bak`
    await fs.copyFile(CONFIG_FILE, backupPath)
    try {
      const configDir = path.dirname(CONFIG_FILE)
      const configFileName = path.basename(CONFIG_FILE)
      const files = await fs.readdir(configDir)
      const backupFiles = files
        .filter((f) => f.startsWith(configFileName) && f.endsWith('.bak'))
        .sort()
        .reverse()
      for (let i = 3; i < backupFiles.length; i++) {
        await fs.unlink(path.join(configDir, backupFiles[i]))
      }
    } catch {
      // cleanup failure is non-fatal
    }
    return backupPath
  } catch {
    return null
  }
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

export const initConfig = async () => {
  const config = await readConfigFile()
  applyEnvelopeToEnv(config)
  return config
}
