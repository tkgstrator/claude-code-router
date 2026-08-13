import os from 'node:os'
import path from 'node:path'

// CCR_HOME_DIR lets the test preload route the on-disk config envelope
// at a tmp directory: os.homedir() doesn't honour $HOME after the
// process starts (it reads /etc/passwd) so setting process.env.HOME at
// preload time is too late. Production never sets this var.
export const HOME_DIR = process.env.CCR_HOME_DIR ?? path.join(os.homedir(), '.claude-code-router')

export const CONFIG_FILE = path.join(HOME_DIR, 'config.json')

export const PLUGINS_DIR = path.join(HOME_DIR, 'plugins')

// Claude projects directory — read by the vendored llms router to look
// up the active CCR session's per-project routing override.
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

// Model-family guard for reasoning-effort support. Matches gpt-5.x and
// o1/o3/o4 chat models — the only OpenAI families that accept
// `max_completion_tokens` and `reasoning_effort` on Chat Completions.
// Older gpt-4.x models silently ignore both fields. Shared by the
// server-side OpenAI transformer and the frontend Tier editor so both
// surfaces stay in lock-step.
export const REASONING_MODEL_RE = /^(gpt-5(?:\.\d+)?(?:-|$)|o[1-9](?:-|$))/
