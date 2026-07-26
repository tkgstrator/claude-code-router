import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Transformer } from '@/types'

interface TransformerListProps {
  transformers: Transformer[]
  onEdit: (index: number) => void
  onRemove: (index: number) => void
}

export function TransformerList({ transformers, onEdit, onRemove }: TransformerListProps) {
  // Handle case where transformers might be null or undefined
  if (!transformers || !Array.isArray(transformers)) {
    return (
      <div className='flex items-center justify-center bg-muted/40 p-8 text-muted-foreground'>
        No transformers configured
      </div>
    )
  }

  return (
    // Auto-fill grid: transformer rows sit side-by-side at a comfortable
    // width on wide screens instead of stretching edge-to-edge.
    <div className='grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] items-start gap-x-6 gap-y-1'>
      {transformers.map((transformer, index) => {
        // Handle case where individual transformer might be null or undefined
        if (!transformer) {
          return (
            <div
              key={index}
              className='flex items-start justify-between gap-3 rounded-md px-2 py-3 animate-slide-in hover:bg-muted/50 transition-colors'
            >
              <div className='flex-1 space-y-1.5'>
                <p className='text-md font-semibold text-foreground'>Invalid Transformer</p>
                <p className='text-sm text-muted-foreground'>Transformer data is missing</p>
              </div>
              <div className='flex flex-shrink-0 items-center gap-2'>
                <Button variant='ghost' size='icon' onClick={() => onEdit(index)} disabled>
                  <Pencil className='h-4 w-4' />
                </Button>
                <Button variant='destructive' size='icon' onClick={() => onRemove(index)}>
                  <Trash2 className='h-4 w-4 text-current transition-colors duration-200' />
                </Button>
              </div>
            </div>
          )
        }

        // Handle case where transformer.path might be null or undefined
        const transformerPath = transformer.path || 'Unnamed Transformer'

        // Handle case where transformer.parameters might be null or undefined
        const options = transformer.options || {}

        // Render parameters as tags in a single line
        const renderParameters = () => {
          if (!options || Object.keys(options).length === 0) {
            return <p className='text-sm text-muted-foreground'>No parameters configured</p>
          }

          return (
            <div className='flex flex-wrap gap-2 max-h-8 overflow-hidden'>
              {Object.entries(options).map(([key, value]) => (
                <span
                  key={key}
                  className='inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs font-medium text-foreground border'
                >
                  <span className='text-muted-foreground'>{key}:</span>
                  <span className='ml-1 text-foreground'>{String(value)}</span>
                </span>
              ))}
            </div>
          )
        }

        return (
          <div
            key={index}
            className='flex items-start justify-between gap-3 px-1 py-3 animate-slide-in hover:bg-muted/50 transition-colors'
          >
            <div className='flex-1 space-y-1.5'>
              <p className='text-md font-semibold text-foreground'>{transformerPath}</p>
              {renderParameters()}
            </div>
            <div className='flex flex-shrink-0 items-center gap-2'>
              <Button variant='ghost' size='icon' onClick={() => onEdit(index)}>
                <Pencil className='h-4 w-4' />
              </Button>
              <Button variant='destructive' size='icon' onClick={() => onRemove(index)}>
                <Trash2 className='h-4 w-4 text-current transition-colors duration-200' />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
