import { ChevronRight, File } from 'lucide-react'
import { formatDate, formatFileSize } from '@/lib/log-viewer/format'
import type { LogFile } from '@/lib/log-viewer/types'

interface LogFileListProps {
  files: LogFile[]
  onSelect: (file: LogFile) => void
  t: (key: string) => string
}

// File picker shown before any log file has been selected.
export function LogFileList({ files, onSelect, t }: LogFileListProps) {
  if (files.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-16 text-muted-foreground'>
        <File className='h-12 w-12 mb-4' />
        <p>{t('log_viewer.no_log_files_available')}</p>
      </div>
    )
  }
  return (
    // Auto-fill grid: file entries sit side-by-side at a comfortable width on
    // wide screens instead of stretching edge-to-edge. Mirrors the Personas /
    // ProviderList layout.
    <div className='grid grid-cols-[repeat(auto-fill,minmax(24rem,1fr))] items-start gap-x-6 gap-y-1'>
      {files.map((file) => (
        <button
          key={file.path}
          type='button'
          // Flat row: no card bg. Left border accent on hover / focus and the
          // name goes underline, matching the shared list pattern.
          className='group flex w-full items-start gap-3 border-l-2 border-transparent px-3 py-3 text-left transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none'
          onClick={() => onSelect(file)}
        >
          <File className='mt-0.5 h-5 w-5 flex-shrink-0 text-primary' />
          <div className='min-w-0 flex-1 space-y-1'>
            <p className='truncate text-sm font-semibold text-foreground group-hover:underline'>{file.name}</p>
            <p className='text-xs text-muted-foreground'>
              {formatFileSize(file.size)} · {formatDate(file.lastModified)}
            </p>
          </div>
          <ChevronRight className='mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground' />
        </button>
      ))}
    </div>
  )
}
