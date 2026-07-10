import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortKey } from '@/lib/models/types'

interface SortHeaderProps {
  label: string
  sortKey: SortKey
  activeSortKey: SortKey | null
  sortDir: 'asc' | 'desc'
  onToggle: (key: SortKey) => void
  align?: 'left' | 'right'
}

export function SortHeader({ label, sortKey, activeSortKey, sortDir, onToggle, align = 'left' }: SortHeaderProps) {
  const active = activeSortKey === sortKey
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      type='button'
      onClick={() => onToggle(sortKey)}
      className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground`}
    >
      {label}
      <Icon className='h-3 w-3' />
    </button>
  )
}
