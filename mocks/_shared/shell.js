/**
 * Shared app chrome for the Rialto UI mocks.
 *
 * Static HTML has no include mechanism, so each mock calls renderShell()
 * and the sidebar / header markup is injected from here. Keeps the five
 * screen mocks focused on their own content and guarantees the chrome is
 * pixel-identical across them — which matters because the ui-mock-diff
 * skill diffs whole pages, chrome included.
 *
 * Deliberately a CLASSIC script exposing one global, not an ES module:
 * the mocks are opened over file:// and Chrome blocks module imports
 * from origin `null`. Everything hangs off `window.Shell`.
 */

;(function (global) {

// ─── Theme ────────────────────────────────────────────────────────────
// Applied at script-parse time, from <head>, before the body paints —
// otherwise every navigation flashes light before switching. The choice
// persists across pages so a reviewer can toggle once on the index and
// walk the whole set in dark.
//
// Load only READS storage; only an explicit toggle writes. That keeps
// the screenshot capture deterministic: shoot.ts opens a fresh context
// per theme (empty storage), this falls back to the context's
// prefers-color-scheme, and shoot.ts then sets the class explicitly.

const THEME_KEY = 'rialto-mock-theme'

// file:// pages are an opaque origin and some browsers throw on any
// storage access there. A mock that cannot remember the theme is fine;
// a mock that throws before rendering is not.
const readStored = () => {
  try {
    return localStorage.getItem(THEME_KEY)
  } catch {
    return null
  }
}

const prefersDark = () => global.matchMedia?.('(prefers-color-scheme: dark)').matches === true

const applyTheme = (theme) => {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

const currentTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

const toggleTheme = () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    /* not persisted — the page still switches for this view */
  }
  return next
}

const stored = readStored()
applyTheme(stored === 'dark' || stored === 'light' ? stored : prefersDark() ? 'dark' : 'light')

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'ri-dashboard-3-line', href: 'overview.html' },
  { id: 'routing', label: 'Routing', icon: 'ri-git-branch-line', href: 'routing.html' },
  { id: 'providers', label: 'Providers', icon: 'ri-plug-line', href: 'providers.html' },
  { id: 'activity', label: 'Activity', icon: 'ri-pulse-line', href: 'activity.html' },
  { id: 'settings', label: 'Settings', icon: 'ri-settings-3-line', href: 'settings.html' }
]

const navItem = (item, active) => {
  const on = item.id === active
  const state = on
    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
  return `
    <a href="${item.href}" class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${state}">
      <i class="${item.icon} text-base leading-none opacity-80"></i>
      <span>${item.label}</span>
    </a>`
}

/**
 * @param {{ active: string, title: string, subtitle?: string, actions?: string }} opts
 */
function renderShell(opts) {
  const root = document.getElementById('root')
  const content = root.innerHTML
  root.innerHTML = `
<div class="flex h-screen w-full overflow-hidden bg-background text-foreground">

  <aside class="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
    <div class="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
      <div class="flex size-6 items-center justify-center rounded bg-foreground text-background">
        <i class="ri-route-line text-sm leading-none"></i>
      </div>
      <span class="text-sm font-semibold tracking-tight">Rialto</span>
      <span class="ml-auto font-mono text-[10px] text-muted-foreground">v3.0.0</span>
    </div>

    <nav class="flex flex-1 flex-col gap-0.5 p-2">
      ${NAV.map((i) => navItem(i, opts.active)).join('')}
    </nav>

    <div class="border-t border-sidebar-border p-2">
      <div class="flex items-center gap-2 rounded-md px-2.5 py-2">
        <span class="size-1.5 shrink-0 rounded-full bg-emerald-500"></span>
        <span class="text-xs text-sidebar-foreground/70">Serving</span>
        <span class="ml-auto font-mono text-[10px] text-muted-foreground">:3456</span>
      </div>
      <div class="flex items-center gap-2 rounded-md px-2.5 py-2">
        <i class="ri-shield-check-line shrink-0 text-sm leading-none text-emerald-500"></i>
        <span class="truncate text-xs text-sidebar-foreground/70">tkgstrator@…</span>
        <span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">Access</span>
      </div>
      <button id="mock-theme-toggle" class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60">
        <i class="ri-contrast-2-line text-base leading-none opacity-80"></i>
        <span>Theme</span>
        <span id="mock-theme-label" class="ml-auto font-mono text-[10px] text-muted-foreground"></span>
      </button>
    </div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex h-14 shrink-0 items-center gap-4 border-b border-border px-6">
      <div class="min-w-0">
        <h1 class="truncate text-sm font-semibold tracking-tight">${opts.title}</h1>
        ${opts.subtitle ? `<p class="truncate text-xs text-muted-foreground">${opts.subtitle}</p>` : ''}
      </div>
      <div class="ml-auto flex items-center gap-2">${opts.actions ?? ''}</div>
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto">${content}</main>
  </div>

</div>`

  const label = document.getElementById('mock-theme-label')
  const paintLabel = () => {
    if (label) label.textContent = currentTheme()
  }
  paintLabel()
  document.getElementById('mock-theme-toggle')?.addEventListener('click', () => {
    toggleTheme()
    paintLabel()
  })
}

// ─── Shared building blocks ───────────────────────────────────────────
// Exported as strings so each mock composes the same primitives rather
// than re-inventing spacing / border treatments per page.

/** Flat row treatment used everywhere instead of shadcn Card. */
const ROW = 'border-l-2 border-l-transparent px-4 py-3 transition-colors hover:bg-muted/50'

/** Section container: a titled block with a hairline top rule. */
const section = (title, body, meta = '') => `
  <section class="border-t border-border first:border-t-0">
    <div class="flex items-baseline gap-3 px-6 pt-6 pb-3">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">${title}</h2>
      ${meta ? `<span class="text-xs text-muted-foreground/70">${meta}</span>` : ''}
    </div>
    ${body}
  </section>`

/** Small status pill. tone: ok | warn | bad | mute | info */
const pill = (text, tone = 'mute') => {
  const tones = {
    ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    bad: 'bg-destructive/10 text-destructive',
    info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    mute: 'bg-muted text-muted-foreground'
  }
  return `<span class="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}">${text}</span>`
}

/** Inline monospace token — model ids, paths, keys. */
const mono = (text) => `<span class="font-mono text-[11px] text-muted-foreground">${text}</span>`

/**
 * The four inbound surfaces, named by the raw endpoint a client actually
 * calls. Deliberately NOT short slugs (`messages`, `chat`, …): the path is
 * the string the operator already typed into ANTHROPIC_BASE_URL or the
 * OpenAI SDK, so it needs no glossary and cannot be confused with a
 * scenario name.
 */
const SURFACES = [
  { path: '/v1/messages', client: 'Claude Code' },
  { path: '/v1/chat/completions', client: 'OpenAI SDK' },
  { path: '/v1/responses', client: 'Codex CLI' },
  { path: '/v1beta/models/*', client: 'Gemini CLI' }
]

/** Surface label for a table cell. Monospace so paths align down a column. */
const surfacePill = (path) =>
  `<span class="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">${path}</span>`

/** Toggle chip for "which surfaces does this apply to" pickers. */
const surfaceChip = (path, on) => `
  <button class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
    on ? 'border-foreground/40 bg-muted/60 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50'
  }">
    ${on ? '<i class="ri-check-line text-xs"></i>' : ''}${path}
  </button>`

/** Horizontal utilization meter. pct 0-100. */
const meter = (pct, tone = 'auto') => {
  const resolved = tone === 'auto' ? (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok') : tone
  const bar = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-destructive' }[resolved]
  return `
    <div class="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div class="h-full rounded-full ${bar}" style="width:${pct}%"></div>
    </div>`
}

/**
 * Underlined tab strip. Used by every screen that has sub-views, so the
 * treatment stays identical across Routing / Providers / Activity /
 * Settings instead of each page inventing its own.
 * items: [{ id, label, count?, href? }]
 */
const tabs = (items, activeId) =>
  items
    .map((t) => {
      const on = t.id === activeId
      const cls = on
        ? 'border-b-foreground font-medium'
        : 'border-b-transparent text-muted-foreground hover:text-foreground'
      const count =
        t.count === undefined || t.count === ''
          ? ''
          : `<span class="font-mono text-[10px] tabular-nums text-muted-foreground">${t.count}</span>`
      const tag = t.href ? 'a' : 'button'
      const href = t.href ? ` href="${t.href}"` : ''
      return `<${tag}${href} class="flex items-center gap-2 border-b-2 px-3 py-2 text-xs transition-colors ${cls}">${t.label}${count}</${tag}>`
    })
    .join('')

/** Left rail item (Settings sections, Providers list). */
const railItem = (item, activeId) => {
  const on = item.id === activeId
  const cls = on
    ? 'border-l-foreground bg-muted/60 font-medium'
    : 'border-l-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  const href = item.href ? ` href="${item.href}"` : ''
  return `<a${href} class="flex items-center gap-2.5 border-l-2 px-4 py-2 text-xs transition-colors ${cls}"><i class="${item.icon} text-sm leading-none opacity-80"></i>${item.label}</a>`
}

/** Settings section rail — shared by every settings-* mock. */
const SETTINGS_RAIL = [
  { id: 'server', label: 'Server', icon: 'ri-server-line', href: 'settings.html' },
  { id: 'auth', label: 'Access', icon: 'ri-key-2-line', href: 'settings-access.html' },
  { id: 'logging', label: 'Logging', icon: 'ri-file-list-2-line', href: 'settings-logging.html' },
  { id: 'personas', label: 'Personas', icon: 'ri-user-voice-line', href: 'settings-personas.html' },
  { id: 'statusline', label: 'Status line', icon: 'ri-layout-bottom-line', href: 'settings-statusline.html' },
  { id: 'presets', label: 'Presets', icon: 'ri-archive-drawer-line', href: 'settings-presets.html' },
  { id: 'advanced', label: 'Advanced', icon: 'ri-terminal-box-line', href: 'settings-advanced.html' }
]

const btn = (label, variant = 'ghost', icon = '') => {
  const variants = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline: 'border border-border hover:bg-muted/60',
    ghost: 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'
  }
  return `<button class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${variants[variant]}">
    ${icon ? `<i class="${icon} text-sm leading-none"></i>` : ''}${label}
  </button>`
}

  global.Shell = {
    renderShell, ROW, section, pill, mono, meter, btn,
    tabs, railItem, SETTINGS_RAIL,
    SURFACES, surfacePill, surfaceChip,
    toggleTheme, currentTheme
  }
})(window)
