import { File } from 'lucide-react'
import { formatDate, formatFileSize } from '@/lib/log-viewer/format'
import type { LogFile } from '@/lib/log-viewer/types'

interface LogFileListProps {
  files: LogFile[]
  onSelect: (file: LogFile) => void
  t: (key: string) => string
}

// File picker shown before any log file has been selected.
export function LogFileList({ files, onSelect, t }: LogFileListProps) {
  return (
    <div className='p-6'>
      <h3 className='text-lg font-medium mb-4'>{t('log_viewer.select_file')}</h3>
      {files.length === 0 ? (
        <div className='text-muted-foreground text-center py-8'>
          <File className='h-12 w-12 mx-auto mb-4 text-muted-foreground' />
          <p>{t('log_viewer.no_log_files_available')}</p>
        </div>
      ) : (
        <div className='divide-y border-y'>
          {files.map((file) => (
            <div
              key={file.path}
              className='flex items-center justify-between gap-3 px-1 py-3 hover:bg-muted/50 cursor-pointer transition-colors'
              onClick={() => onSelect(file)}
            >
              <div className='flex items-start justify-between'>
                <div className='flex items-center gap-2'>
                  <File className='h-5 w-5 text-primary' />
                  <span className='font-medium text-sm'>{file.name}</span>
                </div>
              </div>
              <div className='text-xs text-muted-foreground space-y-1 text-right'>
                <div>{formatFileSize(file.size)}</div>
                <div>{formatDate(file.lastModified)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
