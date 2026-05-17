// Codex (ChatGPT backend) has no standalone usage endpoint — its rate
// limits ride on the /responses reply as `x-codex-*` headers (see
// openai/codex codex-rs/codex-api/src/rate_limits.rs). codex-credentials
// captures them from real traffic into this in-memory snapshot so the
// Usage view can show the latest without spending a probe request.

export interface CodexUsageWindow {
  usedPercent: number
  windowMinutes: number | null
  resetAt: string | null
}

export interface CodexUsageSnapshot {
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
  limitName: string | null
  capturedAt: string
}

// Single-element holder so the module stays reassignment-free.
const store: { snapshot: CodexUsageSnapshot | null } = { snapshot: null }

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const windowOf = (
  used: string | null | undefined,
  mins: string | null | undefined,
  reset: string | null | undefined
): CodexUsageWindow | null => {
  const u = num(used)
  if (u === null) return null
  return { usedPercent: u, windowMinutes: num(mins), resetAt: reset && reset.length > 0 ? reset : null }
}

// `get` is abstracted so callers can pass a Fetch `Headers.get` bound
// fn or a plain record lookup.
export function captureCodexUsage(get: (name: string) => string | null | undefined): void {
  const primary = windowOf(
    get('x-codex-primary-used-percent'),
    get('x-codex-primary-window-minutes'),
    get('x-codex-primary-reset-at')
  )
  const secondary = windowOf(
    get('x-codex-secondary-used-percent'),
    get('x-codex-secondary-window-minutes'),
    get('x-codex-secondary-reset-at')
  )
  if (!primary && !secondary) return
  const limit = get('x-codex-limit-name')
  store.snapshot = {
    primary,
    secondary,
    limitName: limit && limit.length > 0 ? limit : null,
    capturedAt: new Date().toISOString()
  }
}

export function getCodexUsageSnapshot(): CodexUsageSnapshot | null {
  return store.snapshot
}
