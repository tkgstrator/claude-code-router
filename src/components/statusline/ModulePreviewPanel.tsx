import type React from 'react'
import type { StatusLineModuleConfig } from '@/types'
import { renderModulePreview } from './ModulePreview'

interface ModulePreviewPanelProps {
  title: string
  dragHint: string
  fontKey: string
  fontStyle: React.CSSProperties
  currentStyle: string
  currentModules: StatusLineModuleConfig[]
  selectedModuleIndex: number | null
  onSelectModule: (index: number) => void
  onAddModule: (moduleType: string) => void
  onReorderModules: (fromIndex: number, toIndex: number) => void
}

// Middle column: renders the live preview strip, and hosts both drag targets
// (drop a module type from the left list to append, drag a chip onto another
// chip to reorder).
export function ModulePreviewPanel({
  title,
  dragHint,
  fontKey,
  fontStyle,
  currentStyle,
  currentModules,
  selectedModuleIndex,
  onSelectModule,
  onAddModule,
  onReorderModules
}: ModulePreviewPanelProps) {
  const isPowerline = currentStyle === 'powerline'

  return (
    <div className='border rounded-lg p-4 flex flex-col col-span-3'>
      <h3 className='text-sm font-medium mb-3'>{title}</h3>
      <div
        key={fontKey}
        className={`rounded bg-black/90 text-white font-mono text-sm overflow-x-auto flex items-center border border-border p-3 py-5 shadow-inner overflow-hidden ${
          isPowerline ? 'gap-0 h-8 p-0 items-center relative' : 'h-5'
        }`}
        data-testid='statusline-preview'
        style={fontStyle}
        onDragOver={(e) => {
          e.preventDefault()
        }}
        onDrop={(e) => {
          e.preventDefault()
          const moduleType = e.dataTransfer.getData('moduleType')
          if (moduleType) {
            onAddModule(moduleType)
          }
        }}
      >
        {currentModules.length > 0 ? (
          <div className='flex items-center flex-wrap gap-0'>
            {currentModules.map((module, index) => (
              <div
                key={index}
                tabIndex={0}
                className={`cursor-pointer ${selectedModuleIndex === index ? 'bg-white/20' : 'hover:bg-white/10'} ${
                  isPowerline
                    ? 'p-0 rounded-none inline-flex overflow-visible relative'
                    : 'flex items-center gap-1 px-2 py-1 rounded'
                }`}
                onClick={() => onSelectModule(index)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('dragIndex', index.toString())
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const dragIndex = parseInt(e.dataTransfer.getData('dragIndex'))
                  if (!Number.isNaN(dragIndex) && dragIndex !== index) {
                    onReorderModules(dragIndex, index)
                  }
                }}
              >
                {renderModulePreview(module, isPowerline)}
              </div>
            ))}
          </div>
        ) : (
          <div className='flex flex-col items-center justify-center w-full py-4 text-center'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='24'
              height='24'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              className='text-gray-500 mb-2'
            >
              <path d='M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' />
              <path d='M12 8v8' />
              <path d='M8 12h8' />
            </svg>
            <span className='text-gray-500 text-sm'>{dragHint}</span>
          </div>
        )}
      </div>
    </div>
  )
}
