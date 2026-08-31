import os from 'node:os'
import path from 'node:path'

/**
 * Resolve the on-disk home directory from an environment.
 *
 * RIALTO_HOME_DIR lets the test preload point the config envelope at a
 * tmp directory: os.homedir() doesn't honour $HOME after the process
 * starts (it reads /etc/passwd) so setting process.env.HOME at preload
 * time is too late. Production never sets it.
 *
 * CCR_HOME_DIR is the pre-rename name of the same variable. It is still
 * honoured, second, so an operator who set it does not silently get a
 * different directory after upgrading. Exported as a function purely so
 * the fallback is testable — HOME_DIR itself is frozen at import time.
 */
export const resolveHomeDir = (env: NodeJS.ProcessEnv, homedir: string): string =>
  env.RIALTO_HOME_DIR ?? env.CCR_HOME_DIR ?? path.join(homedir, '.rialto')

/**
 * True when the deprecated CCR_HOME_DIR was the variable that decided
 * HOME_DIR. The warning itself is emitted from the boot path, not here:
 * this module cannot import the logger, because the logger imports
 * LOG_DIR from it.
 */
export const HOME_DIR_ENV_IS_LEGACY =
  process.env.RIALTO_HOME_DIR === undefined && process.env.CCR_HOME_DIR !== undefined

export const HOME_DIR = resolveHomeDir(process.env, os.homedir())

export const CONFIG_FILE = path.join(HOME_DIR, 'config.json')

export const PLUGINS_DIR = path.join(HOME_DIR, 'plugins')

// Where pino's rotating file sink writes. Shared with the storage
// report, which measures the same directory the logger fills.
export const LOG_DIR = path.join(HOME_DIR, 'logs')

// Claude projects directory — read by the scenario router to map a
// session id back to the project the active Rialto session belongs to.
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')
