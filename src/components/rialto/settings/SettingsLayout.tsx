/**
 * Settings frame: the section rail plus the pane its sections render into.
 *
 * SettingsPage / Presets / Personas / StatusLine / Debug were five
 * separate top-level nav entries. They all answer "configure this
 * installation", so they collapse into one screen with a rail — which
 * also means the rail markup lives here once instead of being repeated
 * by each section.
 */
import type { ReactNode } from 'react'
import { type RailEntry, RailItem } from '@/components/rialto/primitives'
import { Screen } from '@/components/rialto/Screen'

export const SETTINGS_RAIL: RailEntry[] = [
  { id: 'server', label: 'Server', icon: 'ri-server-line', href: '/settings' },
  { id: 'access', label: 'Access', icon: 'ri-key-2-line', href: '/settings/access' },
  { id: 'logging', label: 'Logging', icon: 'ri-file-list-2-line', href: '/settings/logging' },
  { id: 'personas', label: 'Personas', icon: 'ri-user-voice-line', href: '/settings/personas' },
  { id: 'statusline', label: 'Status line', icon: 'ri-layout-bottom-line', href: '/settings/statusline' },
  { id: 'presets', label: 'Presets', icon: 'ri-archive-drawer-line', href: '/settings/presets' },
  { id: 'advanced', label: 'Advanced', icon: 'ri-terminal-box-line', href: '/settings/advanced' }
]

export function SettingsLayout({
  active,
  title,
  subtitle,
  actions,
  headerNote,
  headerBadge,
  headerActions,
  showHeading = true,
  children
}: {
  active: string
  title: ReactNode
  subtitle?: ReactNode
  /** Actions for the app-level title bar. */
  actions?: ReactNode
  /** The one-line explanation beside the section heading. */
  headerNote?: ReactNode
  /** Status pill beside the section heading (Access shows one). */
  headerBadge?: ReactNode
  /** Actions for the section heading row (Restart, Save, …). */
  headerActions?: ReactNode
  /**
   * Sections whose own first element is a tab strip (Advanced) open
   * straight into it — a heading above the strip is not in the design
   * and would push everything below it out of alignment with the rest.
   */
  showHeading?: boolean
  children: ReactNode
}) {
  const section = SETTINGS_RAIL.find((r) => r.id === active)
  return (
    <Screen title={title} subtitle={subtitle} actions={actions}>
      <div className='grid h-full grid-cols-[13rem_1fr]'>
        <aside className='min-w-0 overflow-y-auto border-r border-border py-3'>
          {SETTINGS_RAIL.map((item) => (
            <RailItem key={item.id} item={item} active={active} />
          ))}
        </aside>
        <div className='min-w-0 overflow-y-auto'>
          {showHeading ? (
            <div className='flex items-center gap-3 px-6 pt-6 pb-3'>
              <h2 className='text-sm font-semibold'>{section === undefined ? '' : section.label}</h2>
              {headerBadge}
              {headerNote ? <span className='text-[11px] text-muted-foreground'>{headerNote}</span> : null}
              {headerActions ? <div className='ml-auto'>{headerActions}</div> : null}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </Screen>
  )
}

/**
 * One labelled row of the settings form: a fixed-width label column with
 * its hint, and the control. Fixed so controls line up down the pane
 * regardless of how long each label is.
 */
export function SettingsField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className='grid grid-cols-[14rem_1fr] items-start gap-6 border-t border-border/60 px-6 py-4'>
      <div>
        <div className='text-xs font-medium'>{label}</div>
        {hint ? <div className='mt-0.5 text-[11px] leading-snug text-muted-foreground'>{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  )
}
