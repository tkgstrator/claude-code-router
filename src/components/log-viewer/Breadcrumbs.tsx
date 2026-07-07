import { Fragment } from 'react'

export interface BreadcrumbItem {
  id: string
  label: string
  onClick: () => void
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav className='flex items-center space-x-1 text-sm'>
      {items.map((breadcrumb, index) => (
        <Fragment key={breadcrumb.id}>
          {index > 0 && <span className='text-muted-foreground mx-1'>/</span>}
          {index === items.length - 1 ? (
            <span className='text-foreground font-medium'>{breadcrumb.label}</span>
          ) : (
            <button onClick={breadcrumb.onClick} className='text-primary hover:text-primary/80 transition-colors'>
              {breadcrumb.label}
            </button>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
