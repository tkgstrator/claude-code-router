import { ArrowLeft, Download, Layers, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { ShellOutletContext } from '@/components/AppShell'
import { Breadcrumbs } from '@/components/log-viewer/Breadcrumbs'
import { LogEditor } from '@/components/log-viewer/LogEditor'
import { LogFileList } from '@/components/log-viewer/LogFileList'
import { RequestGroupList } from '@/components/log-viewer/RequestGroupList'
import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { createDebugClickHandler } from '@/lib/log-viewer/debug-navigation'
import { formatLogsForEditor, getFinalRequestLines } from '@/lib/log-viewer/logs'
import { createEditorMountHandler } from '@/lib/log-viewer/monaco-debug-gutter'
import { buildBreadcrumbs, resolveBackAction } from '@/lib/log-viewer/navigation'
import type { GroupedLogsResponse, LogFile } from '@/lib/log-viewer/types'
import { createInlineWorker } from '@/lib/log-viewer/worker'

export function LogViewer() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useOutletContext<ShellOutletContext>()
  const [logs, setLogs] = useState<string[]>([])
  const [logFiles, setLogFiles] = useState<LogFile[]>([])
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [groupByReqId, setGroupByReqId] = useState(false)
  const [groupedLogs, setGroupedLogs] = useState<GroupedLogsResponse | null>(null)
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  const refreshInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const workerRef = useRef<Worker | null>(null)
  const editorRef = useRef<any>(null)

  useEffect(() => {
    loadLogFiles()
  }, [])

  // Initialize the Web Worker
  useEffect(() => {
    if (typeof Worker !== 'undefined') {
      try {
        // Create the inline Web Worker
        workerRef.current = createInlineWorker()

        // Listen for messages from the Worker
        workerRef.current.onmessage = (event) => {
          const { type, data, error } = event.data

          if (type === 'groupLogsResult') {
            setGroupedLogs(data)
          } else if (type === 'error') {
            console.error('Worker error:', error)
            showToast(t('log_viewer.worker_error') + ': ' + error, 'error')
          }
        }

        // Listen for Worker errors
        workerRef.current.onerror = (error) => {
          console.error('Worker error:', error)
          showToast(t('log_viewer.worker_init_failed'), 'error')
        }
      } catch (error) {
        console.error('Failed to create worker:', error)
        showToast(t('log_viewer.worker_init_failed'), 'error')
      }
    }

    // Clean up the Worker
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [showToast, t])

  useEffect(() => {
    if (autoRefresh && selectedFile) {
      refreshInterval.current = setInterval(() => {
        loadLogs()
      }, 5000) // Refresh every 5 seconds
    } else if (refreshInterval.current) {
      clearInterval(refreshInterval.current)
    }

    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current)
      }
    }
  }, [autoRefresh, selectedFile])

  // Load logs when selected file changes
  useEffect(() => {
    if (selectedFile) {
      setLogs([]) // Clear existing logs
      loadLogs()
    }
  }, [selectedFile])

  const loadLogFiles = async () => {
    try {
      setIsLoading(true)
      const response = await api.getLogFiles()

      if (response && Array.isArray(response)) {
        setLogFiles(response)
        setSelectedFile(null)
        setLogs([])
      } else {
        setLogFiles([])
        showToast(t('log_viewer.no_log_files_available'), 'warning')
      }
    } catch (error) {
      console.error('Failed to load log files:', error)
      showToast(t('log_viewer.load_files_failed') + ': ' + (error as Error).message, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const loadLogs = async () => {
    if (!selectedFile) return

    try {
      setIsLoading(true)
      setGroupedLogs(null)
      setSelectedReqId(null)

      // Always load the raw log data
      const response = await api.getLogs(selectedFile.path)

      if (response && Array.isArray(response)) {
        // The endpoint now returns an array of raw log strings - store it directly
        setLogs(response)

        // If grouping is enabled, aggregate via the Web Worker (must convert to LogEntry shape for the Worker)
        if (groupByReqId && workerRef.current) {
          workerRef.current.postMessage({
            type: 'groupLogsByReqId',
            data: { logs: response }
          })
        } else {
          setGroupedLogs(null)
        }
      } else {
        setLogs([])
        setGroupedLogs(null)
        showToast(t('log_viewer.no_logs_available'), 'warning')
      }
    } catch (error) {
      console.error('Failed to load logs:', error)
      showToast(t('log_viewer.load_failed') + ': ' + (error as Error).message, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const clearLogs = async () => {
    if (!selectedFile) return

    try {
      await api.clearLogs(selectedFile.path)
      setLogs([])
      showToast(t('log_viewer.logs_cleared'), 'success')
    } catch (error) {
      console.error('Failed to clear logs:', error)
      showToast(t('log_viewer.clear_failed') + ': ' + (error as Error).message, 'error')
    }
  }

  const selectFile = (file: LogFile) => {
    setSelectedFile(file)
    setAutoRefresh(false) // Reset auto refresh when changing files
  }

  const toggleGroupByReqId = () => {
    const newValue = !groupByReqId
    setGroupByReqId(newValue)

    if (newValue && selectedFile && logs.length > 0) {
      // When enabling aggregation, if logs are already loaded, send them to the Worker
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'groupLogsByReqId',
          data: { logs }
        })
      }
    } else if (!newValue) {
      // When disabling aggregation, clear the cached result
      setGroupedLogs(null)
      setSelectedReqId(null)
    }
  }

  const selectReqId = (reqId: string) => {
    setSelectedReqId(reqId)
  }

  const downloadLogs = () => {
    if (!selectedFile || logs.length === 0) return

    // Download the raw log strings directly, one entry per line
    const logText = logs.join('\n')

    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedFile.name}-${dayjs().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    showToast(t('log_viewer.logs_downloaded'), 'success')
  }

  // Reset back to the root file-list view
  const resetToFileList = () => {
    setSelectedFile(null)
    setAutoRefresh(false)
    setLogs([])
    setGroupedLogs(null)
    setSelectedReqId(null)
    setGroupByReqId(false)
  }

  // Clicking the file-level breadcrumb pops back to the group list in
  // grouping mode, or clears grouping entirely otherwise.
  const onFileBreadcrumbClick = () => {
    if (groupByReqId) {
      setSelectedReqId(null)
    } else {
      setSelectedReqId(null)
      setGroupedLogs(null)
      setGroupByReqId(false)
    }
  }

  const breadcrumbs = buildBreadcrumbs({ t, selectedFile, selectedReqId, resetToFileList, onFileBreadcrumbClick })
  const backAction = resolveBackAction(selectedFile, selectedReqId, () => setSelectedReqId(null), resetToFileList)

  // Console-style: newest lines at the top for the file-wide view. Within
  // a single drilled-in request (grouped + selectedReqId), keep
  // chronological order — it's the natural read of what happened during
  // that request.
  const inSelectedReqView = groupByReqId && selectedReqId !== null
  const displayLogs = useMemo(() => (inSelectedReqView ? logs : [...logs].reverse()), [logs, inSelectedReqView])

  const handleDebugClick = createDebugClickHandler(displayLogs, groupedLogs, groupByReqId, selectedReqId, navigate)

  const configureEditor = createEditorMountHandler(
    editorRef,
    () => getFinalRequestLines(displayLogs, groupedLogs, groupByReqId, selectedReqId),
    handleDebugClick
  )

  const showFileActions = Boolean(selectedFile)
  const hasLogs = logs.length > 0
  // Secondary bar under the title: back button + breadcrumb trail. Only
  // rendered once the user has drilled in — the root file picker doesn't
  // need it.
  const secondary = selectedFile ? (
    <div className='flex items-center gap-2'>
      {backAction && (
        <Button variant='ghost' size='sm' onClick={backAction}>
          <ArrowLeft className='h-4 w-4 mr-2' />
          {t('log_viewer.back')}
        </Button>
      )}
      <Breadcrumbs items={breadcrumbs} />
    </div>
  ) : undefined

  return (
    <PageContainer>
      <PageHeader title={t('nav.logs')} extra={secondary}>
        {showFileActions && (
          <>
            <Button
              variant='ghost'
              size='sm'
              onClick={toggleGroupByReqId}
              className={groupByReqId ? 'bg-primary/10 text-primary' : ''}
            >
              <Layers className='h-4 w-4 mr-2' />
              {groupByReqId ? t('log_viewer.grouped_on') : t('log_viewer.group_by_req_id')}
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={autoRefresh ? 'bg-primary/10 text-primary' : ''}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? t('log_viewer.auto_refresh_on') : t('log_viewer.auto_refresh_off')}
            </Button>
            <Button variant='outline' size='sm' onClick={downloadLogs} disabled={!hasLogs}>
              <Download className='h-4 w-4 mr-2' />
              {t('log_viewer.download')}
            </Button>
            <Button variant='outline' size='sm' onClick={clearLogs} disabled={!hasLogs}>
              <Trash2 className='h-4 w-4 mr-2' />
              {t('log_viewer.clear')}
            </Button>
          </>
        )}
      </PageHeader>

      <div className='flex-1 min-h-0'>
        {isLoading ? (
          <div className='flex items-center justify-center h-full'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary'></div>
          </div>
        ) : selectedFile ? (
          groupByReqId && groupedLogs && !selectedReqId ? (
            <RequestGroupList summary={groupedLogs.summary} onSelectReqId={selectReqId} t={t} />
          ) : (
            <LogEditor
              value={formatLogsForEditor(displayLogs, groupedLogs, groupByReqId, selectedReqId)}
              isDark={isDark}
              onMount={configureEditor}
            />
          )
        ) : (
          <div className='px-6 py-6'>
            <LogFileList files={logFiles} onSelect={selectFile} t={t} />
          </div>
        )}
      </div>
    </PageContainer>
  )
}
