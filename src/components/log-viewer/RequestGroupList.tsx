import { File } from 'lucide-react'
import { formatDate } from '@/lib/log-viewer/format'
import type { GroupedLogsResponse } from '@/lib/log-viewer/types'

interface RequestGroupListProps {
  summary: GroupedLogsResponse['summary']
  onSelectReqId: (reqId: string) => void
  t: (key: string) => string
}

// Grouped-by-reqId summary list shown when grouping is on and no request is selected yet.
export function RequestGroupList({ summary, onSelectReqId, t }: RequestGroupListProps) {
  return (
    <div className='flex flex-col h-full p-6'>
      <div className='mb-4 flex-shrink-0'>
        <h3 className='text-lg font-medium mb-2'>{t('log_viewer.request_groups')}</h3>
        <p className='text-sm text-muted-foreground'>
          {t('log_viewer.total_requests')}: {summary.totalRequests} |{t('log_viewer.total_logs')}: {summary.totalLogs}
        </p>
      </div>
      <div className='flex-1 min-h-0 overflow-y-auto space-y-3'>
        {summary.requests.map((request) => (
          <div
            key={request.reqId}
            className='border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors'
            onClick={() => onSelectReqId(request.reqId)}
          >
            <div className='flex items-center justify-between mb-2'>
              <div className='flex items-center gap-2'>
                <File className='h-5 w-5 text-primary' />
                <span className='font-medium text-sm'>{request.reqId}</span>
                {request.model && (
                  <span className='text-xs bg-green-100 text-green-800 px-2 py-1 rounded'>{request.model}</span>
                )}
              </div>
              <span className='text-xs bg-primary/10 text-primary px-2 py-1 rounded'>
                {request.logCount} {t('log_viewer.logs')}
              </span>
            </div>
            <div className='text-xs text-muted-foreground space-y-1'>
              <div>
                {t('log_viewer.first_log')}: {formatDate(request.firstLog)}
              </div>
              <div>
                {t('log_viewer.last_log')}: {formatDate(request.lastLog)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
