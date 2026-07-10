import { ArrowLeft, Download, Layers, RefreshCw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type BreadcrumbItem, Breadcrumbs } from './Breadcrumbs'

interface LogViewerHeaderProps {
  backAction: (() => void) | null
  breadcrumbs: BreadcrumbItem[]
  showFileActions: boolean
  groupByReqId: boolean
  onToggleGroupByReqId: () => void
  autoRefresh: boolean
  onToggleAutoRefresh: () => void
  onDownload: () => void
  onClear: () => void
  hasLogs: boolean
  onClose: () => void
  t: (key: string) => string
}

export function LogViewerHeader({
  backAction,
  breadcrumbs,
  showFileActions,
  groupByReqId,
  onToggleGroupByReqId,
  autoRefresh,
  onToggleAutoRefresh,
  onDownload,
  onClear,
  hasLogs,
  onClose,
  t
}: LogViewerHeaderProps) {
  return (
    <div className='flex items-center justify-between border-b p-4'>
      <div className='flex items-center gap-2'>
        {backAction && (
          <Button variant='ghost' size='sm' onClick={backAction}>
            <ArrowLeft className='h-4 w-4 mr-2' />
            {t('log_viewer.back')}
          </Button>
        )}

        {/* Breadcrumb navigation */}
        <Breadcrumbs items={breadcrumbs} />
      </div>
      <div className='flex gap-2'>
        {showFileActions && (
          <>
            <Button
              variant='ghost'
              size='sm'
              onClick={onToggleGroupByReqId}
              className={groupByReqId ? 'bg-primary/10 text-primary' : ''}
            >
              <Layers className='h-4 w-4 mr-2' />
              {groupByReqId ? t('log_viewer.grouped_on') : t('log_viewer.group_by_req_id')}
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={onToggleAutoRefresh}
              className={autoRefresh ? 'bg-primary/10 text-primary' : ''}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? t('log_viewer.auto_refresh_on') : t('log_viewer.auto_refresh_off')}
            </Button>
            <Button variant='outline' size='sm' onClick={onDownload} disabled={!hasLogs}>
              <Download className='h-4 w-4 mr-2' />
              {t('log_viewer.download')}
            </Button>
            <Button variant='outline' size='sm' onClick={onClear} disabled={!hasLogs}>
              <Trash2 className='h-4 w-4 mr-2' />
              {t('log_viewer.clear')}
            </Button>
          </>
        )}
        <Button variant='outline' size='sm' onClick={onClose}>
          <X className='h-4 w-4 mr-2' />
          {t('log_viewer.close')}
        </Button>
      </div>
    </div>
  )
}
