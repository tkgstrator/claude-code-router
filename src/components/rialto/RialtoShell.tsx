/**
 * Rialto application shell — the five-item sidebar and the frame every
 * screen renders into.
 *
 * Replaces the 21-item `AppShell` navigation: the old build gave each
 * absorbed component its own top-level entry, which is why Router-related
 * settings were spread across five sibling links. The information
 * architecture here is the one the approved mocks use
 * (`mocks/_shared/shell.js`).
 */
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import { Toaster } from '@/components/ui/sonner'
import { api, type HealthResponse, type IdentityResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/version'

interface NavEntry {
  id: string
  labelKey: string
  icon: string
  href: string
}

const NAV: NavEntry[] = [
  { id: 'overview', labelKey: 'shell.navOverview', icon: 'ri-dashboard-3-line', href: '/overview' },
  { id: 'routing', labelKey: 'shell.navRouting', icon: 'ri-git-branch-line', href: '/routing' },
  { id: 'providers', labelKey: 'shell.navProviders', icon: 'ri-plug-line', href: '/providers' },
  { id: 'activity', labelKey: 'shell.navActivity', icon: 'ri-pulse-line', href: '/activity' },
  { id: 'settings', labelKey: 'shell.navSettings', icon: 'ri-settings-3-line', href: '/settings' }
]

function NavItem({ item }: { item: NavEntry }) {
  const { t } = useTranslation()
  return (
    <NavLink
      to={item.href}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
        )
      }
    >
      <i className={cn(item.icon, 'text-base leading-none opacity-80')} />
      <span>{t(item.labelKey)}</span>
    </NavLink>
  )
}

/**
 * Sidebar footer identity row.
 *
 * Display only. It reports who the edge said is calling; it never gates
 * anything. The access decision itself belongs at the edge (Cloudflare
 * Access) and in the API-key middleware, never in a rendered string.
 */
function IdentityRow({ identity }: { identity: IdentityResponse | null }) {
  const { t } = useTranslation()
  const mode = identity === null ? null : identity.mode
  // A local request presents no credential, so labelling it 'token' said
  // one had been checked when none was.
  const icon =
    mode === 'cloudflare_access'
      ? 'ri-shield-check-line text-emerald-500'
      : mode === 'local'
        ? 'ri-computer-line text-muted-foreground'
        : 'ri-key-2-line text-muted-foreground'
  const label = t(
    mode === 'cloudflare_access'
      ? 'shell.identityAccess'
      : mode === 'local'
        ? 'shell.identityLocal'
        : 'shell.identityToken'
  )
  return (
    <div className='flex items-center gap-2 rounded-md px-2.5 py-2'>
      <i className={cn('shrink-0 text-sm leading-none', icon)} />
      <span className='truncate text-xs text-sidebar-foreground/70'>
        {identity?.email ? identity.email : t('settings.access.viaThisMachine')}
      </span>
      <span className='ml-auto shrink-0 font-mono text-[10px] text-muted-foreground'>{label}</span>
    </div>
  )
}

/**
 * Sidebar serving indicator.
 *
 * The dot reports what /api/health actually said. A degraded server
 * (reachable, but a dependency check failed) is the case worth catching
 * early, and a permanently-green dot would hide exactly that.
 */
function ServingRow({
  health,
  reachable,
  port
}: {
  health: HealthResponse | null
  reachable: boolean
  port: number | undefined
}) {
  const { t } = useTranslation()
  const state = !reachable ? 'down' : health === null ? 'unknown' : health.status === 'ok' ? 'ok' : 'degraded'
  const dot = {
    ok: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    down: 'bg-destructive',
    unknown: 'bg-muted-foreground/40'
  }[state]
  const label = t(
    {
      ok: 'shell.serving',
      degraded: 'shell.degraded',
      down: 'shell.unreachable',
      unknown: 'shell.serving'
    }[state]
  )
  return (
    <div className='flex items-center gap-2 rounded-md px-2.5 py-2'>
      <span className={cn('size-1.5 shrink-0 rounded-full', dot)} />
      <span className='text-xs text-sidebar-foreground/70'>{label}</span>
      <span className='ml-auto font-mono text-[10px] text-muted-foreground'>{port ? `:${port}` : '—'}</span>
    </div>
  )
}

export function RialtoShell() {
  // No auth branch here: a 401 never reaches this component, because
  // ProtectedRoute sends it to /access-denied before the shell mounts.
  const { t } = useTranslation()
  const { config } = useConfig()
  const { resolvedTheme, setTheme } = useTheme()
  const [identity, setIdentity] = useState<IdentityResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [reachable, setReachable] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    api
      .getIdentity()
      .then(setIdentity)
      .catch(() => {
        // Display-only row; a failed probe just leaves it on the local
        // fallback rather than blocking the shell from rendering.
      })
    api
      .getHealth()
      .then((res) => {
        setHealth(res)
        setReachable(true)
      })
      .catch(() => setReachable(false))
  }, [])

  const port = config?.PORT
  const themeLabel = mounted && resolvedTheme ? resolvedTheme : ''

  return (
    <div className='flex h-screen w-full overflow-hidden bg-background text-foreground'>
      <aside className='flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar'>
        <div className='flex h-14 items-center gap-2 border-b border-sidebar-border px-4'>
          <div className='flex size-6 items-center justify-center rounded bg-foreground text-background'>
            <i className='ri-route-line text-sm leading-none' />
          </div>
          <span className='text-sm font-semibold tracking-tight'>Rialto</span>
          <span className='ml-auto font-mono text-[10px] text-muted-foreground'>v{APP_VERSION}</span>
        </div>

        <nav className='flex flex-1 flex-col gap-0.5 p-2'>
          {NAV.map((item) => (
            <NavItem key={item.id} item={item} />
          ))}
        </nav>

        <div className='border-t border-sidebar-border p-2'>
          <ServingRow health={health} reachable={reachable} port={port} />
          <IdentityRow identity={identity} />
          <button
            type='button'
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className='flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60'
          >
            <i className='ri-contrast-2-line text-base leading-none opacity-80' />
            <span>{t('shell.theme')}</span>
            <span className='ml-auto font-mono text-[10px] text-muted-foreground'>{themeLabel}</span>
          </button>
        </div>
      </aside>

      <div className='flex min-w-0 flex-1 flex-col'>
        <Outlet />
      </div>
      <Toaster />
    </div>
  )
}
