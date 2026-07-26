import { Info, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PresetMetadata } from '@/lib/presets/types'

interface PresetListItemProps {
  preset: PresetMetadata
  onViewDetail: (preset: PresetMetadata) => void
  onRequestDelete: (presetId: string) => void
}

export function PresetListItem({ preset, onViewDetail, onRequestDelete }: PresetListItemProps) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-md px-2 py-3 hover:bg-muted/50 transition-colors'>
      <div className='flex-1'>
        <div className='flex items-center gap-2'>
          <h3 className='font-medium'>{preset.name}</h3>
          <span className='text-xs text-muted-foreground'>v{preset.version}</span>
        </div>
        {preset.description && <p className='text-sm text-muted-foreground mt-1'>{preset.description}</p>}
        {preset.author && <p className='text-xs text-muted-foreground mt-1'>by {preset.author}</p>}
      </div>
      <div className='flex items-center gap-2'>
        <Button variant='ghost' size='icon' onClick={() => onViewDetail(preset)}>
          <Info className='h-4 w-4' />
        </Button>
        <Button variant='ghost' size='icon' onClick={() => onRequestDelete(preset.id)}>
          <Trash2 className='h-4 w-4 text-red-500' />
        </Button>
      </div>
    </div>
  )
}
