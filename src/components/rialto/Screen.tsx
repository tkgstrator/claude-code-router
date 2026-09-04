/**
 * Page frame inside the Rialto shell: the sticky breadcrumb bar plus the
 * one scrolling region beneath it.
 *
 * The shell owns the sidebar and the flex column; each screen owns its own
 * header content, so the subtitle/actions travel with the page component
 * instead of through a context the router has to keep in sync.
 *
 * The trail is DERIVED from the route, not passed. Every screen but
 * Overview sits under one of the five sections and three of them nest a
 * level further, which a bare title could not say: "Access", "Requests"
 * and "Presets" all read as top-level screens when they are not, and the
 * titles had already drifted into naming different depths on neighbouring
 * screens ("Activity" on one, "Logs" on the next). Deriving it also means
 * the trail and the highlighted sidebar row cannot disagree.
 *
 * A page passes `crumbs` only for what the route cannot name on its own —
 * a provider, a session id.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { childOf, sectionOf } from '@/components/rialto/RialtoShell'

export interface Crumb {
  label: ReactNode
  href?: string
}

export function Screen({
  crumbs = [],
  subtitle,
  actions,
  children
}: {
  crumbs?: readonly Crumb[]
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const section = sectionOf(pathname)
  const child = childOf(pathname)
  const trail: Crumb[] = [
    ...(section === undefined ? [] : [{ label: t(section.labelKey), href: section.href }]),
    ...(child === undefined ? [] : [{ label: t(child.labelKey), href: child.href }]),
    ...crumbs
  ]
  return (
    <>
      <header className='flex h-14 shrink-0 items-center gap-4 border-b border-border px-6'>
        <div className='min-w-0'>
          <h1 className='truncate text-sm font-semibold tracking-tight'>
            {trail.map((crumb, i) => {
              const last = i === trail.length - 1
              return (
                // Index keys: the trail is positional and short-lived, and
                // a crumb's label is not unique (two "Sessions" can appear
                // at different depths).
                // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
                <span key={i}>
                  {i === 0 ? null : <span className='px-1.5 font-normal text-muted-foreground/40'>/</span>}
                  {last || crumb.href === undefined ? (
                    crumb.label
                  ) : (
                    <Link
                      to={crumb.href}
                      className='font-normal text-muted-foreground transition-colors hover:text-foreground'
                    >
                      {crumb.label}
                    </Link>
                  )}
                </span>
              )
            })}
          </h1>
          {subtitle ? <p className='truncate text-xs text-muted-foreground'>{subtitle}</p> : null}
        </div>
        <div className='ml-auto flex items-center gap-2'>{actions}</div>
      </header>
      <main className='min-h-0 flex-1 overflow-y-auto'>{children}</main>
    </>
  )
}
