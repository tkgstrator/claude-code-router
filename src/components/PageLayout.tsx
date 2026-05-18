import { cn } from '@/lib/utils'

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex h-full flex-col', className)}>{children}</div>
}

export function PageHeader({
  title,
  children,
  extra,
  className
}: {
  title: string
  children?: React.ReactNode
  extra?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('shrink-0 border-b px-6', className)}>
      <div className='flex h-16 items-center justify-between'>
        <h1 className='text-lg font-semibold'>{title}</h1>
        {children && <div className='flex items-center gap-2'>{children}</div>}
      </div>
      {extra && <div className='pb-4'>{extra}</div>}
    </div>
  )
}

export function PageContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex-1 overflow-auto px-6 py-4', className)}>{children}</div>
}
