interface NotRegisteredProps {
  message: string
  hint: string
  href: string
  cta: string
}

export function NotRegistered({ message, hint, href, cta }: NotRegisteredProps) {
  return (
    <div className='space-y-1 text-sm text-muted-foreground'>
      <p>{message}</p>
      <p className='text-xs'>{hint}</p>
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='inline-block text-xs font-medium text-primary hover:underline'
      >
        {cta}
      </a>
    </div>
  )
}
