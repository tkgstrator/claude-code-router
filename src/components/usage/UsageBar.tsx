interface UsageBarProps {
  label: string
  percent: number
  reset: string
}

export function UsageBar({ label, percent, reset }: UsageBarProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between text-sm'>
        <span className='font-medium'>{label}</span>
        <span className='text-muted-foreground'>{percent.toFixed(1)}%</span>
      </div>
      <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
        <div className='h-full rounded-full bg-blue-500' style={{ width: `${clamped}%` }} />
      </div>
      <div className='text-xs text-muted-foreground'>{reset}</div>
    </div>
  )
}
