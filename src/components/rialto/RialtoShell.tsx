/**
 * Rialto application shell — the navigation tree and the frame every
 * screen renders into.
 *
 * Replaces the 21-item `AppShell` navigation: the old build gave each
 * absorbed component its own top-level entry, which is why Router-related
 * settings were spread across five sibling links. The information
 * architecture here is the one the approved mocks use
 * (`mocks/_shared/shell.js`).
 *
 * The sidebar is the app's ONLY navigation. Sub-views live in it as a
 * second level rather than in a section rail (Settings) or a tab strip
 * (Routing, Activity): two vertical menus side by side spent 27rem on
 * navigation before any content began, and a horizontal strip meant the
 * same list existed in two shapes depending on which screen you were on.
 * With one tree the rule has no exceptions — sidebar navigates, the
 * content area holds nothing but content.
 *
 * Providers is deliberately childless. Its rail is a list of objects with
 * quota meters and live/invalid state, which makes it data; folding it in
 * here would turn the menu into a dashboard.
 */
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useConfig } from '@/components/ConfigProvider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Toaster } from '@/components/ui/sonner'
import { api, type HealthResponse, type IdentityResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/version'

/** A destination. Sub-entries are leaves, which is why they are a type of
 *  their own rather than a NavEntry with an empty list to carry around. */
interface NavChild {
  id: string
  labelKey: string
  icon: string
  href: string
}

interface NavEntry extends NavChild {
  children: readonly NavChild[]
}

/**
 * Sub-entries carry no counts on purpose. A menu answers "where can I go",
 * not "how much is in there", and those numbers move on every request — a
 * sidebar carrying them ticks in the corner of the eye while you read
 * something else. The screens still show them where the data is.
 */
const NAV: readonly NavEntry[] = [
  { id: 'overview', labelKey: 'shell.navOverview', icon: 'ri-dashboard-3-line', href: '/overview', children: [] },
  {
    id: 'routing',
    labelKey: 'shell.navRouting',
    icon: 'ri-git-branch-line',
    href: '/routing',
    children: [
      { id: 'chain', labelKey: 'routing.common.tabChain', icon: 'ri-list-ordered', href: '/routing' },
      { id: 'map', labelKey: 'routing.common.tabMap', icon: 'ri-node-tree', href: '/routing/map' },
      { id: 'rules', labelKey: 'routing.common.tabRules', icon: 'ri-filter-3-line', href: '/routing/rules' }
    ]
  },
  { id: 'providers', labelKey: 'shell.navProviders', icon: 'ri-plug-line', href: '/providers', children: [] },
  {
    id: 'activity',
    labelKey: 'shell.navActivity',
    icon: 'ri-pulse-line',
    href: '/activity',
    children: [
      { id: 'sessions', labelKey: 'activity.common.tabSessions', icon: 'ri-chat-1-line', href: '/activity' },
      { id: 'requests', labelKey: 'activity.common.tabRequests', icon: 'ri-exchange-line', href: '/activity/requests' },
      { id: 'usage', labelKey: 'activity.common.tabUsage', icon: 'ri-battery-2-line', href: '/activity/usage' },
      { id: 'logs', labelKey: 'activity.common.tabLogs', icon: 'ri-file-list-2-line', href: '/activity/logs' }
    ]
  },
  {
    id: 'settings',
    labelKey: 'shell.navSettings',
    icon: 'ri-settings-3-line',
    href: '/settings',
    children: [
      { id: 'server', labelKey: 'settings.rail.server', icon: 'ri-server-line', href: '/settings' },
      { id: 'access', labelKey: 'settings.rail.access', icon: 'ri-key-2-line', href: '/settings/access' },
      { id: 'logging', labelKey: 'settings.rail.logging', icon: 'ri-file-list-2-line', href: '/settings/logging' },
      { id: 'personas', labelKey: 'settings.rail.personas', icon: 'ri-user-voice-line', href: '/settings/personas' },
      {
        id: 'statusline',
        labelKey: 'settings.rail.statusline',
        icon: 'ri-layout-bottom-line',
        href: '/settings/statusline'
      },
      { id: 'presets', labelKey: 'settings.rail.presets', icon: 'ri-archive-drawer-line', href: '/settings/presets' },
      { id: 'advanced', labelKey: 'settings.rail.advanced', icon: 'ri-terminal-box-line', href: '/settings/advanced' }
    ]
  }
]

/** Which top-level section a path belongs to. */
export function sectionOf(pathname: string): NavEntry | undefined {
  return NAV.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`))
}

/**
 * The deepest child a path matches. Longest href first so `/routing/map`
 * does not resolve to `/routing`, which every routing path starts with.
 */
export function childOf(pathname: string): NavChild | undefined {
  const section = sectionOf(pathname)
  if (section === undefined) return undefined
  return [...section.children]
    .sort((a, b) => b.href.length - a.href.length)
    .find((child) => pathname === child.href || pathname.startsWith(`${child.href}/`))
}

function SubNavItem({ item, active }: { item: NavChild; active: boolean }) {
  const { t } = useTranslation()
  return (
    <NavLink
      to={item.href}
      className={cn(
        // Same 14px as the parent: the level is carried by the indent and
        // by weight when active. Shrinking the type as well says "less
        // important" about the row you are actually on.
        'flex items-center gap-2 rounded-md py-1.5 pr-2.5 pl-[9px] text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
      )}
    >
      <span>{t(item.labelKey)}</span>
    </NavLink>
  )
}

function NavItem({
  item,
  activeSection,
  activeChild,
  open,
  onToggle
}: {
  item: NavEntry
  activeSection: string | undefined
  activeChild: string | undefined
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const isActive = item.id === activeSection
  return (
    <>
      <div className='relative'>
        <NavLink
          to={item.href}
          className={cn(
            'flex items-center gap-2.5 rounded-md py-1.5 pr-2.5 pl-2.5 text-sm transition-colors',
            item.children.length > 0 ? 'pr-8' : '',
            isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
          )}
        >
          <i className={cn(item.icon, 'text-base leading-none opacity-80')} />
          <span>{t(item.labelKey)}</span>
        </NavLink>
        {item.children.length > 0 ? (
          // A separate control, not part of the link: expanding a section
          // to look at it is a different intent from going to it, and
          // Cloudflare's sidebar lets several groups stand open at once.
          <button
            type='button'
            aria-label={t(open ? 'shell.collapseSection' : 'shell.expandSection', { section: t(item.labelKey) })}
            aria-expanded={open}
            onClick={onToggle}
            className='absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground'
          >
            <i className={cn(open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line', 'text-sm leading-none')} />
          </button>
        ) : null}
      </div>
      {item.children.length > 0 && open ? (
        // The guide sits at 18px — dead centre of the parent's icon — and
        // the 8px after it keeps the row backgrounds off the line, which
        // otherwise reads as one thick rule with a bite taken out of it.
        <div className='ml-[18px] flex flex-col gap-0.5 border-l border-sidebar-border pl-2'>
          {item.children.map((child) => (
            <SubNavItem key={child.id} item={child} active={isActive && child.id === activeChild} />
          ))}
        </div>
      ) : null}
    </>
  )
}

/**
 * Command palette over every destination in the tree.
 *
 * Once all the sub-views are rows in one menu the menu is long enough that
 * typing beats hunting — it is the same affordance that keeps Cloudflare's
 * own deep sidebar usable, and the reason the search box earns the slot
 * above the tree.
 */
function NavSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (next: boolean) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const go = useCallback(
    (href: string) => {
      onOpenChange(false)
      navigate(href)
    },
    [navigate, onOpenChange]
  )
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('shell.search')}>
      <CommandInput placeholder={t('shell.searchPlaceholder')} />
      <CommandList>
        <CommandEmpty>{t('shell.searchEmpty')}</CommandEmpty>
        {NAV.map((section) => (
          <CommandGroup key={section.id} heading={t(section.labelKey)}>
            <CommandItem value={t(section.labelKey)} onSelect={() => go(section.href)}>
              <i className={cn(section.icon, 'text-base leading-none opacity-80')} />
              {t(section.labelKey)}
            </CommandItem>
            {section.children.map((child) => (
              <CommandItem
                key={child.id}
                // The section name is in the value so "activity logs"
                // finds the child the way the breadcrumb reads it.
                value={`${t(section.labelKey)} ${t(child.labelKey)}`}
                onSelect={() => go(child.href)}
              >
                <i className={cn(child.icon, 'text-base leading-none opacity-80')} />
                {t(child.labelKey)}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
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
    <NavLink to='/settings/access' className={FOOTER_ROW}>
      <i className={cn('w-4 shrink-0 text-base leading-none', icon)} />
      <span className='truncate text-sidebar-foreground/70'>
        {identity?.email ? identity.email : t('settings.access.viaThisMachine')}
      </span>
      <span className='ml-auto shrink-0 font-mono text-[11px] text-muted-foreground'>{label}</span>
    </NavLink>
  )
}

/**
 * The three footer rows share the nav's row geometry — 16px icon slot,
 * gap-2.5, px-2.5 py-1.5, 14px label. They had grown three different
 * indents (a 6px dot, a 14px icon and a 16px icon, with two gaps), so
 * their labels started at 24 / 34 / 36px while the nav above started at 44.
 */
const FOOTER_ROW =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/60'

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
    <NavLink to='/settings/advanced?tab=health' className={FOOTER_ROW}>
      {/* The dot keeps its 6px but sits centred in the same 16px slot the
          icons use — the only way a dot and a glyph share a column. */}
      <span className='flex w-4 shrink-0 items-center justify-center'>
        <span className={cn('size-1.5 rounded-full', dot)} />
      </span>
      <span className='text-sidebar-foreground/70'>{label}</span>
      <span className='ml-auto font-mono text-[11px] text-muted-foreground'>{port ? `:${port}` : '—'}</span>
    </NavLink>
  )
}

export function RialtoShell() {
  // No auth branch here: a 401 never reaches this component, because
  // ProtectedRoute sends it to /access-denied before the shell mounts.
  const { t } = useTranslation()
  const { config } = useConfig()
  const { resolvedTheme, setTheme } = useTheme()
  const { pathname } = useLocation()
  const [identity, setIdentity] = useState<IdentityResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [reachable, setReachable] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /**
   * Sections the operator has explicitly opened or closed, by id.
   *
   * Not a list of open ones: the section you are in opens by default, and
   * a list could only ever add to that — which made the chevron on the
   * current section a dead control, since the default kept re-opening what
   * the click had just removed. An explicit true/false is the only shape
   * that lets a choice overrule a default.
   */
  const [choice, setChoice] = useState<Readonly<Record<string, boolean>>>({})

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeSection = sectionOf(pathname)?.id
  const activeChild = childOf(pathname)?.id
  const port = config?.PORT
  const themeLabel = mounted && resolvedTheme ? resolvedTheme : ''

  // Open by default only where you are; an explicit choice wins over that.
  const isOpen = useCallback(
    (id: string) => {
      const explicit = choice[id]
      return explicit === undefined ? id === activeSection : explicit
    },
    [choice, activeSection]
  )
  const toggle = useCallback((id: string) => setChoice((prev) => ({ ...prev, [id]: !isOpen(id) })), [isOpen])

  // Arriving in a section forgets an earlier choice about it, so a section
  // you navigate INTO always opens. Without this, closing Settings once
  // meant every later visit landed on a section whose own pages were
  // hidden. Depending on `activeSection` alone keeps a collapse made while
  // already inside the section — that one is about the section you are
  // looking at, not about arriving.
  useEffect(() => {
    if (activeSection === undefined) return
    setChoice((prev) =>
      activeSection in prev ? Object.fromEntries(Object.entries(prev).filter(([id]) => id !== activeSection)) : prev
    )
  }, [activeSection])

  return (
    <div className='flex h-screen w-full overflow-hidden bg-background text-foreground'>
      <aside className='flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar'>
        <div className='flex h-14 items-center gap-2 border-b border-sidebar-border px-4'>
          <div className='flex size-6 items-center justify-center rounded bg-foreground text-background'>
            <i className='ri-route-line text-sm leading-none' />
          </div>
          <span className='text-sm font-semibold tracking-tight'>Rialto</span>
          <span className='ml-auto font-mono text-[11px] text-muted-foreground'>v{APP_VERSION}</span>
        </div>

        <nav className='flex flex-1 flex-col gap-0.5 overflow-y-auto p-2'>
          <div className='px-0 pb-2'>
            <button
              type='button'
              onClick={() => setSearchOpen(true)}
              className='flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60'
            >
              <i className='ri-search-line text-base leading-none' />
              <span>{t('shell.searchPlaceholder')}</span>
              <span className='ml-auto font-mono text-[11px] opacity-60'>⌘K</span>
            </button>
          </div>
          {NAV.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              activeSection={activeSection}
              activeChild={activeChild}
              open={isOpen(item.id)}
              onToggle={() => toggle(item.id)}
            />
          ))}
        </nav>

        <div className='border-t border-sidebar-border p-2'>
          <ServingRow health={health} reachable={reachable} port={port} />
          <IdentityRow identity={identity} />
          <button
            type='button'
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className={cn(FOOTER_ROW, 'text-sidebar-foreground/70')}
          >
            <i className='ri-contrast-2-line w-4 shrink-0 text-base leading-none opacity-80' />
            <span>{t('shell.theme')}</span>
            <span className='ml-auto font-mono text-[11px] text-muted-foreground'>{themeLabel}</span>
          </button>
        </div>
      </aside>

      <div className='flex min-w-0 flex-1 flex-col'>
        <Outlet />
      </div>
      <NavSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <Toaster />
    </div>
  )
}
