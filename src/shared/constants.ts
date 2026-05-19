import os from 'node:os'
import path from 'node:path'

// CCR_HOME_DIR lets the test preload route the on-disk config envelope
// at a tmp directory: os.homedir() doesn't honour $HOME after the
// process starts (it reads /etc/passwd) so setting process.env.HOME at
// preload time is too late. Production never sets this var.
export const HOME_DIR = process.env.CCR_HOME_DIR ?? path.join(os.homedir(), '.claude-code-router')

export const CONFIG_FILE = path.join(HOME_DIR, 'config.json')

export const PLUGINS_DIR = path.join(HOME_DIR, 'plugins')

export const PRESETS_DIR = path.join(HOME_DIR, 'presets')

export const PID_FILE = path.join(HOME_DIR, '.claude-code-router.pid')

export const REFERENCE_COUNT_FILE = path.join(os.tmpdir(), 'claude-code-reference-count.txt')

// Claude projects directory
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

export interface DefaultConfig {
  LOG: boolean
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
  OPENAI_MODEL: string
}

export const DEFAULT_CONFIG: DefaultConfig = {
  LOG: false,
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: '',
  OPENAI_MODEL: ''
}
