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
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
          {files.map((file) => (
            <div
              key={file.path}
              className='border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors'
              onClick={() => onSelect(file)}
            >
              <div className='flex items-start justify-between mb-2'>
                <div className='flex items-center gap-2'>
                  <File className='h-5 w-5 text-primary' />
                  <span className='font-medium text-sm'>{file.name}</span>
                </div>
              </div>
              <div className='text-xs text-muted-foreground space-y-1'>
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
