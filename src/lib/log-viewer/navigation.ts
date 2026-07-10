import type { BreadcrumbItem } from '@/components/log-viewer/Breadcrumbs'
import type { LogFile } from './types'

interface BuildBreadcrumbsParams {
  t: (key: string) => string
  selectedFile: LogFile | null
  selectedReqId: string | null
  resetToFileList: () => void
  onFileBreadcrumbClick: () => void
}

// Build the breadcrumb items
export function buildBreadcrumbs({
  t,
  selectedFile,
  selectedReqId,
  resetToFileList,
  onFileBreadcrumbClick
}: BuildBreadcrumbsParams): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [
    {
      id: 'root',
      label: t('log_viewer.title'),
      onClick: resetToFileList
    }
  ]

  if (selectedFile) {
    breadcrumbs.push({
      id: 'file',
      label: selectedFile.name,
      onClick: onFileBreadcrumbClick
    })
  }

  if (selectedReqId) {
    breadcrumbs.push({
      id: 'req',
      label: `${t('log_viewer.request')} ${selectedReqId}`,
      onClick: () => {
        // Do nothing when the current level is clicked
      }
    })
  }

  return breadcrumbs
}

// Resolve the back-button handler
export function resolveBackAction(
  selectedFile: LogFile | null,
  selectedReqId: string | null,
  onBackFromReqId: () => void,
  resetToFileList: () => void
): (() => void) | null {
  if (selectedReqId) return onBackFromReqId
  if (selectedFile) return resetToFileList
  return null
}
