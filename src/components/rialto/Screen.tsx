/**
 * Page frame inside the Rialto shell: the sticky title bar plus the one
 * scrolling region beneath it.
 *
 * The shell owns the sidebar and the flex column; each screen owns its own
 * header content, so the title/subtitle/actions travel with the page
 * component instead of through a context the router has to keep in sync.
 */
import type { ReactNode } from 'react'

export function Screen({
  title,
  subtitle,
  actions,
  children
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <header className='flex h-14 shrink-0 items-center gap-4 border-b border-border px-6'>
        <div className='min-w-0'>
          <h1 className='truncate text-sm font-semibold tracking-tight'>{title}</h1>
          {subtitle ? <p className='truncate text-xs text-muted-foreground'>{subtitle}</p> : null}
        </div>
        <div className='ml-auto flex items-center gap-2'>{actions}</div>
      </header>
      <main className='min-h-0 flex-1 overflow-y-auto'>{children}</main>
    </>
  )
}
