import { cn } from '@/lib/utils'

// Single source of truth for the shared page shell. Every routed page gets
// the same gutters and section rhythm from here:
//
// - Full-width, no cap: pages use the whole viewport width. Sections that
//   repeat items are expected to lay them out in responsive grids so content
//   stays a comfortable size instead of stretching thin.
// - LEFT-aligned (no `mx-auto`) on purpose: the header doesn't scroll but the
//   content does, so a vertical scrollbar in PageContent would shift a
//   *centered* block left by ~half the scrollbar width and misalign it from
//   the header. Left-aligned keeps both left edges pinned to the same gutter
//   regardless of the scrollbar.
// - `px-6` lives on the inner width box in BOTH header and content, so the
//   header title and page content share the exact same left edge.
// - PageContent spaces its direct children with `gap-6` and pads with
//   `py-6`, giving all pages one vertical rhythm (24px).
//
// `fluid` remains for full-bleed pages that manage their own padding/scroll
// (e.g. the routing canvas or master-detail splits).
const CONTENT_WIDTH = 'w-full'

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex h-full flex-col', className)}>{children}</div>
}

export function PageHeader({
  title,
  children,
  extra,
  leading,
  className,
  fluid = false
}: {
  title: string
  children?: React.ReactNode
  extra?: React.ReactNode
  leading?: React.ReactNode
  className?: string
  fluid?: boolean
}) {
  return (
    <div className={cn('shrink-0 border-b', className)}>
      <div className={cn('px-6', fluid ? 'w-full' : CONTENT_WIDTH)}>
        <div className='flex h-16 items-center justify-between'>
          <div className='flex items-center gap-3'>
            {leading}
            <h1 className='text-lg font-semibold'>{title}</h1>
          </div>
          {children && <div className='flex items-center gap-2'>{children}</div>}
        </div>
        {extra && <div className='pb-4'>{extra}</div>}
      </div>
    </div>
  )
}

export function PageContent({
  children,
  className,
  fluid = false
}: {
  children: React.ReactNode
  className?: string
  fluid?: boolean
}) {
  // Outer div is the full-width scroll container (keeps the scrollbar at the
  // viewport edge); the inner box carries the shared gutters and rhythm
  // (full-width, left-aligned, no cap). It is a min-h-full flex column so
  // pages can center empty/loading states (justify-center) or fill the
  // viewport (flex-1 children).
  return (
    <div className='flex-1 overflow-auto'>
      <div className={cn('flex min-h-full flex-col gap-6 px-6 py-6', fluid ? 'w-full' : CONTENT_WIDTH, className)}>
        {children}
      </div>
    </div>
  )
}
