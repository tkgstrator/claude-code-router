import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { HOME_DIR } from '@ccr/shared'

// Single JSON-lines logger shared by the absorbed @musistudio/llms
// pipeline (via the src/llmsContext shim) and anything else that wants
// structured, request-scoped logs.
//
// Two sinks, both gated by the same level:
//   - file:    ~/.claude-code-router/logs/ccr-<YYYY-MM-DD>.log, one
//              JSON object per line. The format is what LogViewer.tsx's
//              grouping worker expects: it JSON.parses each line and
//              groups by `reqId`, sorts by `time`, and reads the model
//              off a `{ type: 'request body', data: { model } }` entry.
//   - console: so the same events are visible in `ccr` / container
//              stdout without opening the UI.
//
// warn/error/fatal always reach the console (operator-relevant);
// info/debug/trace only when LOG_LEVEL allows — so the per-request LLM
// metadata, logged at `debug`, surfaces exactly in "debug mode"
// (LOG_LEVEL=debug|trace) and stays quiet otherwise.

const LOG_DIR = path.join(HOME_DIR, 'logs')

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
}

// Read fresh every call: a config save (LOG / LOG_LEVEL) re-mirrors
// these onto process.env and resetLlmsContext() rebuilds the pipeline,
// so the new level must take effect without a process restart.
function threshold(): number {
  const raw = String(process.env.LOG_LEVEL || '').toLowerCase()
  return LEVELS[raw as LogLevel] ?? LEVELS.info
}

// File logging is on unless explicitly disabled (LOG=false). An unset
// LOG (fresh envelope) still logs — the whole point of this change is
// that errors are visible by default.
function fileEnabled(): boolean {
  return String(process.env.LOG ?? '').toLowerCase() !== 'false'
}

const SECRET_KEY_RE =
  /^(authorization|api[-_]?key|x-api-key|access[-_]?token|refresh[-_]?token|token|secret|password|bearer|cookie|set-cookie)$/i
const SECRET_VAL_RE = /\b(Bearer\s+[A-Za-z0-9._~+/-]+=*|sk-[A-Za-z0-9._-]{8,}|sk-ant-[A-Za-z0-9._-]{8,})/g

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value
  if (typeof value === 'string') return value.replace(SECRET_VAL_RE, '***')
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? '***' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

let dirReady = false
function ensureDir(): void {
  if (dirReady) return
  try {
    mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    /* logging must never throw */
  }
  dirReady = true
}

function logFilePath(): string {
  const day = new Date().toISOString().slice(0, 10)
  return path.join(LOG_DIR, `ccr-${day}.log`)
}

function emit(level: LogLevel, bindings: Record<string, unknown>, args: unknown[]): void {
  if (LEVELS[level] < threshold()) return

  // pino-style call shapes: (msg), (obj), (obj, msg), (msg, ...rest).
  let obj: Record<string, unknown> = {}
  let msg = ''
  if (args.length && typeof args[0] === 'object' && args[0] !== null) {
    obj = redact(args[0]) as Record<string, unknown>
    msg = args.slice(1).map(String).join(' ')
  } else {
    msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(redact(a)))).join(' ')
  }

  const now = new Date()
  const redactedBindings = redact(bindings) as Record<string, unknown>
  const record: Record<string, unknown> = {
    level,
    time: now.getTime(),
    timestamp: now.toISOString(),
    ...redactedBindings,
    ...obj,
    ...(msg ? { msg } : {})
  }

  if (fileEnabled()) {
    ensureDir()
    try {
      appendFileSync(logFilePath(), JSON.stringify(record) + '\n')
    } catch {
      /* disk full / readonly fs — never crash the request path */
    }
  }

  // warn/error/fatal: always to console. info/debug/trace already
  // passed the level gate above, so echo them too (the user asked for
  // console visibility, not just a file).
  const reqId = record.reqId ? ` [${String(record.reqId).slice(0, 8)}]` : ''
  const extra = JSON.stringify({ ...obj, ...redactedBindings })
  const line = `[llms] ${record.timestamp} ${level.toUpperCase()}${reqId} ${msg}${extra === '{}' ? '' : ' ' + extra}`
  if (level === 'error' || level === 'fatal') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export interface Logger {
  fatal: (...a: unknown[]) => void
  error: (...a: unknown[]) => void
  warn: (...a: unknown[]) => void
  info: (...a: unknown[]) => void
  debug: (...a: unknown[]) => void
  trace: (...a: unknown[]) => void
  child: (bindings?: Record<string, unknown>) => Logger
}

function makeLogger(bindings: Record<string, unknown> = {}): Logger {
  const at =
    (level: LogLevel) =>
    (...a: unknown[]) =>
      emit(level, bindings, a)
  return {
    fatal: at('fatal'),
    error: at('error'),
    warn: at('warn'),
    info: at('info'),
    debug: at('debug'),
    trace: at('trace'),
    // Merge bindings so a per-request child({ reqId }) tags every line
    // it emits — that reqId is what LogViewer groups requests by.
    child: (b: Record<string, unknown> = {}) => makeLogger({ ...bindings, ...b })
  }
}

export const logger: Logger = makeLogger()

export { LOG_DIR }
