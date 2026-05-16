import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { getServer } from '@ccr/server'
import { CONFIG_FILE, HOME_DIR, PID_FILE, PLUGINS_DIR, PRESETS_DIR, REFERENCE_COUNT_FILE } from '@ccr/shared'
import JSON5 from 'json5'
import { cleanupPidFile, isServiceRunning } from './processCheck'

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
  await ensureDir(PRESETS_DIR)
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

const _confirm = async (query: string): Promise<boolean> => {
  const answer = await question(query)
  return answer.toLowerCase() !== 'n'
}

// Warn once per process so commands like `ccr code` / `ccr status` don't
// spam the screen on every call. The server moved Providers / Router
// into Postgres; the CLI doesn't speak DB yet (slated for a follow-up
// PR), so any caller that grabs them off the parsed config will see
// empty values and we want them to know why.
let warnedAboutMigratedKeys = false

export const readConfigFile = async () => {
  try {
    const config = await fs.readFile(CONFIG_FILE, 'utf-8')
    try {
      // Try to parse with JSON5 first (which also supports standard JSON)
      const parsedConfig = JSON5.parse(config)
      const interpolated = interpolateEnvVars(parsedConfig)
      const hasProviders = Array.isArray(interpolated?.Providers) || Array.isArray(interpolated?.providers)
      const hasRouter = interpolated?.Router && Object.keys(interpolated.Router).length > 0
      if (!warnedAboutMigratedKeys && !hasProviders && !hasRouter) {
        warnedAboutMigratedKeys = true
        console.warn(
          '[ccr] Providers / Router are not in config.json — the server now stores them in Postgres. ' +
            'CLI commands that depend on them (e.g. `ccr code`, `ccr status`) will see empty values until the CLI DB cutover lands.'
        )
      }
      return interpolated
    } catch (parseError) {
      console.error(`Failed to parse config file at ${CONFIG_FILE}`)
      console.error('Error details:', (parseError as Error).message)
      console.error('Please check your config file syntax.')
      process.exit(1)
    }
  } catch (readError: any) {
    if (readError.code === 'ENOENT') {
      // Config file doesn't exist, prompt user for initial setup
      try {
        // Initialize directories
        await initDir()

        // Backup existing config file if it exists
        const backupPath = await backupConfigFile()
        if (backupPath) {
          console.log(`Backed up existing configuration file to ${backupPath}`)
        }
        const config = {
          PORT: 3456,
          Providers: [],
          Router: {}
        }
        // Create a minimal default config file
        await writeConfigFile(config)
        console.log('Created minimal default configuration file at ~/.claude-code-router/config.json')
        console.log('Please edit this file with your actual configuration.')
        return config
      } catch (error: any) {
        console.error('Failed to create default configuration:', error.message)
        process.exit(1)
      }
    } else {
      console.error(`Failed to read config file at ${CONFIG_FILE}`)
      console.error('Error details:', readError.message)
      process.exit(1)
    }
  }
}

export const backupConfigFile = async () => {
  try {
    if (
      await fs
        .access(CONFIG_FILE)
        .then(() => true)
        .catch(() => false)
    ) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = `${CONFIG_FILE}.${timestamp}.bak`
      await fs.copyFile(CONFIG_FILE, backupPath)

      // Clean up old backups, keeping only the 3 most recent
      try {
        const configDir = path.dirname(CONFIG_FILE)
        const configFileName = path.basename(CONFIG_FILE)
        const files = await fs.readdir(configDir)

        // Find all backup files for this config
        const backupFiles = files
          .filter((file) => file.startsWith(configFileName) && file.endsWith('.bak'))
          .sort()
          .reverse() // Sort in descending order (newest first)

        // Delete all but the 3 most recent backups
        if (backupFiles.length > 3) {
          for (let i = 3; i < backupFiles.length; i++) {
            const oldBackupPath = path.join(configDir, backupFiles[i])
            await fs.unlink(oldBackupPath)
          }
        }
      } catch (cleanupError) {
        console.warn('Failed to clean up old backups:', cleanupError)
      }

      return backupPath
    }
  } catch (error) {
    console.error('Failed to backup config file:', error)
  }
  return null
}

export const writeConfigFile = async (config: any) => {
  await ensureDir(HOME_DIR)
  const configWithComment = `${JSON.stringify(config, null, 2)}`
  await fs.writeFile(CONFIG_FILE, configWithComment)
}

export const initConfig = async () => {
  const config = await readConfigFile()
  Object.assign(process.env, config)
  return config
}

export const run = async (_args: string[] = []) => {
  const isRunning = isServiceRunning()
  if (isRunning) {
    console.log('claude-code-router server is running')
    return
  }
  const server = await getServer()
  const app = server.app
  // Save the PID of the background process
  writeFileSync(PID_FILE, process.pid.toString())

  app.post('/api/restart', async () => {
    setTimeout(async () => {
      spawn('ccr', ['restart'], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    }, 100)

    return { success: true, message: 'Service restart initiated' }
  })

  // await server.start() to ensure it starts successfully and keep process alive
  await server.start()
}

export const restartService = async () => {
  // Stop the service if it's running
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8'), 10)
    process.kill(pid)
    cleanupPidFile()
    if (existsSync(REFERENCE_COUNT_FILE)) {
      try {
        await fs.unlink(REFERENCE_COUNT_FILE)
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
    console.log('claude code router service has been stopped.')
  } catch (_e) {
    console.log('Service was not running or failed to stop.')
    cleanupPidFile()
  }

  // Start the service again in the background
  console.log('Starting claude code router service...')
  const cliPath = path.join(__dirname, 'cli.js')
  const startProcess = spawn('node', [cliPath, 'start'], {
    detached: true,
    stdio: 'ignore'
  })

  startProcess.on('error', (error) => {
    console.error('Failed to start service:', error)
    throw error
  })

  startProcess.unref()
  console.log('✅ Service started successfully in the background.')
}

/**
 * Get a temporary path for the settings file
 * Hash the content and return the file path if it already exists in temp directory,
 * otherwise create a new file with the content
 * @param content Settings content string
 * @returns Full path to the temporary file
 */
export const getSettingsPath = async (content: string): Promise<string> => {
  // Hash the content using SHA256 algorithm
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex')

  // Create claude-code-router directory in system temp folder
  const tempDir = path.join(os.tmpdir(), 'claude-code-router')
  const fileName = `ccr-settings-${hash}.json`
  const tempFilePath = path.join(tempDir, fileName)

  // Ensure the directory exists
  try {
    await fs.access(tempDir)
  } catch {
    await fs.mkdir(tempDir, { recursive: true })
  }

  // Check if the file already exists
  try {
    await fs.access(tempFilePath)
    return tempFilePath
  } catch {
    // File doesn't exist, create and write content
    await fs.writeFile(tempFilePath, content, 'utf-8')
    return tempFilePath
  }
}
