/**
 * Shared building blocks for the Rialto UI.
 *
 * These are the React counterparts of the string helpers in
 * `mocks/_shared/shell.js`. The class lists are copied verbatim so the
 * `ui-mock-diff` capture measures design differences, not markup drift.
 *
 * Deliberately NOT shadcn `Card`: the house pattern is a flat block with a
 * `border-l` accent plus `hover:bg-muted/50`.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

/** Flat row treatment used everywhere instead of shadcn Card. */
export const ROW = 'border-l-2 border-l-transparent px-4 py-3 transition-colors hover:bg-muted/50'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute'

/** Section container: a titled block with a hairline top rule. */
export function Section({
  title,
  meta,
  children,
  className
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('border-t border-border first:border-t-0', className)}>
      <div className='flex items-baseline gap-3 px-6 pt-6 pb-3'>
        <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>{title}</h2>
        {meta ? <span className='text-xs text-muted-foreground/70'>{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}

const PILL_TONES: Record<Tone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  mute: 'bg-muted text-muted-foreground'
}

/** Small status pill. */
export function Pill({ tone = 'mute', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
        PILL_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

/** Inline monospace token — model ids, paths, keys. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[11px] text-muted-foreground', className)}>{children}</span>
}

const METER_BARS: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-destructive'
}

const autoMeterTone = (pct: number): 'ok' | 'warn' | 'bad' => {
  if (pct >= 90) return 'bad'
  if (pct >= 70) return 'warn'
  return 'ok'
}

/** Horizontal utilization meter. pct 0-100. */
export function Meter({ pct, tone = 'auto' }: { pct: number; tone?: 'auto' | 'ok' | 'warn' | 'bad' }) {
  const resolved = tone === 'auto' ? autoMeterTone(pct) : tone
  return (
    <div className='h-1 w-full overflow-hidden rounded-full bg-muted'>
      <div className={cn('h-full rounded-full', METER_BARS[resolved])} style={{ width: `${pct}%` }} />
    </div>
  )
}

const BUTTON_VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border border-border hover:bg-muted/60',
  ghost: 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'
} as const

export type ButtonVariant = keyof typeof BUTTON_VARIANTS

/**
 * The compact 32px control used in headers and section toolbars.
 *
 * shadcn's `Button` is 36px tall with different padding, so matching the
 * mock through it would mean overriding every class that defines it.
 */
export function RButton({
  variant = 'ghost',
  icon,
  children,
  className,
  ...rest
}: {
  variant?: ButtonVariant
  icon?: string
  children: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type='button'
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
        BUTTON_VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {icon ? <i className={cn(icon, 'text-sm leading-none')} /> : null}
      {children}
    </button>
  )
}

/**
 * Underlined tab strip. Used by every screen that has sub-views, so the
 * treatment stays identical across Routing / Providers / Activity /
 * Settings instead of each page inventing its own.
 */
export interface TabItem {
  id: string
  label: string
  count?: number | string
  href?: string
}

export function Tabs({ items, active }: { items: TabItem[]; active: string }) {
  return (
    <>
      {items.map((tab) => {
        const on = tab.id === active
        const cls = cn(
          'flex items-center gap-2 border-b-2 px-3 py-2 text-xs transition-colors',
          on ? 'border-b-foreground font-medium' : 'border-b-transparent text-muted-foreground hover:text-foreground'
        )
        const count =
          tab.count === undefined || tab.count === '' ? null : (
            <span className='font-mono text-[10px] tabular-nums text-muted-foreground'>{tab.count}</span>
          )
        if (tab.href) {
          return (
            <Link key={tab.id} to={tab.href} className={cls}>
              {tab.label}
              {count}
            </Link>
          )
        }
        return (
          <button key={tab.id} type='button' className={cls}>
            {tab.label}
            {count}
          </button>
        )
      })}
    </>
  )
}

/** Left rail item (Settings sections, Providers list). */
export interface RailEntry {
  id: string
  label: string
  icon: string
  href: string
}

export function RailItem({ item, active }: { item: RailEntry; active: string }) {
  const on = item.id === active
  return (
    <Link
      to={item.href}
      className={cn(
        'flex items-center gap-2.5 border-l-2 px-4 py-2 text-xs transition-colors',
        on
          ? 'border-l-foreground bg-muted/60 font-medium'
          : 'border-l-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
    >
      <i className={cn(item.icon, 'text-sm leading-none opacity-80')} />
      {item.label}
    </Link>
  )
}

/**
 * Surface label for a table cell. Monospace so paths align down a column.
 */
export function SurfacePill({ path }: { path: string }) {
  return (
    <span className='inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'>
      {path}
    </span>
  )
}

/**
 * Chip for "which surfaces does this apply to".
 *
 * Renders as a button only when it does something. Several screens show
 * this as a derived read-out — a persona reaches whichever surfaces are
 * in routed mode, and that is not a per-persona setting — and a chip
 * that looks pressable but is inert reads as a broken control rather
 * than as information. Without `onClick` it becomes a span, keeps the
 * same weight, and explains itself on hover instead.
 */
export function SurfaceChip({
  path,
  on,
  onClick,
  readOnlyHint
}: {
  path: string
  on: boolean
  onClick?: () => void
  /** Tooltip for the read-only form: why this is showing, not settable. */
  readOnlyHint?: string
}) {
  const base = cn(
    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors',
    on ? 'border-foreground/40 bg-muted/60 text-foreground' : 'border-border text-muted-foreground'
  )
  const content = (
    <>
      {on ? <i className='ri-check-line text-xs' /> : null}
      {path}
    </>
  )

  if (onClick === undefined) {
    return (
      <span className={base} title={readOnlyHint}>
        {content}
      </span>
    )
  }

  return (
    <button type='button' onClick={onClick} className={cn(base, on ? '' : 'hover:bg-muted/50')}>
      {content}
    </button>
  )
}
