import { cn } from '@/lib/utils'

// Shared max content width so pages don't stretch edge-to-edge on wide
// monitors now that flat sections no longer sit inside width-capped cards.
// Left-aligned (no auto margins); header and content share the same cap so
// their left edges line up. Pass `fluid` to opt out on full-bleed pages
// (e.g. the routing canvas).
const CONTENT_WIDTH = 'w-full max-w-6xl'

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex h-full flex-col', className)}>{children}</div>
}

export function PageHeader({
  title,
  children,
  extra,
  className,
  fluid = false
}: {
  title: string
  children?: React.ReactNode
  extra?: React.ReactNode
  className?: string
  fluid?: boolean
}) {
  return (
    <div className={cn('shrink-0 border-b px-6', className)}>
      <div className={fluid ? 'w-full' : CONTENT_WIDTH}>
        <div className='flex h-16 items-center justify-between'>
          <h1 className='text-lg font-semibold'>{title}</h1>
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
  return <div className={cn('flex-1 overflow-auto px-6 py-4', fluid ? '' : CONTENT_WIDTH, className)}>{children}</div>
}
